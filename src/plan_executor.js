import { DEFAULT_AGENT, createAgentRunner } from './agent_runner.js'
import { agentMessageToUpdate, agentThreadID, parseAgentLine } from './agents.js'
import { UserError } from './cli.js'
import { AgentUpdateFormatter } from './formatters/agent_updates.js'
import { spawn } from './spawn.js'
import { PersistentStateStore } from './state_store.js'

/**
 * PlanExecutor runs provider follow-up plans synchronously with resumable state.
 */
export class PlanExecutor {
	constructor({
		agent = DEFAULT_AGENT,
		agentRunner,
		formatter = new AgentUpdateFormatter(),
		stateStore = new PersistentStateStore(),
		shell = process.env.SHELL ?? '/bin/sh',
	} = {}) {
		// An explicitly injected runner (e.g. in tests) wins over the named agent
		// and is never rebuilt on resume.
		this.explicitRunner = agentRunner !== undefined
		this.agent = agent
		this.agentRunner = agentRunner ?? createAgentRunner(agent)
		this.formatter = formatter
		this.stateStore = stateStore
		this.shell = shell
	}

	/**
	 * Switches to a named agent unless a runner was explicitly injected.
	 *
	 * Used by resume so a plan continues with the agent it was started with,
	 * because thread IDs are agent-specific and cannot be handed to another CLI.
	 */
	useAgent(name) {
		if (this.explicitRunner) {
			return
		}

		this.agent = name
		this.agentRunner = createAgentRunner(name)
	}

	async execute(plan) {
		const state = {
			id: plan.id ?? crypto.randomUUID(),
			status: 'running',
			agent: this.agent,
			plan,
			currentStepIndex: 0,
			steps: plan.steps,
			lastOutput: undefined,
		}

		await this.saveState(state)
		await this.drive(state)
	}

	/**
	 * Resumes a stopped or interrupted plan from its last persisted checkpoint.
	 *
	 * Because progress is only checkpointed after a step completes, resume re-runs
	 * the step that was in flight when the plan stopped. Steps are carried out by an
	 * agent that reconciles any half-applied work, so re-running is safe.
	 *
	 * @example
	 * await new PlanExecutor().resume('a1b2c3d4')
	 */
	async resume(id) {
		const state = await this.stateStore.get(`plan/${id}`)

		if (state === undefined) {
			throw new UserError(`Unknown plan: ${id}`)
		}

		if (state.status === 'completed') {
			console.log(`Plan ${id} is already complete`)
			return
		}

		this.useAgent(state.agent ?? DEFAULT_AGENT)
		state.agent = this.agent
		state.status = 'running'
		await this.drive(state)
	}

	async drive(state) {
		try {
			await this.runState(state)
		} catch (error) {
			if (error instanceof UserError) {
				throw new UserError(`${error.message}\n\nResume with: kit plan resume ${state.id}`)
			}

			throw error
		}
	}

	async runState(state) {
		while (state.currentStepIndex < state.steps.length) {
			const index = state.currentStepIndex
			await this.runStep(state.steps[index], state)

			// Checkpoint only after the step completes; an interrupted step is
			// re-run on resume rather than skipped.
			state.currentStepIndex = index + 1
			await this.saveState(state)
		}

		state.status = 'completed'
		await this.saveState(state)
	}

	async saveState(state) {
		await this.stateStore.set(`plan/${state.id}`, state)
	}

	async runStep(step, state) {
		for (let attempt = 0; attempt < 2; attempt++) {
			if (step.agent !== undefined) {
				state.lastOutput = await this.runAgentStep(step, state)
			}

			if (step.verifyWithCommand === undefined) {
				return
			}

			const verification = await this.runVerifyStep(step)

			if (verification.ok) {
				console.log(`Verified ${step.verifyWithCommand}`)
				return
			}

			state.lastOutput = `Verification failed with code ${verification.code}: ${verification.output}`

			if (step.agent === undefined) {
				break
			}
		}

		throw verificationFailure(step)
	}

	async runAgentStep(step, state) {
		let lastOutput = state.lastOutput
		let threadID = step.agent.threadID
		const events =
			threadID === undefined
				? this.agentRunner.start({ prompt: agentPrompt(step, state), cwd: process.cwd() })
				: this.agentRunner.continue({
						threadID,
						prompt: agentPrompt(step, state),
						cwd: process.cwd(),
					})

		let exitCode = 0
		const stderr = []

		for await (const event of events) {
			const value = event.toJSON()

			if (value.type === 'command.exited') {
				exitCode = value.code
				continue
			}

			if (value.type === 'command.output' && value.stream === 'stderr') {
				stderr.push(value.bytes)
				continue
			}

			if (value.type !== 'command.output' || value.stream !== 'stdout') {
				continue
			}

			for (const line of new TextDecoder().decode(value.bytes).split('\n').filter(Boolean)) {
				const message = parseAgentLine(line)

				if (message === undefined) {
					continue
				}

				threadID ??= agentThreadID(message)
				step.agent.threadID = threadID

				const update = agentMessageToUpdate(message)

				if (update !== undefined) {
					if (update.name !== undefined) {
						update.name = `${step.id}:${update.name}`
					} else {
						update.kind = `${step.id}:${update.kind}`
					}

					lastOutput = update.text
					this.formatter.write(update)
				}
			}
		}

		if (exitCode !== 0) {
			throw agentFailure(step, exitCode, new TextDecoder().decode(join(stderr)).trim())
		}

		return lastOutput
	}

	async runVerifyStep(step) {
		const chunks = []
		let code = 0

		for await (const event of spawn([this.shell, '-c', step.verifyWithCommand])) {
			const value = event.toJSON()

			if (value.type === 'command.output') {
				chunks.push(value.bytes)
			}

			if (value.type === 'command.exited') {
				code = value.code
			}
		}

		return {
			ok: code === 0,
			code,
			output: new TextDecoder().decode(join(chunks)),
		}
	}
}

function join(chunks) {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
	const bytes = new Uint8Array(length)
	let offset = 0

	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}

	return bytes
}

function verificationFailure(step) {
	const parts = []

	if (step.instructions !== undefined) {
		parts.push(step.instructions)
	}

	parts.push(`Verification failed: ${step.verifyWithCommand}`)
	return new UserError(parts.join('\n\n'))
}

function agentFailure(step, exitCode, stderr) {
	const label = step.id ?? '(unnamed)'
	const detail = stderr === '' ? '' : `\n${stderr}`

	return new UserError(
		`Agent step ${label} failed with exit code ${exitCode}.${detail}\n\nIf the agent is not authenticated, log in and resume.`,
	)
}

function agentPrompt(step, state) {
	return [
		step.agent.prompt,
		'',
		`Plan progress: step ${state.currentStepIndex + 1} of ${state.steps.length}.`,
		state.lastOutput === undefined ? '' : `Previous output: ${state.lastOutput}`,
	]
		.filter(Boolean)
		.join('\n')
}
