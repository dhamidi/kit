import { Type } from '@sinclair/typebox'
import { FileURI } from '../file_uri.js'

/**
 * Provider events report provider discovery and module-loading progress: discovered
 * provider paths, provider modules being loaded, successfully loaded providers, and
 * load failures.
 */
export const providerSchemas = {
	providerDiscovered: Type.Object(
		{
			type: Type.Literal('provider.discovered'),
			path: FileURI.schema,
		},
		{ additionalProperties: false, description: 'Discovery path scanned for provider modules' },
	),
	providerLoading: Type.Object(
		{
			type: Type.Literal('provider.loading'),
			path: FileURI.schema,
		},
		{ additionalProperties: false, description: 'Provider module import started' },
	),
	providerLoaded: Type.Object(
		{
			type: Type.Literal('provider.loaded'),
			name: Type.String(),
			path: FileURI.schema,
		},
		{ additionalProperties: false, description: 'Provider module loaded successfully' },
	),
	providerLoadFailed: Type.Object(
		{
			type: Type.Literal('provider.loadFailed'),
			path: FileURI.schema,
			message: Type.String(),
			cause: Type.Optional(Type.Unknown()),
		},
		{
			additionalProperties: false,
			description: 'Provider module import or initialization failed',
		},
	),
}

/**
 * Builds a provider discovery path payload.
 */
export function providerDiscoveredEvent(path) {
	return { type: 'provider.discovered', path: FileURI.fromPath(path).toString() }
}

export function providerLoadingEvent(path) {
	return { type: 'provider.loading', path: FileURI.fromPath(path).toString() }
}

export function providerLoadedEvent(name, path) {
	return { type: 'provider.loaded', name, path: FileURI.fromPath(path).toString() }
}

export function providerLoadFailedEvent(path, message, cause) {
	const event = { type: 'provider.loadFailed', path: FileURI.fromPath(path).toString(), message }

	if (cause !== undefined) {
		event.cause = cause
	}

	return event
}
