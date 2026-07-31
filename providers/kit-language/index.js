import { Glob } from 'bun'
import { Language, Parser } from 'web-tree-sitter'

const adapterGlob = 'src/ui/languages/*_language.js'
const manifestPath = 'vendor/tree-sitter/manifest.json'
const assetCatalogPath = 'src/ui/tree_sitter_assets.js'
let parserDefinition

/** Exposes Tree-sitter language adapters as Kit components. */
class KitLanguageProvider {
	constructor(kit) {
		this.kit = kit
	}

	name() {
		return 'kit-language'
	}

	async *types() {
		yield new KitLanguageType(this.kit)
	}

	async *components() {
		const manifest = await Bun.file(manifestPath).json()

		for await (const path of new Glob(adapterGlob).scan({ cwd: process.cwd() })) {
			if (path.endsWith('/tree_sitter_language.js')) continue
			const analysis = await analyzeAdapter(this.kit, path)
			const language = manifest.languages[analysis.adapter.id]
			if (language === undefined) continue
			yield new KitLanguageComponent({ analysis, language, path, kit: this.kit })
		}
	}

	create(spec, env) {
		return new KitLanguageType(this.kit).create(spec, env)
	}
}

/** Generates the data-driven part of a Tree-sitter language adapter. */
class KitLanguageType {
	constructor(kit) {
		this.kit = kit
	}

	id() {
		return 'language'
	}

	description() {
		return 'A Tree-sitter-backed source language for the Kit browser'
	}

	schema() {
		const { Type } = this.kit
		const queryFiles = Type.Array(Type.String({ description: 'Query filename below the vendored language queries directory' }))

		return Type.Object({
			name: Type.String({
				description: 'Lowercase language id used for the adapter and vendored asset directory',
				examples: ['python', 'ruby'],
				pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
			}),
			extensions: Type.Array(Type.String({
				description: 'File extension including its leading dot',
				pattern: '^\\.[A-Za-z0-9][A-Za-z0-9.+-]*$',
			}), {
				description: 'File extensions owned by this language',
				examples: [['.py', '.pyi']],
				minItems: 1,
			}),
			package: Type.String({
				description: 'Exact npm package that supplies the grammar and standard queries',
				examples: ['tree-sitter-python'],
			}),
			version: Type.String({
				description: 'Exact grammar package version to install and record in the vendor manifest',
				examples: ['0.25.0'],
				pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$',
			}),
			grammar: Type.String({
				description: 'Default vendored WASM filename',
				default: 'parser.wasm',
			}),
			tags: Type.Optional(Type.Array(Type.String(), {
				description: 'Tag query filenames used to discover definitions and references',
				default: ['tags.scm'],
			})),
			highlights: Type.Optional(Type.Array(Type.String(), {
				description: 'Highlight query filenames used for syntax coloring',
				default: ['highlights.scm'],
			})),
			structures: Type.Optional(Type.String({
				description: 'Additional Tree-sitter query captures for symbols missing from the upstream tags query',
			})),
			base: Type.Optional(Type.Union([
				Type.Literal('tree-sitter'),
				Type.Literal('javascript'),
			], {
				description: 'Existing adapter semantics to inherit',
				default: 'tree-sitter',
			})),
			grammarVariants: Type.Optional(Type.Record(Type.String(), Type.String(), {
				description: 'Exceptional extension-to-WASM mappings; all other extensions use grammar',
				kit: { cli: false },
			})),
			highlightVariants: Type.Optional(Type.Record(Type.String(), queryFiles, {
				description: 'Exceptional extension-to-highlight-query mappings',
				kit: { cli: false },
			})),
			semantics: Type.Optional(Type.Array(Type.String(), {
				description: 'Adapter methods that contain language-specific symbol semantics',
				kit: { cli: false },
			})),
		})
	}

	describe(spec) {
		return `${spec.name} source language from ${spec.package}@${spec.version}`
	}

	async *create(spec, env) {
		const root = this.kit.FileURI.fromPath(process.cwd())
		const file = root.join('src', 'ui', 'languages', `${fileStem(spec.name)}_language.js`)
		yield await env.createFile(file, adapterSource(spec))
		yield this.kit.Event.plan(
			`Finish ${spec.name} Tree-sitter support`,
			[
				{
					id: 'vendor-language-assets',
					instructions: `Vendor and statically embed ${spec.package}@${spec.version} grammar, query, license, checksum, and commit metadata without using floating versions`,
					files: [manifestPath, assetCatalogPath, 'package.json', 'bun.lock', `vendor/tree-sitter/${spec.name}`],
					agent: { prompt: vendorPrompt(spec) },
				},
				{
					id: 'implement-language-semantics',
					instructions: `Implement only the ${spec.name}-specific symbol semantics that cannot be expressed by queries`,
					files: [file],
					agent: { prompt: semanticsPrompt(spec, file.path()) },
				},
				{
					id: 'register-and-verify-language',
					instructions: 'Register the adapter with SyntaxService and add focused parser, symbol, highlight, and byte-range tests',
					files: [file, 'src/ui/syntax_service.js', 'src/ui/syntax_service.test.js'],
					verifyWithCommand: 'bun test src/ui',
				},
			],
			{ intent: spec.intent },
		)
	}
}

/** One existing language adapter and its exact vendored grammar metadata. */
class KitLanguageComponent {
	constructor({ analysis, language, path, kit }) {
		this.analysis = analysis
		this.language = language
		this.path = path
		this.kit = kit
	}

	provider() {
		return 'kit-language'
	}

	type() {
		return 'language'
	}

	id() {
		return this.analysis.adapter.id
	}

	description() {
		return `${this.id()} via ${this.language.package}@${this.language.version}`
	}

	inspect() {
		const adapter = this.analysis.adapter
		const extensions = [...adapter.extensions]
		const grammars = extensions.map((extension) => adapter.grammarFor(extension))
		const highlights = extensions.map((extension) => adapter.highlightFilesFor(extension))
		const grammar = mostCommon(grammars) ?? 'parser.wasm'
		const highlightFiles = mostCommon(highlights, sameArray) ?? []
		const grammarVariants = variants(extensions, grammars, grammar)
		const highlightVariants = variants(extensions, highlights, highlightFiles, sameArray)

		return compact({
			name: adapter.id,
			extensions,
			package: this.language.package,
			version: this.language.version,
			grammar,
			tags: adapter.tagFilesFor(extensions[0]),
			highlights: highlightFiles,
			structures: adapter.structureSource || undefined,
			base: this.analysis.base,
			grammarVariants,
			highlightVariants,
			semantics: this.analysis.semantics.length === 0 ? undefined : this.analysis.semantics,
			files: languageFiles(this.kit, adapter.id, this.path, this.language),
		})
	}
}

async function analyzeAdapter(kit, path) {
	const source = await Bun.file(path).text()
	const tree = await parseJavaScript(kit, source)
	try {
		const declaration = descendants(tree.rootNode, 'class_declaration')[0]
		const className = declaration?.childForFieldName('name')?.text
		const methods = declaration === undefined ? [] : descendants(declaration, 'method_definition')
			.map((method) => method.childForFieldName('name')?.text)
			.filter((name) => name !== undefined && !['constructor', 'grammarFor', 'highlightFilesFor', 'tagFilesFor'].includes(name))
		const module = await import(kit.FileURI.fromPath(path).toString())
		const Adapter = Object.values(module).find((value) => typeof value === 'function' && value.name === className)
		const adapter = new Adapter()
		const parentName = Object.getPrototypeOf(Adapter.prototype).constructor.name
		return {
			adapter,
			base: parentName === 'JavaScriptLanguage' ? 'javascript' : 'tree-sitter',
			semantics: [...new Set(methods)],
		}
	} finally {
		tree.delete()
	}
}

async function parseJavaScript(kit, source) {
	if (parserDefinition === undefined) {
		parserDefinition = (async () => {
			const root = kit.FileURI.fromPath(process.cwd())
			await Parser.init({ locateFile: () => root.join('vendor', 'tree-sitter', 'runtime', 'web-tree-sitter.wasm').path() })
			return Language.load(root.join('vendor', 'tree-sitter', 'javascript', 'parser.wasm').path())
		})()
	}
	const language = await parserDefinition
	const parser = new Parser()
	parser.setLanguage(language)
	const tree = parser.parse(Buffer.from(source).toString('latin1'))
	parser.delete()
	return tree
}

function descendants(node, type) {
	const matches = node.type === type ? [node] : []
	for (const child of node.namedChildren) matches.push(...descendants(child, type))
	return matches
}

function languageFiles(kit, name, adapterPath, language) {
	const workspace = kit.FileURI.fromPath(process.cwd())
	const vendor = workspace.join('vendor', 'tree-sitter')
	const assets = vendor.join(name)
	const relative = (file) => file.relativeTo(workspace)
	const files = [adapterPath, assetCatalogPath, manifestPath, relative(assets.join('LICENSE'))]
	if (language.grammar !== undefined) files.push(relative(vendor.join(language.grammar)))
	if (language.grammars !== undefined) files.push(...Object.keys(language.grammars).map((grammar) => relative(vendor.join(grammar))))
	files.push(...Object.keys(language.queries ?? {}).map((query) => relative(assets.join('queries', query))))
	return files
}

function adapterSource(spec) {
	const className = `${pascalCase(spec.name)}Language`
	const baseClass = spec.base === 'javascript' ? 'JavaScriptLanguage' : 'TreeSitterLanguage'
	const baseFile = spec.base === 'javascript' ? 'javascript_language.js' : 'tree_sitter_language.js'
	const grammar = variantExpression(spec.grammar, spec.grammarVariants)
	const highlights = JSON.stringify(spec.highlights ?? [])
	const highlightOverride = spec.highlightVariants === undefined ? '' : `

	highlightFilesFor(extension) {
		return ${JSON.stringify(spec.highlightVariants, null, 2)}[extension] ?? super.highlightFilesFor(extension)
	}`

	return `import { ${baseClass} } from './${baseFile}'

const structures = ${JSON.stringify(spec.structures ?? '')}

/** Maps ${spec.name} Tree-sitter captures to Kit syntax values. */
export class ${className} extends ${baseClass} {
	constructor() {
		super({
			id: ${JSON.stringify(spec.name)},
			extensions: ${JSON.stringify(spec.extensions)},
			assetDirectory: ${JSON.stringify(spec.name)},
			grammar: ${grammar},
			tags: ${JSON.stringify(spec.tags ?? [])},
			highlights: ${highlights},
			structures,
		})
	}${highlightOverride}
}
`
}

function variantExpression(fallback, mappings) {
	if (mappings === undefined) return JSON.stringify(fallback)
	return `(extension) => ${JSON.stringify(mappings, null, 2)}[extension] ?? ${JSON.stringify(fallback)}`
}

function vendorPrompt(spec) {
	return `Add exact dependency ${spec.package}@${spec.version}. Copy its WASM grammar, selected query files, and license into vendor/tree-sitter/${spec.name}. Record source commit metadata and SHA-256 checksums in ${manifestPath}. Add static file imports for every grammar and static text imports for every selected query to ${assetCatalogPath}, then register them under the ${spec.name} asset directory so standalone compiled Kit binaries embed them. Never use a regex parser or a floating package version.`
}

function semanticsPrompt(spec, path) {
	const semantics = spec.semantics?.join(', ') || 'none yet'
	return `Finish ${path} using Tree-sitter nodes and queries only. Requested semantic overrides: ${semantics}. Keep generic capture/loading behavior in TreeSitterLanguage. Add code only for ownership, callable body ranges, signatures, section ranges, or duplicate policy that the ${spec.name} grammar requires. Intent: ${spec.intent ?? 'bootstrap standard language support'}`
}

function variants(keys, values, fallback, equal = Object.is) {
	const result = {}
	for (let index = 0; index < keys.length; index++) {
		if (!equal(values[index], fallback)) result[keys[index]] = values[index]
	}
	return Object.keys(result).length === 0 ? undefined : result
}

function mostCommon(values, equal = Object.is) {
	return values.reduce((best, candidate) => {
		const count = values.filter((value) => equal(value, candidate)).length
		return best === undefined || count > best.count ? { value: candidate, count } : best
	}, undefined)?.value
}

function sameArray(left, right) {
	return left?.length === right?.length && left.every((value, index) => value === right[index])
}

function compact(value) {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function fileStem(name) {
	return name.replaceAll('-', '_')
}

function pascalCase(name) {
	return name.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join('')
}

export default function provider(kit) {
	return new KitLanguageProvider(kit)
}
