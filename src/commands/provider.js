import { defineCommand, UserError } from '../cli.js'
import { discoverProviders } from '../provider_discovery.js'
import { loadProvider } from '../index.js'

/**
 * Command group for provider operations.
 *
 * @example
 * await createCLI([provider]).run(['provider', 'list'])
 */
const provider = defineCommand({
	name: 'provider',
	description: 'Manage providers',
	run(context) {
		return context.command.commands.get('list').call([], context)
	},
})

provider.command(
	defineCommand({
		name: 'list',
		description: 'List discovered providers',
		async run({ cli }) {
			await cli.formatter.providersList(discoverProviders())
		},
	}),
)

provider.command(
	defineCommand({
		name: 'show',
		description: 'Show provider component types and schemas',
		async run({ cli, parsed }) {
			const target = parsed.positionals[0]

			if (target === undefined) {
				throw new UserError('Usage: kit provider show <provider>[.<type>]')
			}

			const { providerName, typeName } = parseProviderTarget(target)
			const provider = await findProvider(providerName)

			if (provider === undefined) {
				throw new UserError(`Unknown provider: ${providerName}`)
			}

			if (typeName === undefined) {
				await cli.formatter.providerShow(provider)
				return
			}

			for await (const type of provider.types()) {
				if (type.id() === typeName) {
					cli.formatter.providerTypeShow(provider, type)
					return
				}
			}

			throw new UserError(`Unknown provider type: ${providerName}.${typeName}`)
		},
	}),
)

function parseProviderTarget(target) {
	const [providerName, ...typeParts] = target.split('.')

	return {
		providerName,
		typeName: typeParts.length === 0 ? undefined : typeParts.join('.'),
	}
}

async function findProvider(providerName) {
	for await (const event of discoverProviders()) {
		const value = event.toJSON()

		if (value.type === 'provider.loaded' && value.name === providerName) {
			return loadProvider(value.path)
		}
	}

	return undefined
}

export default provider
