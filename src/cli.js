import { parseArgs as nodeParseArgs } from 'node:util'
import { CommandFormatter } from './formatters/command.js'
import { schemaArgsMetadata } from './schema_args.js'

/**
 * Parses argv like `node:util` parseArgs, but converts argument-parsing failures
 * into {@link UserError} so invalid CLI input reports a clean message instead of
 * a stack trace. Providers get the same behavior through `kit.parseArgs`.
 *
 * @example
 * parseArgs({ args: ['--nope'], options: {}, strict: true }) // throws UserError
 */
export function parseArgs(config) {
	try {
		const metadata = config.options?.[schemaArgsMetadata]
		const parsed = nodeParseArgs({
			...config,
			options: metadata?.optionsFor(config.args, config.options) ?? config.options,
		})

		if (metadata === undefined) {
			return parsed
		}

		return {
			...parsed,
			values: metadata.normalizeValues(parsed.values),
		}
	} catch (error) {
		if (typeof error?.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS_')) {
			throw new UserError(parseErrorMessage(error))
		}

		throw error
	}
}

function parseErrorMessage(error) {
	return error.message.replace(/\.\s+To specify a positional argument[\s\S]*$/, '.')
}

/**
 * Command is a small value object for defining CLI commands.
 *
 * @example
 * const command = new Command({
 * 	name: 'hello',
 * 	description: 'Say hello',
 * 	options: { loud: { type: 'boolean', short: 'l' } },
 * 	run: ({ parsed }) => parsed.values.loud ? 'HELLO' : 'Hello',
 * })
 */
export class Command {
	/**
	 * @example
	 * const command = new Command({
	 * 	name: 'hello',
	 * 	description: 'Say hello',
	 * 	options: { name: { type: 'string' } },
	 * 	run: ({ parsed }) => `Hello, ${parsed.values.name}`,
	 * })
	 */
	constructor({ name, description, options = {}, strict = true, run }) {
		this.name = name
		this.description = description
		this.options = options
		this.strict = strict
		this.run = run
		this.commands = new Map()
	}

	command(command) {
		this.commands.set(command.name, command)
		return this
	}

	/**
	 * @example
	 * const parsed = command.parse(['--name', 'Kit', 'extra'])
	 * console.log(parsed.values.name)
	 * console.log(parsed.positionals)
	 */
	parse(argv) {
		return parseArgs({
			args: argv,
			options: this.options,
			strict: this.strict,
			allowPositionals: true,
		})
	}

	/**
	 * @example
	 * const result = await command.call(['--name', 'Kit'], { cwd: process.cwd() })
	 * console.log(result)
	 */
	async call(argv, context = {}) {
		const [commandName, ...commandArgv] = argv
		const command = this.commands.get(commandName)

		if (command !== undefined) {
			return command.call(commandArgv, {
				...context,
				path: [...(context.path ?? [this.name]), command.name],
			})
		}

		if (argv.includes('--help') && this.name !== 'generate') {
			return context.cli.formatter.commandHelp(this, context.path ?? [this.name])
		}

		if (this.commands.size > 0 && commandName !== undefined && !commandName.startsWith('-')) {
			const path = (context.path ?? [this.name]).join(' ')
			const available = [...this.commands.keys()].join(', ')
			throw new UserError(
				`Unknown command: ${path} ${commandName}\n\nAvailable subcommands: ${available}`,
			)
		}

		const parsed = this.parse(argv)
		return this.run({ ...context, argv, command: this, parsed })
	}
}

/**
 * CLI dispatches argv to structured Command objects.
 */
export class CLI {
	constructor(commands = []) {
		this.commands = new Map(commands.map((command) => [command.name, command]))
		this.formatter = new CommandFormatter(this)
	}

	async run(argv = Bun.argv.slice(2), context = {}) {
		const [commandName, ...commandArgv] = argv
		const command = this.commands.get(commandName)

		if (command === undefined) {
			throw new UserError(`Unknown command: ${commandName ?? '(none)'}`)
		}

		return command.call(commandArgv, { ...context, cli: this })
	}

	list() {
		return Array.from(this.commands.values())
	}

	find(path) {
		const [name, ...rest] = path
		let command = this.commands.get(name)

		for (const part of rest) {
			command = command?.commands.get(part)
		}

		return command
	}
}

/**
 * UserError is a clean command-line error caused by invalid user input.
 */
export class UserError extends Error {}

export function defineCommand(definition) {
	return new Command(definition)
}

export function createCLI(commands) {
	return new CLI(commands)
}
