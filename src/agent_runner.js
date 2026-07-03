import { UserError } from './cli.js'
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
 * Name of the agent used for plan execution when none is specified.
 */
export const DEFAULT_AGENT = 'amp'

const agentRunnerClasses = {
	amp: AmpAgentRunner,
	claude: ClaudeAgentRunner,
}

/**
 * Names of the agents that can execute plans, for help text and validation.
 *
 * @example
 * agentNames() // ['amp', 'claude']
 */
export function agentNames() {
	return Object.keys(agentRunnerClasses)
}

/**
 * Builds an agent runner by name, defaulting to Amp.
 *
 * The name is a persistence-stable identifier stored in plan state so a resumed
 * plan continues with the same agent (thread IDs are agent-specific).
 *
 * @example
 * createAgentRunner('claude') // ClaudeAgentRunner
 * createAgentRunner() // AmpAgentRunner
 */
export function createAgentRunner(name = DEFAULT_AGENT) {
	const RunnerClass = agentRunnerClasses[name]

	if (RunnerClass === undefined) {
		throw new UserError(`Unknown agent: ${name}\n\nAvailable agents: ${agentNames().join(', ')}`)
	}

	return new RunnerClass()
}
