import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Type } from '@sinclair/typebox'
import { FileURI } from '../file_uri.js'
import { ComponentForm } from './component_form.js'

const temporaryDirectories = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ComponentForm', () => {
	test('groups fields and presents controls, defaults, examples, and constraints', async () => {
		const schema = Type.Object({
			name: Type.String({ description: 'Component name', pattern: '^[a-z]+$', default: 'widget' }),
			count: Type.Optional(Type.Integer({ minimum: 1, maximum: 9, examples: [3] })),
			enabled: Type.Optional(Type.Boolean({ default: false })),
			tags: Type.Optional(Type.Array(Type.String(), { default: ['one', 'two'] })),
			options: Type.Optional(Type.Object({}, { default: { color: 'blue' } })),
			mode: Type.Optional(Type.Union([Type.Literal('fast'), Type.Literal('safe')])),
		})
		const form = await ComponentForm.create(schema)

		expect(form.requiredFields.map((field) => field.name)).toEqual(['name'])
		expect(form.optionalFields.map((field) => field.name)).toEqual(['count', 'enabled', 'tags', 'options', 'mode'])
		expect(form.requiredFields[0]).toMatchObject({
			control: 'text', value: 'widget', description: 'Component name', pattern: '^[a-z]+$',
		})
		expect(form.optionalFields[0]).toMatchObject({ control: 'number', value: 3, minimum: 1, maximum: 9 })
		expect(form.optionalFields[1]).toMatchObject({ control: 'boolean', value: false })
		expect(form.optionalFields[2]).toMatchObject({ control: 'array', value: 'one\ntwo' })
		expect(form.optionalFields[3]).toMatchObject({ control: 'object', value: '{\n  "color": "blue"\n}' })
		expect(form.optionalFields[4]).toMatchObject({ control: 'choices', choices: ['fast', 'safe'] })
	})

	test('parses browser values according to each field', async () => {
		const form = await ComponentForm.create(Type.Object({
			enabled: Type.Boolean(),
			count: Type.Number(),
			tags: Type.Array(Type.Integer()),
			options: Type.Object({ active: Type.Boolean() }),
			mode: Type.Union([Type.Literal('fast'), Type.Literal(2)]),
			note: Type.Optional(Type.String()),
		}))
		const data = new FormData()
		data.set('enabled', 'false')
		data.set('count', '2.5')
		data.set('tags', '1\n 2\n\n3')
		data.set('options', '{"active":true}')
		data.set('mode', '2')
		data.set('note', '')

		expect(form.parse(data)).toEqual({
			enabled: false,
			count: 2.5,
			tags: [1, 2, 3],
			options: { active: true },
			mode: 2,
		})
	})

	test('turns inspected workspace files into source-browser links', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'kit-component-form-'))
		temporaryDirectories.push(directory)
		await writeFile(join(directory, 'component.js'), 'export default {}')
		const form = await ComponentForm.create(Type.Object({ files: Type.Array(Type.String()) }), {
			values: { files: ['component.js', 'missing.js'] },
			workspace: FileURI.fromPath(directory),
		})

		expect(form.requiredFields[0].fileLinks).toEqual([
			{ label: 'component.js', href: '/files?file=component.js' },
		])
	})
})
