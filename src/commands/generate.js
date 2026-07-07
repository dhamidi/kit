import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { defineCommand, UserError } from '../cli.js'
import { Identifier } from '../component_identifier.js'
import { createFileEnv } from '../file_env.js'
import { kit } from '../index.js'
import { schemaCLIOptionEntries, schemaHasCLIArrayField } from '../schema_args.js'

/**
 * Command for generating components through provider component types.
 *
 * @example
 * await createCLI([generate]).run(['generate', 'command', 'component.show'])
 */
export default defineCommand({
	name: 'generate',
	description: 'Generate a component',
	options: {
		'dry-run': { type: 'boolean', short: 'n' },
	},
	strict: false,
	async run({ argv }) {
		const {
			dryRun,
			json,
			intent,
			agent,
			help,
			argv: providerArgv,
		} = extractGenerateOptions(argv)
		const [providerQuery, target] = providerArgv

		if (help) {
			return await generateHelp(providerQuery, target)
		}

		if (target === undefined) {
			throw new UserError('Usage: kit generate <provider> <component-type> [provider options]')
		}

		const match = await matchTarget(providerQuery, target)

		if (match === undefined) {
			throw new UserError(`Unknown provider or component type: ${providerQuery} ${target}`)
		}

		const reparsed = match.candidate.type.parse(providerArgv.slice(2))
		const rest = match.restOverride ?? match.rest

		const spec = {
			...reparsed.values,
			intent,
		}

		if (spec.name === undefined) {
			spec.name = rest.parts().at(-1)
		}
		spec.description = match.candidate.type.describe(spec)

		if (rest.parts().length > 1) {
			spec.parent = rest.parts()[0]
		}

		assertValidSpec(match.candidate.provider, match.candidate.type, spec)

		const env = createFileEnv({ dryRun })

		for await (const event of match.candidate.type.create(spec, env)) {
			const value = event.toJSON()
			writeEvent(value, { dryRun, json })

			if (value.type === 'plan') {
				if (dryRun) {
					continue
				}

				await new kit.PlanExecutor({ agent }).execute(value)
			}
		}
	},
})

/**
 * Validates an assembled spec against the component type's TypeBox schema before
 * a provider runs, so missing or malformed arguments produce readable CLI errors
 * instead of crashing inside provider generation code.
 *
 * @example
 * assertValidSpec(provider, type, { description: 'x' }) // throws: "name is required"
 */
function assertValidSpec(provider, type, spec) {
	const schema = type.schema()

	if (schema?.type !== 'object') {
		return
	}

	const problems = fieldProblems(schema, spec)

	if (problems.length === 0) {
		return
	}

	throw new UserError(
		[
			`Cannot generate ${provider.name()} ${type.id()}:`,
			...problems.map((problem) => `  ${problem}`),
			'',
			`Run \`kit generate ${provider.name()} ${type.id()} --help\` to see all fields.`,
		].join('\n'),
	)
}

/**
 * Reduces TypeBox validation output to one readable message per offending field,
 * enriched with each field's schema description.
 */
function fieldProblems(schema, spec) {
	const specWithCommonFields = commonFieldsSchema(schema)
	const seen = new Set()
	const problems = []

	for (const error of Value.Errors(specWithCommonFields, spec ?? {})) {
		const field = error.path.replace(/^\//, '').split('/')[0]

		if (field === '' || seen.has(field)) {
			continue
		}

		seen.add(field)
		const description = schema.properties?.[field]?.description
		const missing = spec?.[field] === undefined
		const reason = missing ? 'is required' : `is invalid (${error.message})`
		problems.push(`${field} ${reason}${description ? ` — ${description}` : ''}`)
	}

	return problems
}

/**
 * Extends an object schema with the Kit-common `intent` field the generate
 * command adds to every spec, so it is not reported as an unknown property.
 */
function commonFieldsSchema(schema) {
	return {
		...schema,
		properties: {
			...schema.properties,
			intent: Type.Optional(Type.String()),
		},
	}
}

function writeEvent(value, { dryRun, json }) {
	if (json) {
		console.log(JSON.stringify(value))
		return
	}

	if (value.type === 'file.edited') {
		console.log(`${dryRun ? 'Would edit' : 'Edited'} ${kit.FileURI.fromPath(value.path).path()}`)
		return
	}

	if (value.type === 'file.created') {
		console.log(`${dryRun ? 'Would create' : 'Created'} ${kit.FileURI.fromPath(value.path).path()}`)
		return
	}

	if (value.type === 'command.spawned') {
		console.log(`${dryRun ? 'Would run' : 'Running'} ${value.command.join(' ')}`)
		return
	}

	if (value.type === 'command.exited') {
		if (!dryRun) {
			console.log(`Exited ${value.command.join(' ')} with code ${value.code}`)
		}

		return
	}

	if (value.type === 'command.output') {
		return
	}

	if (value.type === 'plan') {
		new kit.PlanFormatter().write(planStateForEvent(value))
		return
	}

	console.log(JSON.stringify(value))
}

function planStateForEvent(value) {
	return {
		id: value.id ?? '(pending)',
		status: 'pending',
		currentStepIndex: 0,
		plan: value,
	}
}

function extractGenerateOptions(argv) {
	const next = []
	let intent
	let agent
	let dryRun = false
	let json = false
	let help = false

	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === '-n' || argv[index] === '--dry-run') {
			dryRun = true
		} else if (argv[index] === '--json') {
			json = true
		} else if (argv[index] === '--intent') {
			intent = argv[index + 1]
			index++
		} else if (argv[index] === '--agent') {
			agent = argv[index + 1]
			index++
		} else if (argv[index] === '--help') {
			help = true
		} else {
			next.push(argv[index])
		}
	}

	return { dryRun, json, intent, agent, help, argv: next }
}

async function generateHelp(providerQuery, target) {
	const providers = await loadProviders()

	if (providerQuery === undefined) {
		return [
			'Usage: kit generate [--intent <text>] <provider> <component-type> [options]',
			'',
			'Generate a component using a provider.',
			'',
			'Examples:',
			'  kit generate <provider> <component-type> --help',
			'  kit generate kit task.inject-secret-files --file.0 thread-actors/src/sandbox/manager.ts',
			'',
			'Providers:',
			...providers.map((provider) => `  ${provider.name()}`),
		].join('\n')
	}

	const provider = matchProvider(providers, providerQuery)

	if (provider === undefined) {
		throw new UserError(`Unknown provider: ${providerQuery}`)
	}

	const types = await Array.fromAsync(provider.types())

	if (target === undefined) {
		return [
			`Usage: kit generate ${provider.name()} <component-type> [options]`,
			'',
			`Generate components with ${provider.name()}.`,
			'',
			'Examples:',
			`  kit generate ${provider.name()} <component-type> --help`,
			'',
			'Component types:',
			...types.map((type) => `  ${type.id().padEnd(typeWidth(types))}  ${type.description()}`),
			'',
			'Global options:',
			'  --intent <text>   Extra planning context for follow-up agent work',
			'  --agent <name>    Agent that executes the follow-up plan (default: amp)',
			'  -n, --dry-run     List generated files and print the final plan without writing or executing it',
			'  --json            Output one JSON object per event',
			'  --help            Show help',
		].join('\n')
	}

	const match = await matchTarget(provider.name(), target)

	if (match === undefined) {
		throw new UserError(`Unknown component type: ${provider.name()} ${target}`)
	}

	return typeHelp(provider, match.candidate.type)
}

function typeHelp(provider, type) {
	const schema = type.schema()
	const options = schemaCLIOptionEntries(schema)
	const width = Math.max('--help'.length, ...options.map((option) => optionUsage(option).length))

	return [
		`Usage: kit generate ${provider.name()} ${type.id()} [options]`,
		'',
		type.description(),
		'',
		'Options:',
		...options.map((option) => {
			return `  ${optionUsage(option).padEnd(width)}  ${option.description}`
		}),
		`  ${'--intent <text>'.padEnd(width)}  Extra planning context for follow-up agent work`,
		`  ${'--agent <name>'.padEnd(width)}  Agent that executes the follow-up plan (default: amp)`,
		`  ${'-n, --dry-run'.padEnd(width)}  List generated files and print the final plan without writing or executing it`,
		`  ${'--json'.padEnd(width)}  Output one JSON object per event`,
		`  ${'--help'.padEnd(width)}  Show help`,
		...schemaExamples(provider, type, schema),
		...schemaOptionNotes(schema),
	].join('\n')
}

function schemaExamples(provider, type, schema) {
	const values = schemaExampleValues(schema)
	const argv = kit.argvFromSchemaValues(schema, values)
	const command = [
		'kit',
		'generate',
		provider.name(),
		exampleTarget(type, schema),
		...argv,
	]

	return [
		'',
		'Examples:',
		`  ${command.map(shellQuote).join(' ')}`,
	]
}

function exampleTarget(type, schema) {
	const name = schema.properties?.name

	if (name !== undefined && !kit.isSchemaFieldVisibleInCLI(name)) {
		return `${type.id()}.${exampleValue(name)}`
	}

	return type.id()
}

function schemaExampleValues(schema) {
	const values = {}
	const required = new Set(schema.required ?? [])

	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		if (!kit.isSchemaFieldVisibleInCLI(property)) {
			continue
		}

		if (!required.has(name) && !hasSchemaExample(property)) {
			continue
		}

		values[name] = exampleValue(property)
	}

	return values
}

function hasSchemaExample(schema) {
	if (schema.examples?.[0] !== undefined || schema.default !== undefined || schema.const !== undefined) {
		return true
	}

	if (schema.anyOf !== undefined) {
		return schema.anyOf.some(hasSchemaExample)
	}

	if (schema.type === 'array') {
		return hasSchemaExample(schema.items)
	}

	if (schema.type === 'object') {
		return Object.entries(schema.properties ?? {}).some(([, property]) => {
			return kit.isSchemaFieldVisibleInCLI(property) && hasSchemaExample(property)
		})
	}

	return false
}

function exampleValue(schema) {
	if (schema.examples?.[0] !== undefined) {
		return schema.examples[0]
	}

	if (schema.default !== undefined) {
		return schema.default
	}

	if (schema.const !== undefined) {
		return schema.const
	}

	if (schema.anyOf !== undefined) {
		return exampleValue(schema.anyOf[0])
	}

	if (schema.type === 'array') {
		return [exampleValue(schema.items)]
	}

	if (schema.type === 'object') {
		return schemaExampleValues(schema)
	}

	if (schema.type === 'boolean') {
		return false
	}

	if (schema.type === 'number' || schema.type === 'integer') {
		return 1
	}

	return 'example'
}

function shellQuote(value) {
	const text = String(value)

	if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
		return text
	}

	return `'${text.replaceAll("'", "'\\''")}'`
}

function schemaOptionNotes(schema) {
	if (!schemaHasCLIArrayField(schema)) {
		return []
	}

	return [
		'',
		'Array syntax:',
		'  Use zero-based dotted indexes for specific array items: --field.0 <value>',
		'  For arrays of objects, put the index before the object field: --field.0.name <value>',
		'  Scalar arrays also accept repeated flags: --field <value> --field <value>',
		'',
		'RePL round trip:',
		'  kit.parseSchemaArgs(schema, argv).values',
		'  kit.argvFromSchemaValues(schema, values)',
	]
}

function optionUsage(option) {
	return `--${option.name} ${option.value}`
}

function typeWidth(types) {
	return Math.max(...types.map((type) => type.id().length))
}

async function matchTarget(providerQuery, target) {
	const targetID = Identifier.fromString(target)
	const providers = await loadProviders()

	const provider = matchProvider(providers, providerQuery)

	if (provider === undefined) {
		return undefined
	}

	const candidates = []

	for await (const type of provider.types()) {
		candidates.push({
			id: type.id(),
			provider,
			type,
		})

		if (type.id() === 'component') {
			candidates.push({
				id: 'components',
				provider,
				type,
			})
			candidates.push({
				id: targetID.parts()[0],
				restOverride: targetID,
				provider,
				type,
			})
		}
	}

	return kit.bestMatch(candidates, target)
}

async function loadProviders() {
	const providers = []

	for await (const event of kit.discoverProviders()) {
		const value = event.toJSON()

		if (value.type === 'provider.loaded') {
			providers.push(await kit.loadProvider(value.path))
		}
	}

	return providers
}

function matchProvider(providers, query) {
	return (
		providers.find((provider) => provider.name() === query) ??
		providers.find((provider) => provider.name().split('-').includes(query))
	)
}
