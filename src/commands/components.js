import { defineCommand, UserError } from '../cli.js'
import {
	discoverComponentRecords,
	discoverComponents,
	inspectComponent,
} from '../provider_discovery.js'
import { bestMatch } from '../matcher.js'
import {
	normalizeSchemaValue,
	schemaViolations,
	schemaWithKitFields,
} from '../schema_normalizer.js'

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
				throw new UserError('Usage: kit component show <component>')
			}

			const record = await inspectComponent(componentName)

			if (record === undefined) {
				throw new UserError(`Unknown component: ${componentName}`)
			}

			if (typeof record.provider.formatComponentShow === 'function') {
				await record.provider.formatComponentShow(componentName, record, cli.formatter.output)
				return
			}

			cli.formatter.componentShow(componentName, record)
		},
	}),
)

components.command(
	defineCommand({
		name: 'spec',
		description: 'Print a discovered component as normalized schema JSON',
		async run({ parsed }) {
			const componentName = parsed.positionals[0]

			if (componentName === undefined) {
				throw new UserError('Usage: kit component spec <component>')
			}

			const record = await inspectComponent(componentName)

			if (record === undefined) {
				throw new UserError(`Unknown component: ${componentName}`)
			}

			const type = await componentTypeFor(record.provider, record.component)

			if (type === undefined) {
				throw new UserError(`No matching component type for ${componentName}`)
			}

			const schema = schemaWithKitFields(type.schema())
			const spec = normalizeSchemaValue(schema, record.component.inspect())
			const violations = schemaViolations(schema, spec)

			if (violations.length > 0) {
				throw new UserError(
					violations.map((violation) => `${componentName}${violation.path}: ${violation.message}`).join('\n'),
				)
			}

			console.log(JSON.stringify(spec, null, 2))
		},
	}),
)

async function componentTypeFor(provider, component) {
	const types = await Array.fromAsync(provider.types())
	const explicit = typeof component.type === 'function' ? component.type() : undefined

	if (explicit !== undefined) {
		return types.find((type) => type.id() === explicit)
	}

	if (types.length === 1) {
		return types[0]
	}

	return bestMatch(types.map((type) => ({ id: type.id(), type })), component.id())?.candidate.type
}

export default components
