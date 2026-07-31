import { createFileEnv } from '../file_env.js'
import { FileURI } from '../file_uri.js'
import { normalizeSchemaValue, schemaViolations, schemaWithKitFields } from '../schema_normalizer.js'
import { ComponentForm } from './component_form.js'
import { ProviderCatalog } from './provider_catalog.js'

/**
 * Reads Kit's provider domain for the server-rendered browser.
 */
export class KitBrowser {
	constructor({ cwd, allowWrites = false }) {
		this.cwd = cwd
		this.allowWrites = allowWrites
		this.catalog = new ProviderCatalog({ cwd })
	}

	/** Returns provider, type, component, and inspector state for one request. */
	async snapshot(searchParams = new URLSearchParams()) {
		const providers = await this.catalog.providers()
		const selectedProviderName = searchParams.get('provider') ?? providers[0]?.name
		const selectedProvider = providers.find((entry) => entry.name === selectedProviderName)
		const types = selectedProvider === undefined ? [] : await this.catalog.types(selectedProvider.provider)
		const components = selectedProvider === undefined ? [] : await this.catalog.components(selectedProvider.provider)
		const selectedType = types.find((entry) => entry.id === searchParams.get('type'))
		const selectedComponent = components.find((entry) => entry.id === searchParams.get('component'))

		return {
			allowWrites: this.allowWrites,
			providers: providers.map(({ name }) => ({ name })),
			selectedProvider: selectedProvider?.name,
			types: types.map(({ id, description }) => ({ id, description })),
			components: components.map(({ id, description }) => ({ id, description })),
			selection: selectedComponent === undefined
				? selectedType === undefined
					? providerSelection(selectedProvider, types, components)
					: await typeSelection(selectedProvider, selectedType)
				: await this.componentSelection(selectedProvider, selectedComponent, types),
		}
	}

	async componentSelection(provider, selectedComponent, types) {
		const type = this.catalog.componentType(selectedComponent.component, types)
		const properties = selectedComponent.component.inspect()
		const advertisedSchema = type === undefined ? undefined : schemaWithKitFields(type.type.schema())

		return {
			kind: 'component',
			title: selectedComponent.id,
			description: selectedComponent.description,
			provider: provider.name,
			properties,
			form: await ComponentForm.create(inspectionSchema(advertisedSchema, properties), {
				values: properties,
				workspace: FileURI.fromPath(this.cwd),
			}),
		}
	}

	/** Runs one schema-derived form as a dry-run or deterministic generation. */
	async generate({ providerName, typeID, formData, dryRun }) {
		if (!dryRun && !this.allowWrites) {
			throw new Error('Writes are disabled. Restart Kit UI with --allow-writes to create components.')
		}

		const provider = (await this.catalog.provider(providerName))?.provider
		const type = provider === undefined
			? undefined
			: (await this.catalog.type(provider, typeID))?.type

		if (provider === undefined || type === undefined) {
			throw new Error(`Unknown component type: ${providerName}.${typeID}`)
		}

		const schema = schemaWithKitFields(type.schema())
		const form = await ComponentForm.create(schema)
		const spec = normalizeSchemaValue(schema, form.parse(formData))
		const initialViolations = schemaViolations(schema, spec)

		if (initialViolations.length > 0) {
			throw new Error(initialViolations.map((violation) => `${violation.path}: ${violation.message}`).join('\n'))
		}

		if (spec.description === undefined && typeof type.describe === 'function') {
			spec.description = type.describe(spec)
		}

		const violations = schemaViolations(schema, spec)

		if (violations.length > 0) {
			throw new Error(violations.map((violation) => `${violation.path}: ${violation.message}`).join('\n'))
		}

		const events = []
		const env = createFileEnv({ dryRun })

		for await (const event of type.create(spec, env)) {
			events.push(event.toJSON())
		}

		return { dryRun, events, spec }
	}
}

function providerSelection(provider, types, components) {
	if (provider === undefined) return undefined

	return {
		kind: 'provider',
		title: provider.name,
		description: `${types.length} component types · ${components.length} components`,
	}
}

async function typeSelection(provider, selectedType) {
	const schema = schemaWithKitFields(selectedType.type.schema())
	return {
		kind: 'type',
		title: selectedType.id,
		description: selectedType.description,
		provider: provider.name,
		form: await ComponentForm.create(schema),
	}
}

function inspectionSchema(schema, properties) {
	const inferredProperties = {}

	for (const [name, value] of Object.entries(properties)) {
		inferredProperties[name] = schema?.properties?.[name] ?? inferredSchema(value)
	}

	return {
		...(schema ?? { type: 'object' }),
		properties: inferredProperties,
		required: (schema?.required ?? []).filter((name) => properties[name] !== undefined),
	}
}

function inferredSchema(value) {
	if (Array.isArray(value)) {
		return {
			type: 'array',
			items: inferredSchema(value[0] ?? ''),
			description: 'Provider-reported component property',
		}
	}

	if (value !== null && typeof value === 'object') {
		return { type: 'object', description: 'Provider-reported component property' }
	}

	return { type: typeof value, description: 'Provider-reported component property' }
}
