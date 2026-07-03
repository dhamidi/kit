import { AmpAgentRunner } from './agent_runner.js'
import { agentMessageToUpdate, agentThreadID, parseAgentLine } from './agents.js'
import { AgentUpdateFormatter } from './formatters/agent_updates.js'
import { spawn } from './spawn.js'
import { PersistentStateStore } from './state_store.js'

/**
 * PlanExecutor runs provider follow-up plans synchronously with resumable state.
 */
export class PlanExecutor {
	constructor({
		agentRunner = new AmpAgentRunner(),
		formatter = new AgentUpdateFormatter(),
		stateStore = new PersistentStateStore(),
	} = {}) {
		this.agentRunner = agentRunner
		this.formatter = formatter
		this.stateStore = stateStore
	}

	async execute(plan) {
		const state = {
			id: plan.id ?? crypto.randomUUID(),
			status: 'running',
			plan,
			currentStepIndex: 0,
			steps: plan.steps,
			lastOutput: undefined,
		}

		await this.saveState(state)
		await this.runState(state)
	}

	async runState(state) {
		for (let index = state.currentStepIndex; index < state.steps.length; index++) {
			const step = state.steps[index]
			state.currentStepIndex = index
			await this.saveState(state)

			await this.runStep(step, state)
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
			await this.saveState(state)

			if (step.agent === undefined) {
				break
			}
		}

		throw new Error(`Verification failed: ${step.verifyWithCommand}`)
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

		for await (const event of events) {
			const value = event.toJSON()

			if (value.type !== 'command.output' || value.stream !== 'stdout') {
				continue
			}

			for (const line of new TextDecoder().decode(value.bytes).split('\n').filter(Boolean)) {
				const message = parseAgentLine(line)
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

		return lastOutput
	}

	async runVerifyStep(step) {
		const chunks = []
		let code = 0

		for await (const event of spawn(step.verifyWithCommand.split(' '))) {
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
