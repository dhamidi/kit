import { parseArgs } from 'node:util'
import { Type } from '@sinclair/typebox'
import { AgentRunner, AmpAgentRunner } from './agent_runner.js'
import { CLI, Command, createCLI, defineCommand, UserError } from './cli.js'
import { Component } from './component.js'
import { Identifier } from './component_identifier.js'
import { ComponentType } from './component_type.js'
import { Event } from './event.js'
import { FileURI } from './file_uri.js'
import { CommandFormatter } from './formatters/command.js'
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
import { replSessionFile, replSocketPath, replStateDirectory, startRepl } from './repl.js'
import { repoRoot } from './repo_root.js'
import { parseArgsOptionsFromSchema } from './schema_args.js'
import { spawn } from './spawn.js'
import { EphemeralStateStore, PersistentStateStore } from './state_store.js'

export { AgentRunner, AmpAgentRunner } from './agent_runner.js'
export { parseAgentLine, parseAgentMessage } from './agents.js'
export { CLI, Command, createCLI, defineCommand, UserError } from './cli.js'
export { Component } from './component.js'
export { Identifier } from './component_identifier.js'
export { ComponentType } from './component_type.js'
export { Event } from './event.js'
export { FileURI } from './file_uri.js'
export { CommandFormatter } from './formatters/command.js'
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
export { replSessionFile, replSocketPath, replStateDirectory, startRepl } from './repl.js'
export { repoRoot } from './repo_root.js'
export { parseArgsOptionsFromSchema } from './schema_args.js'
export { spawn } from './spawn.js'
export { EphemeralStateStore, PersistentStateStore } from './state_store.js'

Introspectable.includeIn(ManifestResolver)
Introspectable.includeIn(ManifestRunner)
Introspectable.includeIn(ManifestVocabulary)

export const kit = {
	Type,
	AgentRunner,
	AmpAgentRunner,
	CLI,
	Command,
	UserError,
	CommandFormatter,
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
	parseArgsOptionsFromSchema,
	parseArgs,
	repoRoot,
	replSessionFile,
	replSocketPath,
	replStateDirectory,
	startRepl,
	loadProvider,
	spawn,
}

Introspectable.includeInObject(kit)

export async function loadProvider(path) {
	const module = await import(String(new URL(path, `file://${process.cwd()}/`)))
	return module.default(kit)
}

export function createFileEnv() {
	return Introspectable.includeInObject({
		async createFile(path, content) {
			await Bun.write(FileURI.fromPath(path).path(), content)
			return Event.fileCreated(path)
		},
		async editFile(path, edit) {
			const file = FileURI.fromPath(path).path()
			const source = await Bun.file(file).text()
			const next = typeof edit === 'function' ? edit(source) : source
			await Bun.write(file, next)
			return Event.fileEdited(path)
		},
	})
}
