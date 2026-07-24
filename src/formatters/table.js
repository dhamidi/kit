const MIN_COLUMN_WIDTH = 5
const FALLBACK_WIDTH = 120
const COLUMN_SEPARATOR = '  '

/**
 * TableFormatter buffers rows and writes aligned columns to an output sink.
 *
 * Output is width-aware: the table is capped at the terminal width (falling
 * back to 120 columns when the sink is not a TTY) and overflowing cells are
 * truncated with an ellipsis. Columns may be plain header strings or specs
 * with layout hints.
 *
 * @example
 * const table = new TableFormatter(['Name', 'Description'])
 * table.row(['help', 'Show available commands'])
 * table.flush()
 *
 * @example
 * // Layout hints: cap one column, let another absorb the remaining width.
 * const table = new TableFormatter(
 * 	['Worker', { header: 'Cadence', maxWidth: 40 }, { header: 'Keys', flex: true }],
 * 	process.stdout,
 * 	{ wide: process.argv.includes('--wide') },
 * )
 */
export class TableFormatter {
	/**
	 * @param columns Array of header strings or `{ header, maxWidth?, flex? }` specs.
	 * @param output Sink with a `write` method, usually process.stdout.
	 * @param options `{ width }` overrides the detected terminal width;
	 *   `{ wide: true }` disables truncation entirely (for `--wide` flags).
	 */
	constructor(columns, output = process.stdout, { width, wide = false } = {}) {
		this.columns = columns.map((column) => (typeof column === 'string' ? { header: column } : column))
		this.output = output
		this.rows = []
		this.width = width
		this.wide = wide
	}

	row(values) {
		this.rows.push(values.map((value) => value.toString()))
	}

	isEmpty() {
		return this.rows.length === 0
	}

	flush() {
		const rows = [this.columns.map((column) => column.header), ...this.rows]
		const widths = this.columnWidths(rows)

		for (const row of rows) {
			this.output.write(`${formatRow(row, widths)}\n`)
		}
	}

	/**
	 * Computes final column widths: natural widths, capped per-column by
	 * maxWidth hints, then shrunk to fit the available width — the flex column
	 * first, then repeatedly the widest column.
	 */
	columnWidths(rows) {
		const natural = this.columns.map((_, index) => {
			return Math.max(...rows.map((row) => (row[index] ?? '').length))
		})

		if (this.wide) {
			return natural
		}

		const widths = natural.map((width, index) => {
			return Math.min(width, this.columns[index].maxWidth ?? Infinity)
		})
		const limit = this.availableWidth()
		const separators = COLUMN_SEPARATOR.length * Math.max(0, widths.length - 1)
		let total = sum(widths) + separators

		const flexIndex = this.columns.findIndex((column) => column.flex === true)

		if (total > limit && flexIndex >= 0) {
			const shrunk = Math.max(MIN_COLUMN_WIDTH, widths[flexIndex] - (total - limit))
			total -= widths[flexIndex] - shrunk
			widths[flexIndex] = shrunk
		}

		while (total > limit) {
			const index = widestShrinkableColumn(widths)

			if (index === undefined) {
				break
			}

			widths[index] -= 1
			total -= 1
		}

		return widths
	}

	availableWidth() {
		return this.width ?? this.output.columns ?? process.stdout.columns ?? FALLBACK_WIDTH
	}
}

function widestShrinkableColumn(widths) {
	let index
	let widest = MIN_COLUMN_WIDTH

	for (const [candidate, width] of widths.entries()) {
		if (width > widest) {
			widest = width
			index = candidate
		}
	}

	return index
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0)
}

function formatRow(row, widths) {
	return row
		.map((value, index) => {
			const cell = truncate(value ?? '', widths[index])
			return index === row.length - 1 ? cell : cell.padEnd(widths[index])
		})
		.join(COLUMN_SEPARATOR)
		.trimEnd()
}

function truncate(value, width) {
	if (value.length <= width) {
		return value
	}

	return width < 1 ? '' : `${value.slice(0, width - 1)}…`
}
