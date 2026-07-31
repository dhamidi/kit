import { TreeSitterLanguage } from './tree_sitter_language.js'

const structures = "(pair key: (string (string_content) @name)) @definition.property"

/**
 * Maps JSON Tree-sitter pair captures to Kit symbols. Each object key becomes a
 * property definition; a pair nested inside another pair's object or array
 * value reports the enclosing pair's key as its owner.
 */
export class JsonLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'json',
			extensions: ['.json'],
			assetDirectory: 'json',
			grammar: 'parser.wasm',
			highlights: ['highlights.scm'],
			structures,
		})
	}

	/** Reports the key of the enclosing pair as the owner of a nested pair. */
	describeSymbol({ entity, sourceBytes }) {
		const owner = enclosingPair(entity)
		if (owner === undefined) return {}
		return pairKey(owner, sourceBytes)
	}
}

/**
 * Walks up from a pair through any enclosing object or array to the pair whose
 * value contains it, returning undefined for top-level pairs.
 */
function enclosingPair(pair) {
	for (let current = pair.parent; current !== null; current = current.parent) {
		if (current.type === 'pair') return current
		if (current.type !== 'object' && current.type !== 'array') return undefined
	}
	return undefined
}

/** Decodes the key of a pair into an owner name and the pair's start byte. */
function pairKey(pair, sourceBytes) {
	const key = pair.childForFieldName('key')
	if (key === null) return {}
	const content = key.namedChildren.find((child) => child.type === 'string_content')
	const name = content === undefined
		? ''
		: new TextDecoder().decode(sourceBytes.subarray(content.startIndex, content.endIndex))
	return { containerName: name, containerStartByte: pair.startIndex }
}
