import { Type } from '@sinclair/typebox'

/**
 * ManifestResolver turns parsed syntax into provider-backed operations with real spec values.
 */
export class ManifestResolver {
	constructor(providers) {
		this.providers = providers
	}

	/**
	 * Resolves every parsed form before any provider is allowed to run.
	 */
	async resolve(ast) {
		const vocabulary = await ManifestVocabulary.from(this.providers)
		const operations = []
		const errors = []

		for (const component of ast.components) {
			const operation = await vocabulary.resolve(component)

			if (operation.errors.length > 0) {
				errors.push(...operation.errors)
			} else {
				operations.push(operation.value)
			}
		}

		return { operations, errors }
	}
}

/**
 * ManifestVocabulary is the live provider/type dictionary a manifest may use.
 */
export class ManifestVocabulary {
	static async from(providers) {
		const entries = []

		for await (const provider of providers) {
			for await (const type of provider.types()) {
				entries.push(new ManifestVocabularyEntry(provider, type))
			}
		}

		return new ManifestVocabulary(entries)
	}

	constructor(entries) {
		this.entries = entries
	}

	/**
	 * Finds the vocabulary entry responsible for a parsed component form.
	 */
	resolve(component) {
		return this.entryFor(component).resolve(component)
	}

	/**
	 * Returns every live entry for vocabulary output.
	 */
	all() {
		return this.entries
	}

	entryFor(component) {
		return this.entries.find((entry) => entry.matches(component)) ?? new MissingVocabularyEntry()
	}
}

class ManifestVocabularyEntry {
	constructor(provider, type) {
		this.provider = provider
		this.type = type
	}

	matches(component) {
		return (
			this.provider.name() === component.provider.value &&
			this.type.id() === component.typeName.value
		)
	}

	resolve(component) {
		const object = new ObjectValue(this.type.schema(), component.body, component)
		const result = object.toSpec()

		if (result.errors.length > 0) {
			return result
		}

		return ResolvedManifestValue.ok({
			provider: this.provider.name(),
			type: this.type.id(),
			spec: result.value,
			location: component.start,
		})
	}
}

class MissingVocabularyEntry {
	resolve(component) {
		return ResolvedManifestValue.error(
			component,
			`Unknown manifest component: ${component.provider.value} ${component.typeName.value}`,
		)
	}
}

class ObjectValue {
	constructor(schema, body, owner) {
		this.schema = schemaWithManifestFields(schema)
		this.body = body
		this.owner = owner
	}

	toSpec() {
		const spec = {}
		const errors = []
		const statements = groupStatements(this.body.statements ?? [])

		for (const statement of statements.values()) {
			const property = this.schema.properties?.[statement.name]

			if (property === undefined) {
				errors.push(manifestError(statement.node, `Unknown field: ${statement.name}`))
				continue
			}

			const result = new FieldValue(property, statement).toValue()

			if (result.errors.length > 0) {
				errors.push(...result.errors)
			} else if (result.value !== undefined) {
				spec[statement.name] = result.value
			}
		}

		return new ResolvedManifestValue(spec, errors)
	}
}

class FieldValue {
	constructor(schema, statement) {
		this.schema = schema
		this.statement = statement
	}

	toValue() {
		if (isArraySchema(this.schema)) {
			return this.arrayValue()
		}

		if (this.statement.nodes.length > 1) {
			return ResolvedManifestValue.error(
				this.statement.node,
				`Field ${this.statement.name} is not repeatable`,
			)
		}

		return new SchemaValue(this.schema, this.statement.nodes[0].values[0]).toValue()
	}

	arrayValue() {
		const values = []
		const errors = []

		for (const node of this.statement.nodes) {
			if (node.values.length === 1 && this.schema.items.type === 'object') {
				const result = new SchemaValue(this.schema.items, node.values[0]).toValue()
				values.push(...result.values())
				errors.push(...result.errors)
				continue
			}

			if (node.values.length === 1 && node.values[0].kind === 'BracedValue') {
				for (const value of node.values[0].values ?? []) {
					const result = new SchemaValue(this.schema.items, value).toValue()
					values.push(...result.values())
					errors.push(...result.errors)
				}
				continue
			}

			for (const value of node.values) {
				const result = new SchemaValue(this.schema.items, value).toValue()
				values.push(...result.values())
				errors.push(...result.errors)
			}
		}

		return new ResolvedManifestValue(values, errors)
	}
}

class SchemaValue {
	constructor(schema, node) {
		this.schema = schema
		this.node = node
	}

	toValue() {
		if (this.node === undefined) {
			return ResolvedManifestValue.error(this.node, 'Missing field value')
		}

		if (this.schema.const !== undefined) {
			return this.literalValue()
		}

		if (this.schema.anyOf !== undefined) {
			return this.unionValue()
		}

		if (this.schema.type === 'object' && this.schema.patternProperties !== undefined) {
			return this.recordValue()
		}

		if (this.schema.type === 'object') {
			return this.objectValue()
		}

		return this.scalarValue()
	}

	literalValue() {
		const value = scalarText(this.node)

		if (String(this.schema.const) === value) {
			return ResolvedManifestValue.ok(this.schema.const)
		}

		return ResolvedManifestValue.error(this.node, `Expected literal ${this.schema.const}`)
	}

	unionValue() {
		const results = this.schema.anyOf.map((schema) => new SchemaValue(schema, this.node).toValue())
		return results.find((result) => result.errors.length === 0) ?? results[0]
	}

	recordValue() {
		const schema = Object.values(this.schema.patternProperties)[0]
		const record = {}
		const errors = []

		for (const statement of this.node.statements ?? []) {
			const result = new SchemaValue(schema, statement.values[0]).toValue()
			record[statement.key.value] = result.value
			errors.push(...result.errors)
		}

		return new ResolvedManifestValue(record, errors)
	}

	objectValue() {
		if (this.node.kind !== 'BracedValue') {
			return ResolvedManifestValue.error(this.node, 'Expected object block')
		}

		return new ObjectValue(this.schema, this.node, this.node).toSpec()
	}

	scalarValue() {
		const value = scalarText(this.node)

		if (this.schema.type === 'number' || this.schema.type === 'integer') {
			return ResolvedManifestValue.ok(Number(value))
		}

		if (this.schema.type === 'boolean') {
			if (value !== 'true' && value !== 'false') {
				return ResolvedManifestValue.error(this.node, 'Expected boolean true or false')
			}

			return ResolvedManifestValue.ok(value === 'true')
		}

		if (this.schema.type === 'null') {
			return ResolvedManifestValue.ok(null)
		}

		return ResolvedManifestValue.ok(value)
	}
}

class ResolvedManifestValue {
	static ok(value) {
		return new ResolvedManifestValue(value, [])
	}

	static error(node, message) {
		return new ResolvedManifestValue(undefined, [manifestError(node, message)])
	}

	constructor(value, errors) {
		this.value = value
		this.errors = errors
	}

	values() {
		return this.errors.length === 0 ? [this.value] : []
	}
}

function groupStatements(statements) {
	const groups = new Map()

	for (const node of statements) {
		const name = node.key.value
		const group = groups.get(name) ?? { name, node, nodes: [] }
		group.nodes.push(node)
		groups.set(name, group)
	}

	return groups
}

function scalarText(node) {
	if (node.kind === 'BracedValue') {
		return node.raw.trim()
	}

	return node.value
}

function isArraySchema(schema) {
	return schema.type === 'array'
}

function schemaWithManifestFields(schema) {
	if (schema.type !== 'object' || schema.properties?.intent !== undefined) {
		return schema
	}

	return {
		...schema,
		properties: {
			...schema.properties,
			intent: Type.Optional(Type.String()),
		},
	}
}

function manifestError(node, message) {
	return {
		message,
		location: node?.start,
	}
}
