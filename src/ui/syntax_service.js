import { Parser } from 'web-tree-sitter'
import { FileURI } from '../file_uri.js'
import { BashLanguage } from './languages/bash_language.js'
import { CLanguage } from './languages/c_language.js'
import { HTMLLanguage } from './languages/html_language.js'
import { JavaScriptLanguage } from './languages/javascript_language.js'
import { JsonLanguage } from './languages/json_language.js'
import { MarkdownLanguage } from './languages/markdown_language.js'
import { RustLanguage } from './languages/rust_language.js'
import { SqlLanguage } from './languages/sql_language.js'
import { TomlLanguage } from './languages/toml_language.js'
import { TypeScriptLanguage } from './languages/typescript_language.js'

const runtime = FileURI.fromPath(new URL('../../vendor/tree-sitter/runtime', import.meta.url))
let runtimeInitialization

/**
 * Parses source with Tree-sitter and delegates language semantics to registered
 * language adapters.
 */
export class SyntaxService {
	constructor({ languages = defaultLanguages() } = {}) {
		this.languages = languages
	}

	/** Returns a normalized syntax document, or undefined when no grammar owns the file. */
	async analyze({ source, extension }) {
		const language = this.languages.find((candidate) => candidate.supports(extension))
		if (language === undefined) return undefined

		await initializeRuntime()
		const definition = await language.load(extension)
		const parser = new Parser()
		const sourceBytes = Buffer.from(source)
		parser.setLanguage(definition.grammar)
		const tree = parser.parse(sourceBytes.toString('latin1'))

		try {
			return {
				language: language.id,
				...language.document(tree.rootNode, sourceBytes, definition, extension),
			}
		} finally {
			tree.delete()
			parser.delete()
		}
	}
}

function defaultLanguages() {
	return [
		new RustLanguage(),
		new JavaScriptLanguage(),
		new TypeScriptLanguage(),
		new MarkdownLanguage(),
		new CLanguage(),
		new BashLanguage(),
		new HTMLLanguage(),
		new SqlLanguage(),
		new TomlLanguage(),
		new JsonLanguage(),
	]
}

function initializeRuntime() {
	runtimeInitialization ??= Parser.init({
		locateFile: () => runtime.join('web-tree-sitter.wasm').path(),
	})

	return runtimeInitialization
}
