import { defineCommand } from '../cli.js'
import { discoverProviders } from '../provider_discovery.js'

/**
 * Command group for provider operations.
 *
 * @example
 * await createCLI([providers]).run(['provider', 'list'])
 */
const providers = defineCommand({
	name: 'provider',
	description: 'Manage providers',
	run(context) {
		return context.command.commands.get('list').call([], context)
	},
})

providers.command(
	defineCommand({
		name: 'list',
		description: 'List discovered providers',
		async run({ cli }) {
			await cli.formatter.providersList(discoverProviders())
		},
	}),
)

export default providers
