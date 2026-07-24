import { UserError } from './cli.js'

/**
 * Provider is a single provider instance that can list and create components.
 */
export class Provider {
	// must respond to:
	//
	// - name() to get the provider's name
	// - types() to get a stream of component types managed by this provider
	// - components() to get a stream of component instances managed by this provider as they are discovered
	// - create(specs) to create a list of components, returning a stream of events
}

/**
 * Converts an unexpected exception thrown by a provider hook into a clean
 * UserError that names the provider and hook, so provider bugs surface as CLI
 * errors instead of raw stack traces. UserError passes through untouched, and
 * setting KIT_DEBUG preserves the original error with its stack trace.
 *
 * @example
 * throw providerHookError({ providerName: 'db', typeId: 'worker', hook: 'create', error })
 */
export function providerHookError({ providerName, typeId, hook, error }) {
	if (error instanceof UserError || process.env.KIT_DEBUG) {
		return error
	}

	return new UserError(
		`Provider '${providerName}' failed in ${typeId}.${hook}(): ${error.message}\n` +
			'Run with KIT_DEBUG=1 for the full stack trace.',
	)
}
