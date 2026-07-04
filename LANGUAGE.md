# Kit Manifest Language

Kit manifests are reviewable descriptions of components that should exist.

The model has three layers:

1. **Surface syntax** — what humans and LLMs write.
2. **IR** — normalized `{ provider, type, spec }` operations.
3. **Execution** — provider-owned creation through existing Kit APIs.

```txt
TCL-ish manifest ──parse──▶ IR ──execute──▶ type.create(spec, env)
JS data, maybe   ──parse──▶ IR ──execute──▶ type.create(spec, env)
```

The surface syntax is replaceable. The IR and provider TypeBox schemas are the contract.

## Goals

- Let LLMs draft software-structure changes as small reviewable manifests.
- Keep manifests declarative: say what components should exist, not how files are edited.
- Use live providers and TypeBox schemas as the manifest vocabulary.
- Fail fast on unknown providers, unknown types, unknown fields, and schema mismatches.
- Keep execution provider-owned: providers decide files, edits, plans, and formatting.

## Non-goals

- A general programming language.
- Variables, loops, conditionals, imports, command substitution, or shell execution.
- A bypass around provider-owned creation logic.
- A fake schema/API/UI DSL whose vocabulary is not backed by providers.

## Preferred surface syntax

The preferred surface is TCL-like text.

```kit
server-route route {
	path "/workspace/preferences"
	kind page

	intent {
		Create a workspace preferences page.

		Use existing project settings layout conventions.
	}
}

server-route route {
	path "/api/workspace/preferences"
	kind endpoint
	method GET
	method POST

	intent {
		Create an endpoint for reading and updating workspace preferences.

		Use existing auth/session checks and validate request bodies before persisting changes.
	}
}
```

Each top-level form is:

```txt
<provider> <type> { <schema-directed fields> }
```

The form head must resolve to a discovered provider and one of its type ids.

## IR

The manifest above lowers to this IR:

```js
;[
	{
		provider: 'server-route',
		type: 'route',
		spec: {
			path: '/workspace/preferences',
			kind: 'page',
			intent: 'Create a workspace preferences page.\n\nUse existing project settings...',
		},
	},
	{
		provider: 'server-route',
		type: 'route',
		spec: {
			path: '/api/workspace/preferences',
			kind: 'endpoint',
			method: ['GET', 'POST'],
			intent: 'Create an endpoint for reading and updating workspace preferences...',
		},
	},
]
```

IR fields:

- `provider` — exact `provider.name()`.
- `type` — exact `type.id()` from that provider.
- `spec` — the provider type schema input plus Kit common fields.

## What is Kit core vs provider-owned

Kit core owns only:

- surface parsing
- provider/type resolution
- TypeBox normalization and validation
- the common `intent` field
- dry-run/apply orchestration
- event rendering

Providers own everything else:

- which component types exist
- which fields each type accepts
- whether a type can be created
- generated files and edits
- provider-specific follow-up plans
- provider-specific formatting

`intent` is the only Kit-core spec field. Fields such as `name`, `parent`, `description`, `project`,
`path`, or `method` are provider schema fields or execution-context concerns, not manifest language
grammar.

If a provider exposes a type, it is responsible for making that type's manifest behavior coherent.
For generation-oriented providers, that means implementing the same shape Kit already expects:

```js
type.schema()
type.parse(argv) // CLI surface
type.describe(spec)
type.create(spec, env) // manifest/apply surface
```

If a provider cannot create a type, it should either not expose that type as manifest vocabulary or
fail with a provider-owned error that explains why.

## Dynamic vocabulary

The vocabulary is dynamic. Kit must load providers before parsing a manifest.

In this checkout, when run with repo-root provider discovery, the live vocabulary currently
includes:

```txt
kit task
kit-event event
kit-provider provider
kit-agent runner
kit-command component
```

That list is not hard-coded language grammar. It is runtime provider state.

For example, `server-db table` is invalid until a `server-db` provider with a `table` type exists.
Manifest resolution must not accept invented heads just because they look plausible.

## TypeBox all the way down

Manifest parsing/resolution is schema-directed. After resolving a form head, Kit reads
`type.schema()` and uses that TypeBox schema to construct actual JS values from the TCL surface or
return a collection of surface-shape violations.

The current CLI helper `parseArgsOptionsFromSchema()` is not enough for manifests. Manifest
resolution needs to understand the TypeBox shape well enough to choose between string, object,
record, array, and scalar interpretations.

The result passed to `ManifestRunner` is already data, not syntax. `ManifestRunner` then runs the
final TypeBox validation gate, including required properties, unknown fields, literals, unions,
nested objects, records, arrays, patterns, and additional-properties rules. If validation fails, it
refuses to invoke providers.

When coercion is needed, it should be explicit and schema-directed during resolution.

## TypeBox to TCL mapping

- `Type.String()` — `field value`, `field "value"`, or `field { text }` to a string.
- `Type.Number()` — `field 1.5` to a number.
- `Type.Integer()` — `field 1` to an integer.
- `Type.Boolean()` — `field true` or `field false` to a boolean.
- `Type.Null()` — `field null` to null.
- `Type.Literal('x')` — `field x` to the literal.
- `Type.Union([...])` — parsed against each branch to the selected branch value.
- `Type.Optional(T)` — field may be absent; present values parse as `T`.
- `Type.Array(T)` — repeated `field ...` or `field { ... }` to an array.
- `Type.Object({...})` — `field { key value }` to an object.
- `Type.Record(K, V)` — `field { dynamic-key { ... } }` to an object map.
- `Type.Tuple([...])` — `field { item ... }` to a tuple array.
- `Type.Any()` / `Type.Unknown()` — JSON-like scalar/block to a value.

Schema annotations also matter:

- `required` comes from TypeBox object required keys.
- `additionalProperties: false` rejects unknown fields.
- `pattern`, `minLength`, `maxLength`, `minimum`, and similar constraints are enforced.
- `default` may be applied by the manifest normalizer if the provider schema declares it.
- Provider-specific metadata such as `multiple: true` may allow repeated scalar fields.

### Strings and braces

Braces are schema-directed:

- for `Type.String()`, braces quote multiline text
- for `Type.Object()`, braces contain fixed fields
- for `Type.Record()`, braces contain dynamic keys
- for `Type.Array()`, braces contain repeated items or nested item blocks

Example string:

```kit
intent {
	This is one string.

	It can contain multiple paragraphs without escaping quotes.
}
```

Example object:

```kit
options {
	json {
		type boolean
	}
}
```

The same braces are unambiguous because the provider schema says whether `intent` is a string and
`options` is an object or record.

### Repeated values

For array fields or provider fields marked `multiple: true`, repeated statements append values:

```kit
method GET
method POST
```

IR:

```js
{
	method: ['GET', 'POST']
}
```

Array-valued fields may also use one braced array body. For scalar item types, items may be
whitespace-separated or newline-separated:

```kit
method { GET POST }
```

```kit
method {
	GET
	POST
}
```

These are equivalent to the repeated statements above and normalize to the same IR:

```js
{
	method: ['GET', 'POST']
}
```

Quoted scalar items are also allowed:

```kit
method {
	"GET"
	"POST"
}
```

For object item types, prefer repeated field blocks:

```kit
prop {
	name user
	type User
}

prop {
	name compact
	type boolean
}
```

The parser may also accept an explicit braced array of object blocks when the schema says the field
is `Type.Array(Type.Object(...))`:

```kit
prop {
	{
		name user
		type User
	}

	{
		name compact
		type boolean
	}
}
```

Braces are schema-directed. For a string field, braces quote one multiline string:

```kit
intent {
	GET
	POST
}
```

IR:

```js
{
	intent: 'GET\nPOST'
}
```

For an array field, the same braced shape is an array body:

```kit
method {
	GET
	POST
}
```

IR:

```js
{
	method: ['GET', 'POST']
}
```

### Records

`kit-command component` has an `options` record. It maps naturally to nested dynamic keys:

```kit
kit-command component {
	parent component
	name list
	description "List discovered components"

	options {
		json {
			type boolean
		}

		output {
			type string
			short o
			default table
		}
	}
}
```

## Mode of operation

Kit manifest processing should be deterministic and fail-fast:

1. Load providers.
2. Build live vocabulary from providers and their TypeBox schemas.
3. Parse the manifest surface syntax.
4. Resolve each form against the live provider/type vocabulary.
5. Construct JS `spec` values from the syntax using the provider type schema plus `intent`.
6. If any provider, type, field shape, or schema-directed interpretation fails, print errors and
   exit.
7. Pass the resolved operations to `ManifestRunner`.
8. `ManifestRunner` performs final TypeBox validation of the actual `spec` values.
9. If validation fails, print all validation errors and exit without invoking providers.
10. Otherwise invoke provider component types sequentially.
11. In dry-run mode, execute operations with a dry-run `env` and render events.
12. In apply mode, execute operations with the real `env`.

This reduces manifest-shape hallucinations: an LLM can only use provider/type heads and fields that
the loaded providers actually expose. Free-text `intent` remains prose and still requires human
review.

## Vocabulary output

Kit should be able to print the live manifest vocabulary for LLM prompts and human reference.

Example output:

```txt
server-route route {
  path string required
    SvelteKit route path to create, for example /hello or /users/[id]

  kind page|endpoint optional
    Route kind to create; defaults to page unless methods are provided

  method string repeated optional
    HTTP method to scaffold for endpoint routes; repeat for multiple methods

  intent text optional
    Follow-up implementation intent
}
```

The vocabulary output should come from live providers, not from this document.

## JavaScript surface, maybe later

JavaScript can be a later surface syntax because it maps directly to the IR:

```js
export default [
	{
		provider: 'server-route',
		type: 'route',
		spec: {
			path: '/workspace/preferences',
			kind: 'page',
			intent: `
Create a workspace preferences page.

Use existing project settings layout conventions.
			`.trim(),
		},
	},
]
```

This surface is not preferred initially because JavaScript is executable. If Kit accepts JavaScript
manifests, it must treat them as trusted input or define a data-only loader policy. The TCL-like
surface is the safer first target for LLM-generated artifacts.

## Escape hatch

When no provider type fits, do not invent a manifest head. Add a provider, or use the generic
provider-backed `kit task` escape hatch:

```kit
kit task {
	name inject-secret-files-into-sandboxes
	file "thread-actors/src/sandbox/manager.ts"

	intent {
		Wire generated secret-file APIs into sandbox setup.

		Validate paths, avoid logging plaintext contents, and write files before the headless
		executor starts.
	}
}
```

`kit task` is not language grammar. It is a normal provider/type with a TypeBox schema. The `kit`
provider owns its fields and execution behavior like any other provider: `name` identifies the task,
repeated `file` fields list relevant workspace files, and `intent` carries the human-reviewed work
request. Applying the manifest emits a follow-up plan for an agent; use `kit manifest plan` or
`kit manifest apply --skip-plans` to review it without running the agent.

## Design rule

Surface syntax is replaceable. TypeBox-backed provider vocabulary is the contract.

If a manifest needs a concept that cannot be expressed as `provider + type + spec`, first ask
whether that concept deserves a provider. If not, it belongs in `intent` or the generic `kit task`
provider/type, not in the language grammar.
