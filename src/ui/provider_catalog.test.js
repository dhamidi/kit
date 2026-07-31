import { describe, expect, test } from 'bun:test'
import { ProviderCatalog } from './provider_catalog.js'

describe('ProviderCatalog', () => {
	const catalog = new ProviderCatalog({ cwd: '/workspace' })
	const types = [typeEntry('page'), typeEntry('page.admin')]

	test('finds an advertised type by its exact id', async () => {
		const provider = {
			async *types() {
				yield types[0].type
				yield types[1].type
			},
		}

		expect(await catalog.type(provider, 'page.admin')).toEqual(types[1])
		expect(await catalog.type(provider, 'admin')).toBeUndefined()
	})

	test('uses a component explicit type before identifier matching', () => {
		const component = { id: () => 'page.admin.users', type: () => 'page' }

		expect(catalog.componentType(component, types)).toBe(types[0])
	})

	test('does not fall back when an explicit type is unknown', () => {
		const component = { id: () => 'page.admin.users', type: () => 'missing' }

		expect(catalog.componentType(component, types)).toBeUndefined()
	})

	test('uses the only advertised type regardless of component id', () => {
		const component = { id: () => 'unrelated.component' }

		expect(catalog.componentType(component, [types[0]])).toBe(types[0])
	})

	test('uses the longest hierarchical type match', () => {
		const component = { id: () => 'page.admin.users' }

		expect(catalog.componentType(component, types)).toBe(types[1])
	})
})

function typeEntry(id) {
	const type = { id: () => id, description: () => `${id} description` }
	return { id, description: `${id} description`, type }
}
