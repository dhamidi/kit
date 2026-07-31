import { describe, expect, test } from 'bun:test'
import { SymbolIndex } from './symbol_index.js'
import { SyntaxService } from './syntax_service.js'

const service = new SyntaxService()

const parsingCases = [
	['Rust', '.rs', 'struct User { name: String }\nfn greet() { println!("hi"); }', 'rust', [['class', 'User'], ['field', 'name'], ['function', 'greet']]],
	['JavaScript', '.js', 'class Greeter { greet(name) { return name } }', 'javascript', [['class', 'Greeter'], ['method', 'greet']]],
	['JSX', '.jsx', 'export function Card({ title }) { return <h1>{title}</h1> }', 'javascript', [['function', 'Card']]],
	['TypeScript', '.ts', 'interface Store { get(id: string): string }\nconst count: number = 1', 'typescript', [['interface', 'Store'], ['method', 'get'], ['constant', 'count']]],
	['TSX', '.tsx', 'const View = ({ name }: { name: string }) => <div>{name}</div>', 'typescript', [['function', 'View']]],
	['Python', '.py', 'VERSION = "1"\nclass Greeter:\n    def greet(self):\n        return "hello"\n\ndef build():\n    return Greeter()', 'python', [['constant', 'VERSION'], ['class', 'Greeter'], ['method', 'greet'], ['function', 'build']]],
	['Markdown', '.md', '# Intro\nSome **bold** text.', 'markdown', [['heading', 'Intro']]],
	['C', '.c', 'struct User { int id; };\nint main(void) { return 0; }', 'c', [['class', 'User'], ['field', 'id'], ['function', 'main']]],
	['Bash', '.sh', 'greet() { echo "hello $1"; }', 'bash', [['function', 'greet']]],
	['HTML', '.html', '<main><h1 class="title">Hello</h1></main>', 'html', [['element', 'main'], ['element', 'h1']]],
	['SQL', '.sql', 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\nCREATE FUNCTION add(a INTEGER) RETURNS INTEGER AS $$ BEGIN RETURN a; END; $$ LANGUAGE plpgsql;', 'sql', [['table', 'users'], ['column', 'id'], ['column', 'name'], ['function', 'add']]],
	['JSON', '.json', '{"name": "kit", "config": {"debug": true, "ports": [8080, 8443]}}', 'json', [['property', 'name'], ['property', 'config'], ['property', 'debug'], ['property', 'ports']]],
	['TOML', '.toml', 'title = "kit"\n\n[owner]\nname = "Tom"\n[[products]]\nname = "Hammer"', 'toml', [['table', 'owner'], ['property', 'title'], ['property', 'name'], ['table', 'products']]],
]

describe('SyntaxService', () => {
	for (const [label, extension, source, language, expectedDefinitions] of parsingCases) {
		test(`parses ${label}`, async () => {
			const document = await service.analyze({ source, extension })
			const definitions = document.symbols
				.filter((symbol) => symbol.role === 'definition')
				.map(({ kind, name }) => [kind, name])

			expect(document.language).toBe(language)
			for (const definition of expectedDefinitions) expect(definitions).toContainEqual(definition)
			expect(document.highlights.length).toBeGreaterThan(0)
			expect(document.highlights.some(({ capture }) => typeof capture === 'string' && capture.length > 0)).toBe(true)
		})
	}

	test('does not parse an unsupported extension with a fallback', async () => {
		expect(await service.analyze({ source: 'function hidden() {}', extension: '.kit-unknown' })).toBeUndefined()
	})

	test('records JavaScript class ownership, signature, and body range', async () => {
		const source = 'class Greeter {\n  greet(name = "world") {\n    return `Hi ${name}`\n  }\n}'
		const document = await service.analyze({ source, extension: '.js' })
		const method = definition(document, 'method', 'greet')

		expect(method.containerName).toBe('Greeter')
		expect(method.signature).toBe('greet(name = "world")')
		expect(source.slice(method.contentStartByte, method.contentEndByte)).toBe('    return `Hi ${name}`')
		expect(method.contentIndent).toBe('    ')
	})

	test('keeps byte ranges aligned after non-ASCII source', async () => {
		const source = '// café 😀\nfunction exampleTarget(type, schema) {\n\treturn type.id()\n}\n'
		const document = await service.analyze({ source, extension: '.js' })
		const target = definition(document, 'function', 'exampleTarget')
		const bytes = Buffer.from(source)

		expect(target.signature).toBe('function exampleTarget(type, schema)')
		expect(bytes.subarray(target.startByte, target.endByte).toString()).toBe('exampleTarget')
		expect(bytes.subarray(target.contentStartByte, target.contentEndByte).toString()).toBe('\treturn type.id()')
	})

	test('records TypeScript ownership and distinguishes bodyless methods', async () => {
		const source = 'interface Store { get(id: string): string; }\nclass Memory {\n  get(id: string): string {\n    return id\n  }\n}'
		const document = await service.analyze({ source, extension: '.ts' })
		const methods = document.symbols.filter(({ role, kind, name }) => role === 'definition' && kind === 'method' && name === 'get')

		expect(methods[0].contentStartByte).toBeUndefined()
		expect(methods[0].contentEndByte).toBeUndefined()
		expect(methods[1].containerName).toBe('Memory')
		expect(methods[1].signature).toBe('get(id: string): string')
		expect(source.slice(methods[1].contentStartByte, methods[1].contentEndByte)).toBe('    return id')
	})

	test('records Rust member ownership, signature, and body range', async () => {
		const source = 'struct User { name: String }\nimpl User {\n    fn greet(&self) -> String {\n        self.name.clone()\n    }\n}'
		const document = await service.analyze({ source, extension: '.rs' })
		const field = definition(document, 'field', 'name')
		const method = definition(document, 'method', 'greet')

		expect(field.containerName).toBe('User')
		expect(method.containerName).toBe('User')
		expect(method.signature).toBe('fn greet(&self) -> String')
		expect(source.slice(method.contentStartByte, method.contentEndByte)).toBe('        self.name.clone()')
	})

	test('records Python methods and nested functions with dedented editable suites', async () => {
		const source = '# café 😀\nclass Greeter:\n    @classmethod\n    def greet(cls, name: str = "world") -> str:\n        prefix = "Hi"\n        return f"{prefix} {name}"\n\ndef outer():\n    def nested():\n        return "nested"\n    return nested()\n'
		const document = await service.analyze({ source, extension: '.py' })
		const methods = document.symbols.filter(({ role, kind, name }) => role === 'definition' && kind === 'method' && name === 'greet')
		const duplicateFunctions = document.symbols.filter(({ role, kind, name }) => role === 'definition' && kind === 'function' && name === 'greet')
		const method = methods[0]
		const nested = definition(document, 'function', 'nested')
		const bytes = Buffer.from(source)

		expect(methods).toHaveLength(1)
		expect(duplicateFunctions).toHaveLength(0)
		expect(method.containerName).toBe('Greeter')
		expect(method.signature).toBe('def greet(cls, name: str = "world") -> str:')
		expect(bytes.subarray(method.contentStartByte, method.contentEndByte).toString()).toBe('        prefix = "Hi"\n        return f"{prefix} {name}"')
		expect(method.contentIndent).toBe('        ')
		expect(nested.containerName).toBe('outer')
		expect(nested.signature).toBe('def nested():')
		expect(nested.contentIndent).toBe('        ')
	})

	test('gives a C prototype no editable content range', async () => {
		const document = await service.analyze({ source: 'int add(int left, int right);', extension: '.h' })
		const prototype = definition(document, 'function', 'add')

		expect(prototype.contentStartByte).toBeUndefined()
		expect(prototype.contentEndByte).toBeUndefined()
	})

	test('records SQL schema ownership, column ownership, and function body range', async () => {
		const source = 'CREATE TABLE app_schema.users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);\nCREATE FUNCTION app_schema.add(a INTEGER) RETURNS INTEGER AS $$\n  BEGIN\n    RETURN a;\n  END;\n$$ LANGUAGE plpgsql;'
		const document = await service.analyze({ source, extension: '.sql' })
		const table = definition(document, 'table', 'users')
		const column = definition(document, 'column', 'id')
		const fn = definition(document, 'function', 'add')

		expect(table.containerName).toBe('app_schema')
		expect(column.containerName).toBe('users')
		expect(fn.containerName).toBe('app_schema')
		expect(fn.signature).toBe('CREATE FUNCTION app_schema.add(a INTEGER) RETURNS INTEGER')
		expect(source.slice(fn.contentStartByte, fn.contentEndByte)).toBe('  BEGIN\n    RETURN a;\n  END;')
		expect(fn.contentIndent).toBe('  ')
	})

	test('records JSON nested pair ownership through objects and arrays', async () => {
		const source = '{\n  "name": "kit",\n  "config": {\n    "debug": true,\n    "ports": [8080, 8443],\n    "nested": { "deep": 1 }\n  },\n  "items": [\n    { "label": "first" }\n  ]\n}'
		const document = await service.analyze({ source, extension: '.json' })
		const name = definition(document, 'property', 'name')
		const debug = definition(document, 'property', 'debug')
		const deep = definition(document, 'property', 'deep')
		const label = definition(document, 'property', 'label')

		expect(name.containerName).toBeUndefined()
		expect(debug.containerName).toBe('config')
		expect(deep.containerName).toBe('nested')
		expect(label.containerName).toBe('items')
	})

	test('records TOML pair ownership through tables and inline tables', async () => {
		const source = 'title = "kit"\n\n[owner]\nname = "Tom"\ndob = 1979-05-27\n\n[servers.alpha]\nip = "10.0.0.1"\n\n[database]\ntemp = { target = 67, actual = 56 }'
		const document = await service.analyze({ source, extension: '.toml' })
		const title = definition(document, 'property', 'title')
		const ownerName = document.symbols.find((s) => s.role === 'definition' && s.kind === 'property' && s.name === 'name' && s.containerName === 'owner')
		const ip = definition(document, 'property', 'ip')
		const target = definition(document, 'property', 'target')

		expect(title.containerName).toBeUndefined()
		expect(ownerName).toBeDefined()
		expect(ownerName.containerName).toBe('owner')
		expect(ip.containerName).toBe('servers.alpha')
		expect(target.containerName).toBe('temp')
	})
})

test('SymbolIndex atomically replaces a file and hydrates occurrence fields', () => {
	const index = new SymbolIndex()
	const occurrence = {
		role: 'definition', kind: 'function', name: 'before', startByte: 3, endByte: 9,
		startLine: 2, startColumn: 1, endLine: 2, endColumn: 7,
		contentStartByte: 10, contentEndByte: 20, contentStartLine: 3, contentIndent: '  ',
	}

	try {
		index.replaceFile({ path: 'sample.js', language: 'javascript', contentHash: 'one', symbols: [occurrence] })
		expect(index.symbolsForFile('sample.js')[0]).toMatchObject({
			name: 'before', line: 2, entityStartByte: 3, entityEndByte: 9,
			contentStartByte: 10, contentEndByte: 20, contentStartLine: 3, contentIndent: '  ',
		})

		index.replaceFile({ path: 'sample.js', language: 'javascript', contentHash: 'two', symbols: [{ ...occurrence, name: 'after' }] })
		expect(index.definitionsNamed('before')).toEqual([])
		expect(index.symbolsForFile('sample.js').map(({ name }) => name)).toEqual(['after'])
	} finally {
		index.close()
	}
})

function definition(document, kind, name) {
	return document.symbols.find((symbol) => symbol.role === 'definition' && symbol.kind === kind && symbol.name === name)
}
