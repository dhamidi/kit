import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const agentMessageSchemas = {
	system: Type.Object(
		{
			type: Type.Literal('system'),
			subtype: Type.Optional(Type.String()),
			session_id: Type.Optional(Type.String()),
		},
		{ additionalProperties: true },
	),
	user: Type.Object(
		{
			type: Type.Literal('user'),
			message: Type.Optional(Type.Unknown()),
			session_id: Type.Optional(Type.String()),
		},
		{ additionalProperties: true },
	),
	assistant: Type.Object(
		{
			type: Type.Literal('assistant'),
			message: Type.Optional(Type.Unknown()),
			session_id: Type.Optional(Type.String()),
		},
		{ additionalProperties: true },
	),
	result: Type.Object(
		{
			type: Type.Literal('result'),
			subtype: Type.Optional(Type.String()),
			is_error: Type.Optional(Type.Boolean()),
			result: Type.Optional(Type.String()),
			session_id: Type.Optional(Type.String()),
		},
		{ additionalProperties: true },
	),
}

export const agentMessageSchema = Type.Union(Object.values(agentMessageSchemas))

export const agentUpdateSchema = Type.Union([
	Type.Object(
		{
			kind: Type.Literal('tool'),
			name: Type.String(),
			text: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Union([Type.Literal('assistant'), Type.Literal('result')]),
			text: Type.String(),
		},
		{ additionalProperties: false },
	),
])

/**
 * Parses one JSONL stream-json line into a known agent message, or undefined
 * when the line is a message type Kit does not model.
 */
export function parseAgentLine(line) {
	return parseAgentMessage(JSON.parse(line))
}

/**
 * Returns the value when it is an agent message Kit understands, otherwise
 * undefined. Different agent CLIs emit extra event types Kit ignores (for
 * example Claude's `rate_limit_event`), so callers skip unrecognized messages
 * instead of failing the whole plan step.
 */
export function parseAgentMessage(value) {
	return Value.Check(agentMessageSchema, value) ? value : undefined
}

export function agentMessageToUpdate(message) {
	if (message.type === 'assistant') {
		return assistantUpdate(message)
	}

	if (message.type === 'result') {
		return { kind: 'result', text: message.result ?? message.subtype ?? 'done' }
	}

	return undefined
}

export function agentThreadID(message) {
	return message.session_id
}

function assistantUpdate(message) {
	const content = message.message?.content ?? []
	const toolUse = content.find((block) => block.type === 'tool_use')

	if (toolUse !== undefined) {
		return { kind: 'tool', name: toolUse.name, text: JSON.stringify(toolUse.input ?? {}) }
	}

	const text = content.find((block) => block.type === 'text')?.text

	if (text !== undefined) {
		return { kind: 'assistant', text }
	}

	return undefined
}
