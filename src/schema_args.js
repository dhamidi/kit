import { parseArgs as nodeParseArgs } from 'node:util'
import { schemaAliases, shorthandTarget } from './schema_normalizer.js'

export const schemaArgsMetadata = Symbol('kit.schemaArgsMetadata')

/**
 * Converts a TypeBox object schema into node:util parseArgs option definitions.
 *
 * @example
 * const options = parseArgsOptionsFromSchema(schema)
 * const parsed = parseArgs({ args, options, allowPositionals: true })
 */
export function parseArgsOptionsFromSchema(schema) {
	const options = {}

	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		if (!isSchemaFieldVisibleInCLI(property) || !isStaticCLIOption(property)) {
			continue
		}

		options[name] = parseArgOption(property)

		for (const alias of schemaAliases(property)) {
			options[alias] = parseArgOption(property)
		}
	}

	Object.defineProperty(options, schemaArgsMetadata, {
		value: new SchemaArgsMetadata(schema),
		enumerable: false,
	})

	return options
}

/**
 * Parses argv against a TypeBox object schema using Kit's schema-derived CLI
 * rules. Useful in the REPL for checking exactly what a provider schema accepts.
 *
 * @example
 * const schema = kit.Type.Object({ tags: kit.Type.Array(kit.Type.String()) })
 * parseSchemaArgs(schema, ['--tags.0', 'one']).values // { tags: ['one'] }
 */
export function parseSchemaArgs(schema, argv = [], config = {}) {
	const options = parseArgsOptionsFromSchema(schema)
	const metadata = options[schemaArgsMetadata]
	let parsed

	try {
		parsed = nodeParseArgs({
			...config,
			args: argv,
			options: metadata.optionsFor(argv, options),
		})
	} catch (error) {
		if (typeof error?.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS_')) {
			throw new Error(schemaArgsErrorMessage(error, metadata))
		}

		throw error
	}

	return {
		...parsed,
		values: metadata.normalizeValues(parsed.values),
	}
}

function schemaArgsErrorMessage(error, metadata) {
	const message = error.message.replace(/\.\s+To specify a positional argument[\s\S]*$/, '.')
	const hint = metadata.hintForError(message)

	return hint === undefined ? message : `${message}\n${hint}`
}

/**
 * Converts a value object for a TypeBox schema into argv accepted by
 * parseSchemaArgs(). Arrays use zero-based dotted indexes so the generated argv
 * shows the same syntax users can pass to `kit generate`.
 *
 * @example
 * const schema = kit.Type.Object({ tags: kit.Type.Array(kit.Type.String()) })
 * argvFromSchemaValues(schema, { tags: ['one'] }) // ['--tags.0', 'one']
 */
export function argvFromSchemaValues(schema, values = {}) {
	const argv = []

	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		if (!isSchemaFieldVisibleInCLI(property) || values[name] === undefined) {
			continue
		}

		pushArgvValue(argv, [name], property, values[name])
	}

	return argv
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

/**
 * Returns true when schema-derived CLI options need array syntax guidance.
 */
export function schemaHasCLIArrayField(schema) {
	return Object.entries(schema.properties ?? {}).some(([, property]) => {
		return isSchemaFieldVisibleInCLI(property) && hasArrayField(property)
	})
}

function parseArgOption(property) {
	const option = {
		type: 'string',
	}

	if (property.multiple === true || property.type === 'array') {
		option.multiple = true
	}

	return option
}

function isStaticCLIOption(property) {
	return (property.type !== 'object' || shorthandTarget(property) !== undefined) && !isArrayOfObjects(property)
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

function hasArrayField(schema) {
	if (schema.type === 'array') {
		return true
	}

	if (schema.type === 'object') {
		return Object.entries(schema.properties ?? {}).some(([, property]) => {
			return isSchemaFieldVisibleInCLI(property) && hasArrayField(property)
		})
	}

	return false
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

			next[name] = parseArgOption(field.schema)
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
		const root = this.rootField(path[0])
		const property = root?.schema

		if (property === undefined || !isSchemaFieldVisibleInCLI(property)) {
			return undefined
		}

		return resolvePath(property, [root.name, ...path.slice(1)])
	}

	rootField(name) {
		const property = this.schema.properties?.[name]

		if (property !== undefined) {
			return { name, schema: property }
		}

		for (const [canonicalName, canonicalProperty] of Object.entries(this.schema.properties ?? {})) {
			if (schemaAliases(canonicalProperty).includes(name)) {
				return { name: canonicalName, schema: canonicalProperty }
			}
		}

		return undefined
	}

	hintForError(message) {
		const option = message.match(/Unknown option '--([^']+)'/)?.[1]

		if (option === undefined || !option.includes('.')) {
			return undefined
		}

		return optionHint(this.schema, option)
	}
}

function optionHint(schema, option) {
	const path = option.split('.')
	let current = schema.properties?.[path[0]]
	const prefix = [path[0]]

	if (current === undefined || !isSchemaFieldVisibleInCLI(current)) {
		return undefined
	}

	for (const part of path.slice(1)) {
		if (current.type === 'array') {
			if (!isArrayIndex(part)) {
				return `Array field '${prefix.join('.')}' needs a zero-based numeric index. Try --${[
					...prefix,
					0,
					...examplePath(current.items),
				].join('.')} <value>.`
			}

			prefix.push(part)
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

		prefix.push(part)
	}

	return undefined
}

function examplePath(schema) {
	if (schema.type === 'array') {
		return [0, ...examplePath(schema.items)]
	}

	if (schema.type === 'object') {
		const field = Object.entries(schema.properties ?? {}).find(([, property]) => {
			return isSchemaFieldVisibleInCLI(property)
		})

		return field === undefined ? [] : [field[0], ...examplePath(field[1])]
	}

	return []
}

function pushArgvValue(argv, path, schema, value) {
	if (schema.type === 'array') {
		const values = Array.isArray(value) ? value : [value]

		for (const [index, item] of values.entries()) {
			pushArgvValue(argv, [...path, index], schema.items, item)
		}

		return
	}

	if (schema.type === 'object') {
		for (const [name, property] of Object.entries(schema.properties ?? {})) {
			if (!isSchemaFieldVisibleInCLI(property) || value?.[name] === undefined) {
				continue
			}

			pushArgvValue(argv, [...path, name], property, value[name])
		}

		return
	}

	argv.push(`--${path.join('.')}`, String(value))
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

	return isScalarSchema(current) || isArrayOfScalars(current)
		? { path: resolved, schema: current }
		: undefined
}

function isArrayIndex(value) {
	return /^(0|[1-9][0-9]*)$/.test(value)
}

function isScalarSchema(schema) {
	return schema.type !== 'object' && schema.type !== 'array'
}

function isArrayOfScalars(schema) {
	return schema.type === 'array' && isScalarSchema(schema.items)
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
