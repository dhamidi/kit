/**
 * Component types describe how to create a component.
 */
export class ComponentType {
	// must respond to:
	//
	// - schema(): returns a JSON schema (see @sinclair/typebox) describing the parameters required for creation
	// - description(): returns a short description of what this component represents
	// - create(spec, env): spec parameters as per schema, call methods on env to take actions.  Env emits events.
}
