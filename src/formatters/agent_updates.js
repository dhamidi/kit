/**
 * AgentUpdateFormatter writes compact single-line agent progress updates.
 */
export class AgentUpdateFormatter {
	constructor(output = process.stdout, { maxLength = 100 } = {}) {
		this.output = output
		this.maxLength = maxLength
	}

	write(update) {
		this.output.write(`${this.format(update)}\n`)
	}

	format(update) {
		const prefix = update.name === undefined ? update.kind : `${update.name}`
		return `${prefix} ${truncateWords(formatText(update.text ?? ''), this.maxLength)}`
	}
}

function formatText(text) {
	try {
		const value = JSON.parse(text)
		const entries = Object.entries(value)

		if (entries.length === 1 && typeof entries[0][1] === 'string') {
			return entries[0][1]
		}
	} catch {
		return text
	}

	return text
}

function truncateWords(text, maxLength) {
	if (text.length <= maxLength) {
		return text
	}

	const words = text.split(/\s+/)
	let current = ''

	for (const word of words) {
		const next = current === '' ? word : `${current} ${word}`

		if (next.length + 1 > maxLength) {
			break
		}

		current = next
	}

	return `${current}…`
}
