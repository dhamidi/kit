import bashParser from '../../vendor/tree-sitter/bash/parser.wasm' with { type: 'file' }
import bashHighlights from '../../vendor/tree-sitter/bash/queries/highlights.scm' with { type: 'text' }
import cParser from '../../vendor/tree-sitter/c/parser.wasm' with { type: 'file' }
import cHighlights from '../../vendor/tree-sitter/c/queries/highlights.scm' with { type: 'text' }
import cTags from '../../vendor/tree-sitter/c/queries/tags.scm' with { type: 'text' }
import htmlParser from '../../vendor/tree-sitter/html/parser.wasm' with { type: 'file' }
import htmlHighlights from '../../vendor/tree-sitter/html/queries/highlights.scm' with { type: 'text' }
import javascriptParser from '../../vendor/tree-sitter/javascript/parser.wasm' with { type: 'file' }
import javascriptHighlightsJSX from '../../vendor/tree-sitter/javascript/queries/highlights-jsx.scm' with { type: 'text' }
import javascriptHighlightsParams from '../../vendor/tree-sitter/javascript/queries/highlights-params.scm' with { type: 'text' }
import javascriptHighlights from '../../vendor/tree-sitter/javascript/queries/highlights.scm' with { type: 'text' }
import javascriptTags from '../../vendor/tree-sitter/javascript/queries/tags.scm' with { type: 'text' }
import jsonParser from '../../vendor/tree-sitter/json/parser.wasm' with { type: 'file' }
import jsonHighlights from '../../vendor/tree-sitter/json/queries/highlights.scm' with { type: 'text' }
import markdownParser from '../../vendor/tree-sitter/markdown/parser.wasm' with { type: 'file' }
import markdownHighlights from '../../vendor/tree-sitter/markdown/queries/highlights.scm' with { type: 'text' }
import pythonParser from '../../vendor/tree-sitter/python/parser.wasm' with { type: 'file' }
import pythonHighlights from '../../vendor/tree-sitter/python/queries/highlights.scm' with { type: 'text' }
import pythonTags from '../../vendor/tree-sitter/python/queries/tags.scm' with { type: 'text' }
import runtime from '../../vendor/tree-sitter/runtime/web-tree-sitter.wasm' with { type: 'file' }
import rustParser from '../../vendor/tree-sitter/rust/parser.wasm' with { type: 'file' }
import rustHighlights from '../../vendor/tree-sitter/rust/queries/highlights.scm' with { type: 'text' }
import rustTags from '../../vendor/tree-sitter/rust/queries/tags.scm' with { type: 'text' }
import sqlParser from '../../vendor/tree-sitter/sql/parser.wasm' with { type: 'file' }
import sqlHighlights from '../../vendor/tree-sitter/sql/queries/highlights.scm' with { type: 'text' }
import tomlParser from '../../vendor/tree-sitter/toml/parser.wasm' with { type: 'file' }
import tomlHighlights from '../../vendor/tree-sitter/toml/queries/highlights.scm' with { type: 'text' }
import tsxParser from '../../vendor/tree-sitter/typescript/tsx.wasm' with { type: 'file' }
import typescriptParser from '../../vendor/tree-sitter/typescript/typescript.wasm' with { type: 'file' }
import typescriptHighlights from '../../vendor/tree-sitter/typescript/queries/highlights.scm' with { type: 'text' }
import typescriptHighlightsJSX from '../../vendor/tree-sitter/typescript/queries/javascript-highlights-jsx.scm' with { type: 'text' }
import typescriptJavaScriptHighlights from '../../vendor/tree-sitter/typescript/queries/javascript-highlights.scm' with { type: 'text' }
import typescriptJavaScriptTags from '../../vendor/tree-sitter/typescript/queries/javascript-tags.scm' with { type: 'text' }
import typescriptTags from '../../vendor/tree-sitter/typescript/queries/tags.scm' with { type: 'text' }

export const treeSitterRuntime = runtime

const directories = {
	bash: assets({ 'parser.wasm': bashParser }, { 'highlights.scm': bashHighlights }),
	c: assets({ 'parser.wasm': cParser }, { 'highlights.scm': cHighlights, 'tags.scm': cTags }),
	html: assets({ 'parser.wasm': htmlParser }, { 'highlights.scm': htmlHighlights }),
	javascript: assets({ 'parser.wasm': javascriptParser }, {
		'highlights.scm': javascriptHighlights,
		'highlights-jsx.scm': javascriptHighlightsJSX,
		'highlights-params.scm': javascriptHighlightsParams,
		'tags.scm': javascriptTags,
	}),
	json: assets({ 'parser.wasm': jsonParser }, { 'highlights.scm': jsonHighlights }),
	markdown: assets({ 'parser.wasm': markdownParser }, { 'highlights.scm': markdownHighlights }),
	python: assets({ 'parser.wasm': pythonParser }, { 'highlights.scm': pythonHighlights, 'tags.scm': pythonTags }),
	rust: assets({ 'parser.wasm': rustParser }, { 'highlights.scm': rustHighlights, 'tags.scm': rustTags }),
	sql: assets({ 'parser.wasm': sqlParser }, { 'highlights.scm': sqlHighlights }),
	toml: assets({ 'parser.wasm': tomlParser }, { 'highlights.scm': tomlHighlights }),
	typescript: assets({ 'typescript.wasm': typescriptParser, 'tsx.wasm': tsxParser }, {
		'highlights.scm': typescriptHighlights,
		'javascript-highlights-jsx.scm': typescriptHighlightsJSX,
		'javascript-highlights.scm': typescriptJavaScriptHighlights,
		'javascript-tags.scm': typescriptJavaScriptTags,
		'tags.scm': typescriptTags,
	}),
}

/** Returns the statically imported assets for one supported language. */
export function treeSitterAssets(name) {
	const directory = directories[name]
	if (directory === undefined) throw new Error(`Unknown Tree-sitter asset directory: ${name}`)
	return directory
}

function assets(grammars, queries) {
	return { grammars, queries }
}
