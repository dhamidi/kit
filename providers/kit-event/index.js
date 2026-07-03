import { Glob } from 'bun'

class KitEventProvider {
	constructor(kit) {
		this.kit = kit
	}

	name() {
		return 'kit-event'
	}

	async *types() {
		yield new KitEventType(this.kit)
	}

	async *components() {
		for await (const path of new Glob('src/events/*.js').scan({ cwd: process.cwd() })) {
			const module = await import(String(new URL(path, `file://${process.cwd()}/`)))
			const family = path.replace(/^src\/events\//, '').replace(/\.js$/, '')

			for (const [name, schema] of Object.entries(schemasFrom(module))) {
				yield new KitEventComponent({
					family,
					name,
					schema,
					path,
				})
			}
		}
	}

	create(spec, env) {
		return new KitEventType(this.kit).create(spec, env)
	}
}

class KitEventType {
	constructor(kit) {
		this.kit = kit
	}

	id() {
		return 'event'
	}

	description() {
		return 'A Kit event schema in src/events/<family>.js'
	}

	schema() {
		const { Type } = this.kit

		return Type.Object({
			family: Type.String({ examples: ['provider', 'command'] }),
			name: Type.String({ examples: ['providerLoaded', 'commandOutput'] }),
		})
	}

	parse(argv) {
		return this.kit.parseArgs({
			args: argv,
			options: this.kit.parseArgsOptionsFromSchema(this.schema()),
			strict: true,
			allowPositionals: true,
		})
	}

	describe(spec) {
		return `Event schema for ${spec.family}.${spec.name}`
	}

	async *create(spec, env) {
		const path = `src/events/${spec.family}.js`
		const exists = await Bun.file(path).exists()

		if (exists) {
			yield await env.editFile(path, (source) => addEventToFamily(source, spec))
		} else {
			yield await env.createFile(path, familyTemplate(spec))
		}

		yield await env.editFile('src/event.js', (source) => registerEvent(source, spec))
	}
}

class KitEventComponent {
	constructor({ family, name, schema, path }) {
		this.family = family
		this.name = name
		this.schema = schema
		this.path = path
	}

	provider() {
		return 'kit-event'
	}

	id() {
		return `${this.family}.${this.name}`
	}

	description() {
		return this.schema.description ?? `Emitted when ${eventType(this.schema)} occurs`
	}

	inspect() {
		return {
			family: this.family,
			name: this.name,
			type: eventType(this.schema),
			files: [this.path],
		}
	}
}

function schemasFrom(module) {
	const entries = Object.entries(module).find(([name]) => name.endsWith('Schemas'))
	return entries?.[1] ?? {}
}

function eventType(schema) {
	return (
		schema.properties?.type?.const ??
		schema.properties?.type?.allOf?.find((part) => part.const)?.const ??
		schema.allOf?.[0]?.properties?.type?.const ??
		'(unknown)'
	)
}

function familyTemplate(spec) {
	return `import { Type } from '@sinclair/typebox'

/**
 * ${title(spec.family)} events describe ${spec.family} activity.
 */
export const ${familySchemas(spec)} = {
	${schemaKey(spec)}: Type.Object(
		{
			type: Type.Literal(${jsString(eventTypeName(spec))}),
		},
		{
			additionalProperties: false,
			description: ${jsString(`Generated ${eventTypeName(spec)} event`)},
		},
	),
}

/**
 * Builds a ${eventTypeName(spec)} payload.
 */
export function ${builderName(spec)}() {
	return { type: ${jsString(eventTypeName(spec))} }
}
`
}

function addEventToFamily(source, spec) {
	if (source.includes(`${schemaKey(spec)}:`)) {
		return source
	}

	const schemaEntry = `\t${schemaKey(spec)}: Type.Object(
\t\t{
\t\t\ttype: Type.Literal(${jsString(eventTypeName(spec))}),
\t\t},
\t\t{
\t\t\tadditionalProperties: false,
\t\t\tdescription: ${jsString(`Generated ${eventTypeName(spec)} event`)},
\t\t},
\t),
`

	let next = source.replace(/(export const \w+Schemas = \{\n)/, `$1${schemaEntry}`)

	if (!next.includes(`function ${builderName(spec)}(`)) {
		next += `
/**
 * Builds a ${eventTypeName(spec)} payload.
 */
export function ${builderName(spec)}() {
	return { type: ${jsString(eventTypeName(spec))} }
}
`
	}

	return next
}

function registerEvent(source, spec) {
	let next = source
	const importLine = [
		'import {',
		`${builderName(spec)},`,
		familySchemas(spec),
		`} from './events/${spec.family}.js'`,
	].join(' ')

	if (!next.includes(`./events/${spec.family}.js'`)) {
		next = next.replace("import { Value } from '@sinclair/typebox/value'\n", (match) => {
			return `${match}${importLine}\n`
		})
	} else {
		next = addImportNames(next, spec)
	}

	if (!next.includes(`...${familySchemas(spec)},`)) {
		next = next.replace(
			'\t\t...commandSchemas,\n\t}',
			`\t\t...commandSchemas,\n\t\t...${familySchemas(spec)},\n\t}`,
		)
	}

	if (!next.includes(`static ${methodName(spec)}(`)) {
		next = next.replace(
			'\n\tstatic from(schema, value) {',
			`
\tstatic ${methodName(spec)}() {
\t\treturn Event.from(Event.schemas.${schemaKey(spec)}, ${builderName(spec)}())
\t}

\tstatic from(schema, value) {`,
		)
	}

	return next
}

function addImportNames(source, spec) {
	return source.replace(
		new RegExp(`import \\{([\\s\\S]*?)\\} from './events/${escapeRegExp(spec.family)}\\.js'`),
		(match, names) => {
			const imported = names
				.split(',')
				.map((name) => name.trim())
				.filter(Boolean)

			for (const name of [builderName(spec), familySchemas(spec)]) {
				if (!imported.includes(name)) {
					imported.push(name)
				}
			}

			return `import {\n\t${imported.join(',\n\t')},\n} from './events/${spec.family}.js'`
		},
	)
}

function eventTypeName(spec) {
	return `${spec.family}.${spec.name}`
}

function familySchemas(spec) {
	return `${camelCase(spec.family)}Schemas`
}

function schemaKey(spec) {
	return camelCase(spec.name)
}

function builderName(spec) {
	return `${schemaKey(spec)}Event`
}

function methodName(spec) {
	return schemaKey(spec)
}

function camelCase(value) {
	return value.replace(/[-_.]+([a-z0-9])/g, (_, character) => character.toUpperCase())
}

function title(value) {
	const normalized = value.replace(/[-_.]+/g, ' ')
	return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function jsString(value) {
	return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function provider(kit) {
	return new KitEventProvider(kit)
}
