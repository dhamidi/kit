import { ancestor, callableDetails, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = `
	(create_table (object_reference name: (identifier) @name)) @definition.table
	(create_view (object_reference name: (identifier) @name)) @definition.view
	(create_index column: (identifier) @name) @definition.index
	(create_function (object_reference name: (identifier) @name)) @definition.function
	(create_type (object_reference name: (identifier) @name)) @definition.type
	(create_schema (identifier) @name) @definition.schema
	(create_trigger (keyword_trigger) (object_reference name: (identifier) @name) (keyword_before)) @definition.trigger
	(create_trigger (keyword_trigger) (object_reference name: (identifier) @name) (keyword_after)) @definition.trigger
	(create_trigger (keyword_trigger) (object_reference name: (identifier) @name) (keyword_instead)) @definition.trigger
	(column_definition name: (identifier) @name) @definition.column
`

/**
 * Maps SQL Tree-sitter captures — tables, views, indexes, functions, types,
 * schemas, triggers, and columns — to Kit symbols.
 */
export class SqlLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: "sql",
			extensions: [".sql"],
			assetDirectory: "sql",
			grammar: "parser.wasm",
			tags: [],
			highlights: ["highlights.scm"],
			structures,
		})
	}

	/** Returns schema ownership for all objects, table ownership for columns, and callable body ranges for functions. */
	describeSymbol({ kind, entity, name, sourceBytes }) {
		const container = containerFor(kind, entity, name, sourceBytes)
		if (kind !== "function") return container
		const body = firstChild(entity, "function_body")
		return { ...container, ...functionDetails(entity, body, sourceBytes) }
	}
}

/** Returns the schema name that owns a schema-qualified object, or the table name that owns a column. */
function containerFor(kind, entity, name, sourceBytes) {
	if (kind === "schema") return {}

	if (kind === "column") {
		const table = ancestor(entity, ["create_table", "alter_table"])
		const ref = firstChild(table, "object_reference")
		const tableName = ref?.childForFieldName("name")
		if (tableName === null || tableName === undefined) return {}
		return {
			containerName: decode(sourceBytes, tableName.startIndex, tableName.endIndex),
			containerStartByte: ref.startIndex,
		}
	}

	const ref = kind === "index" ? firstChild(entity, "object_reference") : name.parent
	const schema = ref?.childForFieldName("schema")
	if (schema === null || schema === undefined) return {}
	return {
		containerName: decode(sourceBytes, schema.startIndex, schema.endIndex),
		containerStartByte: ref.startIndex,
	}
}

/** Returns the signature and dollar-quoted body content range for a CREATE FUNCTION statement. */
function functionDetails(entity, body, sourceBytes) {
	if (body === null || body === undefined) return {}
	const { signature } = callableDetails(entity, body, sourceBytes, { braced: false })

	let firstQuote = null
	let lastQuote = null
	for (let i = 0; i < body.childCount; i++) {
		const child = body.child(i)
		if (child.type === "dollar_quote") {
			if (firstQuote === null) firstQuote = child
			lastQuote = child
		}
	}

	if (firstQuote === null || firstQuote === lastQuote) return { signature }

	let startByte = firstQuote.endIndex
	let endByte = lastQuote.startIndex
	let startLine = firstQuote.endPosition.row + 1

	if (sourceBytes[startByte] === 13 && sourceBytes[startByte + 1] === 10) {
		startByte += 2
		startLine += 1
	} else if (sourceBytes[startByte] === 10) {
		startByte += 1
		startLine += 1
	}

	const closingLineStart = sourceBytes.lastIndexOf(10, endByte - 1)
	if (closingLineStart >= startByte) {
		const trailing = sourceBytes.subarray(closingLineStart + 1, endByte)
		if (trailing.every((byte) => byte === 9 || byte === 13 || byte === 32)) endByte = closingLineStart
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

function firstChild(node, type) {
	if (node === null || node === undefined) return undefined
	for (let i = 0; i < node.childCount; i++) {
		if (node.child(i).type === type) return node.child(i)
	}
	return undefined
}

function decode(bytes, start, end) {
	return new TextDecoder().decode(bytes.subarray(start, end))
}

function commonIndent(source) {
	const indents = source.split("\n").filter((line) => line.trim() !== "").map((line) => line.match(/^[\t ]*/)[0])
	if (indents.length === 0) return ""
	let common = indents[0]
	for (const indent of indents.slice(1)) while (!indent.startsWith(common)) common = common.slice(0, -1)
	return common
}
