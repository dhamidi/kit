import { Type } from '@sinclair/typebox'

/**
 * Error events report failures from kit event streams and describe generic error handling.
 */
export const errorSchemas = {
	error: Type.Object(
		{
			type: Type.Literal('error'),
			message: Type.String(),
			cause: Type.Optional(Type.Unknown()),
		},
		{ additionalProperties: false, description: 'Generic failure on a Kit event stream' },
	),
}

/**
 * Builds a generic error event payload.
 */
export function errorEvent(message, cause) {
	const event = { type: 'error', message }

	if (cause !== undefined) {
		event.cause = cause
	}

	return event
}
