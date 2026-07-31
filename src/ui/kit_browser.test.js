import { describe, expect, test } from 'bun:test'
import { KitBrowser } from './kit_browser.js'
import { ProviderCatalog } from './provider_catalog.js'

describe('KitBrowser', () => {
	test('shows only components belonging to the selected component type', async () => {
		const browser = fixtureBrowser()
		const snapshot = await browser.snapshot(new URLSearchParams({ provider: 'flask', type: 'route' }))

		expect(snapshot.selectedType).toBe('route')
		expect(snapshot.components.map(({ id }) => id)).toEqual(['public.index', 'admin.users'])
		expect(snapshot.selection).toMatchObject({ kind: 'type', title: 'route' })
	})

	test('keeps the type filter when selecting one of its components', async () => {
		const browser = fixtureBrowser()
		const snapshot = await browser.snapshot(new URLSearchParams({
			provider: 'flask',
			type: 'command',
			component: 'seed-db',
		}))

		expect(snapshot.selectedType).toBe('command')
		expect(snapshot.components.map(({ id }) => id)).toEqual(['seed-db'])
		expect(snapshot.selection).toMatchObject({ kind: 'component', title: 'seed-db' })
	})
})

function fixtureBrowser() {
	const browser = new KitBrowser({ cwd: '/workspace' })
	const resolver = new ProviderCatalog({ cwd: '/workspace' })
	const types = [typeEntry('route'), typeEntry('command')]
	const components = [
		componentEntry('public.index', 'route'),
		componentEntry('seed-db', 'command'),
		componentEntry('admin.users', 'route'),
	]
	const provider = {}

	browser.catalog = {
		providers: async () => [{ name: 'flask', provider }],
		types: async () => types,
		components: async () => components,
		componentType: (component, candidates) => resolver.componentType(component, candidates),
	}
	return browser
}

function typeEntry(id) {
	const type = {
		id: () => id,
		description: () => `${id} description`,
		schema: () => ({ type: 'object', properties: {} }),
	}
	return { id, description: type.description(), type }
}

function componentEntry(id, type) {
	const component = {
		id: () => id,
		type: () => type,
		description: () => `${id} description`,
		inspect: () => ({}),
	}
	return { id, description: component.description(), component }
}
