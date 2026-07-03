import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { defineCommand, UserError } from '../cli.js'
import { Identifier } from '../component_identifier.js'
import { kit } from '../index.js'

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

		const env = dryRun ? createDryRunEnv() : kit.createFileEnv()

		for await (const event of match.candidate.type.create(spec, env)) {
			const value = event.toJSON()
			writeEvent(value, { dryRun, json })

			if (value.type === 'plan') {
				if (dryRun) {
					continue
				}

				await new kit.PlanExecutor().execute(value)
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

function createDryRunEnv() {
	return kit.Introspectable.includeInObject({
		async createFile(path) {
			return kit.Event.fileCreated(path)
		},
		async editFile(path) {
			return kit.Event.fileEdited(path)
		},
	})
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
		} else if (argv[index] === '--help') {
			help = true
		} else {
			next.push(argv[index])
		}
	}

	return { dryRun, json, intent, help, argv: next }
}

async function generateHelp(providerQuery, target) {
	const providers = await loadProviders()

	if (providerQuery === undefined) {
		return [
			'Usage: kit generate [--intent <text>] <provider> <component-type> [options]',
			'',
			'Generate a component using a provider.',
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
			'Component types:',
			...types.map((type) => `  ${type.id().padEnd(typeWidth(types))}  ${type.description()}`),
			'',
			'Global options:',
			'  --intent <text>   Extra planning context for follow-up agent work',
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
	const options = Object.entries(schema.properties ?? {}).filter(
		([, property]) => property.cli !== false,
	)
	const width = Math.max('--help'.length, ...options.map(([name]) => `--${name} <value>`.length))

	return [
		`Usage: kit generate ${provider.name()} ${type.id()} [options]`,
		'',
		type.description(),
		'',
		'Options:',
		...options.map(([name, property]) => {
			return `  ${`--${name} <value>`.padEnd(width)}  ${property.description ?? ''}`
		}),
		`  ${'--intent <text>'.padEnd(width)}  Extra planning context for follow-up agent work`,
		`  ${'-n, --dry-run'.padEnd(width)}  List generated files and print the final plan without writing or executing it`,
		`  ${'--json'.padEnd(width)}  Output one JSON object per event`,
		`  ${'--help'.padEnd(width)}  Show help`,
	].join('\n')
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
