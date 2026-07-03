/**
 * Identifier encodes the rules for encoding and decoding hierarchical
 * identifiers.
 *
 * They are hierarchical, using `.` as the separator.
 *
 * For example, a component is identified as: [provider-name].[component-type].[component-instance]
 */
export class Identifier {
	#parts

	/**
	 * @param raw - converted to a string, then split.
	 * @returns {Identifier}
	 */
	static fromString(raw) {
		const parts = raw.toString().trim().split('.')
		// throw an error if any parts are empty or contain spaces.
		return new Identifier(parts)
	}

	constructor(parts) {
		this.#parts = parts
	}

	parts() {
		return [...this.#parts]
	}

	startsWith(other) {
		const parts = other.parts()
		return parts.every((part, index) => this.#parts[index] === part)
	}

	toString() {
		return this.#parts.join('.')
	}
}
