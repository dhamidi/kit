import { Language, Query } from 'web-tree-sitter'
import { FileURI } from '../../file_uri.js'
import { SymbolOccurrence } from '../symbol_occurrence.js'

/**
 * Loads one Tree-sitter grammar and maps conventional tag captures to Kit
 * symbols. Language subclasses describe grammar-specific structure.
 */
export class TreeSitterLanguage {
	constructor({ id, extensions, assetDirectory, grammar = 'parser.wasm', tags = [], highlights = [], structures = '' }) {
		this.id = id
		this.extensions = new Set(extensions)
		this.assets = FileURI.fromPath(new URL(`../../../vendor/tree-sitter/${assetDirectory}`, import.meta.url))
		this.grammarSource = grammar
		this.tagFileSources = tags
		this.highlightFileSources = highlights
		this.structureSource = structures
		this.definitions = new Map()
	}

	/** Returns whether this adapter owns a file extension. */
	supports(extension) {
		return this.extensions.has(extension)
	}

	/** Loads and caches the grammar variant needed by an extension. */
	async load(extension) {
		const grammarFile = this.grammarFor(extension)
		const tagFiles = this.tagFilesFor(extension)
		const highlightFiles = this.highlightFilesFor(extension)
		const key = JSON.stringify([grammarFile, tagFiles, highlightFiles])
		if (!this.definitions.has(key)) this.definitions.set(key, this.loadDefinition(grammarFile, tagFiles, highlightFiles))
		return this.definitions.get(key)
	}

	/** Returns the grammar asset used for an extension. */
	grammarFor(extension) {
		return typeof this.grammarSource === 'function' ? this.grammarSource(extension) : this.grammarSource
	}

	/** Returns tag query assets used for an extension. */
	tagFilesFor() {
		return this.tagFileSources
	}

	/** Returns highlight query assets used for an extension. */
	highlightFilesFor() {
		return this.highlightFileSources
	}

	/** Maps a parsed tree to normalized symbols and highlight captures. */
	document(rootNode, sourceBytes, definition) {
		return {
			symbols: this.symbols(rootNode, sourceBytes, definition),
			highlights: definition.highlights === undefined ? [] : highlightsFrom(definition.highlights.captures(rootNode)),
		}
	}

	/** Converts conventional @definition.* and @reference.* query matches. */
	symbols(rootNode, sourceBytes, definition) {
		if (definition.tags === undefined) return []
		const symbols = []
		const seen = new Set()

		for (const match of definition.tags.matches(rootNode)) {
			const entity = match.captures.find((capture) => {
				return capture.name.startsWith('definition.') || capture.name.startsWith('reference.')
			})
			const name = match.captures.find((capture) => capture.name === 'name')
			if (entity === undefined || name === undefined) continue
			const separator = entity.name.indexOf('.')
			const role = entity.name.slice(0, separator)
			const kind = entity.name.slice(separator + 1)
			const details = this.describeSymbol({ role, kind, entity: entity.node, name: name.node, sourceBytes })
			const entityNode = details.entityNode ?? entity.node
			const key = `${role}:${kind}:${name.node.startIndex}:${name.node.endIndex}`
			if (seen.has(key)) continue
			seen.add(key)
			delete details.entityNode
			symbols.push(new SymbolOccurrence({
				role,
				kind,
				name: decode(sourceBytes, name.node.startIndex, name.node.endIndex),
				startByte: name.node.startIndex,
				endByte: name.node.endIndex,
				startLine: name.node.startPosition.row + 1,
				startColumn: name.node.startPosition.column,
				endLine: name.node.endPosition.row + 1,
				endColumn: name.node.endPosition.column,
				entityStartByte: entityNode.startIndex,
				entityEndByte: entityNode.endIndex,
				entityStartLine: entityNode.startPosition.row + 1,
				entityEndLine: entityNode.endPosition.row + 1,
				...details,
			}))
		}

		return this.postprocessSymbols(symbols)
	}

	/** Applies language-specific normalization or duplicate policy. */
	postprocessSymbols(symbols) {
		return symbols
	}

	/** Returns language-specific fields for one captured symbol. */
	describeSymbol() {
		return {}
	}

	async loadDefinition(grammarFile, tagFiles, highlightFiles) {
		const grammar = await Language.load(this.assets.join(grammarFile).path())
		const tagSources = await this.sources(tagFiles)
		const highlightSources = await this.sources(highlightFiles)
		if (this.structureSource !== '') tagSources.push(this.structureSource)

		return {
			grammar,
			tags: tagSources.length === 0 ? undefined : new Query(grammar, tagSources.join('\n')),
			highlights: highlightSources.length === 0 ? undefined : new Query(grammar, highlightSources.join('\n')),
		}
	}

	async sources(files) {
		return Promise.all(files.map((name) => Bun.file(this.assets.join('queries', name).path()).text()))
	}
}

/** Returns signature, content range, and indentation for a braced callable. */
export function callableDetails(entity, body, sourceBytes, { braced } = {}) {
	if (body === null) return {}
	const signature = decode(sourceBytes, entity.startIndex, body.startIndex).trim().replace(/\s+/g, ' ')
	const opening = sourceBytes[body.startIndex]
	const closing = sourceBytes[body.endIndex - 1]
	const hasDelimiters = braced ?? ((opening === 123 && closing === 125)
		|| (opening === 40 && closing === 41)
		|| (opening === 91 && closing === 93))

	if (!hasDelimiters) {
		const content = decode(sourceBytes, body.startIndex, body.endIndex)
		return {
			signature,
			contentStartByte: body.startIndex,
			contentEndByte: body.endIndex,
			contentStartLine: body.startPosition.row + 1,
			contentIndent: commonIndent(content),
		}
	}

	let startByte = body.startIndex + 1
	let endByte = body.endIndex - 1
	let startLine = body.startPosition.row + 1

	if (sourceBytes[startByte] === 13 && sourceBytes[startByte + 1] === 10) {
		startByte += 2
		startLine += 1
	} else if (sourceBytes[startByte] === 10) {
		startByte += 1
		startLine += 1
	}

	const closingLineStart = sourceBytes.lastIndexOf(10, endByte - 1)
	if (closingLineStart >= startByte) {
		const closingIndent = sourceBytes.subarray(closingLineStart + 1, endByte)
		if (closingIndent.every((byte) => byte === 9 || byte === 13 || byte === 32)) endByte = closingLineStart
	}

	const content = decode(sourceBytes, startByte, endByte)
	return {
		signature,
		contentStartByte: startByte,
		contentEndByte: endByte,
		contentStartLine: startLine,
		contentIndent: commonIndent(content),
	}
}

export function ancestor(node, types) {
	for (let current = node.parent; current !== null; current = current.parent) {
		if (types.includes(current.type)) return current
	}
	return undefined
}

export function nodeName(node, sourceBytes) {
	const name = node?.childForFieldName('name') ?? node?.childForFieldName('type')
	return name === null || name === undefined ? undefined : {
		name: decode(sourceBytes, name.startIndex, name.endIndex),
		startByte: node.startIndex,
	}
}

function decode(bytes, start, end) {
	return new TextDecoder().decode(bytes.subarray(start, end))
}

function commonIndent(source) {
	const indents = source.split('\n').filter((line) => line.trim() !== '').map((line) => line.match(/^[\t ]*/)[0])
	if (indents.length === 0) return ''
	let common = indents[0]
	for (const indent of indents.slice(1)) while (!indent.startsWith(common)) common = common.slice(0, -1)
	return common
}

function highlightsFrom(captures) {
	return captures.map((capture) => ({
		capture: capture.name,
		startByte: capture.node.startIndex,
		endByte: capture.node.endIndex,
		patternIndex: capture.patternIndex,
	}))
}
