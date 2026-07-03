/**
 * PlanFormatter renders cached plan execution state for command-line users.
 *
 * @example
 * new PlanFormatter().write({ id: 'demo', status: 'completed', steps: [] })
 */
export class PlanFormatter {
	constructor(output = process.stdout) {
		this.output = output
	}

	write(state) {
		this.output.write(`${formatPlan(state)}\n`)
	}
}

function formatPlan(state) {
	const plan = state.plan ?? state
	const steps = state.steps ?? plan.steps ?? []
	const lines = [`Plan ${state.id}`, `Status: ${state.status}`]

	if (plan.intent !== undefined) {
		lines.push('', 'Intent:', indent(plan.intent))
	}

	if (plan.instructions !== undefined) {
		lines.push('', 'Instructions:', indent(plan.instructions))
	}

	lines.push('', 'Steps:')

	for (const [index, step] of steps.entries()) {
		const marker = stepMarker(index, state)
		lines.push(`  ${marker} ${index + 1}. ${step.id ?? 'step'}`)
		lines.push(`     ${step.instructions}`)

		if (step.files !== undefined) {
			lines.push(`     Files: ${step.files.join(', ')}`)
		}

		if (step.verifyWithCommand !== undefined) {
			lines.push(`     Verify: ${step.verifyWithCommand}`)
		}
	}

	if (state.lastOutput !== undefined) {
		lines.push('', 'Last output:', indent(state.lastOutput.trim()))
	}

	return lines.join('\n')
}

function stepMarker(index, state) {
	if (state.status === 'completed' || index < state.currentStepIndex) {
		return '✓'
	}

	if (index === state.currentStepIndex) {
		return '→'
	}

	return ' '
}

function indent(text) {
	return text
		.split('\n')
		.map((line) => `  ${line}`)
		.join('\n')
}
