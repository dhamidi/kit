/** A normalized syntax occurrence with selection, ownership, and edit behavior. */
export class SymbolOccurrence {
	constructor(fields) {
		Object.assign(this, fields)
	}

	isDefinition() {
		return this.role === 'definition'
	}

	selectionKey() {
		return Buffer.from(JSON.stringify([this.role, this.kind, this.startByte])).toString('base64url')
	}

	matchesSelection(key) {
		return typeof key === 'string' && this.selectionKey() === key
	}

	displayRange() {
		return {
			startByte: this.contentStartByte ?? this.entityStartByte,
			endByte: this.contentEndByte ?? this.entityEndByte,
			startLine: this.contentStartLine ?? this.entityStartLine,
		}
	}

	editableRange() {
		if (['function', 'method'].includes(this.kind) && this.contentStartByte == null) return undefined
		return { startByte: this.contentStartByte ?? this.entityStartByte, endByte: this.contentEndByte ?? this.entityEndByte }
	}

	isEditable() {
		return this.isDefinition() && this.editableRange() !== undefined
	}

	isNested() {
		return this.containerName != null
	}

	presentation(selectedKey) {
		return {
			key: this.selectionKey(),
			selected: this.matchesSelection(selectedKey),
			nested: this.isNested(),
			label: this.signature ?? this.name,
			meta: `${this.kind} · L${this.startLine ?? this.line}`,
		}
	}
}
