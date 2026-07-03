# kit

Kit builds things.

At a low level, software is made from functions, classes, values, and modules.

At a high-level, we think about software in terms of API endpoints, database tables, SvelteKit remote functions, and so on.

Ruby on Rails had a good idea here in the form of generators, but 15 years ago we didn't have tree-sitter,
and generators stayed simple use-once features for quick scaffolding.

In the meantime we've learned that:

- asking a dynamic system to dump its current state is more reliable than static analysis,
- LLMs are good at filling in the blanks,
- ast-grep gets you very far with static analysis.

It's time to bring this idea back so that our agents can reason on the same level as developers.

## How kit works

When kit starts, it scans the current working directory for **providers**.

A **provider** is a piece of JavaScript that feeds component definitions to kit.

It knows how to list components, component types, and how to instantiate new versions of a component.

Abstract, but it needs to be because the **component types** are different based on the area of
code base you are working in:

- SvelteKit: remote functions, routes, pages, server hooks, database tables, queries, etc
- TUI: elements, widgets, settings, command palette entries,
- Frontend: components, storybook entries, pages, etc

Kit does not care.

Kit only cares about what things exist, and knowing about how to make more of them.

`kit components types` shows all component types reported by all providers

`kit components list` lists all component instances

`kit generate <type> [ARG] ...` creates a new component based on the provider's recipe,
taking care of validation, templating, file generation, etc.

Essentially, `kit` is the shell.

## Providers

Providers advertise their capabilities, so that every area of a project can provide individual components.

Component Type Definitions are simple JSON objects describing all the parameters a component needs to be instantiated, including examples.

When kit is asked to generate a component of this kind, it collects all parameter values and forwards the request to the provider.

The provider can run whatever logic it needs to generate the component, but it must return a stream of changes:

- files created,
- files read,
- files removed,
- files edited,
- errors encountered,
- follow-up plans to execute.

All pretty straightforward, except for the last bit.

Often deterministic generation will get you 80% or 90% and the last part needs to be filled in by an LLM.

A plan is just that: a series of steps for an LLM to carry out, to take the task to completion.

When kit receives a plan, it will spawn an agent for each step of the plan.  
A step includes instructions, file references, and optionally a deterministic command to keep the LLM on track.

Kit records the completion of every step so that the execution of a plan can be resumed or aborted,
even when the kit process crashes or is restarted.

## Implementation

Kit is written in JavaScript because not everything needs to be TypeScript.

It commits to bun as the runtime, because having a featureful base is nice.

It stays disciplined by using @sinclair/typebox at the edges, picking good names,
and following parse-don't-validate to encode invariants in runtime values, instead of
relying on compile time checks.
