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
