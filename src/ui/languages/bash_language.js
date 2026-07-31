import { callableDetails, TreeSitterLanguage } from './tree_sitter_language.js'

const structures = `(function_definition name: (word) @name) @definition.function`

/** Maps Bash functions and highlight captures to Kit syntax values. */
export class BashLanguage extends TreeSitterLanguage {
	constructor() {
		super({
			id: 'bash',
			extensions: ['.sh', '.bash'],
			assetDirectory: 'bash',
			highlights: ['highlights.scm'],
			structures,
		})
	}

	describeSymbol({ entity, sourceBytes }) {
		return callableDetails(entity, entity.childForFieldName('body'), sourceBytes)
	}
}
