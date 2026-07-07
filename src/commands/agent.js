import { defineCommand } from '../cli.js'
import { discoverAgents } from '../agent_runner.js'
import { TableFormatter } from '../formatters/table.js'

/**
 * Command group for discovering plan execution agents.
 */
const agent = defineCommand({
	name: 'agent',
	description: 'Discover plan execution agents',
	run(context) {
		return context.command.commands.get('list').call([], context)
	},
})

agent.command(defineCommand({
	name: 'list',
	description: 'List supported agents and whether their commands are installed',
	async run() {
		const table = new TableFormatter(['Agent', 'Status', 'Command', 'Details'])

		for await (const event of discoverAgents()) {
			const value = event.toJSON()

			if (value.type === 'agent.available') {
				table.row([value.name, 'available', value.command, value.path])
			} else if (value.type === 'agent.unavailable') {
				table.row([value.name, 'unavailable', value.command, value.reason])
			}
		}

		table.flush()
	},
}))

export default agent
