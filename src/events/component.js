import { Type } from '@sinclair/typebox'

/**
 * Component events describe provider-reported components available for component listing.
 */
export const componentSchemas = {
	componentListed: Type.Object(
		{
			type: Type.Literal('component.listed'),
			id: Type.String(),
			description: Type.String(),
			provider: Type.String(),
		},
		{ additionalProperties: false, description: 'Provider reported an available component' },
	),
}

/**
 * Builds a component listing payload.
 */
export function componentListedEvent(provider, id, description) {
	return { type: 'component.listed', provider, id, description }
}
