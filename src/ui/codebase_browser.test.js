import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileURI } from '../file_uri.js'
import { CodebaseBrowser } from './codebase_browser.js'

const temporaryDirectories = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('CodebaseBrowser symbol previews and editing', () => {
	test('reports invalid UTF-8 as an unusable preview', async () => {
		const fixture = await fixtureFile('invalid.js', new Uint8Array([0x66, 0x80, 0x6f]))
		const browser = new CodebaseBrowser(FileURI.fromPath(fixture.root))
		const snapshot = await browser.snapshot(new URLSearchParams({ file: fixture.name }))

		expect(snapshot.source.error).toContain('valid UTF-8')
		expect(snapshot.source.lines).toEqual([])
	})

	test('rejects a stale hash and bodyless callable editing', async () => {
		const fixture = await fixtureFile('sample.h', 'int add(int left, int right);\n')
		const browser = new CodebaseBrowser(FileURI.fromPath(fixture.root), { allowWrites: true })
		const selected = await selectDefinition(browser, fixture.name, 'add')

		expect(selected.source.editable).toBe(false)
		expect(selected.source.selection.editableRange()).toBeUndefined()
		await expect(browser.editSource({
			relativePath: fixture.name,
			expectedHash: selected.source.contentHash,
			symbolKey: selected.source.selection.selectionKey(),
			replacement: 'return left + right;',
		})).rejects.toThrow('no editable body')
		await expect(browser.editSource({
			relativePath: fixture.name,
			expectedHash: 'stale',
			symbolKey: selected.source.selection.selectionKey(),
			replacement: 'anything',
		})).rejects.toThrow('file changed')
	})

	test('selects only a JavaScript body, dedents its preview, and reindents its replacement', async () => {
		const source = 'class Greeter {\n  greet(name) {\n    const message = `Hi ${name}`\n    return message\n  }\n}\n'
		const fixture = await fixtureFile('sample.js', source)
		const browser = new CodebaseBrowser(FileURI.fromPath(fixture.root), { allowWrites: true })
		const selected = await selectDefinition(browser, fixture.name, 'greet')

		expect(selected.source.selectedText).toBe('const message = `Hi ${name}`\nreturn message')
		expect(selected.source.startLine).toBe(3)
		expect(selected.source.lines.map(lineText).join('\n')).toBe(selected.source.selectedText)
		await browser.editSource({
			relativePath: fixture.name,
			expectedHash: selected.source.contentHash,
			symbolKey: selected.source.selection.selectionKey(),
			replacement: 'const message = name.toUpperCase()\nreturn message',
		})
		expect(await readFile(fixture.path, 'utf8')).toBe('class Greeter {\n  greet(name) {\n    const message = name.toUpperCase()\n    return message\n  }\n}\n')

		const reparsed = await browser.snapshot(new URLSearchParams({
			file: fixture.name,
			symbol: selected.source.selection.selectionKey(),
		}))
		expect(reparsed.source.selection.name).toBe('greet')
		expect(reparsed.source.selectedText).toBe('const message = name.toUpperCase()\nreturn message')
	})

	test('selects and edits a Bash non-braced function body', async () => {
		const source = 'greet() if true; then\n  echo "hello"\nfi\n'
		const fixture = await fixtureFile('script.sh', source)
		const browser = new CodebaseBrowser(FileURI.fromPath(fixture.root), { allowWrites: true })
		const selected = await selectDefinition(browser, fixture.name, 'greet')

		expect(selected.source.selectedText).toBe('if true; then\n  echo "hello"\nfi')
		expect(selected.source.selection.signature).toBe('greet()')
		await browser.editSource({
			relativePath: fixture.name,
			expectedHash: selected.source.contentHash,
			symbolKey: selected.source.selection.selectionKey(),
			replacement: 'if false; then\n  echo "changed"\nfi',
		})
		expect(await readFile(fixture.path, 'utf8')).toBe('greet() if false; then\n  echo "changed"\nfi\n')
	})

	test('selects a Markdown heading section without including its heading', async () => {
		const source = '# Intro\nFirst paragraph.\n\n## Details\nNested paragraph.\n\n# Next\nLast.\n'
		const fixture = await fixtureFile('notes.md', source)
		const browser = new CodebaseBrowser(FileURI.fromPath(fixture.root), { allowWrites: true })
		const selected = await selectDefinition(browser, fixture.name, 'Intro')

		expect(selected.source.startLine).toBe(2)
		expect(selected.source.selectedText).toBe('First paragraph.\n\n## Details\nNested paragraph.\n\n')
		await browser.editSource({
			relativePath: fixture.name,
			expectedHash: selected.source.contentHash,
			symbolKey: selected.source.selection.selectionKey(),
			replacement: 'Replacement.\n\n## Detail\nUpdated.\n\n',
		})
		expect(await readFile(fixture.path, 'utf8')).toBe('# Intro\nReplacement.\n\n## Detail\nUpdated.\n\n# Next\nLast.\n')
	})
})

async function fixtureFile(name, source) {
	const root = await mkdtemp(join(tmpdir(), 'kit-ui-'))
	temporaryDirectories.push(root)
	const path = join(root, name)
	await writeFile(path, source)
	return { root, name, path }
}

async function selectDefinition(browser, file, name) {
	const initial = await browser.snapshot(new URLSearchParams({ file }))
	const symbol = initial.symbols.find((candidate) => candidate.name === name && candidate.role === 'definition')
	return browser.snapshot(new URLSearchParams({ file, symbol: symbol.key }))
}

function lineText(segments) {
	return segments.map(({ text }) => text).join('')
}
