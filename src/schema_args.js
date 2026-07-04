/**
 * Converts a TypeBox object schema into node:util parseArgs option definitions.
 *
 * @example
 * const options = parseArgsOptionsFromSchema(schema)
 * const parsed = parseArgs({ args, options, allowPositionals: true })
 */
export function parseArgsOptionsFromSchema(schema) {
	return Object.fromEntries(
		Object.entries(schema.properties ?? {})
			.filter(([, property]) => isSchemaFieldVisibleInCLI(property))
			.map(([name, property]) => [name, parseArgOption(property)]),
	)
}

/**
 * Returns whether a TypeBox schema field should be exposed as a generated CLI flag.
 */
export function isSchemaFieldVisibleInCLI(property) {
	return property.kit?.cli !== false
}

function parseArgOption(property) {
	const option = {
		type: parseArgType(property),
	}

	if (property.multiple === true) {
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
