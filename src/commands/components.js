import { defineCommand } from '../cli.js'
import {
	discoverComponentRecords,
	discoverComponents,
	inspectComponent,
} from '../provider_discovery.js'

/**
 * Command group for component operations.
 *
 * @example
 * await createCLI([components]).run(['component', 'list'])
 */
const components = defineCommand({
	name: 'component',
	description: 'Manage components',
	run(context) {
		return context.command.commands.get('list').call([], context)
	},
})

components.command(
	defineCommand({
		name: 'list',
		description: 'List discovered components, optionally filtered by hierarchical prefix',
		async run({ cli, parsed }) {
			const prefix = parsed.positionals[0]

			if (prefix !== undefined && !prefix.includes('.')) {
				const records = []

				for await (const record of discoverComponentRecords()) {
					if (record.provider.name() === prefix) {
						records.push(record)
					}
				}

				if (records.length > 0 && typeof records[0].provider.formatComponentsList === 'function') {
					await records[0].provider.formatComponentsList(records, cli.formatter.output)
					return
				}
			}

			await cli.formatter.componentsList(discoverComponents(), { prefix })
		},
	}),
)

components.command(
	defineCommand({
		name: 'show',
		description: 'Show component details',
		async run({ cli, parsed }) {
			const componentName = parsed.positionals[0]

			if (componentName === undefined) {
				throw new Error('Usage: kit component show <component>')
			}

			const record = await inspectComponent(componentName)

			if (record === undefined) {
				throw new Error(`Unknown component: ${componentName}`)
			}

			if (typeof record.provider.formatComponentShow === 'function') {
				await record.provider.formatComponentShow(componentName, record, cli.formatter.output)
				return
			}

			cli.formatter.componentShow(componentName, record)
		},
	}),
)

export default components
