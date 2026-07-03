# Writing Kit Providers

Providers are small adapters that teach Kit about a component family. A good
provider lists existing components, generates deterministic scaffolds, and emits
structured events/plans without leaking framework details into Kit core.

## Provider shape

Default-export `provider(kit)` and use only the injected `kit` object plus
standard Bun APIs.

The injected `kit` object is dynamically introspectable. Agents should inspect
the runtime API instead of importing Kit internals or guessing helper shapes:

```js
kit.methods().map((method) => method.signature())
kit.method('spawn').source()
```

The generation `env` passed to `create(spec, env)` is also introspectable:

```js
env.methods().map((method) => method.signature())
env.method('createFile').parameterNames()
```

For asynchronous inspection while writing providers, use the Kit REPL:

```sh
bun run kit repl new
bun run kit repl do 'kit.methods().map(method => method.signature())'
bun run kit repl do 'env.methods().map(method => method.signature())'
```

```js
export default function provider(kit) {
	return new MyProvider(kit)
}
```

A provider should implement:

- `name()` — stable provider id.
- `async *types()` — component type objects it can generate.
- `async *components()` — existing component objects it can list/show.
- `create(spec, env)` — delegate to the matching type for generation.

Component types should implement `id()`, `description()`, `schema()`, `parse()`,
`describe()`, and `async *create(spec, env)`.

Component objects should implement `provider()`, `id()`, `description()`, and
`inspect()`.

## Use Kit values, not ad hoc strings

- Use `kit.FileURI` for paths. Do not splice paths with string operations.
- Use `kit.Identifier` for hierarchical ids. Do not split ids on `.` by hand.
- Use `kit.spawn()` for external commands so process IO stays observable.
- Use `kit.Type` schemas with `description`; help text is generated from schema
  descriptions.

## Generation and events

Generation should be deterministic first, with optional follow-up plans for LLM
work.

- Call `env.createFile()` / `env.editFile()` and yield the event they return.
- Do not perform file writes directly inside providers.
- If `spec.intent` is present, yield a `kit.Event.plan(...)` describing the
  follow-up implementation work.
- Keep plan wording generic and specific to the generated component, not copied
  from another provider.

```js
yield await env.createFile(file, source)

if (spec.intent !== undefined) {
	yield kit.Event.plan(`Implement ${name}`, [{
		id: 'implement-component',
		instructions: `Use Amp to implement ${name}`,
		files: [file],
	}], { intent: spec.intent })
}
```

## Listing and showing components

Descriptions should come from the source object being modeled, not hardcoded
fallbacks like `Commander command foo`.

If the generic table/show format is noisy, the provider should own output shape:

- `formatComponentsList(records, output)` for list output.
- `formatComponentShow(componentName, record, output)` for detailed output.

Use `kit.TableFormatter` for dense, tabular data. If table output looks wrong,
fix `TableFormatter` rather than working around trailing padding in each
provider.

## Code search and analysis

Use structural tools for source-code structure.

- Use ast-grep for TypeScript/Svelte/JavaScript syntax such as Commander chains,
  exports, route handlers, or component declarations.
- Prefer one broad ast-grep scan per file or directory over many small spawned
  searches.
- Correlate results using AST/range metadata instead of brittle regex parsing.
- Regex is fine only for simple strings after ast-grep has selected the relevant
  source nodes.

## Performance

- Avoid spawning one process per component or per field.
- Cache per-file discovery results during a component listing pass.
- Keep `component list` and `component show` fast enough to run in the foreground.

## Output modes

- Human output should be concise and readable.
- JSON output should be structured: one JSON object per event/record line when a
  command supports `--json`.
- Dry-run output should use the same events as real generation; only the env
  interpreter changes whether IO is performed.

## Common checks

After changing a provider, run focused foreground checks:

```sh
bun run kit provider list
bun run kit component list <provider>
bun run kit component show <provider>.<component>
bun run kit generate <provider> <type> --help
```

Run `bun run kit generate ...` itself only in a background/tmux task.
