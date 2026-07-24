import { Type } from '@sinclair/typebox'
import {
	AgentRunner,
	AmpAgentRunner,
	ClaudeAgentRunner,
	agentNames,
	availableAgents,
	createAgentRunner,
	discoverAgents,
	selectAgent,
} from './agent_runner.js'
import { CLI, Command, createCLI, defineCommand, parseArgs, UserError } from './cli.js'
import { Component } from './component.js'
import { Identifier } from './component_identifier.js'
import { ComponentType } from './component_type.js'
import { Event } from './event.js'
import { createFileEnv } from './file_env.js'
import { FileURI } from './file_uri.js'
import { CommandFormatter } from './formatters/command.js'
import { KeyValueFormatter } from './formatters/key_value.js'
import { PlanFormatter } from './formatters/plan.js'
import { TableFormatter } from './formatters/table.js'
import { Introspectable } from './introspectable.js'
import { ManifestParseError, parseManifest } from './manifest/parser.js'
import { ManifestResolver, ManifestVocabulary } from './manifest/resolver.js'
import { ManifestRunner, ManifestRunnerError } from './manifest/runner.js'
import { bestMatch } from './matcher.js'
import { PlanExecutor } from './plan_executor.js'
import { Provider } from './provider.js'
import {
	discoverComponentRecords,
	discoverComponents,
	discoverProviders,
	inspectComponent,
	providerDiscoveryPaths,
} from './provider_discovery.js'
import { replHistoryFile, replSessionFile, replSocketPath, replStateDirectory, startRepl } from './repl.js'
import { repoRoot } from './repo_root.js'
import {
	argvFromSchemaValues,
	isSchemaFieldVisibleInCLI,
	parseArgsOptionsFromSchema,
	parseSchemaArgs,
	schemaCLIOptionEntries,
	schemaHasCLIArrayField,
	schemaHasCLIBooleanField,
} from './schema_args.js'
import { kitVersion } from './version.js'
import {
	normalizeSchemaValue,
	schemaAliases,
	schemaViolations,
	schemaWithKitFields,
	shorthandTarget,
} from './schema_normalizer.js'
import { spawn } from './spawn.js'
import { EphemeralStateStore, PersistentStateStore } from './state_store.js'

export {
	AgentRunner,
	AmpAgentRunner,
	ClaudeAgentRunner,
	agentNames,
	availableAgents,
	createAgentRunner,
	discoverAgents,
	selectAgent,
} from './agent_runner.js'
export { parseAgentLine, parseAgentMessage } from './agents.js'
export { CLI, Command, createCLI, defineCommand, parseArgs, UserError } from './cli.js'
export { Component } from './component.js'
export { Identifier } from './component_identifier.js'
export { ComponentType } from './component_type.js'
export { Event } from './event.js'
export { createFileEnv } from './file_env.js'
export { FileURI } from './file_uri.js'
export { CommandFormatter } from './formatters/command.js'
export { KeyValueFormatter } from './formatters/key_value.js'
export { PlanFormatter } from './formatters/plan.js'
export { TableFormatter } from './formatters/table.js'
export { Introspectable } from './introspectable.js'
export { ManifestParseError, parseManifest } from './manifest/parser.js'
export { ManifestResolver, ManifestVocabulary } from './manifest/resolver.js'
export { ManifestRunner, ManifestRunnerError } from './manifest/runner.js'
export { bestMatch } from './matcher.js'
export { PlanExecutor } from './plan_executor.js'
export { Provider } from './provider.js'
export {
	discoverComponentRecords,
	discoverComponents,
	discoverProviders,
	inspectComponent,
	providerDiscoveryPaths,
} from './provider_discovery.js'
export { replHistoryFile, replSessionFile, replSocketPath, replStateDirectory, startRepl } from './repl.js'
export { repoRoot } from './repo_root.js'
export {
	argvFromSchemaValues,
	isSchemaFieldVisibleInCLI,
	parseArgsOptionsFromSchema,
	parseSchemaArgs,
	schemaCLIOptionEntries,
	schemaHasCLIArrayField,
	schemaHasCLIBooleanField,
} from './schema_args.js'
export { kitVersion } from './version.js'
export {
	normalizeSchemaValue,
	schemaAliases,
	schemaViolations,
	schemaWithKitFields,
	shorthandTarget,
} from './schema_normalizer.js'
export { spawn } from './spawn.js'
export { EphemeralStateStore, PersistentStateStore } from './state_store.js'

Introspectable.includeIn(ManifestResolver)
Introspectable.includeIn(ManifestRunner)
Introspectable.includeIn(ManifestVocabulary)
Introspectable.includeIn(FileURI)

export const kit = {
	Type,
	AgentRunner,
	AmpAgentRunner,
	ClaudeAgentRunner,
	agentNames,
	availableAgents,
	createAgentRunner,
	discoverAgents,
	selectAgent,
	CLI,
	Command,
	UserError,
	CommandFormatter,
	KeyValueFormatter,
	PlanFormatter,
	TableFormatter,
	bestMatch,
	createCLI,
	createFileEnv,
	defineCommand,
	Identifier,
	Component,
	ComponentType,
	Event,
	FileURI,
	Introspectable,
	ManifestParseError,
	ManifestResolver,
	ManifestRunner,
	ManifestRunnerError,
	ManifestVocabulary,
	parseManifest,
	Provider,
	PlanExecutor,
	EphemeralStateStore,
	PersistentStateStore,
	discoverComponents,
	discoverComponentRecords,
	discoverProviders,
	inspectComponent,
	providerDiscoveryPaths,
	argvFromSchemaValues,
	isSchemaFieldVisibleInCLI,
	normalizeSchemaValue,
	parseArgsOptionsFromSchema,
	parseSchemaArgs,
	schemaAliases,
	schemaCLIOptionEntries,
	schemaHasCLIArrayField,
	schemaHasCLIBooleanField,
	schemaViolations,
	schemaWithKitFields,
	shorthandTarget,
	parseArgs,
	kitVersion,
	repoRoot,
	replHistoryFile,
	replSessionFile,
	replSocketPath,
	replStateDirectory,
	startRepl,
	loadProvider,
	spawn,
}

documentRuntimeAPI()
Introspectable.includeInObject(kit)

export async function loadProvider(path) {
	const module = await import(FileURI.fromPath(path).toString())
	return module.default(kit)
}

function documentRuntimeAPI() {
	Introspectable.document(kit, kitDocs())
	documentCoreClasses()
	documentFormattingClasses()
	documentManifestClasses()
	documentExecutionClasses()
}

function kitDocs() {
	return {
		Type: 'TypeBox schema builder re-export. Use it for provider schemas and runtime boundaries so Kit can generate CLI help and manifest vocabulary.',
		AgentRunner: 'Base class for plan agent executors. Subclass this when adding a new agent CLI integration.',
		AmpAgentRunner: 'AgentRunner implementation for the Amp CLI.',
		ClaudeAgentRunner: 'AgentRunner implementation for the Claude Code CLI.',
		agentNames: 'Returns supported agent names in default selection order.',
		availableAgents: 'Returns installed supported agents by consuming agent discovery events.',
		createAgentRunner: 'Resolves an agent name or auto selection and returns the concrete runner plus selected name.',
		discoverAgents: 'Yields agent discovery events describing supported plan execution agents and PATH availability.',
		selectAgent: 'Resolves an explicit or auto agent request to one installed supported agent.',
		CLI: 'Small command dispatcher used by Kit itself. Useful if a provider or plugin needs Kit-style commands and help output.',
		Command: 'Value object for one CLI command, including options, subcommands, parsing, and execution.',
		UserError: 'Throw this for user-facing failures. Kit prints the message without a stack trace.',
		CommandFormatter: 'Terminal formatter for help, provider lists, component lists, component details, and plan details.',
		KeyValueFormatter: 'Aligned key/value definition-list formatter (like kit component show output). Prefer it over TableFormatter when rows carry long or list-valued cells.',
		PlanFormatter: 'Terminal formatter for a saved or pending follow-up plan.',
		TableFormatter: 'Width-aware aligned-column formatter for terminal tables. Caps output at the terminal width, truncates cells with an ellipsis, and accepts per-column { header, maxWidth, flex } hints plus a { wide } escape hatch.',
		bestMatch: 'Returns the best fuzzy-ish match for a raw query from a list of candidate strings.',
		createCLI: 'Constructs a CLI from Command objects. Kit uses this in src/main.js.',
		createFileEnv: 'Creates the env object passed to provider create() methods. Pass { dryRun: true } to preview writes and commands without side effects.',
		defineCommand: 'Convenience wrapper for new Command(definition). Use it for Kit command modules.',
		Identifier: 'Value object for dot-separated component ids such as provider.type.name.',
		Component: 'Marker/base class documenting the provider component contract: id(), description(), inspect(), and related provider-owned behavior.',
		ComponentType: 'Marker/base class documenting the provider component-type contract: schema(), parse(), describe(), create().',
		Event: 'Validated event registry. Event constructors return objects with toJSON() for files, plans, providers, components, commands, and errors.',
		FileURI: 'Value object for file references. Use it instead of path string surgery; call .path() only at runtime IO boundaries.',
		Introspectable: 'Runtime API discovery helpers. Use .methods(), .method(name), .signature(), .doc(), and .source() in the REPL.',
		ManifestParseError: 'Error thrown when manifest syntax cannot be parsed. It includes source location details when available.',
		ManifestResolver: 'Turns parsed manifest syntax into provider/type/spec operations before anything writes files.',
		ManifestRunner: 'Runs already-resolved manifest operations through providers using an env and optional plan execution.',
		ManifestRunnerError: 'Batch validation error containing every manifest operation error found before execution.',
		ManifestVocabulary: 'Live dictionary of provider component types used to validate manifests and print example vocabulary.',
		parseManifest: 'Parses TCL-ish .kit manifest text into syntax nodes. This does not validate providers or schemas.',
		Provider: 'Marker/base class documenting the provider contract: name(), types(), components(), create().',
		PlanExecutor: 'Executes provider follow-up plans, persists progress, runs agents, verifies steps, and supports resume.',
		EphemeralStateStore: 'In-memory state store implementing the plan/state persistence contract. Use in tests or throwaway execution.',
		PersistentStateStore: 'JSON file state store under the Kit cache directory. Used for resumable plans.',
		discoverComponents: 'Yields provider discovery events and component.listed events for every discovered provider component.',
		discoverComponentRecords: 'Yields richer provider/component records for commands that need provider-specific formatting or inspect data.',
		discoverProviders: 'Scans provider directories, imports provider modules, and yields provider discovery/loading events.',
		inspectComponent: 'Finds one provider-qualified component record such as kit-event.file.fileRead.',
		providerDiscoveryPaths: 'Returns the FileURI directories Kit scans for providers from a repo root and cwd.',
		argvFromSchemaValues: 'Converts TypeBox schema values into argv for schema-derived provider options. Arrays use zero-based dotted indexes such as --files.0.path value.',
		parseArgsOptionsFromSchema: 'Converts a TypeBox object schema into node:util parseArgs options, respecting kit.cli: false fields and schema-directed dotted nested flags.',
		parseSchemaArgs: 'Parses argv against a TypeBox object schema and returns normalized values. Use with argvFromSchemaValues in the REPL to test schema/argv round trips.',
		schemaCLIOptionEntries: 'Returns the schema-derived option rows used by kit generate help, including dotted nested field names.',
		schemaHasCLIArrayField: 'Returns true when schema-derived CLI help should include array index syntax guidance.',
		schemaHasCLIBooleanField: 'Returns true when schema-derived CLI help should include boolean flag guidance (--flag, --no-flag, --flag=false).',
		kitVersion: 'Returns the Kit CLI version tag, such as v0.3.3. Backed by the package.json version field.',
		isSchemaFieldVisibleInCLI: 'Returns whether a TypeBox schema field should be exposed as a generated kit generate CLI flag. Reads kit.cli metadata.',
		parseArgs: 'node:util parseArgs wrapper that turns parse failures into clean UserError messages and reconstructs schema-directed dotted nested flags.',
		repoRoot: 'Runs git rev-parse --show-toplevel and returns the repository root as a FileURI. Call .path() if an API needs a native string.',
		replHistoryFile: 'Returns the cache file that stores interactive REPL history for this workspace.',
		replSessionFile: 'Returns the cache file that stores the current REPL session id for this workspace.',
		replSocketPath: 'Returns the Unix socket path used by this workspace’s persistent Kit REPL server.',
		replStateDirectory: 'Returns the cache directory where Kit stores REPL sockets/sessions and plan state.',
		startRepl: 'Starts the Unix-socket REPL server. CLI users normally call kit repl new/do/stop instead.',
		loadProvider: 'Imports a provider module from a path/FileURI and calls its default export with the kit object.',
		spawn: 'Low-level command event stream that always runs. Use env.spawn() instead for generation side effects that must no-op in dry-run.',
	}
}

function documentCoreClasses() {
	Introspectable.document(AgentRunner, {
		instance: {
			start: 'Abstract method: start a new agent run and return an async stream of command events. Subclasses must implement it.',
			continue: 'Abstract method: continue an existing agent run by thread id and return an async stream of command events. Subclasses must implement it.',
		},
	})
	Introspectable.document(AmpAgentRunner, {
		instance: {
			start: 'Starts a new Amp thread with --stream-json and returns Kit command events. Used by PlanExecutor for new agent steps.',
			continue: 'Continues an existing Amp thread id with a new prompt and returns Kit command events. Used when resuming agent work.',
		},
	})
	Introspectable.document(ClaudeAgentRunner, {
		instance: {
			start: 'Starts a new Claude Code session with stream-json output and returns Kit command events. Used by PlanExecutor for new agent steps.',
			continue: 'Resumes an existing Claude Code session id with a new prompt and returns Kit command events. Used when resuming agent work.',
		},
	})
	Introspectable.document(CLI, {
		instance: {
			run: 'Dispatches argv to a registered Command. Throws UserError when the command name is unknown.',
			list: 'Returns the registered top-level Command objects in display order.',
			find: 'Finds a command by path array, walking subcommands. Returns undefined when no command matches.',
		},
	})
	Introspectable.document(Command, {
		instance: {
			command: 'Registers a subcommand and returns this command for chaining.',
			parse: 'Parses argv using this command’s option schema. Allows positionals and converts parse failures to UserError.',
			call: 'Runs this command or one of its subcommands with context. Handles help and unknown-subcommand errors.',
		},
	})
	Introspectable.document(Identifier, {
		static: {
			fromString: 'Parses a dot-separated id string into an Identifier. Use this instead of split(".") in provider code.',
		},
		instance: {
			parts: 'Returns a defensive copy of the id parts array.',
			startsWith: 'Returns true when this id begins with another Identifier’s parts. Useful for component list prefix filtering.',
			toString: 'Serializes the id as dot-separated text.',
		},
	})
	Introspectable.document(FileURI, {
		static: {
			from: 'Parses an existing absolute file:// URL or returns a FileURI unchanged. Use when event/plan data already contains file URLs.',
			fromPath: 'Converts a native path or file URL string into a FileURI. Relative paths resolve from process.cwd().',
		},
		instance: {
			join: 'Appends safe relative path segments and returns a new FileURI. Rejects absolute paths, URLs, and .. traversal.',
			parent: 'Returns the containing directory as a FileURI.',
			path: 'Returns the native filesystem path string. Use only at IO boundaries such as Bun.file or Bun.write.',
			relativeTo: 'Returns this URI relative to a base FileURI, or throws if this file is outside the base.',
			withExtension: 'Returns a new FileURI with a suffix appended. The extension must include its leading dot.',
			withoutExtension: 'Returns a new FileURI with a suffix removed when present. The extension must include its leading dot.',
			toString: 'Serializes as an absolute file:// URL for events, JSON, and manifests.',
			toJSON: 'Serializes as the same file:// URL returned by toString().',
		},
	})
	Introspectable.document(Event, {
		static: eventDocs(),
		instance: {
			toJSON: 'Returns the validated plain event object. CLI formatters and JSON output consume this shape.',
		},
	})
}

function documentFormattingClasses() {
	Introspectable.document(TableFormatter, {
		instance: {
			row: 'Adds one row. Values are converted to strings when queued, before widths are calculated.',
			isEmpty: 'Returns true when no data rows have been queued.',
			flush: 'Writes headers and queued rows as an aligned text table, capped to the terminal width unless constructed with { wide: true }.',
			columnWidths: 'Computes final column widths from natural widths, per-column maxWidth hints, the flex column, and the available terminal width.',
			availableWidth: 'Returns the width budget: the width option, the output sink columns, process.stdout.columns, or 120.',
		},
	})
	Introspectable.document(KeyValueFormatter, {
		instance: {
			entry: 'Queues one key/value pair. Arrays render one element per line; objects render as single-line JSON.',
			isEmpty: 'Returns true when no entries have been queued.',
			flush: 'Writes queued entries as an aligned key/value definition list, wrapping long values to the terminal width unless constructed with { wide: true }.',
		},
	})
	Introspectable.document(PlanFormatter, {
		instance: {
			write: 'Writes a human-readable plan state, including status, intent, steps, files, verification commands, and last output.',
		},
	})
	Introspectable.document(CommandFormatter, {
		instance: {
			help: 'Returns top-level CLI help text with every command and subcommand summary.',
			commandHelp: 'Returns help text for one command path, including subcommands and options.',
			commandsWithChildren: 'Returns flattened command/subcommand rows used by top-level help output.',
			providersList: 'Consumes provider discovery events and writes a Provider/Path table.',
			componentsList: 'Consumes component discovery events and writes a filtered Component/Description table.',
			componentShow: 'Writes details for one inspected component record, including files and provider-specific fields.',
			planShow: 'Writes a saved plan state through PlanFormatter.',
			writeLine: 'Writes a single line to the configured output sink.',
		},
	})
}

function documentManifestClasses() {
	Introspectable.document(ManifestResolver, {
		instance: {
			resolve: 'Resolves parsed manifest syntax against live provider vocabulary. Returns { operations, errors } and does not run providers.',
		},
	})
	Introspectable.document(ManifestVocabulary, {
		static: {
			from: 'Builds vocabulary entries by asking each provider for its component types.',
		},
		instance: {
			resolve: 'Resolves one parsed manifest component into a provider/type/spec operation or an error.',
			all: 'Returns every live vocabulary entry. Used by kit manifest vocabulary output.',
			entryFor: 'Finds the vocabulary entry for one parsed component, or returns a missing-entry object that explains the error.',
		},
	})
	Introspectable.document(ManifestRunner, {
		instance: {
			run: 'Validates a resolved manifest batch, then yields provider events in manifest order. Throws ManifestRunnerError if validation fails.',
			validate: 'Resolves operations against providers and returns { operations, errors } without running create().',
			registry: 'Builds the provider registry used to bind provider/type names to live provider objects.',
		},
	})
}

function documentExecutionClasses() {
	Introspectable.document(PlanExecutor, {
		instance: {
			execute: 'Starts a new follow-up plan, persists initial state, then runs steps synchronously.',
			resume: 'Loads plan/<id> from the state store and resumes from the last completed checkpoint. The in-flight step may run again.',
			drive: 'Runs a plan state and rewrites UserError messages to include the kit plan resume command.',
			runState: 'Runs steps from currentStepIndex to completion, checkpointing only after each step succeeds.',
			saveState: 'Persists a plan state under plan/<id> using the configured state store.',
			runStep: 'Runs one plan step: optional agent work, optional verification, and one retry when an agent step fails verification.',
			runAgentStep: 'Starts or continues the configured agent runner, parses streamed agent JSON, updates threadID, and records last output.',
			runVerifyStep: 'Runs verifyWithCommand through the configured shell and returns { ok, code, output }.',
		},
	})
	const stateDocs = {
		get: 'Returns the JSON value stored at a logical key, or undefined when missing.',
		set: 'Stores a JSON-serializable value at a logical key.',
		delete: 'Removes the value for a logical key if present.',
		list: 'Lists logical keys under an optional prefix. Plan state keys look like plan/<id>.',
	}
	Introspectable.document(EphemeralStateStore, { instance: stateDocs })
	Introspectable.document(PersistentStateStore, {
		instance: {
			...stateDocs,
			path: 'Returns the native filesystem path for a logical key. Prefer file() unless an API needs a string path.',
			file: 'Returns the FileURI for a logical key JSON file. Adds .json and rejects unsafe keys.',
		},
	})
}

function eventDocs() {
	return {
		fileCreated: 'Builds a file.created event for a path that was or would be created.',
		fileRead: 'Builds a file.read event for a path that was read.',
		fileRemoved: 'Builds a file.removed event for a path that was removed.',
		fileEdited: 'Builds a file.edited event for a path that was or would be edited.',
		error: 'Builds an error event with a message and optional cause details.',
		plan: 'Builds a follow-up plan event. Providers yield this after deterministic generation when agent work remains.',
		providerDiscovered: 'Builds a provider.discovered event for a directory Kit is scanning.',
		providerLoading: 'Builds a provider.loading event before importing one provider module.',
		providerLoaded: 'Builds a provider.loaded event after a provider module loads and names itself.',
		providerLoadFailed: 'Builds a provider.loadFailed event when importing or initializing a provider throws.',
		componentListed: 'Builds a component.listed event from provider, id, and description values.',
		commandSpawned: 'Builds a command.spawned event for a command array.',
		commandOutput: 'Builds a command.output event for stdout/stderr bytes.',
		commandExited: 'Builds a command.exited event with the process exit code.',
		from: 'Validates a raw event value against a TypeBox schema and wraps it as an Event.',
	}
}
