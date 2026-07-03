import { createFileEnv } from '../file_env.js'
import { PlanExecutor } from '../plan_executor.js'
import { ManifestOperations, ProviderRegistry } from './operation.js'

/**
 * Error thrown when a manifest cannot be executed safely.
 */
export class ManifestRunnerError extends Error {
	constructor(errors) {
		super(errors.map((error) => error.message).join('\n'))
		this.name = 'ManifestRunnerError'
		this.errors = errors
	}
}

/**
 * Runs already-resolved manifest operations.
 *
 * Parsing and schema-directed surface interpretation happen before this class. The runner asks
 * operations to bind themselves to live providers, refuses the whole batch when any operation is
 * invalid, then runs the valid batch in order.
 *
 * @example
 * const runner = new ManifestRunner({ providers })
 * for await (const event of runner.run([{ provider: 'kit-event', type: 'event', spec }])) {
 * 	console.log(event.toJSON())
 * }
 */
export class ManifestRunner {
	constructor({ providers = [], env = createFileEnv(), planExecutor, executePlans = true } = {}) {
		this.providers = providers
		this.env = env
		this.planEvents = planEventHandler({ planExecutor, executePlans })
	}

	/**
	 * Resolves and validates the batch before allowing any provider to touch the workspace.
	 */
	async *run(manifest) {
		const { operations, errors } = await this.validate(manifest)

		if (errors.length > 0) {
			throw new ManifestRunnerError(errors)
		}

		yield* operations.run(this.env, this.planEvents)
	}

	/**
	 * Resolves operations and returns all reasons the batch cannot run yet.
	 */
	async validate(manifest) {
		const operations = await ManifestOperations.from(manifest).resolveWith(await this.registry())
		return { operations, errors: operations.errors() }
	}

	/**
	 * Wraps the live providers in objects that know how to claim or reject operations.
	 */
	async registry() {
		return ProviderRegistry.from(this.providers)
	}
}

function planEventHandler({ planExecutor, executePlans }) {
	return executePlans
		? new ExecutingPlanEventHandler(planExecutor ?? new PlanExecutor())
		: new IgnoringPlanEventHandler()
}

class ExecutingPlanEventHandler {
	constructor(planExecutor) {
		this.planExecutor = planExecutor
	}

	/**
	 * Executes plan events and ignores everything else in the provider event stream.
	 */
	async handle(event) {
		const value = event.toJSON()

		if (value.type === 'plan') {
			await this.planExecutor.execute(value)
		}
	}
}

class IgnoringPlanEventHandler {
	/**
	 * Keeps dry-run callers on the same event path without running follow-up plans.
	 */
	async handle() {}
}
