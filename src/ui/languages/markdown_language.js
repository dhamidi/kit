import { ancestor, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = `
	(atx_heading heading_content: (_) @name) @definition.heading
	(setext_heading heading_content: (_) @name) @definition.heading
`

/** Maps Markdown headings and block highlights to Kit syntax values. */
export class MarkdownLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'markdown',
			extensions: ['.md', '.markdown'],
			assetDirectory: 'markdown',
			highlights: ['highlights.scm'],
			structures,
		})
	}

	describeSymbol({ entity, sourceBytes }) {
		const section = ancestor(entity, ['section'])
		if (section === undefined) return {}
		let startByte = entity.endIndex
		let startLine = entity.endPosition.row + 1

		if (sourceBytes[startByte] === 13 && sourceBytes[startByte + 1] === 10) {
			startByte += 2
			startLine += 1
		} else if (sourceBytes[startByte] === 10) {
			startByte += 1
			startLine += 1
		}

		return {
			contentStartByte: startByte,
			contentEndByte: section.endIndex,
			contentStartLine: startLine,
			contentIndent: '',
		}
	}
}
