import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/**
 * Normalizes an input object according to Kit schema metadata before validation.
 *
 * This is the shared boundary for argv, manifest, and JSON inputs: providers
 * advertise the canonical schema, while Kit handles compatibility affordances
 * such as aliases, shorthand object values, scalar-to-array coercion, and
 * TypeBox defaults.
 *
 * @example
 * normalizeSchemaValue(schema, { method: 'POST' }) // { methods: ['POST'] }
 */
export function normalizeSchemaValue(schema, value = {}) {
	return Value.Default(schema, normalizeValue(schema, clone(value)))
}

/**
 * Returns validation errors for a normalized schema value, including Kit's small
 * set of schema-level constraints.
 */
export function schemaViolations(schema, value, { path = '' } = {}) {
	return [
		...Array.from(Value.Errors(schema, value ?? {}), (error) => {
			return {
				path: error.path || path || '/',
				message: error.message,
				value: error.value,
			}
		}),
		...kitConstraintViolations(schema, value, path),
	]
}

/**
 * Adds Kit's common manifest/generate fields to an object schema.
 */
export function schemaWithKitFields(schema) {
	if (schema.type !== 'object') {
		return schema
	}

	return {
		...schema,
		properties: {
			...schema.properties,
			description: schema.properties?.description ?? Type.Optional(Type.String()),
			files:
				schema.properties?.files ??
				Type.Optional(
					Type.Array(
						Type.String({ description: 'Workspace file associated with this component' }),
						{ description: 'Files associated with this component' },
					),
				),
			intent: schema.properties?.intent ?? optionalStringSchema(),
		},
	}
}

/**
 * Returns all aliases declared for a schema property.
 */
export function schemaAliases(schema) {
	return [schema.kit?.alias, ...(schema.kit?.aliases ?? [])].filter(Boolean)
}

/**
 * Returns the field an object schema accepts as scalar shorthand.
 */
export function shorthandTarget(schema) {
	return schema.kit?.shorthandFor ?? schema.kit?.shorthand?.to
}

function normalizeValue(schema, value) {
	if (schema.type === 'array') {
		const values = Array.isArray(value) ? value : [value]
		return values.map((entry) => normalizeValue(schema.items, entry))
	}

	if (schema.type === 'object') {
		return normalizeObject(schema, value)
	}

	return value
}

function normalizeObject(schema, value) {
	if (!isPlainObject(value)) {
		const target = shorthandTarget(schema)

		if (target !== undefined) {
			const object = {}
			assignPath(object, target.split('.'), value)
			return normalizeObject(schema, object)
		}

		return value
	}

	const normalized = { ...value }

	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		for (const alias of schemaAliases(property)) {
			if (normalized[name] === undefined && normalized[alias] !== undefined) {
				normalized[name] = normalized[alias]
			}

			delete normalized[alias]
		}
	}

	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		if (normalized[name] !== undefined) {
			normalized[name] = normalizeValue(property, normalized[name])
		}
	}

	return normalized
}

function kitConstraintViolations(schema, value, path) {
	const violations = []
	const oneOfRequired = schema.kit?.oneOfRequired ?? []

	if (oneOfRequired.length > 0 && !oneOfRequired.some((field) => value?.[field] !== undefined)) {
		violations.push({
			path: path || '/',
			message: `Expected at least one of: ${oneOfRequired.join(', ')}`,
			value,
		})
	}

	return violations
}

function optionalStringSchema() {
	return Type.Optional(Type.String())
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone(value) {
	return value === undefined ? undefined : structuredClone(value)
}

function assignPath(target, path, value) {
	let current = target

	for (const [index, part] of path.entries()) {
		if (index === path.length - 1) {
			current[part] = value
			return
		}

		current[part] ??= {}
		current = current[part]
	}
}
