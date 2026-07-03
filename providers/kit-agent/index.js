const AGENT_RUNNER_FILE = 'src/agent_runner.js'
const BASE_CLASS = 'AgentRunner'

const CLASS_RULE = `id: agent-runner-class
language: js
rule:
  kind: class_declaration
  has:
    field: name
    pattern: $CNAME`

const METHOD_RULE = `id: agent-runner-method
language: js
rule:
  kind: method_definition
  has:
    field: name
    pattern: $MNAME`

/**
 * Provider that manages agent runner classes in src/agent_runner.js.
 *
 * Agent runners are the pluggable executors the PlanExecutor drives for plan
 * steps. This provider lists the runner subclasses of `AgentRunner`, checks that
 * each implements the runner interface using ast-grep static analysis, and
 * generates new runner subclasses.
 */
class KitAgentProvider {
	constructor(kit) {
		this.kit = kit
	}

	name() {
		return 'kit-agent'
	}

	async *types() {
		yield new KitAgentRunnerType(this.kit)
	}

	async *components() {
		if (!(await Bun.file(AGENT_RUNNER_FILE).exists())) {
			return
		}

		for (const runner of await analyzeAgentRunners(this.kit, AGENT_RUNNER_FILE)) {
			yield new KitAgentComponent(runner)
		}
	}

	create(spec, env) {
		return new KitAgentRunnerType(this.kit).create(spec, env)
	}
}

/**
 * Component type that generates an `AgentRunner` subclass in src/agent_runner.js.
 */
class KitAgentRunnerType {
	constructor(kit) {
		this.kit = kit
	}

	id() {
		return 'runner'
	}

	description() {
		return `An ${BASE_CLASS} subclass in ${AGENT_RUNNER_FILE}`
	}

	schema() {
		const { Type } = this.kit

		return Type.Object({
			name: Type.String({
				description: 'Runner name in kebab-case; the class becomes <Name>AgentRunner',
				examples: ['claude', 'codex'],
				pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
			}),
			command: Type.String({
				description: 'External CLI command the runner spawns',
				examples: ['claude', 'codex'],
			}),
			authCheckCommand: Type.Optional(
				Type.String({
					description:
						'Non-interactive shell command that exits 0 when the CLI is authenticated; enables an auth-gate step that pauses the plan until login',
					examples: ['claude whoami', 'claude whoami || test -n "$ANTHROPIC_API_KEY"'],
				}),
			),
			loginCommand: Type.Optional(
				Type.String({
					description: 'Command the developer runs to authenticate the CLI',
					examples: ['claude login'],
				}),
			),
		})
	}

	parse(argv) {
		return this.kit.parseArgs({
			args: argv,
			options: this.kit.parseArgsOptionsFromSchema(this.schema()),
			strict: true,
			allowPositionals: true,
		})
	}

	describe(spec) {
		return `Agent runner ${runnerClassName(spec.name)} spawning ${spec.command}`
	}

	async *create(spec, env) {
		const className = runnerClassName(spec.name)

		yield await env.editFile(AGENT_RUNNER_FILE, (source) => addRunnerClass(source, spec))

		if (spec.intent !== undefined) {
			yield this.kit.Event.plan(
				`Implement ${className} agent runner`,
				runnerPlanSteps(spec, className),
				{ intent: spec.intent },
			)
		}
	}
}

/**
 * Component describing one agent runner subclass discovered in src/agent_runner.js.
 */
class KitAgentComponent {
	constructor(analysis) {
		this.analysis = analysis
	}

	provider() {
		return 'kit-agent'
	}

	id() {
		return this.analysis.name
	}

	description() {
		if (this.analysis.missing.length > 0) {
			return `Agent runner ${this.analysis.name} — missing ${this.analysis.missing.join(', ')}`
		}

		return `Agent runner ${this.analysis.name} implementing ${this.analysis.methods.join(', ')}`
	}

	inspect() {
		return {
			name: this.analysis.name,
			files: [this.analysis.path],
			methods: this.analysis.methods,
			interface: this.analysis.interfaceMethods,
			missing: this.analysis.missing,
			complete: this.analysis.complete,
		}
	}
}

/**
 * Analyzes agent runner classes in a file using ast-grep.
 *
 * Runs two broad structural scans (class declarations and method definitions),
 * derives the runner interface from the `AgentRunner` base class, and correlates
 * each subclass's methods by AST byte range to report which interface methods are
 * implemented and which are missing.
 *
 * @example
 * await analyzeAgentRunners(kit, 'src/agent_runner.js')
 */
async function analyzeAgentRunners(kit, path) {
	const [classMatches, methodMatches] = await Promise.all([
		astGrepJSON(kit, ['scan', '--inline-rules', CLASS_RULE, '--json=compact', path]),
		astGrepJSON(kit, ['scan', '--inline-rules', METHOD_RULE, '--json=compact', path]),
	])

	const classes = classMatches.map((match) => ({
		name: match.metaVariables?.single?.CNAME?.text,
		superclass: superclassOf(match.text),
		range: match.range.byteOffset,
	}))

	const methods = methodMatches.map((match) => ({
		name: match.metaVariables?.single?.MNAME?.text,
		range: match.range.byteOffset,
	}))

	const base = classes.find((klass) => klass.name === BASE_CLASS)
	const interfaceMethods = methodNamesWithin(methods, base?.range)

	return classes
		.filter((klass) => klass.superclass === BASE_CLASS)
		.map((klass) => {
			const implemented = methodNamesWithin(methods, klass.range)
			const missing = interfaceMethods.filter((method) => !implemented.includes(method))

			return {
				name: klass.name,
				path,
				methods: implemented,
				interfaceMethods,
				missing,
				complete: missing.length === 0,
			}
		})
}

/**
 * Returns method names whose AST range is contained within the given class range,
 * excluding constructors.
 */
function methodNamesWithin(methods, classRange) {
	if (classRange === undefined) {
		return []
	}

	return methods
		.filter(
			(method) => method.range.start >= classRange.start && method.range.end <= classRange.end,
		)
		.map((method) => method.name)
		.filter((name) => name !== 'constructor')
}

/**
 * Extracts the superclass identifier from a class declaration's source node.
 * ast-grep has already selected the class node, so a simple string match is safe.
 */
function superclassOf(classSource) {
	return classSource.match(/\bextends\s+([A-Za-z0-9_$]+)/)?.[1]
}

/**
 * Runs ast-grep and parses its JSON output, collecting only stdout bytes from the
 * observable command stream.
 */
async function astGrepJSON(kit, args) {
	const chunks = []

	for await (const event of kit.spawn(['ast-grep', ...args])) {
		const value = event.toJSON()

		if (value.type === 'command.output' && value.stream === 'stdout') {
			chunks.push(value.bytes)
		}
	}

	const text = new TextDecoder().decode(concatBytes(chunks)).trim()
	return text === '' ? [] : JSON.parse(text)
}

function concatBytes(chunks) {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
	const bytes = new Uint8Array(length)
	let offset = 0

	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}

	return bytes
}

function addRunnerClass(source, spec) {
	const className = runnerClassName(spec.name)

	if (source.includes(`class ${className} `)) {
		return source
	}

	return `${source.trimEnd()}\n${runnerTemplate(spec, className)}`
}

function runnerTemplate(spec, className) {
	return `
export class ${className} extends ${BASE_CLASS} {
	constructor({ command = ${jsString(spec.command)} } = {}) {
		super()
		this.command = command
	}

	start({ prompt, cwd }) {
		return spawn([this.command, '--execute', prompt], { cwd })
	}

	continue({ threadID, prompt, cwd }) {
		return spawn([this.command, 'continue', threadID, '--execute', prompt], { cwd })
	}
}
`
}

/**
 * Builds the follow-up plan for a generated agent runner.
 *
 * The implement step is self-healing: it pairs the agent with a structural verify
 * (`component show`) so a broken edit re-runs the agent instead of failing. When
 * the runner declares an `authCheckCommand`, a trailing verify-only auth gate is
 * appended — a non-authenticated CLI makes the plan pause cleanly with login and
 * resume instructions rather than reporting the runner as ready to execute plans.
 */
function runnerPlanSteps(spec, className) {
	const componentCheck = `bun run kit component show kit-agent.${className}`

	const steps = [
		{
			id: 'implement-runner',
			instructions: `Use Amp to implement the ${className} agent runner in ${AGENT_RUNNER_FILE}`,
			files: [AGENT_RUNNER_FILE],
			agent: {
				prompt: runnerPrompt(spec, className),
			},
			verifyWithCommand: componentCheck,
		},
	]

	if (spec.authCheckCommand !== undefined) {
		steps.push({
			id: 'auth-gate',
			instructions: `Log into ${spec.command} so Kit can execute plans with ${className}: ${spec.loginCommand ?? `${spec.command} login`}`,
			verifyWithCommand: spec.authCheckCommand,
		})
	}

	return steps
}

function runnerPrompt(spec, className) {
	return `Intent: ${spec.intent ?? `Implement the ${className} agent runner`}

Finish the generated ${className} agent runner in ${AGENT_RUNNER_FILE}.
It spawns the ${jsString(spec.command)} CLI. Match the start/continue interface
of ${BASE_CLASS} and the streaming conventions used by AmpAgentRunner.
Do not refactor unrelated code.`
}

function runnerClassName(name) {
	return `${pascalCase(name)}AgentRunner`
}

function pascalCase(value) {
	return value
		.split(/[-_.]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')
}

function jsString(value) {
	return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export default function provider(kit) {
	return new KitAgentProvider(kit)
}
