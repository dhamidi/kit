import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export const maximumSourceBytes = 512 * 1024

/** Owns loading, syntax, selection, previews, and atomic edits for one source file. */
export class SourceDocument {
	constructor({ file, path, syntaxService, symbolIndex }) {
		this.file = file
		this.path = path
		this.syntaxService = syntaxService
		this.symbolIndex = symbolIndex
		this.extension = extname(file.path())
	}

	static async open(options) {
		const document = new SourceDocument(options)
		await document.load()
		return document
	}

	async load() {
		const metadata = await stat(this.file.path())
		if (!metadata.isFile()) throw new Error(`${this.file.path()} is not a file`)
		this.metadata = metadata
		if (metadata.size > maximumSourceBytes) return this.fail(`File is larger than ${maximumSourceBytes / 1024} KiB`)
		this.bytes = await readFile(this.file.path())
		if (this.bytes.includes(0)) return this.fail('Binary file preview is not available')
		try {
			this.text = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes)
		} catch {
			return this.fail('File is not valid UTF-8')
		}
		this.contentHash = Bun.hash(this.bytes).toString()
		this.syntax = await this.syntaxService.analyze({ source: this.text, extension: this.extension })
	}

	fail(error) {
		this.error = error
	}

	index() {
		if (this.error !== undefined) return
		this.symbolIndex.replaceFile({ path: this.path, language: this.syntax?.language ?? 'text', contentHash: this.contentHash, symbols: this.syntax?.symbols ?? [] })
		this.symbols = this.symbolIndex.symbolsForFile(this.path)
	}

	select(key) {
		return key === undefined ? undefined : this.symbols?.find((symbol) => symbol.isDefinition() && symbol.matchesSelection(key))
	}

	preview(key) {
		if (this.error !== undefined) return { error: this.error, lines: [], symbols: [] }
		this.index()
		const selection = this.select(key)
		const range = selection?.displayRange() ?? { startByte: 0, endByte: this.bytes.length, startLine: 1 }
		const indent = selection?.contentIndent ?? ''
		return {
			extension: this.extension,
			lines: dedentLines(highlightedLines(this.bytes, range.startByte, range.endByte, this.syntax?.highlights ?? []), indent),
			startLine: range.startLine,
			selection,
			editable: selection?.isEditable() ?? false,
			selectedText: selection === undefined ? undefined : dedent(new TextDecoder().decode(this.bytes.subarray(range.startByte, range.endByte)), indent),
			contentHash: this.contentHash,
			symbols: this.symbols,
		}
	}

	async replace({ symbolKey, expectedHash, replacement }) {
		if (this.error !== undefined) throw new Error('This file cannot be edited in the browser')
		if (this.contentHash !== expectedHash) throw new Error('The file changed after you opened it. Reload the symbol before saving.')
		this.index()
		const occurrence = this.select(symbolKey)
		if (occurrence === undefined) throw new Error('The selected definition is no longer available')
		const range = occurrence.editableRange()
		if (range === undefined) throw new Error('This callable has no editable body')
		const replacementBytes = new TextEncoder().encode(reindent(replacement, occurrence.contentIndent ?? ''))
		const updated = new Uint8Array(range.startByte + replacementBytes.length + this.bytes.length - range.endByte)
		updated.set(this.bytes.subarray(0, range.startByte))
		updated.set(replacementBytes, range.startByte)
		updated.set(this.bytes.subarray(range.endByte), range.startByte + replacementBytes.length)
		const temporary = this.file.parent().join(`.${basename(this.file.path())}.kit-${crypto.randomUUID()}.tmp`)
		try {
			await writeFile(temporary.path(), updated, { mode: this.metadata.mode })
			await rename(temporary.path(), this.file.path())
		} catch (error) {
			await unlink(temporary.path()).catch(() => {})
			throw error
		}
	}
}

function highlightedLines(bytes, rangeStart, rangeEnd, highlights) {
	const captures = highlights.filter((capture) => capture.startByte < rangeEnd && capture.endByte > rangeStart)
	const boundaries = new Set([rangeStart, rangeEnd])
	for (const capture of captures) { boundaries.add(Math.max(rangeStart, capture.startByte)); boundaries.add(Math.min(rangeEnd, capture.endByte)) }
	const points = [...boundaries].sort((left, right) => left - right)
	const lines = [[]]
	for (let index = 0; index < points.length - 1; index++) {
		const start = points[index]; const end = points[index + 1]
		const capture = captures.filter((candidate) => candidate.startByte <= start && candidate.endByte >= end)
			.sort((left, right) => (left.endByte - left.startByte) - (right.endByte - right.startByte) || right.patternIndex - left.patternIndex)[0]
		for (const [partIndex, part] of new TextDecoder().decode(bytes.subarray(start, end)).split('\n').entries()) {
			if (partIndex > 0) lines.push([])
			if (part !== '') lines.at(-1).push({ text: part, capture: capture?.capture })
		}
	}
	return lines
}

function dedentLines(lines, indent) {
	if (indent === '') return lines
	return lines.map((segments) => {
		if (!segments.map((segment) => segment.text).join('').startsWith(indent)) return segments
		let remaining = indent.length
		return segments.flatMap((segment) => { const removed = Math.min(remaining, segment.text.length); remaining -= removed; const text = segment.text.slice(removed); return text === '' ? [] : [{ ...segment, text }] })
	})
}

function dedent(source, indent) { return indent === '' ? source : source.split('\n').map((line) => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n') }
function reindent(source, indent) { return indent === '' ? source : source.split('\n').map((line) => line === '' ? line : `${indent}${line}`).join('\n') }
