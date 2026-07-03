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
			.filter(([, property]) => property.cli !== false)
			.map(([name, property]) => [name, parseArgOption(property)]),
	)
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
