/**
 * Error thrown when a Kit manifest cannot be parsed.
 */
export class ManifestParseError extends Error {
	constructor(message, location) {
		super(`${message} at ${location.line}:${location.column}`)
		this.name = 'ManifestParseError'
		this.line = location.line
		this.column = location.column
		this.location = location
	}
}

/**
 * Parses TCL-ish Kit manifest source into a raw syntax tree.
 *
 * The returned tree intentionally does not normalize braced values. Each braced
 * value keeps its raw text plus candidate child statements and values so a later
 * schema-directed pass can decide whether it is a string, object, record, or array.
 *
 * @example
 * const manifest = parseManifest('server-route route {\n\tpath "/hello"\n}')
 * console.log(manifest.components[0].provider.value)
 */
export function parseManifest(source) {
	return new Parser(source).parseManifest()
}

class Parser {
	constructor(source, indexOffset = 0, initialLocation = { line: 1, column: 1 }) {
		this.source = source
		this.index = 0
		this.indexOffset = indexOffset
		this.location = { ...initialLocation }
	}

	parseManifest() {
		const start = this.mark()
		const components = []

		this.skipSeparators()

		while (!this.isEOF()) {
			components.push(this.parseComponent())
			this.skipSeparators()
		}

		return node('Manifest', start, this.mark(), { components })
	}

	parseComponent() {
		const start = this.mark()
		const provider = this.parseBare('Expected provider name')
		this.skipInlineWhitespace()
		const typeName = this.parseBare('Expected component type')
		this.skipInlineWhitespace()

		if (this.peek() !== '{') {
			throw this.error('Malformed top-level form: expected component body')
		}

		const body = this.parseBrace({ parseStatements: true })
		return node('ComponentForm', start, body.end, { provider, typeName, body })
	}

	parseStatements(untilBrace = false) {
		const statements = []
		this.skipStatementSeparators()

		while (!this.isEOF() && !(untilBrace && this.peek() === '}')) {
			const start = this.mark()
			const key = this.parseBare('Expected statement key')
			const values = []

			this.skipInlineWhitespace()

			while (!this.isEOF() && this.peek() !== '\n' && !(untilBrace && this.peek() === '}')) {
				if (this.peek() === '#') {
					this.skipComment()
					break
				}

				values.push(this.parseValue())
				this.skipInlineWhitespace()
			}

			statements.push(node('Statement', start, this.mark(), { key, values }))
			this.skipStatementSeparators()
		}

		return statements
	}

	parseValues() {
		const values = []
		this.skipSeparators()

		while (!this.isEOF()) {
			values.push(this.parseValue())
			this.skipSeparators()
		}

		return values
	}

	parseValue() {
		const character = this.peek()

		if (character === '{') {
			return this.parseBrace({ parseStatements: false })
		}

		if (character === '"') {
			return this.parseQuoted()
		}

		return this.parseBare('Expected value')
	}

	parseBare(message) {
		const start = this.mark()
		let value = ''

		while (!this.isEOF()) {
			const character = this.peek()

			if (isWhitespace(character) || character === '{' || character === '}' || character === '"') {
				break
			}

			if (character === '#') {
				break
			}

			value += this.consume()
		}

		if (value === '') {
			throw this.error(message)
		}

		return node('BareValue', start, this.mark(), { value })
	}

	parseQuoted() {
		const start = this.mark()
		this.expect('"')
		let value = ''

		while (!this.isEOF()) {
			const character = this.consume()

			if (character === '"') {
				return node('QuotedValue', start, this.mark(), { value })
			}

			if (character === '\\') {
				value += this.parseEscape()
				continue
			}

			value += character
		}

		throw new ManifestParseError('Unclosed quote', start)
	}

	parseEscape() {
		if (this.isEOF()) {
			throw this.error('Unclosed quote')
		}

		const character = this.consume()
		const escapes = {
			n: '\n',
			r: '\r',
			t: '\t',
			b: '\b',
			f: '\f',
			v: '\v',
			'"': '"',
			'\\': '\\',
		}

		if (character === 'u') {
			const hex = this.source.slice(this.index, this.index + 4)

			if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
				throw this.error('Invalid unicode escape')
			}

			for (let i = 0; i < 4; i++) {
				this.consume()
			}

			return String.fromCharCode(Number.parseInt(hex, 16))
		}

		return escapes[character] ?? character
	}

	parseBrace({ parseStatements }) {
		const start = this.mark()
		this.expect('{')
		const contentStart = this.mark()
		let depth = 1
		let raw = ''

		while (!this.isEOF()) {
			const character = this.consume()

			if (character === '\\') {
				raw += character

				if (!this.isEOF()) {
					raw += this.consume()
				}

				continue
			}

			if (character === '{') {
				depth++
				raw += character
				continue
			}

			if (character === '}') {
				depth--

				if (depth === 0) {
					const end = this.mark()
					return node('BracedValue', start, end, {
						raw,
						statements: this.tryParseInnerStatements(raw, contentStart, parseStatements),
						values: this.tryParseInnerValues(raw, contentStart),
					})
				}

				raw += character
				continue
			}

			raw += character
		}

		throw new ManifestParseError('Unclosed brace', start)
	}

	tryParseInnerStatements(raw, location, required) {
		try {
			const parser = new Parser(raw, location.index, location)
			const statements = parser.parseStatements(false)
			parser.skipSeparators()

			if (!parser.isEOF()) {
				return required ? parser.failUnexpected() : undefined
			}

			return statements
		} catch (error) {
			if (required || error instanceof ManifestParseError === false) {
				throw error
			}

			return undefined
		}
	}

	tryParseInnerValues(raw, location) {
		try {
			const parser = new Parser(raw, location.index, location)
			return parser.parseValues()
		} catch (error) {
			if (error instanceof ManifestParseError) {
				return undefined
			}

			throw error
		}
	}

	skipStatementSeparators() {
		let consumed = true

		while (consumed) {
			consumed = this.skipInlineWhitespace() || this.skipComment() || this.skipNewlines()
		}
	}

	skipSeparators() {
		let consumed = true

		while (consumed) {
			consumed = this.skipInlineWhitespace() || this.skipComment() || this.skipNewlines()
		}
	}

	skipInlineWhitespace() {
		let consumed = false

		while (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r') {
			this.consume()
			consumed = true
		}

		return consumed
	}

	skipNewlines() {
		let consumed = false

		while (this.peek() === '\n') {
			this.consume()
			consumed = true
		}

		return consumed
	}

	skipComment() {
		if (this.peek() !== '#') {
			return false
		}

		while (!this.isEOF() && this.peek() !== '\n') {
			this.consume()
		}

		return true
	}

	failUnexpected() {
		throw this.error(
			this.isEOF() ? 'Unexpected EOF' : `Unexpected token ${JSON.stringify(this.peek())}`,
		)
	}

	error(message) {
		return new ManifestParseError(message, this.mark())
	}

	expect(character) {
		if (this.peek() !== character) {
			throw this.error(`Expected ${JSON.stringify(character)}`)
		}

		return this.consume()
	}

	consume() {
		const character = this.source[this.index]
		this.index++

		if (character === '\n') {
			this.location.line++
			this.location.column = 1
		} else {
			this.location.column++
		}

		return character
	}

	peek() {
		return this.source[this.index]
	}

	isEOF() {
		return this.index >= this.source.length
	}

	mark() {
		return {
			index: this.indexOffset + this.index,
			line: this.location.line,
			column: this.location.column,
		}
	}
}

function node(kind, start, end, fields) {
	return { kind, start, end, ...fields }
}

function isWhitespace(character) {
	return character === ' ' || character === '\t' || character === '\r' || character === '\n'
}
