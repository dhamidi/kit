/**
 * Component types describe how to create a component.
 */
export class ComponentType {
	// must respond to:
	//
	// - schema(): returns a JSON schema (see @sinclair/typebox) describing the canonical component spec accepted by create() and returned by component.inspect()
	// - description(): returns a short description of what this component represents
	// - create(spec, env): normalized spec parameters as per schema, call methods on env to take actions.  Env emits events.
}
