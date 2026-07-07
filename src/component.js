/**
 * Component is a single component instance as understood by kit.
 */
export class Component {
	// must respond to:
	//
	// - provider(): the provider who manages this component,
	// - inspect(): returns the canonical component spec used to recreate this component and any provider schema fields such as files.
	// - id(): returns a ComponentIdentifier uniquely naming this component within its provider.
}
