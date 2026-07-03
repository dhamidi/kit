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
			project,
			help,
			argv: providerArgv,
		} = await extractGenerateOptions(argv)
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
			project,
		}

		if (spec.name === undefined) {
			spec.name = rest.parts().at(-1)
		}
		spec.description = match.candidate.type.describe(spec)

		if (rest.parts().length > 1) {
			spec.parent = rest.parts()[0]
		}

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

async function extractGenerateOptions(argv) {
	const next = []
	let intent
	let project
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
		} else if (argv[index] === '--project') {
			project = argv[index + 1]
			index++
		} else if (argv[index] === '--help') {
			help = true
		} else {
			next.push(argv[index])
		}
	}

	project ??= (await kit.repoRoot()).join('.kit/providers').path()

	return { dryRun, json, intent, project, help, argv: next }
}

async function generateHelp(providerQuery, target) {
	const providers = await loadProviders()

	if (providerQuery === undefined) {
		return [
			'Usage: kit generate [--project <path>] [--intent <text>] <provider> <component-type> [options]',
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
			'  --project <path>  Provider project/output directory; defaults to repoRoot/.kit/providers',
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
		`  ${'--project <path>'.padEnd(width)}  Provider project/output directory; defaults to repoRoot/.kit/providers`,
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
