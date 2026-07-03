import { defineCommand, UserError } from '../cli.js'

export default defineCommand({
	name: 'help',
	description: 'Show available commands',
	options: {},
	run({ cli, parsed }) {
		if (parsed.positionals.length > 0) {
			const command = cli.find(parsed.positionals)

			if (command === undefined) {
				throw new UserError(`Unknown command: ${parsed.positionals.join(' ')}`)
			}

			return cli.formatter.commandHelp(command, parsed.positionals)
		}

		return cli.formatter.help()
	},
})
