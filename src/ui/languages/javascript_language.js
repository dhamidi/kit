import { ancestor, callableDetails, TreeSitterLanguage } from './tree_sitter_language.js'

const javascriptStructures = `
	(method_definition name: (property_identifier) @name) @definition.method
	(program (lexical_declaration "const" (variable_declarator name: (identifier) @name)) @definition.constant)
	(program (lexical_declaration "let" (variable_declarator name: (identifier) @name)) @definition.variable)
	(program (variable_declaration (variable_declarator name: (identifier) @name)) @definition.variable)
	(program (export_statement (lexical_declaration "const" (variable_declarator name: (identifier) @name)) @definition.constant))
	(program (export_statement (lexical_declaration "let" (variable_declarator name: (identifier) @name)) @definition.variable))
	(program (export_statement (variable_declaration (variable_declarator name: (identifier) @name)) @definition.variable))
	(field_definition property: [(property_identifier) (private_property_identifier)] @name) @definition.field
`

/** Maps JavaScript Tree-sitter nodes and query captures to Kit syntax values. */
export class JavaScriptLanguage extends TreeSitterLanguage {
	constructor({
		id = 'javascript',
		extensions = ['.js', '.jsx', '.mjs', '.cjs'],
		assetDirectory = 'javascript',
		grammar = 'parser.wasm',
		tags = ['tags.scm'],
		highlights = ['highlights.scm', 'highlights-jsx.scm', 'highlights-params.scm'],
		tsxHighlights = highlights,
		structures = javascriptStructures,
	} = {}) {
		super({ id, extensions, assetDirectory, grammar, tags, highlights, structures })
		this.tsxHighlights = tsxHighlights
	}

	highlightFilesFor(extension) {
		return extension === '.tsx' ? this.tsxHighlights : super.highlightFilesFor(extension)
	}

	describeSymbol({ kind, entity, sourceBytes }) {
		const container = classContainer(entity, sourceBytes)
		const callable = ['method', 'function'].includes(kind) ? callableNode(entity) : undefined
		const body = callable?.childForFieldName('body')
		const details = callable === undefined || body === null
			? {}
			: callableDetails(entity, body, sourceBytes, { braced: body.type === 'statement_block' })

		return {
			containerName: container?.name,
			containerStartByte: container?.startByte,
			signature: details.signature,
			contentStartByte: details.contentStartByte,
			contentEndByte: details.contentEndByte,
			contentStartLine: details.contentStartLine,
			contentIndent: body !== null && body?.type !== 'statement_block' ? '' : details.contentIndent,
		}
	}

	postprocessSymbols(symbols) {
		return symbols.filter((symbol) => {
			if (!['constant', 'variable'].includes(symbol.kind)) return true
			return !symbols.some((other) => {
				return other !== symbol
					&& other.role === symbol.role
					&& other.startByte === symbol.startByte
					&& other.endByte === symbol.endByte
					&& ['function', 'class'].includes(other.kind)
			})
		})
	}
}

function callableNode(entity) {
	if (['function_declaration', 'function_expression', 'generator_function', 'generator_function_declaration', 'method_definition'].includes(entity.type)) return entity
	if (entity.type === 'variable_declarator') return entity.childForFieldName('value') ?? undefined
	if (entity.type === 'assignment_expression') return entity.childForFieldName('right') ?? undefined
	if (entity.type === 'pair') return entity.childForFieldName('value') ?? undefined
	return entity
}

function classContainer(node, sourceBytes) {
	const container = ancestor(node, ['class', 'class_declaration'])
	const name = container?.childForFieldName('name')
	return name === null || name === undefined ? undefined : {
		name: new TextDecoder().decode(sourceBytes.subarray(name.startIndex, name.endIndex)),
		startByte: container.startIndex,
	}
}
