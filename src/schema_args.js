export const schemaArgsMetadata = Symbol('kit.schemaArgsMetadata')

/**
 * Converts a TypeBox object schema into node:util parseArgs option definitions.
 *
 * @example
 * const options = parseArgsOptionsFromSchema(schema)
 * const parsed = parseArgs({ args, options, allowPositionals: true })
 */
export function parseArgsOptionsFromSchema(schema) {
	const options = Object.fromEntries(
		Object.entries(schema.properties ?? {})
			.filter(([, property]) => isSchemaFieldVisibleInCLI(property))
			.filter(([, property]) => isStaticCLIOption(property))
			.map(([name, property]) => [name, parseArgOption(property)]),
	)

	Object.defineProperty(options, schemaArgsMetadata, {
		value: new SchemaArgsMetadata(schema),
		enumerable: false,
	})

	return options
}

/**
 * Returns whether a TypeBox schema field should be exposed as a generated CLI flag.
 */
export function isSchemaFieldVisibleInCLI(property) {
	return property.kit?.cli !== false
}

/**
 * Returns the schema-derived option rows shown by `kit generate ... --help`.
 */
export function schemaCLIOptionEntries(schema) {
	return Object.entries(schema.properties ?? {}).flatMap(([name, property]) => {
		if (!isSchemaFieldVisibleInCLI(property)) {
			return []
		}

		return cliOptionEntries(name, property)
	})
}

function parseArgOption(property) {
	const option = {
		type: parseArgType(scalarSchema(property)),
	}

	if (property.multiple === true || property.type === 'array') {
		option.multiple = true
	}

	return option
}

function parseArgType(property) {
	if (property.type === 'boolean') {
		return 'boolean'
	}

	return 'string'
}

function isStaticCLIOption(property) {
	return property.type !== 'object' && !isArrayOfObjects(property)
}

function isArrayOfObjects(property) {
	return property.type === 'array' && property.items?.type === 'object'
}

function scalarSchema(property) {
	return property.type === 'array' ? property.items : property
}

function cliOptionEntries(name, schema) {
	if (schema.type === 'array' && schema.items?.type === 'object') {
		return Object.entries(schema.items.properties ?? {}).flatMap(([field, property]) => {
			if (!isSchemaFieldVisibleInCLI(property)) {
				return []
			}

			return cliOptionEntries(`${name}.<index>.${field}`, property)
		})
	}

	if (schema.type === 'object') {
		return Object.entries(schema.properties ?? {}).flatMap(([field, property]) => {
			if (!isSchemaFieldVisibleInCLI(property)) {
				return []
			}

			return cliOptionEntries(`${name}.${field}`, property)
		})
	}

	return [{ name, value: valueName(schema), description: schema.description ?? '' }]
}

function valueName(schema) {
	const scalar = scalarSchema(schema)

	if (scalar.type === 'boolean') {
		return '<boolean>'
	}

	if (scalar.type === 'number' || scalar.type === 'integer') {
		return '<number>'
	}

	return '<value>'
}

/**
 * SchemaArgsMetadata expands and resolves schema-directed dotted CLI flags.
 */
class SchemaArgsMetadata {
	constructor(schema) {
		this.schema = schema
	}

	optionsFor(args, options) {
		const next = { ...options }
		delete next[schemaArgsMetadata]

		for (const name of optionNames(args)) {
			const field = this.fieldForOption(name)

			if (field === undefined || next[name] !== undefined) {
				continue
			}

			next[name] = { type: 'string' }
		}

		return next
	}

	normalizeValues(values) {
		const normalized = { ...values }

		for (const [name, value] of Object.entries(values)) {
			const field = this.fieldForOption(name)

			if (field === undefined) {
				continue
			}

			delete normalized[name]
			assignPath(normalized, field.path, coerceValue(field.schema, value))
		}

		for (const [name, schema] of Object.entries(this.schema.properties ?? {})) {
			if (normalized[name] !== undefined && isSchemaFieldVisibleInCLI(schema)) {
				normalized[name] = coerceValue(schema, normalized[name])
			}
		}

		return normalized
	}

	fieldForOption(name) {
		if (!name.includes('.')) {
			return undefined
		}

		const path = name.split('.')
		const property = this.schema.properties?.[path[0]]

		if (property === undefined || !isSchemaFieldVisibleInCLI(property)) {
			return undefined
		}

		return resolvePath(property, path)
	}
}

function optionNames(args) {
	const names = []

	for (const arg of args ?? []) {
		if (!arg.startsWith('--') || arg === '--') {
			continue
		}

		const [name] = arg.slice(2).split('=', 1)
		names.push(name)
	}

	return names
}

function resolvePath(schema, path) {
	let current = schema
	const resolved = [path[0]]

	for (const part of path.slice(1)) {
		if (current.type === 'array') {
			if (!isArrayIndex(part)) {
				return undefined
			}

			resolved.push(Number(part))
			current = current.items
			continue
		}

		if (current.type !== 'object') {
			return undefined
		}

		current = current.properties?.[part]

		if (current === undefined || !isSchemaFieldVisibleInCLI(current)) {
			return undefined
		}

		resolved.push(part)
	}

	return isScalarSchema(current) ? { path: resolved, schema: current } : undefined
}

function isArrayIndex(value) {
	return /^(0|[1-9][0-9]*)$/.test(value)
}

function isScalarSchema(schema) {
	return schema.type !== 'object' && schema.type !== 'array'
}

function assignPath(target, path, value) {
	let current = target

	for (const [index, part] of path.entries()) {
		const last = index === path.length - 1

		if (last) {
			current[part] = value
			return
		}

		const nextPart = path[index + 1]
		current[part] ??= typeof nextPart === 'number' ? [] : {}
		current = current[part]
	}
}

function coerceValue(schema, value) {
	if (Array.isArray(value)) {
		const item = schema.type === 'array' ? schema.items : schema
		return value.map((entry) => coerceValue(item, entry))
	}

	if (schema.type === 'array') {
		return [coerceValue(schema.items, value)]
	}

	if (schema.type === 'boolean' && typeof value === 'string') {
		return value === 'true' ? true : value === 'false' ? false : value
	}

	if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'string') {
		return Number(value)
	}

	return value
}
