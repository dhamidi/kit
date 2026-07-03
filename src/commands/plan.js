import { defineCommand, UserError } from '../cli.js'
import { TableFormatter } from '../formatters/table.js'
import { PersistentStateStore } from '../state_store.js'

/**
 * Command group for plan operations.
 *
 * @example
 * await createCLI([plan]).run(['plan', 'clear'])
 */
const plan = defineCommand({
	name: 'plan',
	description: 'Manage plan',
	run(context) {
		return context.command.commands.get('list').call([], context)
	},
})

plan.command(
	defineCommand({
		name: 'clear',
		description: 'Remove completed cached plans',
		async run() {
			const store = new PersistentStateStore()
			const table = new TableFormatter(['ID', 'Progress', 'Description'])

			for (const key of await cachedPlanKeys(store)) {
				const state = await store.get(key)

				if (state === undefined || state.status !== 'completed') {
					continue
				}

				table.row(planRow(key, state))
				await store.delete(key)
			}

			if (table.isEmpty()) {
				console.log('No completed cached plans removed')
				return
			}

			table.flush()
		},
	}),
)

plan.command(
	defineCommand({
		name: 'list',
		description: 'List cached plans',
		async run() {
			const store = new PersistentStateStore()
			const table = new TableFormatter(['ID', 'Progress', 'Description'])

			for (const key of await cachedPlanKeys(store)) {
				const state = await store.get(key)

				if (state === undefined) {
					continue
				}

				table.row(planRow(key, state))
			}

			if (table.isEmpty()) {
				console.log('No cached plans')
				return
			}

			table.flush()
		},
	}),
)

plan.command(
	defineCommand({
		name: 'status',
		description: 'List running plans',
		async run() {
			const store = new PersistentStateStore()
			const table = new TableFormatter(['ID', 'Progress', 'Description'])

			for (const key of await cachedPlanKeys(store)) {
				const state = await store.get(key)

				if (state === undefined || state.status !== 'running') {
					continue
				}

				table.row(planRow(key, state))
			}

			if (table.isEmpty()) {
				console.log('No running plans')
				return
			}

			table.flush()
		},
	}),
)

plan.command(
	defineCommand({
		name: 'show',
		description: 'Show plan by id',
		async run({ cli, parsed }) {
			const id = parsed.positionals[0]

			if (id === undefined) {
				const keys = await new PersistentStateStore().list('plan')
				throw new UserError(`Usage: kit plan show <id>\n\nCached plans:\n${cachedPlans(keys)}`)
			}

			const state = await new PersistentStateStore().get(`plan/${id}`)

			if (state === undefined) {
				throw new UserError(`Unknown plan: ${id}`)
			}

			cli.formatter.planShow(state)
		},
	}),
)

export default plan

async function cachedPlanKeys(store) {
	return (await store.list('plan')).filter((key) => key !== 'plan/current')
}

function cachedPlans(keys) {
	const plans = keys.map((key) => `  ${planID(key)}`)

	return plans.length === 0 ? '  (none)' : plans.join('\n')
}

function planRow(key, state) {
	return [planID(key), progress(state), description(state)]
}

function planID(key) {
	return key.replace(/^plan\//, '')
}

function description(state) {
	const plan = state.plan ?? state

	return plan.intent ?? plan.instructions ?? '(no description)'
}

function progress(state) {
	const total = (state.steps ?? state.plan?.steps ?? []).length
	const completed = state.status === 'completed' ? total : Math.max(0, state.currentStepIndex ?? 0)

	return `${completed}/${total}`
}
