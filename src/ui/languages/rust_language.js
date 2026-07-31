import { ancestor, callableDetails, nodeName, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = `(field_declaration name: (field_identifier) @name) @definition.field`

/** Maps Rust structs, traits, implementations, functions, and fields to Kit symbols. */
export class RustLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'rust',
			extensions: ['.rs'],
			assetDirectory: 'rust',
			tags: ['tags.scm'],
			highlights: ['highlights.scm'],
			structures,
		})
	}

	describeSymbol({ kind, entity, sourceBytes }) {
		const implementation = ancestor(entity, ['impl_item'])
		const trait = ancestor(entity, ['trait_item'])
		const container = implementation === undefined
			? nodeName(trait ?? ancestor(entity, ['struct_item', 'enum_item', 'union_item', 'mod_item']), sourceBytes)
			: nodeName(implementation, sourceBytes)
		const normalizedKind = kind === 'method' && implementation === undefined && trait === undefined ? 'function' : kind
		const callable = ['method', 'function'].includes(normalizedKind)
			? callableDetails(entity, entity.childForFieldName('body'), sourceBytes)
			: {}
		return { kind: normalizedKind, containerName: container?.name, containerStartByte: container?.startByte, ...callable }
	}

	symbols(rootNode, sourceBytes, definition) {
		const symbols = super.symbols(rootNode, sourceBytes, definition)
		return symbols.filter((symbol, index) => {
			return symbols.findIndex((other) => other.role === symbol.role && other.kind === symbol.kind && other.startByte === symbol.startByte) === index
		})
	}
}
