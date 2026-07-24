const FALLBACK_WIDTH = 120

/**
 * KeyValueFormatter writes records as an aligned key/value definition list —
 * the same shape as `kit component show` output. Use it instead of a table
 * when rows carry long or list-valued cells: each array element gets its own
 * line and long values wrap to the available width instead of stretching a
 * table.
 *
 * @example
 * const details = new KeyValueFormatter()
 * details.entry('Worker', 'invoice-sync')
 * details.entry('Redis keys', ['queue:invoices', 'queue:invoices:dead'])
 * details.flush()
 */
export class KeyValueFormatter {
	/**
	 * @param output Sink with a `write` method, usually process.stdout.
	 * @param options `{ width }` overrides the detected terminal width;
	 *   `{ wide: true }` disables wrapping entirely.
	 */
	constructor(output = process.stdout, { width, wide = false } = {}) {
		this.output = output
		this.entries = []
		this.width = width
		this.wide = wide
	}

	/**
	 * Queues one key/value pair. Arrays render one element per line; plain
	 * objects render as single-line JSON; everything else is stringified.
	 */
	entry(key, value) {
		this.entries.push([String(key), value])
	}

	isEmpty() {
		return this.entries.length === 0
	}

	flush() {
		if (this.entries.length === 0) {
			return
		}

		const keyWidth = Math.max(...this.entries.map(([key]) => key.length))
		const valueWidth = Math.max(20, this.availableWidth() - keyWidth - 2)

		for (const [key, value] of this.entries) {
			const lines = this.entryLines(value, valueWidth)
			this.output.write(`${`${key.padEnd(keyWidth)}  ${lines[0] ?? ''}`.trimEnd()}\n`)

			for (const line of lines.slice(1)) {
				this.output.write(`${`${' '.repeat(keyWidth)}  ${line}`.trimEnd()}\n`)
			}
		}
	}

	entryLines(value, width) {
		const lines = valueLines(value)

		if (this.wide) {
			return lines
		}

		return lines.flatMap((line) => wrapLine(line, width))
	}

	availableWidth() {
		return this.width ?? this.output.columns ?? process.stdout.columns ?? FALLBACK_WIDTH
	}
}

function valueLines(value) {
	if (Array.isArray(value)) {
		return value.length === 0 ? [''] : value.flatMap(valueLines)
	}

	if (value !== null && typeof value === 'object') {
		return [JSON.stringify(value)]
	}

	return String(value).split('\n')
}

function wrapLine(line, width) {
	if (line.length <= width) {
		return [line]
	}

	const wrapped = []
	let rest = line

	while (rest.length > width) {
		const breakAt = rest.lastIndexOf(' ', width)
		const cut = breakAt > width / 2 ? breakAt : width
		wrapped.push(rest.slice(0, cut).trimEnd())
		rest = rest.slice(cut).trimStart()
	}

	if (rest !== '') {
		wrapped.push(rest)
	}

	return wrapped
}
