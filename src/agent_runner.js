import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter } from 'node:path'
import { UserError } from './cli.js'
import { Event } from './event.js'
import { FileURI } from './file_uri.js'
import { spawn } from './spawn.js'

/**
 * AgentRunner defines the interface for executing and continuing agent work.
 */
export class AgentRunner {
	start() {
		throw new Error('AgentRunner.start must be implemented')
	}

	continue() {
		throw new Error('AgentRunner.continue must be implemented')
	}
}

export class AmpAgentRunner extends AgentRunner {
	constructor({ command = 'amp', mode = 'rush' } = {}) {
		super()
		this.command = command
		this.mode = mode
	}

	start({ prompt, cwd }) {
		return spawn(
			[
				this.command,
				'--stream-json',
				'--no-archive-after-execute',
				'--mode',
				this.mode,
				'--execute',
				prompt,
			],
			{ cwd },
		)
	}

	continue({ threadID, prompt, cwd }) {
		return spawn(
			[this.command, 'threads', 'continue', threadID, '--stream-json', '--execute', prompt],
			{ cwd },
		)
	}
}

export class ClaudeAgentRunner extends AgentRunner {
	constructor({ command = 'claude', model = 'sonnet' } = {}) {
		super()
		this.command = command
		this.model = model
	}

	start({ prompt, cwd }) {
		return spawn(
			[
				this.command,
				'--print',
				'--verbose',
				'--model',
				this.model,
				'--output-format',
				'stream-json',
				prompt,
			],
			{ cwd },
		)
	}

	continue({ threadID, prompt, cwd }) {
		return spawn(
			[
				this.command,
				'--print',
				'--verbose',
				'--model',
				this.model,
				'--output-format',
				'stream-json',
				'--resume',
				threadID,
				prompt,
			],
			{ cwd },
		)
	}
}

/**
 * Name of the automatic agent selection mode used when none is specified.
 */
export const DEFAULT_AGENT = 'auto'

const agentDefinitions = [
	{
		name: 'amp',
		command: 'amp',
		description: 'Amp CLI',
		installHint: 'Install Amp from https://ampcode.com',
		RunnerClass: AmpAgentRunner,
	},
	{
		name: 'claude',
		command: 'claude',
		description: 'Claude Code CLI',
		installHint: 'Install Claude Code and run `claude login`',
		RunnerClass: ClaudeAgentRunner,
	},
]

/**
 * Names of the agents that can execute plans, for help text and validation.
 *
 * @example
 * agentNames() // ['amp', 'claude']
 */
export function agentNames() {
	return agentDefinitions.map((agent) => agent.name)
}

/**
 * Yields observable agent discovery events in default selection order.
 */
export async function* discoverAgents({ env = process.env } = {}) {
	for (const definition of agentDefinitions) {
		yield Event.agentDiscovered(definition)

		const path = await findExecutable(definition.command, { env })

		if (path === undefined) {
			yield Event.agentUnavailable(definition, 'Command not found on PATH')
			continue
		}

		yield Event.agentAvailable(definition, path)
	}
}

/**
 * Returns currently available agents in default selection order.
 */
export async function availableAgents(options = {}) {
	const agents = []

	for await (const event of discoverAgents(options)) {
		const value = event.toJSON()

		if (value.type === 'agent.available') {
			agents.push(value)
		}
	}

	return agents
}

/**
 * Resolves an explicit or automatic agent request into one installed agent.
 */
export async function selectAgent(name = DEFAULT_AGENT, options = {}) {
	if (name === undefined || name === DEFAULT_AGENT) {
		return selectDefaultAgent(await agentDiscoveryReport(options))
	}

	const definition = agentDefinitions.find((agent) => agent.name === name)

	if (definition === undefined) {
		throw new UserError(`Unknown agent: ${name}\n\nSupported agents: ${agentNames().join(', ')}`)
	}

	return selectRequestedAgent(definition, await agentDiscoveryReport(options))
}

/**
 * Builds an agent runner by name, defaulting to the first available agent.
 *
 * The selected name is persistence-stable and should be stored in plan state so
 * a resumed plan continues with the same agent (thread IDs are agent-specific).
 */
export async function createAgentRunner(name = DEFAULT_AGENT, options = {}) {
	const agent = await selectAgent(name, options)
	return {
		name: agent.name,
		runner: new agent.definition.RunnerClass({ command: agent.path }),
		event: Event.agentSelected(agent, selectionReason(name)),
	}
}

async function agentDiscoveryReport(options) {
	const events = []
	const available = []
	const unavailable = []

	for await (const event of discoverAgents(options)) {
		const value = event.toJSON()
		events.push(value)

		if (value.type === 'agent.available') {
			available.push(value)
		} else if (value.type === 'agent.unavailable') {
			unavailable.push(value)
		}
	}

	return { events, available, unavailable }
}

function selectDefaultAgent(report) {
	const agent = report.available[0]

	if (agent !== undefined) {
		return agentWithDefinition(agent)
	}

	throw new UserError(noAgentsMessage(report))
}

function selectRequestedAgent(definition, report) {
	const agent = report.available.find((candidate) => candidate.name === definition.name)

	if (agent !== undefined) {
		return agentWithDefinition(agent)
	}

	const available = report.available.map((candidate) => candidate.name).join(', ') || '(none)'
	throw new UserError([
		`Agent "${definition.name}" is supported but its command was not found on PATH.`,
		'',
		definition.installHint,
		`Available installed agents: ${available}`,
	].join('\n'))
}

function agentWithDefinition(agent) {
	return {
		...agent,
		definition: agentDefinitions.find((definition) => definition.name === agent.name),
	}
}

function noAgentsMessage(report) {
	return [
		'No supported agent CLI found.',
		'',
		`Kit looked for: ${agentNames().join(', ')}`,
		'',
		'Install one of:',
		...report.unavailable.map((agent) => `  ${agent.name.padEnd(7)} ${agent.installHint}`),
		'',
		'Or pass --agent <name> after installing it.',
	].join('\n')
}

function selectionReason(name) {
	return name === undefined || name === DEFAULT_AGENT
		? 'first available agent by priority'
		: 'requested by --agent'
}

async function findExecutable(command, { env }) {
	if (command.includes('/')) {
		const file = FileURI.fromPath(command)
		return await isExecutable(file) ? file.path() : undefined
	}

	for (const directory of pathEntries(env)) {
		const file = FileURI.fromPath(directory).join(command)

		if (await isExecutable(file)) {
			return file.path()
		}
	}

	return undefined
}

function pathEntries(env) {
	return (env.PATH ?? '').split(delimiter).filter((entry) => entry !== '')
}

async function isExecutable(file) {
	try {
		await access(file.path(), constants.X_OK)
		return true
	} catch {
		return false
	}
}
