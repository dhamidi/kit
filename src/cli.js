import { parseArgs } from 'node:util'
import { CommandFormatter } from './formatters/command.js'

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
			throw new Error(`Unknown command: ${commandName ?? '(none)'}`)
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
