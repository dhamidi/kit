import { JavaScriptLanguage } from './javascript_language.js'

const structures = `
	(method_definition name: (_) @name) @definition.method
	(public_field_definition name: (_) @name) @definition.field
	(program (lexical_declaration "const" (variable_declarator name: (identifier) @name)) @definition.constant)
	(program (lexical_declaration "let" (variable_declarator name: (identifier) @name)) @definition.variable)
	(program (variable_declaration (variable_declarator name: (identifier) @name)) @definition.variable)
	(program (export_statement (lexical_declaration "const" (variable_declarator name: (identifier) @name)) @definition.constant))
	(program (export_statement (lexical_declaration "let" (variable_declarator name: (identifier) @name)) @definition.variable))
`

/** Maps TypeScript and TSX trees to Kit syntax values. */
export class TypeScriptLanguage extends JavaScriptLanguage {
	constructor() {
		super({
			id: 'typescript',
			extensions: ['.ts', '.tsx', '.mts', '.cts'],
			assetDirectory: 'typescript',
			grammar: (extension) => extension === '.tsx' ? 'tsx.wasm' : 'typescript.wasm',
			tags: ['tags.scm', 'javascript-tags.scm'],
			highlights: ['highlights.scm', 'javascript-highlights.scm'],
			tsxHighlights: ['highlights.scm', 'javascript-highlights-jsx.scm', 'javascript-highlights.scm'],
			structures,
		})
	}
}
