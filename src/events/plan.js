import { Type } from '@sinclair/typebox'
import { FileURI } from '../file_uri.js'

/**
 * Plan events describe agent planning features, especially provider follow-up plans
 * that tell agents what work to do next and which files or commands are relevant.
 */
const planStepSchema = Type.Object(
	{
		id: Type.Optional(Type.String()),
		instructions: Type.String(),
		files: Type.Optional(Type.Array(FileURI.schema)),
		agent: Type.Optional(
			Type.Object(
				{
					prompt: Type.String(),
					command: Type.Optional(Type.Array(Type.String())),
				},
				{ additionalProperties: false },
			),
		),
		verifyWithCommand: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
)

export const planSchemas = {
	plan: Type.Object(
		{
			type: Type.Literal('plan'),
			id: Type.Optional(Type.String()),
			intent: Type.Optional(Type.String()),
			instructions: Type.String(),
			steps: Type.Array(planStepSchema),
		},
		{
			additionalProperties: false,
			description: 'Follow-up plan for agent-completed generation work',
		},
	),
}

/**
 * Builds a provider follow-up plan payload.
 */
export function planEvent(instructions, steps, fields = {}) {
	return { type: 'plan', ...fields, instructions, steps: steps.map(parseStep) }
}

function parseStep(step) {
	if (step.files === undefined) {
		return step
	}

	return {
		...step,
		files: step.files
			.filter((file) => file !== undefined && file !== null)
			.map((file) => FileURI.fromPath(file).toString()),
	}
}
