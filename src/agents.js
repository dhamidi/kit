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
			input: Type.Unknown(),
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

/**
 * Converts one agent message into the display updates it contains.
 *
 * An assistant message can carry several content blocks, so this returns one
 * update per meaningful block (each text block and each tool call) rather than
 * collapsing to the first — otherwise narration accompanying a tool call, or a
 * message with several tool calls, would be lost.
 *
 * @returns {Array<object>} zero or more updates, in the order they appear.
 */
export function agentMessageToUpdate(message) {
	if (message.type === 'assistant') {
		return assistantUpdates(message)
	}

	if (message.type === 'result') {
		return [{ kind: 'result', text: message.result ?? message.subtype ?? 'done' }]
	}

	return []
}

export function agentThreadID(message) {
	return message.session_id
}

function assistantUpdates(message) {
	const content = message.message?.content ?? []
	const updates = []

	for (const block of content) {
		if (block.type === 'tool_use') {
			updates.push({ kind: 'tool', name: block.name, input: block.input ?? {} })
		} else if (block.type === 'text' && block.text) {
			updates.push({ kind: 'assistant', text: block.text })
		}
	}

	return updates
}
