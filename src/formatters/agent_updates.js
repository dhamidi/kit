/**
 * AgentUpdateFormatter renders agent progress as an indented action transcript.
 *
 * Each tool call becomes a readable action line (the tool name followed by its
 * primary argument, e.g. the shell command), and assistant narration prints as
 * plain indented text. Step identity and the `result` outcome are owned by the
 * executor's header/footer, so they are not rendered here.
 */
export class AgentUpdateFormatter {
	constructor(output = process.stdout, { maxLength = 120 } = {}) {
		this.output = output
		this.maxLength = maxLength
	}

	write(update) {
		const line = this.format(update)

		if (line !== undefined) {
			this.output.write(`${line}\n`)
		}
	}

	format(update) {
		if (update.kind === 'tool') {
			return `  ${truncateWords(formatToolCall(update.name, update.input), this.maxLength)}`
		}

		if (update.kind === 'assistant') {
			return `  ${truncateWords(update.text ?? '', this.maxLength)}`
		}

		return undefined
	}
}

/**
 * Keys, in priority order, that best summarize a tool invocation. Agent CLIs
 * name the primary argument of a tool differently (shell tools use `command`,
 * file tools use `path`/`file_path`, search tools use `pattern`), so the first
 * present key wins and its value is shown on its own.
 */
const primaryToolKeys = [
	'command',
	'cmd',
	'pattern',
	'query',
	'path',
	'file_path',
	'filePath',
	'file',
	'url',
	'description',
	'prompt',
]

/**
 * Renders a tool call as `<tool name> <primary argument>` so callers see which
 * tool ran and its most meaningful input; tools without a recognized primary
 * argument show just their name.
 */
function formatToolCall(name, input) {
	const label = String(name ?? 'tool')
	const arg = primaryArg(input)

	if (arg === undefined || arg === '') {
		return label
	}

	return `${label} ${arg}`
}

function primaryArg(input) {
	if (input === undefined || input === null) {
		return undefined
	}

	if (typeof input === 'string') {
		return input
	}

	if (typeof input !== 'object') {
		return String(input)
	}

	for (const key of primaryToolKeys) {
		if (typeof input[key] === 'string' && input[key] !== '') {
			return input[key]
		}
	}

	const entries = Object.entries(input)

	if (entries.length === 1 && typeof entries[0][1] === 'string') {
		return entries[0][1]
	}

	return JSON.stringify(input)
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
