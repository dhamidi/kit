import { ancestor, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = '(table [(bare_key) (quoted_key) (dotted_key)] @name) @definition.table\n(table_array_element [(bare_key) (quoted_key) (dotted_key)] @name) @definition.table\n(pair [(bare_key) (quoted_key) (dotted_key)] @name) @definition.property'

/**
 * Maps TOML Tree-sitter captures — tables, array-of-tables headers, and key
 * pairs — to Kit symbols. A pair nested inside a table or array-of-tables
 * header reports the header's key as its owner; a pair nested inside an
 * inline table reports the enclosing pair's key as its owner.
 */
export class TomlLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'toml',
			extensions: ['.toml'],
			assetDirectory: 'toml',
			grammar: 'parser.wasm',
			tags: [],
			highlights: ['highlights.scm'],
			structures,
		})
	}

	/** Reports the enclosing table or inline-table pair as the owner of a property. */
	describeSymbol({ kind, entity, sourceBytes }) {
		if (kind !== 'property') return {}
		const container = ancestor(entity, ['pair']) ?? ancestor(entity, ['table', 'table_array_element'])
		if (container === undefined) return {}
		const key = keyOf(container)
		if (key === undefined) return {}
		return {
			containerName: decode(sourceBytes, key.startIndex, key.endIndex),
			containerStartByte: container.startIndex,
		}
	}
}

/** Returns the bare, quoted, or dotted key child of a table or pair node. */
function keyOf(node) {
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i)
		if (child !== null && (child.type === 'bare_key' || child.type === 'quoted_key' || child.type === 'dotted_key')) {
			return child
		}
	}
	return undefined
}

function decode(bytes, start, end) {
	return new TextDecoder().decode(bytes.subarray(start, end))
}
