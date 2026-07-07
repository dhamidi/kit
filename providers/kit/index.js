/**
 * Built-in generic Kit provider.
 *
 * The `kit task` type is the manifest escape hatch for work that does not yet
 * deserve a domain-specific provider. It emits a provider-owned follow-up plan
 * instead of adding shell execution or imperative steps to the manifest language.
 */
class KitProvider {
	constructor(kit) {
		this.kit = kit
	}

	name() {
		return 'kit'
	}

	async *types() {
		yield new KitTaskType(this.kit)
	}

	async *components() {}

	create(spec, env) {
		return new KitTaskType(this.kit).create(spec, env)
	}
}

/**
 * Generic task component type that turns declarative intent into a Kit plan.
 */
class KitTaskType {
	constructor(kit) {
		this.kit = kit
	}

	id() {
		return 'task'
	}

	description() {
		return 'A generic agent task for work without a more specific provider type'
	}

	schema() {
		const { Type } = this.kit

		return Type.Object({
			name: Type.String({
				description: 'Kebab-case task name used to identify the follow-up plan',
				examples: ['inject-secret-files-into-sandboxes'],
				pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
				kit: { cli: false },
			}),
			file: Type.Optional(
				Type.Array(
					Type.String({
						description: 'Workspace file relevant to the task',
						examples: ['thread-actors/src/sandbox/manager.ts'],
					}),
					{
						description: 'Files the agent should inspect or edit for this task',
						examples: [['thread-actors/src/sandbox/manager.ts']],
						multiple: true,
					},
				),
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
		return `Task ${spec.name}`
	}

	async *create(spec) {
		yield this.kit.Event.plan(
			`Complete task ${spec.name}`,
			[
				{
					id: spec.name,
					instructions: `Use the configured agent to complete task ${spec.name}`,
					files: spec.file ?? [],
					agent: {
						prompt: taskPrompt(spec),
					},
				},
			],
			{ intent: spec.intent },
		)
	}
}

function taskPrompt(spec) {
	return [
		`Task: ${spec.name}`,
		'',
		'Intent:',
		(spec.intent ?? `Complete ${spec.name}.`).trim(),
		'',
		...filePromptLines(spec.file),
		'Use existing project patterns. Do not refactor unrelated code.',
	].join('\n')
}

function filePromptLines(files) {
	if (files === undefined || files.length === 0) {
		return []
	}

	return ['Relevant files:', ...files.map((file) => `- ${file}`), '']
}

/**
 * Creates the built-in generic Kit provider.
 */
export default function provider(kit) {
	return new KitProvider(kit)
}
