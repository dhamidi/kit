import { defineCommand, UserError } from '../cli.js'
import { discoverProviders } from '../provider_discovery.js'
import { loadProvider } from '../index.js'
import { bestMatch } from '../matcher.js'
import {
	normalizeSchemaValue,
	schemaViolations,
	schemaWithKitFields,
} from '../schema_normalizer.js'

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

provider.command(
	defineCommand({
		name: 'test',
		description: 'Validate discovered components against provider type schemas',
		async run({ parsed }) {
			const target = parsed.positionals[0]

			if (target === undefined) {
				throw new UserError('Usage: kit provider test <provider>')
			}

			const provider = await findProvider(target)

			if (provider === undefined) {
				throw new UserError(`Unknown provider: ${target}`)
			}

			const violations = await providerTestViolations(provider)

			if (violations.length > 0) {
				throw new UserError(violations.join('\n'))
			}
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

async function providerTestViolations(provider) {
	const violations = []
	const types = await Array.fromAsync(provider.types())

	if (types.length === 0) {
		violations.push(`provider ${provider.name()}: no component types advertised`)
	}

	for await (const component of provider.components()) {
		const type = componentTypeFor(component, types)

		if (type === undefined) {
			violations.push(
				`provider ${provider.name()} component ${component.id()}: no matching advertised type`,
			)
			continue
		}

		let inspected

		try {
			inspected = component.inspect()
		} catch (error) {
			violations.push(
				`provider ${provider.name()} component ${component.id()}: inspect() failed: ${error.message}`,
			)
			continue
		}

		const schema = schemaWithKitFields(type.schema())
		const normalized = normalizeSchemaValue(schema, inspected)
		const errors = schemaViolations(schema, normalized)

		for (const error of errors) {
			violations.push(
				`provider ${provider.name()} component ${component.id()} type ${type.id()}${error.path}: ${error.message}`,
			)
		}
	}

	return violations
}

function componentTypeFor(component, types) {
	const explicit = typeof component.type === 'function' ? component.type() : undefined

	if (explicit !== undefined) {
		return types.find((type) => type.id() === explicit)
	}

	if (types.length === 1) {
		return types[0]
	}

	return bestMatch(types.map((type) => ({ id: type.id(), type })), component.id())?.candidate.type
}

export default provider
