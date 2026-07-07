import { defineCommand, UserError } from '../cli.js'
import { createFileEnv } from '../file_env.js'
import { FileURI } from '../file_uri.js'
import { ManifestResolver, ManifestVocabulary } from '../manifest/resolver.js'
import { ManifestRunner, ManifestRunnerError } from '../manifest/runner.js'
import { PlanExecutor } from '../plan_executor.js'
import { parseManifest } from '../manifest/parser.js'
import { PlanFormatter } from '../formatters/plan.js'
import { discoverProviders } from '../provider_discovery.js'
import { loadProvider } from '../index.js'

/**
 * Command group for manifest operations.
 *
 * @example
 * await createCLI([manifest]).run(['manifest', 'check', 'manifest.kit'])
 */
const manifest = defineCommand({
	name: 'manifest',
	description: 'Manage manifest files',
	run(context) {
		return context.command.commands.get('vocabulary').call([], context)
	},
})

manifest.command(defineCommand({
	name: 'vocabulary',
	description: 'Print valid example manifests for live provider component types',
	options: {
		provider: { type: 'string', description: 'Only show component types from one provider' },
		type: { type: 'string', description: 'Only show one component type' },
		json: { type: 'boolean', description: 'Print vocabulary as JSON' },
	},
	async run({ parsed }) {
		const providers = await loadProviders()
		const vocabulary = await ManifestVocabulary.from(providers)
		const entries = filterEntries(vocabulary.all(), parsed.values)

		if (parsed.values.json) {
			return JSON.stringify(entries.map((entry) => vocabularyEntryJSON(entry)), null, 2)
		}

		return entries.map((entry) => new VocabularyExample(entry).toString()).join('\n\n')
	},
}))

manifest.command(defineCommand({
	name: 'vocab',
	description: 'Alias for manifest vocabulary',
	options: {
		provider: { type: 'string', description: 'Only show component types from one provider' },
		type: { type: 'string', description: 'Only show one component type' },
		json: { type: 'boolean', description: 'Print vocabulary as JSON' },
	},
	async run(context) {
		return manifest.commands.get('vocabulary').run(context)
	},
}))

manifest.command(defineCommand({
	name: 'check',
	description: 'Parse, resolve, and validate a manifest without running providers',
	options: {
		json: { type: 'boolean', description: 'Print resolved operations as JSON' },
	},
	async run({ parsed }) {
		const execution = await ManifestExecution.from(parsed)
		return execution.check()
	},
}))

manifest.command(defineCommand({
	name: 'plan',
	description: 'Preview provider effects from a manifest without writing files',
	options: {
		json: { type: 'boolean', description: 'Print provider events as JSON lines' },
	},
	async run({ parsed }) {
		const execution = await ManifestExecution.from(parsed)
		return execution.plan()
	},
}))

manifest.command(defineCommand({
	name: 'apply',
	description: 'Apply a manifest by invoking providers sequentially',
	options: {
		json: { type: 'boolean', description: 'Print provider events as JSON lines' },
		'skip-plans': { type: 'boolean', description: 'Skip provider follow-up plans (executed by default)' },
		agent: { type: 'string', description: 'Agent that executes follow-up plans (default: auto)' },
	},
	async run({ parsed }) {
		const execution = await ManifestExecution.from(parsed)
		return execution.apply()
	},
}))

class ManifestExecution {
	static async from(parsed) {
		const path = parsed.positionals[0]

		if (path === undefined) {
			throw new UserError('Usage: kit manifest <check|plan|apply> <file|->')
		}

		const providers = await loadProviders()
		const ast = parseManifest(await readManifest(path))
		const resolved = await new ManifestResolver(providers).resolve(ast)

		return new ManifestExecution({
			providers,
			resolved,
			json: parsed.values.json,
			path,
			runPlans: parsed.values['skip-plans'] !== true,
			agent: parsed.values.agent,
		})
	}

	constructor({ providers, resolved, json, path, runPlans, agent, output = process.stdout }) {
		this.providers = providers
		this.resolved = resolved
		this.json = json
		this.path = path
		this.runPlans = runPlans
		this.agent = agent
		this.output = output
	}

	async check() {
		await this.validate()

		if (this.json) {
			return JSON.stringify(this.resolved.operations, null, 2)
		}

		return `${this.path} is valid`
	}

	async plan() {
		return this.run({ env: createFileEnv({ dryRun: true }), executePlans: false, dryRun: true })
	}

	async apply() {
		return this.run({ executePlans: this.runPlans, dryRun: false })
	}

	async validate() {
		if (this.resolved.errors.length > 0) {
			throw new UserError(formatErrors(this.resolved.errors))
		}

		try {
			const result = await new ManifestRunner({
				providers: this.providers,
				env: createFileEnv({ dryRun: true }),
				executePlans: false,
			}).validate(this.resolved.operations)

			if (result.errors.length > 0) {
				throw new ManifestRunnerError(result.errors)
			}
		} catch (error) {
			if (error instanceof ManifestRunnerError) {
				throw new UserError(formatErrors(error.errors))
			}

			throw error
		}
	}

	async run({ env, executePlans, dryRun }) {
		await this.validate()
		const planExecutor = executePlans ? new PlanExecutor({ agent: this.agent }) : undefined
		const runner = new ManifestRunner({ providers: this.providers, env, executePlans, planExecutor })

		// Write each event as it arrives so provider effects and agent progress
		// stream to the user instead of appearing all at once when the run ends.
		for await (const event of runner.run(this.resolved.operations)) {
			const value = event.toJSON()
			const line = this.json ? JSON.stringify(value) : formatEvent(value, { dryRun })

			if (line) {
				this.output.write(`${line}\n`)
			}
		}
	}
}

class VocabularyExample {
	constructor(entry) {
		this.entry = entry
		this.schema = entry.type.schema()
	}

	toString() {
		return [
			...commentLines(this.entry.type.description()),
			`${this.entry.provider.name()} ${this.entry.type.id()} {`,
			...this.fieldLines(),
			'}',
		]
			.filter((line) => line !== undefined)
			.join('\n')
	}

	fieldLines() {
		return Object.entries(this.schema.properties ?? {}).flatMap(([name, schema]) => {
			return new VocabularyField(name, schema).lines()
		})
	}
}

class VocabularyField {
	constructor(name, schema) {
		this.name = name
		this.schema = schema
	}

	lines() {
		return [
			...commentLines(this.schema.description),
			`\t${this.name} ${new ExampleValue(this.schema).manifestValue('\t')}`,
		]
	}
}

class ExampleValue {
	constructor(schema) {
		this.schema = schema
	}

	manifestValue(indent = '') {
		if (this.schema.type === 'array') {
			return this.arrayValue(indent)
		}

		if (this.schema.type === 'object' && this.schema.patternProperties !== undefined) {
			return this.recordValue(indent)
		}

		if (this.schema.type === 'object') {
			return this.objectValue(indent)
		}

		const value = this.value()

		if (typeof value === 'string') {
			return manifestString(value)
		}

		return String(value)
	}

	arrayValue(indent) {
		const item = new ExampleValue(this.schema.items).manifestValue(`${indent}\t`)
		return `{\n${indent}\t${item}\n${indent}}`
	}

	recordValue(indent) {
		const [pattern, schema] = Object.entries(this.schema.patternProperties)[0]
		const key = exampleRecordKey(this.schema.examples?.[0], pattern)
		const value = new ExampleValue(schema).manifestValue(`${indent}\t`)
		return `{\n${indent}\t${key} ${value}\n${indent}}`
	}

	objectValue(indent) {
		const fields = Object.entries(this.schema.properties ?? {}).map(([name, schema]) => {
			const value = new ExampleValue(schema).manifestValue(`${indent}\t`)
			return `${indent}\t${name} ${value}`
		})

		return `{\n${fields.join('\n')}\n${indent}}`
	}

	value() {
		if (this.schema.examples?.[0] !== undefined) {
			return this.schema.examples[0]
		}

		if (this.schema.default !== undefined) {
			return this.schema.default
		}

		if (this.schema.const !== undefined) {
			return this.schema.const
		}

		if (this.schema.anyOf !== undefined) {
			return new ExampleValue(this.schema.anyOf[0]).value()
		}

		if (this.schema.type === 'boolean') {
			return false
		}

		if (this.schema.type === 'number' || this.schema.type === 'integer') {
			return 1
		}

		return 'example'
	}
}

async function loadProviders() {
	const providers = []

	for await (const event of discoverProviders()) {
		const value = event.toJSON()

		if (value.type === 'provider.loaded') {
			providers.push(await loadProvider(value.path))
		}
	}

	return providers
}

async function readManifest(path) {
	return path === '-' ? await Bun.stdin.text() : await Bun.file(path).text()
}

function filterEntries(entries, values) {
	return entries.filter((entry) => {
		return (
			(values.provider === undefined || entry.provider.name() === values.provider) &&
			(values.type === undefined || entry.type.id() === values.type)
		)
	})
}

function vocabularyEntryJSON(entry) {
	return {
		provider: entry.provider.name(),
		type: entry.type.id(),
		description: entry.type.description(),
		schema: entry.type.schema(),
	}
}

function formatEvent(value, { dryRun }) {
	if (value.type === 'file.created') {
		return `${dryRun ? 'Would create' : 'Created'} ${FileURI.fromPath(value.path).path()}`
	}

	if (value.type === 'file.edited') {
		return `${dryRun ? 'Would edit' : 'Edited'} ${FileURI.fromPath(value.path).path()}`
	}

	if (value.type === 'command.spawned') {
		return `${dryRun ? 'Would run' : 'Running'} ${value.command.join(' ')}`
	}

	if (value.type === 'command.exited') {
		return dryRun ? undefined : `Exited ${value.command.join(' ')} with code ${value.code}`
	}

	if (value.type === 'command.output') {
		return undefined
	}

	if (value.type === 'plan') {
		return formatPlan(value)
	}

	return JSON.stringify(value)
}

function formatPlan(value) {
	const output = { chunks: [], write(chunk) { this.chunks.push(chunk) } }
	new PlanFormatter(output).write({ id: value.id ?? '(pending)', status: 'pending', plan: value })
	return output.chunks.join('').trimEnd()
}

function formatErrors(errors) {
	return errors.map((error) => {
		const location = error.location === undefined
			? ''
			: `${error.location.line}:${error.location.column} `
		return `${location}${error.message}`
	}).join('\n')
}

function commentLines(text) {
	return text === undefined ? [] : text.split('\n').map((line) => `# ${line}`)
}

function manifestString(value) {
	return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value)
}

function exampleRecordKey(example, pattern) {
	if (example !== undefined && typeof example === 'object') {
		const key = Object.keys(example)[0]

		if (key !== undefined) {
			return key
		}
	}

	return pattern === undefined ? 'example' : 'example'
}

export default manifest
