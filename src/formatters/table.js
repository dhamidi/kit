/**
 * TableFormatter buffers rows and writes aligned columns to an output sink.
 *
 * @example
 * const table = new TableFormatter(['Name', 'Description'])
 * table.row(['help', 'Show available commands'])
 * table.flush()
 */
export class TableFormatter {
	constructor(headers, output = process.stdout) {
		this.headers = headers
		this.output = output
		this.rows = []
	}

	row(values) {
		this.rows.push(values.map((value) => value.toString()))
	}

	isEmpty() {
		return this.rows.length === 0
	}

	flush() {
		const rows = [this.headers, ...this.rows]
		const widths = this.headers.map((_, index) => {
			return Math.max(...rows.map((row) => row[index].length))
		})

		for (const row of rows) {
			this.output.write(`${formatRow(row, widths)}\n`)
		}
	}
}

function formatRow(row, widths) {
	return row
		.map((value, index) => (index === row.length - 1 ? value : value.padEnd(widths[index])))
		.join('  ')
		.trimEnd()
}
