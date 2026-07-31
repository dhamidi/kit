import { ancestor, nodeName, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = `
	(element (start_tag (tag_name) @name)) @definition.element
	(script_element (start_tag (tag_name) @name)) @definition.element
	(style_element (start_tag (tag_name) @name)) @definition.element
`

/** Maps HTML elements and highlight captures to Kit syntax values. */
export class HTMLLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'html',
			extensions: ['.html', '.htm'],
			assetDirectory: 'html',
			highlights: ['highlights.scm'],
			structures,
		})
	}

	describeSymbol({ entity, sourceBytes }) {
		const parent = ancestor(entity, ['element', 'script_element', 'style_element'])
		const container = parent === undefined || parent === entity ? undefined : elementName(parent, sourceBytes)
		return { containerName: container?.name, containerStartByte: container?.startByte }
	}
}

function elementName(element, sourceBytes) {
	const startTag = element.namedChildren.find((child) => child.type === 'start_tag')
	const name = startTag?.namedChildren.find((child) => child.type === 'tag_name')
	return name === undefined ? nodeName(element, sourceBytes) : {
		name: new TextDecoder().decode(sourceBytes.subarray(name.startIndex, name.endIndex)),
		startByte: element.startIndex,
	}
}
