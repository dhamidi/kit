import { Identifier } from './component_identifier.js'

/**
 * Finds the candidate with the longest hierarchical prefix match.
 *
 * @example
 * const match = bestMatch(['kit-command.component'], 'kit-command.component.show')
 * console.log(match.rest.toString())
 */
export function bestMatch(candidates, raw) {
	const identifier = Identifier.fromString(raw)
	const matches = candidates
		.map((candidate) => matchCandidate(candidate, identifier))
		.filter((match) => match !== undefined)
		.sort((left, right) => right.length - left.length)

	return matches[0]
}

function matchCandidate(candidate, identifier) {
	const candidateID = Identifier.fromString(candidate.id ?? candidate)
	const candidateParts = candidateID.parts()

	if (candidateParts.length > 0 && !identifier.startsWith(candidateID)) {
		return undefined
	}

	return {
		candidate,
		length: candidateParts.length,
		rest: new Identifier(identifier.parts().slice(candidateParts.length)),
		restOverride: candidate.restOverride,
	}
}
