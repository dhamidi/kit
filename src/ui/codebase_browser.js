import { readdir, realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import { FileURI } from '../file_uri.js'
import { SymbolIndex } from './symbol_index.js'
import { SyntaxService } from './syntax_service.js'
import { SourceDocument } from './source_document.js'

const ignoredNames = new Set(['.git', 'node_modules'])

/**
 * Reads a codebase into the four-pane state used by the browser UI.
 */
export class CodebaseBrowser {
	constructor(root, { symbolIndex = new SymbolIndex(), syntaxService = new SyntaxService(), allowWrites = false } = {}) {
		this.root = FileURI.from(root)
		this.symbolIndex = symbolIndex
		this.syntaxService = syntaxService
		this.allowWrites = allowWrites
	}

	/**
	 * Returns one safe, renderable browser snapshot from URL search parameters.
	 */
	async snapshot(searchParams = new URLSearchParams()) {
		const directory = await this.contained(this.resolve(searchParams.get('dir') ?? ''))
		const selected = this.selectedFile(searchParams.get('file'))
		const selectedFile = selected === undefined ? undefined : await this.contained(selected)
		const query = (searchParams.get('query') ?? '').trim().toLowerCase()
		const entries = await readdir(directory.path(), { withFileTypes: true })
		const folders = entries
			.filter((entry) => entry.isDirectory() && !ignoredNames.has(entry.name))
			.map((entry) => this.item(directory.join(entry.name), entry.name))
			.filter((entry) => matches(entry.name, query))
			.sort(byName)
		const files = entries
			.filter((entry) => entry.isFile() && !ignoredNames.has(entry.name))
			.map((entry) => this.item(directory.join(entry.name), entry.name))
			.filter((entry) => matches(entry.name, query))
			.sort(byName)
		const selectedSymbol = searchParams.get('symbol') ?? undefined
		const source = selectedFile === undefined ? undefined : await this.source(selectedFile, selectedSymbol)
		const symbols = (source?.symbols ?? []).filter((symbol) => symbol.isDefinition() && matches(symbol.name, query))
			.map((symbol) => ({ ...symbol, ...symbol.presentation(selectedSymbol) }))

		return {
			rootName: basename(this.root.path()) || this.root.path(),
			directory: this.relative(directory),
			parent: directory.toString() === this.root.toString() ? undefined : this.relative(directory.parent()),
			folders,
			files,
			selectedFile: selectedFile === undefined ? undefined : this.relative(selectedFile),
			selectedSymbol,
			allowWrites: this.allowWrites,
			query: searchParams.get('query') ?? '',
			source,
			symbols,
		}
	}

	resolve(relativePath) {
		return relativePath === '' ? this.root : this.root.join(relativePath)
	}

	selectedFile(relativePath) {
		return relativePath === null || relativePath === '' ? undefined : this.resolve(relativePath)
	}

	async contained(file) {
		const canonicalRoot = FileURI.fromPath(await realpath(this.root.path()))
		const canonicalFile = FileURI.fromPath(await realpath(file.path()))

		if (canonicalFile.toString() !== canonicalRoot.toString()) {
			canonicalFile.relativeTo(canonicalRoot)
		}

		return file
	}

	item(file, name) {
		return { name, path: this.relative(file) }
	}

	relative(file) {
		return file.toString() === this.root.toString() ? '' : file.relativeTo(this.root)
	}

	async source(file, selectedSymbol) {
		const document = await SourceDocument.open({ file, path: this.relative(file), syntaxService: this.syntaxService, symbolIndex: this.symbolIndex })
		return document.preview(selectedSymbol)
	}

	/** Replaces one indexed Tree-sitter definition after checking its source hash. */
	async editSource({ relativePath, expectedHash, symbolKey, replacement }) {
		if (!this.allowWrites) throw new Error('Source editing is disabled. Start with --allow-writes to enable it.')
		const file = await this.contained(this.selectedFile(relativePath))
		const document = await SourceDocument.open({ file, path: this.relative(file), syntaxService: this.syntaxService, symbolIndex: this.symbolIndex })
		await document.replace({ symbolKey, expectedHash, replacement })
	}
}

function matches(value, query) {
	return query === '' || value.toLowerCase().includes(query)
}

function byName(left, right) {
	return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}
