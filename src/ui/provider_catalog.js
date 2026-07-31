import { loadProvider } from '../index.js'
import { bestMatch } from '../matcher.js'
import { discoverProviders } from '../provider_discovery.js'

/**
 * Discovers providers and resolves their advertised component types for Kit's UI.
 */
export class ProviderCatalog {
	constructor({ cwd, discover = discoverProviders, load = loadProvider }) {
		this.cwd = cwd
		this.discover = discover
		this.load = load
	}

	async providers() {
		const providers = []

		for await (const event of this.discover({ cwd: this.cwd })) {
			const value = event.toJSON()

			if (value.type === 'provider.loaded') {
				providers.push({ name: value.name, provider: await this.load(value.path) })
			}
		}

		return providers.sort((left, right) => left.name.localeCompare(right.name))
	}

	async provider(name) {
		return (await this.providers()).find((entry) => entry.name === name)
	}

	async types(provider) {
		return Array.fromAsync(provider.types(), (type) => ({
			id: type.id(),
			description: type.description(),
			type,
		}))
	}

	async type(provider, id) {
		return (await this.types(provider)).find((entry) => entry.id === id)
	}

	async components(provider) {
		return Array.fromAsync(provider.components(), (component) => ({
			id: component.id().toString(),
			description: component.description(),
			component,
		}))
	}

	componentType(component, types) {
		const explicitType = typeof component.type === 'function' ? component.type() : undefined

		if (explicitType !== undefined) {
			return types.find((entry) => entry.id === explicitType)
		}

		if (types.length === 1) {
			return types[0]
		}

		return bestMatch(types, component.id())?.candidate
	}
}
