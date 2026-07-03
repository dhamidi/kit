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
