import { stat } from 'node:fs/promises'
import { Glob } from 'bun'
import { Event } from './event.js'
import { FileURI } from './file_uri.js'
import { loadProvider } from './index.js'
import { repoRoot as findRepoRoot } from './repo_root.js'

/**
 * Returns the provider directories Kit scans for a repository and working directory.
 *
 * @example
 * const paths = providerDiscoveryPaths(FileURI.fromPath('/workspace/repo'), '/workspace/repo/app')
 * console.log(paths)
 */
export function providerDiscoveryPaths(repoRoot = process.cwd(), cwd = process.cwd()) {
	repoRoot = FileURI.fromPath(repoRoot)
	cwd = FileURI.fromPath(cwd)

	return uniqueFileURIs([
		repoRoot.join('providers'),
		repoRoot.join('kit/providers'),
		repoRoot.join('.kit/providers'),
		cwd.join('.kit/providers'),
	])
}

function uniqueFileURIs(values) {
	const seen = new Set()
	const unique = []

	for (const value of values) {
		const key = value.path()

		if (!seen.has(key)) {
			seen.add(key)
			unique.push(value)
		}
	}

	return unique
}

/**
 * Discovers providers by loading provider modules and yielding discovery events.
 *
 * @example
 * for await (const event of discoverProviders()) {
 * 	console.log(event.toJSON())
 * }
 */
export async function* discoverProviders({ repoRoot, cwd = process.cwd() } = {}) {
	repoRoot ??= await discoveryRoot(cwd)

	for (const directory of providerDiscoveryPaths(repoRoot, cwd)) {
		yield Event.providerDiscovered(directory)

		if (!(await exists(directory.path()))) {
			continue
		}

		for await (const path of new Glob('*/index.js').scan({
			cwd: directory.path(),
			absolute: true,
		})) {
			try {
				yield Event.providerLoading(path)
				const provider = await loadProvider(path)
				yield Event.providerLoaded(provider.name(), path)
			} catch (error) {
				yield Event.providerLoadFailed(path, `Failed to load provider at ${path}`, error)
			}
		}
	}
}

/**
 * Lists components from every discovered provider as an event stream.
 *
 * @example
 * for await (const event of discoverComponents()) {
 * 	console.log(event.toJSON())
 * }
 */
export async function* discoverComponents({ repoRoot, cwd = process.cwd() } = {}) {
	for await (const record of discoverComponentRecords({ repoRoot, cwd, events: true })) {
		if (record.event !== undefined) {
			yield record.event
		} else {
			yield Event.componentListed(
				record.provider.name(),
				record.component.id(),
				record.component.description(),
			)
		}
	}
}

/**
 * Discovers components with provider objects for provider-specific formatting.
 *
 * @example
 * for await (const record of discoverComponentRecords()) {
 * 	console.log(record.provider.name(), record.component.id())
 * }
 */
export async function* discoverComponentRecords({
	repoRoot,
	cwd = process.cwd(),
	events = false,
} = {}) {
	repoRoot ??= await discoveryRoot(cwd)

	for (const directory of providerDiscoveryPaths(repoRoot, cwd)) {
		if (events) {
			yield { event: Event.providerDiscovered(directory) }
		}

		if (!(await exists(directory.path()))) {
			continue
		}

		for await (const path of new Glob('*/index.js').scan({
			cwd: directory.path(),
			absolute: true,
		})) {
			try {
				if (events) {
					yield { event: Event.providerLoading(path) }
				}

				const provider = await loadProvider(path)

				if (events) {
					yield { event: Event.providerLoaded(provider.name(), path) }
				}

				for await (const component of provider.components()) {
					yield { provider, component, path }
				}
			} catch (error) {
				if (events) {
					yield {
						event: Event.providerLoadFailed(path, `Failed to load provider at ${path}`, error),
					}
				}
			}
		}
	}
}

/**
 * Finds one component by its provider-qualified identifier.
 *
 * @example
 * const component = await inspectComponent('kit-event.file.fileRead')
 * console.log(component.inspect())
 */
export async function inspectComponent(name, { repoRoot, cwd = process.cwd() } = {}) {
	for await (const record of discoverComponentRecords({ repoRoot, cwd })) {
		if (`${record.provider.name()}.${record.component.id()}` === name) {
			return record
		}
	}

	return undefined
}

async function exists(path) {
	try {
		return (await stat(path)).isDirectory()
	} catch {
		return false
	}
}

async function discoveryRoot(cwd) {
	try {
		return await findRepoRoot(cwd)
	} catch {
		return FileURI.fromPath(cwd)
	}
}
