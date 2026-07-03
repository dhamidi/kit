/**
 * Component is a single component instance as understood by kit.
 */
export class Component {
	// must respond to:
	//
	// - provider(): the provider who manages this component,
	// - inspect(): returns the parameters used to create this component and any files it touched.
	// - id(): returns a ComponentIdentifier uniquely naming this component within its provider.
}
