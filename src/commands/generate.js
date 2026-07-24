import { defineCommand, UserError } from '../cli.js'
import { Identifier } from '../component_identifier.js'
import { createFileEnv } from '../file_env.js'
import { kit } from '../index.js'
import { providerHookError } from '../provider.js'
import { schemaCLIOptionEntries, schemaHasCLIArrayField, schemaHasCLIBooleanField } from '../schema_args.js'
import {
	normalizeSchemaValue,
	schemaViolations,
	schemaWithKitFields,
} from '../schema_normalizer.js'

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
			specFile,
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

		const reparsed = parseComponentArgs(match.candidate, providerArgv.slice(2))
		const rest = match.restOverride ?? match.rest

		const fileSpec = specFile === undefined ? {} : await readSpecFile(specFile)
		let spec = normalizeSchemaValue(schemaWithKitFields(match.candidate.type.schema()), {
			...fileSpec,
			...reparsed.values,
			intent,
		})

		if (spec.name === undefined) {
			spec.name = rest.parts().at(-1)
		}

		if (spec.description === undefined) {
			try {
				spec.description = match.candidate.type.describe(spec)
			} catch (error) {
				throw providerFailure(match.candidate, 'describe', error)
			}
		}

		if (rest.parts().length > 1) {
			spec.parent = rest.parts()[0]
		}

		assertValidSpec(match.candidate.provider, match.candidate.type, spec)

		const env = createFileEnv({ dryRun })

		try {
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
		} catch (error) {
			throw providerFailure(match.candidate, 'create', error)
		}
	},
})

/**
 * Parses component-type argv, using the provider's parse() when it defines one
 * and falling back to Kit's schema-derived parser otherwise. Validates that a
 * custom parse() returns the { values, positionals } shape kit.parseArgs
 * produces, so a broken provider is reported instead of a misleading
 * missing-field error downstream.
 */
function parseComponentArgs(candidate, argv) {
	const { provider, type } = candidate

	if (typeof type.parse !== 'function') {
		return kit.parseArgs({
			args: argv,
			options: kit.parseArgsOptionsFromSchema(generateCLISchema(type.schema())),
			strict: true,
			allowPositionals: true,
		})
	}

	const injected = extractInjectedArgs(argv, type.schema())
	let parsed

	try {
		parsed = type.parse(injected.argv)
	} catch (error) {
		throw providerFailure(candidate, 'parse', error)
	}

	if (!isPlainObject(parsed) || !isPlainObject(parsed.values)) {
		throw new UserError(
			[
				`Provider '${provider.name()}' component type '${type.id()}' returned an invalid parse() result.`,
				'parse(argv) must return { values, positionals } like kit.parseArgs does.',
				"Fix the provider's parse(), or delete it to use Kit's schema-derived parser.",
			].join('\n'),
		)
	}

	return { ...parsed, values: { ...parsed.values, ...injected.values } }
}

/**
 * Returns the schema `kit generate` parses CLI flags against: the component
 * type's own schema plus the Kit-injected fields every component accepts
 * (description, files). Injected fields are grouped so help lists provider
 * options first; `intent` stays out because generate handles --intent as a
 * global option.
 */
function generateCLISchema(schema) {
	if (schema.type !== 'object') {
		return schema
	}

	const properties = { ...schemaWithKitFields(schema).properties }

	for (const [name, property] of Object.entries(properties)) {
		if (schema.properties?.[name] !== undefined) {
			continue
		}

		if (name === 'intent') {
			delete properties[name]
			continue
		}

		properties[name] = { ...property, kit: { ...property.kit, group: 'Component metadata' } }
	}

	return { ...schema, properties }
}

/**
 * Splits Kit-injected fields out of provider argv so component types with a
 * custom parse() never see flags their schema does not declare, while
 * `kit generate` still accepts --description and --files for every type.
 * Supports `--field value`, `--field=value`, and `--field.0 value` for arrays.
 */
function extractInjectedArgs(argv, schema) {
	const injected = injectedFieldSchemas(schema)
	const values = {}
	const rest = []

	for (let index = 0; index < argv.length; index++) {
		const match = argv[index].match(/^--([A-Za-z][\w-]*)(?:\.(\d+))?(?:=([\s\S]*))?$/)
		const field = injected[match?.[1]]

		if (field === undefined) {
			rest.push(argv[index])
			continue
		}

		const value = match[3] ?? argv[++index]

		if (value === undefined) {
			throw new UserError(`Option '--${match[1]} <value>' argument missing`)
		}

		if (field.type === 'array') {
			values[match[1]] ??= []
			values[match[1]][match[2] === undefined ? values[match[1]].length : Number(match[2])] = value
		} else {
			values[match[1]] = value
		}
	}

	return { values, argv: rest }
}

function injectedFieldSchemas(schema) {
	if (schema.type !== 'object') {
		return {}
	}

	const injected = {}

	for (const [name, property] of Object.entries(schemaWithKitFields(schema).properties)) {
		if (schema.properties?.[name] === undefined && name !== 'intent') {
			injected[name] = property
		}
	}

	return injected
}

/**
 * Converts an unexpected provider exception into a clean CLI error that names
 * the provider hook, keeping UserError untouched and preserving the raw stack
 * trace when KIT_DEBUG is set.
 */
function providerFailure(candidate, hook, error) {
	return providerHookError({
		providerName: candidate.provider.name(),
		typeId: candidate.type.id(),
		hook,
		error,
	})
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates an assembled spec against the component type's TypeBox schema before
 * a provider runs, so missing or malformed arguments produce readable CLI errors
 * instead of crashing inside provider generation code.
 *
 * @example
 * assertValidSpec(provider, type, { description: 'x' }) // throws: "name is required"
 */
function assertValidSpec(provider, type, spec) {
	const schema = schemaWithKitFields(type.schema())

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
	const seen = new Set()
	const problems = []

	for (const error of schemaViolations(schema, spec ?? {})) {
		const field = error.path === '/' ? '(spec)' : error.path.replace(/^\//, '').split('/')[0]

		if (seen.has(field)) {
			continue
		}

		seen.add(field)
		const description = schema.properties?.[field]?.description
		const missing = field !== '(spec)' && spec?.[field] === undefined
		const reason = missing ? 'is required' : `is invalid (${error.message})`
		problems.push(`${field} ${reason}${description ? ` — ${description}` : ''}`)
	}

	return problems
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
	let specFile
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
		} else if (argv[index] === '--spec') {
			specFile = argv[index + 1]
			index++
		} else if (argv[index] === '--help') {
			help = true
		} else {
			next.push(argv[index])
		}
	}

	return { dryRun, json, intent, agent, specFile, help, argv: next }
}

async function readSpecFile(path) {
	if (path === undefined) {
		throw new UserError('--spec requires a JSON file path or -')
	}

	try {
		const source = path === '-' ? await new Response(Bun.stdin.stream()).text() : await Bun.file(path).text()
		return JSON.parse(source)
	} catch (error) {
		throw new UserError(`Cannot read --spec ${path}: ${error.message}`)
	}
}

async function generateHelp(providerQuery, target) {
	const providers = await loadProviders()

	if (providerQuery === undefined) {
		return [
			'Usage: kit generate [--intent <text>] <provider> <component-type> [options]',
			'',
			'Generate a component using a provider.',
			'',
			...planLifecycleNote(),
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
			...globalOptionRows().map(([usage, description]) => `  ${usage.padEnd(globalOptionWidth())}  ${description}`),
			'',
			...planLifecycleNote(),
		].join('\n')
	}

	const match = await matchTarget(provider.name(), target)

	if (match === undefined) {
		throw new UserError(`Unknown component type: ${provider.name()} ${target}`)
	}

	return typeHelp(provider, match.candidate.type)
}

function typeHelp(provider, type) {
	const schema = generateCLISchema(type.schema())
	const options = schemaCLIOptionEntries(schema)
	const width = Math.max(
		globalOptionWidth(),
		...options.map((option) => optionUsage(option).length),
	)

	return [
		`Usage: kit generate ${provider.name()} ${type.id()} [options]`,
		'',
		type.description(),
		...optionSections(options).flatMap(({ title, entries }) => [
			'',
			`${title}:`,
			...entries.map((option) => `  ${optionUsage(option).padEnd(width)}  ${option.description}`),
		]),
		'',
		'Global options:',
		...globalOptionRows().map(([usage, description]) => `  ${usage.padEnd(width)}  ${description}`),
		'',
		...planLifecycleNote(),
		...schemaExamples(provider, type, schema),
		...schemaOptionNotes(schema),
	].join('\n')
}

/**
 * Splits schema-derived option entries into help sections. Fields annotated
 * with `kit: { group: 'Name' }` render under "Name options:" in first-seen
 * order, so providers can list common options first; unannotated fields stay
 * under "Options:".
 */
function optionSections(options) {
	const sections = new Map()

	for (const option of options) {
		const title = option.group === undefined ? 'Options' : `${option.group} options`

		if (!sections.has(title)) {
			sections.set(title, { title, entries: [] })
		}

		sections.get(title).entries.push(option)
	}

	return [...sections.values()]
}

function globalOptionRows() {
	return [
		['--intent <text>', 'Extra planning context for follow-up agent work'],
		['--agent <name>', 'Agent that executes the follow-up plan (default: auto)'],
		['--spec <path|->', 'Read component spec JSON from a file or stdin before applying CLI overrides'],
		['-n, --dry-run', 'List generated files and print the follow-up plan without writing or executing anything'],
		['--json', 'Output one JSON object per event'],
		['--help', 'Show help'],
	]
}

function globalOptionWidth() {
	return Math.max(...globalOptionRows().map(([usage]) => usage.length))
}

function planLifecycleNote() {
	return [
		'Plan execution:',
		'  When a provider emits a follow-up plan, kit generate executes it immediately with',
		'  the selected agent. With --dry-run the plan is only printed, not saved or executed.',
		'  Use `kit plan resume` to continue a plan whose execution was interrupted.',
	]
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
	const notes = []

	if (schemaHasCLIBooleanField(schema)) {
		notes.push(
			'',
			'Boolean flags:',
			'  Pass --flag to enable. Negate with --no-flag or --flag=false.',
		)
	}

	if (schemaHasCLIArrayField(schema)) {
		notes.push(
			'',
			'Array syntax:',
			'  Use zero-based dotted indexes for specific array items: --field.0 <value>',
			'  For arrays of objects, put the index before the object field: --field.0.name <value>',
			'  Scalar arrays also accept repeated flags: --field <value> --field <value>',
			'',
			'RePL round trip:',
			'  kit.parseSchemaArgs(schema, argv).values',
			'  kit.argvFromSchemaValues(schema, values)',
		)
	}

	return notes
}

function optionUsage(option) {
	return option.value === '' ? `--${option.name}` : `--${option.name} ${option.value}`
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
