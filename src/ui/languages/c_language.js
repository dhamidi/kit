import { ancestor, callableDetails, nodeName, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = `(field_declaration declarator: (field_identifier) @name) @definition.field`

/** Maps C declarations, functions, aggregate types, and fields to Kit symbols. */
export class CLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'c',
			extensions: ['.c', '.h'],
			assetDirectory: 'c',
			tags: ['tags.scm'],
			highlights: ['highlights.scm'],
			structures,
		})
	}

	describeSymbol({ kind, entity, sourceBytes }) {
		if (kind === 'function') {
			const definition = ancestor(entity, ['function_definition'])
			if (definition !== undefined) {
				return {
					entityNode: definition,
					...callableDetails(definition, definition.childForFieldName('body'), sourceBytes),
				}
			}

			const declaration = ancestor(entity, ['declaration'])
			if (declaration !== undefined) return { entityNode: declaration }
		}

		const container = nodeName(ancestor(entity, ['struct_specifier', 'union_specifier']), sourceBytes)
		return { containerName: container?.name, containerStartByte: container?.startByte }
	}
}
