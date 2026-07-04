import { Glob } from 'bun'

class KitCommandProvider {
	constructor(kit) {
		this.kit = kit
	}

	name() {
		return 'kit-command'
	}

	async *types() {
		yield new KitCommandType(this.kit)
	}

	async *components() {
		for await (const path of new Glob('src/commands/*.js').scan({ cwd: process.cwd() })) {
			const module = await import(this.kit.FileURI.fromPath(path).toString())
			const command = module.default

			yield new KitCommandComponent({
				id: command.name,
				description: command.description,
				path,
			})

			for (const child of command.commands.values()) {
				yield new KitCommandComponent({
					id: `${command.name}.${child.name}`,
					description: child.description,
					path,
				})
			}
		}
	}

	create(spec, env) {
		return new KitCommandType(this.kit).create(spec, env)
	}
}

class KitCommandType {
	constructor(kit) {
		this.kit = kit
	}

	id() {
		return 'component'
	}

	description() {
		return 'A Kit CLI command module in src/commands/<name>.js'
	}

	schema() {
		const { Type } = this.kit
		const parseArgOption = Type.Object(
			{
				type: Type.Union([Type.Literal('boolean'), Type.Literal('string')]),
				short: Type.Optional(
					Type.String({
						description: 'Single-character short flag alias',
						examples: ['h'],
						minLength: 1,
						maxLength: 1,
					}),
				),
				default: Type.Optional(Type.Union([Type.Boolean(), Type.String()])),
				multiple: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		)

		return Type.Object({
			name: Type.String({
				description: 'Kebab-case command or subcommand name',
				examples: ['components-list', 'generate'],
				pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
				kit: { cli: false },
			}),
			parent: Type.Optional(
				Type.String({
					description: 'Optional parent command name for nested commands',
					examples: ['component'],
					kit: { cli: false },
				}),
			),
			arg: Type.Optional(
				Type.String({
					description: 'Optional positional argument name',
					examples: ['componentName'],
				}),
			),
			description: Type.String({
				description: 'Short user-facing description of the command',
				examples: ['List all known components'],
				kit: { cli: false },
			}),
			options: Type.Optional(
				Type.Record(
					Type.String({
						description: 'Long option name passed to util.parseArgs',
						examples: ['help', 'verbose', 'output'],
						pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
					}),
					parseArgOption,
					{
						description: 'Option definitions forwarded to node:util parseArgs',
						kit: { cli: false },
						examples: [
							{
								help: { type: 'boolean', short: 'h' },
								output: { type: 'string', short: 'o', default: './out' },
							},
						],
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
		return spec.description ?? `Show ${spec.arg}`
	}

	async *create(spec, env) {
		if (spec.parent === 'component' && spec.name === 'show') {
			yield await env.editFile('src/commands/components.js', (source) =>
				addComponentShowCommand(source, spec),
			)
			yield this.kit.Event.plan(
				'Finish generated component show command',
				[
					{
						id: 'fill-in-command',
						instructions: 'Use Amp to finish generated command implementation',
						files: ['src/commands/components.js'],
						agent: {
							prompt: componentShowPrompt(spec),
						},
					},
					{
						id: 'verify-command',
						instructions: 'Verify generated component show command works',
						verifyWithCommand: 'bun run kit component show kit-event.file.fileRead',
					},
				],
				{ intent: spec.intent },
			)
			return
		}

		if (spec.parent === 'provider' && spec.name === 'show') {
			yield await env.editFile('src/commands/provider.js', (source) =>
				addProviderShowCommand(source, spec),
			)
			yield this.kit.Event.plan(
				'Finish generated provider show command',
				[
					{
						id: 'fill-in-command',
						instructions: 'Use Amp to finish generated command implementation',
						files: ['src/commands/provider.js'],
						agent: {
							prompt: providerShowPrompt(spec),
						},
					},
					{
						id: 'verify-command',
						instructions: 'Verify generated provider show command works',
						verifyWithCommand: 'bun run kit provider show kit-command.component',
					},
				],
				{ intent: spec.intent },
			)
			return
		}

		const path = `src/commands/${spec.parent ?? spec.name}.js`
		const source = commandTemplate(spec)

		yield await env.createFile(path, source)

		yield await env.editFile('src/main.js', (source) => registerCommand(source, spec))
		yield this.kit.Event.plan(
			`Finish generated ${commandID(spec)} command`,
			[
				{
					id: 'fill-in-command',
					instructions: 'Use Amp to finish generated command implementation',
					files: [path],
					agent: {
						prompt: commandPrompt(spec, path),
					},
				},
			],
			{ intent: spec.intent },
		)
	}
}

function componentShowPrompt(spec) {
	return `Intent: ${spec.intent ?? 'Show detailed information about a component'}

Finish the generated component show command in src/commands/components.js.
Use existing Kit CLI, provider, event, and formatter patterns.
Do not refactor unrelated code.`
}

function providerShowPrompt(spec) {
	return `Intent: ${spec.intent ?? 'Show detailed information about a provider'}

Finish the generated provider show command in src/commands/provider.js.
It should list component type summaries for provider show <provider> and schema details for provider show <provider>.<type>.
Use existing Kit CLI, provider, event, and formatter patterns.
Do not refactor unrelated code.`
}

function addComponentShowCommand(source, spec) {
	if (source.includes("name: 'show'")) {
		return source
	}

	if (!source.includes("import { TableFormatter } from '../formatters/table.js'")) {
		source = source.replace(
			"import { discoverComponents } from '../provider_discovery.js'",
			"import { discoverComponents } from '../provider_discovery.js'\nimport { TableFormatter } from '../formatters/table.js'",
		)
	}

	return source.replace(
		'\nexport default components\n',
		`
components.command(defineCommand({
	name: 'show',
	description: ${JSON.stringify(spec.description)},
	async run({ parsed }) {
		const componentName = parsed.positionals[0]
		const table = new TableFormatter(['Component', 'Description'])

		for await (const event of discoverComponents()) {
			const value = event.toJSON()

			if (value.type === 'component.listed' && \`\${value.provider}.\${value.id}\` === componentName) {
				table.row([componentName, value.description])
			}
		}

		if (table.isEmpty()) {
			throw new Error(\`Unknown component: \${componentName}\`)
		}

		table.flush()
	},
}))

export default components
`,
	)
}

function addProviderShowCommand(source, spec) {
	if (source.includes("name: 'show'")) {
		return source
	}

	if (!source.includes("import { defineCommand, UserError } from '../cli.js'")) {
		source = source.replace(
			"import { defineCommand } from '../cli.js'",
			"import { defineCommand, UserError } from '../cli.js'",
		)
	}

	return source.replace(
		'\nexport default provider\n',
		`
provider.command(defineCommand({
	name: 'show',
	description: ${JSON.stringify(spec.description)},
	async run({ parsed }) {
		const providerName = parsed.positionals[0]

		if (providerName === undefined) {
			throw new UserError('Usage: kit provider show <provider>[.<type>]')
		}

		throw new Error('Command provider.show is not implemented yet')
	},
}))

export default provider
`,
	)
}

class KitCommandComponent {
	constructor({ id, description, path }) {
		this.componentID = id
		this.componentDescription = description
		this.path = path
	}

	provider() {
		return 'kit-command'
	}

	id() {
		return this.componentID
	}

	description() {
		return this.componentDescription
	}

	inspect() {
		return {
			name: this.id(),
			files: [this.path],
		}
	}
}

function commandTemplate(spec) {
	if (spec.parent !== undefined) {
		return commandGroupTemplate(spec)
	}

	return `import { defineCommand } from '../cli.js'

/**
 * Command group for ${spec.description}.
 *
 * @example
 * await createCLI([${spec.name}]).run(['${spec.name}'])
 */
const ${camelName(spec.name)} = defineCommand({
	name: '${spec.name}',
	description: ${JSON.stringify(spec.description)},
	async run() {
		throw new Error('Command ${spec.name} is not implemented yet')
	},
})

export default ${camelName(spec.name)}
`
}

function commandGroupTemplate(spec) {
	return `import { defineCommand } from '../cli.js'

/**
 * Command group for ${spec.parent} operations.
 *
 * @example
 * await createCLI([${camelName(spec.parent)}]).run(['${spec.parent}', '${spec.name}'])
 */
const ${camelName(spec.parent)} = defineCommand({
	name: '${spec.parent}',
	description: 'Manage ${spec.parent}',
	run(context) {
		return context.command.commands.get('${spec.name}').call([], context)
	},
})

${camelName(spec.parent)}.command(defineCommand({
	name: 'show',
	description: ${JSON.stringify(spec.description)},
	async run() {
		throw new Error('Command ${commandID(spec)} is not implemented yet')
	},
}))

export default ${camelName(spec.parent)}
`
}

function registerCommand(source, spec) {
	const name = spec.parent ?? spec.name
	const variable = camelName(name)

	if (source.includes(`import ${variable} from './commands/${name}.js'`)) {
		return source
	}

	source = source.replace(
		"import help from './commands/help.js'",
		`import help from './commands/help.js'\nimport ${variable} from './commands/${name}.js'`,
	)

	return source.replace(
		/createCLI\(\[([^\]]+)\]\)/,
		(_, commands) => `createCLI([${commands}, ${variable}])`,
	)
}

function commandPrompt(spec, path) {
	return `Intent: ${spec.intent ?? spec.description}

Finish the generated ${commandID(spec)} command in ${path}.
Use existing Kit CLI, state, provider, event, and formatter patterns.
Do not refactor unrelated code.`
}

function commandID(spec) {
	return spec.parent === undefined ? spec.name : `${spec.parent}.${spec.name}`
}

function camelName(name) {
	return name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase())
}

export default function provider(kit) {
	return new KitCommandProvider(kit)
}
