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

	for (const name of Object.keys(options)) {
		if (options[name].type === 'boolean' && options[`no-${name}`] === undefined) {
			options[`no-${name}`] = { type: 'boolean' }
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
	const args = metadata.normalizeArgs(argv)
	let parsed

	try {
		parsed = nodeParseArgs({
			...config,
			args,
			options: metadata.optionsFor(args, options),
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

/**
 * Returns true when schema-derived CLI help should include boolean flag
 * guidance (bare `--flag` plus `--no-flag` / `--flag=false` negation).
 */
export function schemaHasCLIBooleanField(schema) {
	return schemaCLIOptionEntries(schema).some((entry) => entry.value === '')
}

function parseArgOption(property) {
	const option = {
		type: scalarSchema(property)?.type === 'boolean' ? 'boolean' : 'string',
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

function cliOptionEntries(name, schema, inherited = {}) {
	const context = {
		group: schema.kit?.group ?? inherited.group,
		description: schema.description ?? inherited.description,
	}

	if (schema.type === 'array' && schema.items?.type === 'object') {
		const itemContext = { ...context, description: schema.items.description ?? context.description }

		return Object.entries(schema.items.properties ?? {}).flatMap(([field, property]) => {
			if (!isSchemaFieldVisibleInCLI(property)) {
				return []
			}

			return cliOptionEntries(`${name}.<index>.${field}`, property, itemContext)
		})
	}

	if (schema.type === 'object') {
		return Object.entries(schema.properties ?? {}).flatMap(([field, property]) => {
			if (!isSchemaFieldVisibleInCLI(property)) {
				return []
			}

			return cliOptionEntries(`${name}.${field}`, property, context)
		})
	}

	return [
		{
			name,
			value: valueName(schema),
			description: optionDescription(schema, context.description),
			group: context.group,
		},
	]
}

/**
 * Builds the help description for one schema-derived option, falling back to
 * the closest ancestor description for nested fields and appending the schema
 * default so providers do not have to repeat defaults in description text.
 */
function optionDescription(schema, inheritedDescription) {
	const description = schema.description ?? inheritedDescription ?? ''

	if (schema.default === undefined) {
		return description
	}

	const rendered = typeof schema.default === 'string' ? schema.default : JSON.stringify(schema.default)
	const suffix = `(default: ${rendered})`

	return description === '' ? suffix : `${description} ${suffix}`
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
		return ''
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
			if (next[name] !== undefined) {
				continue
			}

			const field = this.fieldForOption(name)

			if (field !== undefined) {
				next[name] = parseArgOption(field.schema)
				continue
			}

			const target = negatedOptionTarget(name)

			if (target !== undefined && this.booleanField(target) !== undefined) {
				next[name] = { type: 'boolean' }
			}
		}

		return next
	}

	/**
	 * Rewrites boolean `--flag=true` / `--flag=false` forms into the bare-flag and
	 * `--no-flag` forms that node:util parseArgs accepts for boolean options.
	 */
	normalizeArgs(args) {
		return (args ?? []).map((arg) => {
			const match = /^--([^=]+)=(true|false)$/.exec(arg)

			if (match === null || this.booleanField(match[1]) === undefined) {
				return arg
			}

			return match[2] === 'true' ? `--${match[1]}` : `--no-${match[1]}`
		})
	}

	normalizeValues(values) {
		const normalized = { ...values }
		const negated = []

		for (const [name, value] of Object.entries(values)) {
			const field = this.fieldForOption(name)

			if (field !== undefined) {
				delete normalized[name]
				assignPath(normalized, field.path, coerceValue(field.schema, value))
				continue
			}

			const target = negatedOptionTarget(name)

			if (target !== undefined && this.booleanField(target) !== undefined) {
				delete normalized[name]

				if (value === true) {
					negated.push(target)
				}
			}
		}

		for (const [name, schema] of Object.entries(this.schema.properties ?? {})) {
			if (normalized[name] !== undefined && isSchemaFieldVisibleInCLI(schema)) {
				normalized[name] = coerceValue(schema, normalized[name])
			}
		}

		for (const target of negated) {
			const field = this.fieldForOption(target)

			if (field !== undefined) {
				assignPath(normalized, field.path, false)
				continue
			}

			normalized[this.rootField(target).name] = false
		}

		return normalized
	}

	/**
	 * Returns the schema for a root or dotted option name when it resolves to a
	 * boolean field, and undefined otherwise.
	 */
	booleanField(name) {
		const schema = name.includes('.') ? this.fieldForOption(name)?.schema : this.rootField(name)?.schema

		if (schema === undefined) {
			return undefined
		}

		return scalarSchema(schema).type === 'boolean' ? schema : undefined
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

	if (schema.type === 'boolean' && typeof value === 'boolean') {
		argv.push(value ? `--${path.join('.')}` : `--no-${path.join('.')}`)
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

	if (schema.anyOf !== undefined && typeof value === 'string') {
		return coerceUnionValue(schema.anyOf, value)
	}

	return value
}

/**
 * Coerces a CLI string into the most specific matching union variant: exact
 * literal matches stay untouched, numeric text becomes a number when the union
 * accepts one, and true/false become booleans when the union accepts one.
 */
function coerceUnionValue(variants, value) {
	if (variants.some((variant) => variant.const === value)) {
		return value
	}

	const types = new Set(variants.map((variant) => variant.type))

	if ((types.has('number') || types.has('integer')) && isNumericText(value)) {
		return Number(value)
	}

	if (types.has('boolean') && (value === 'true' || value === 'false')) {
		return value === 'true'
	}

	return value
}

function isNumericText(value) {
	return value.trim() !== '' && Number.isFinite(Number(value))
}

function negatedOptionTarget(name) {
	return name.startsWith('no-') ? name.slice(3) : undefined
}
