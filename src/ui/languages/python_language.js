import { ancestor, callableDetails, nodeName, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = '(class_definition body: (block (function_definition name: (identifier) @name) @definition.method))\n(class_definition body: (block (decorated_definition definition: (function_definition name: (identifier) @name) @definition.method)))'

/** Maps Python Tree-sitter nodes and query captures to Kit syntax values. */
export class PythonLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'python',
			extensions: ['.py', '.pyi'],
			assetDirectory: 'python',
			grammar: 'parser.wasm',
			tags: ['tags.scm'],
			highlights: ['highlights.scm'],
			structures,
		})
	}

	describeSymbol({ kind, entity, sourceBytes }) {
		const container = kind === 'method'
			? nodeName(ancestor(entity, ['class_definition']), sourceBytes)
			: nodeName(ancestor(entity, ['function_definition']), sourceBytes)
		if (['function', 'method'].includes(kind)) {
			const body = entity.childForFieldName('body')
			return {
				containerName: container?.name,
				containerStartByte: container?.startByte,
				...(body === null ? {} : pythonCallableDetails(entity, body, sourceBytes)),
			}
		}
		return {}
	}

	postprocessSymbols(symbols) {
		const methodNames = new Set(
			symbols
				.filter((symbol) => symbol.role === 'definition' && symbol.kind === 'method')
				.map((symbol) => `${symbol.startByte}:${symbol.endByte}`)
		)
		return symbols.filter((symbol) => {
			if (symbol.kind !== 'function') return true
			return !methodNames.has(`${symbol.startByte}:${symbol.endByte}`)
		})
	}
}

function pythonCallableDetails(entity, body, sourceBytes) {
	if (body.startPosition.row === entity.startPosition.row) {
		return callableDetails(entity, body, sourceBytes, { braced: false })
	}

	const lineStart = sourceBytes.lastIndexOf(10, body.startIndex - 1) + 1
	return {
		signature: decode(sourceBytes, entity.startIndex, body.startIndex).trim().replace(/\s+/g, ' '),
		contentStartByte: lineStart,
		contentEndByte: body.endIndex,
		contentStartLine: body.startPosition.row + 1,
		contentIndent: decode(sourceBytes, lineStart, body.startIndex),
	}
}

function decode(bytes, start, end) {
	return new TextDecoder().decode(bytes.subarray(start, end))
}
