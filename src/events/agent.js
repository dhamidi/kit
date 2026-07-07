import { Type } from '@sinclair/typebox'

const agentFields = {
	name: Type.String(),
	command: Type.String(),
	description: Type.String(),
	installHint: Type.String(),
}

/**
 * Agent events report discovery of supported plan executors and whether their
 * commands are available on PATH.
 */
export const agentSchemas = {
	agentDiscovered: Type.Object(
		{
			type: Type.Literal('agent.discovered'),
			...agentFields,
		},
		{ additionalProperties: false, description: 'Supported agent runner discovered' },
	),
	agentAvailable: Type.Object(
		{
			type: Type.Literal('agent.available'),
			...agentFields,
			path: Type.String(),
		},
		{ additionalProperties: false, description: 'Supported agent command found on PATH' },
	),
	agentUnavailable: Type.Object(
		{
			type: Type.Literal('agent.unavailable'),
			...agentFields,
			reason: Type.String(),
		},
		{ additionalProperties: false, description: 'Supported agent command was not found' },
	),
	agentSelected: Type.Object(
		{
			type: Type.Literal('agent.selected'),
			...agentFields,
			path: Type.String(),
			reason: Type.String(),
		},
		{ additionalProperties: false, description: 'Agent selected to execute a plan' },
	),
}

export function agentDiscoveredEvent(agent) {
	return { type: 'agent.discovered', ...agentEventFields(agent) }
}

export function agentAvailableEvent(agent, path) {
	return { type: 'agent.available', ...agentEventFields(agent), path }
}

export function agentUnavailableEvent(agent, reason) {
	return { type: 'agent.unavailable', ...agentEventFields(agent), reason }
}

export function agentSelectedEvent(agent, reason) {
	return { type: 'agent.selected', ...agentEventFields(agent), path: agent.path, reason }
}

function agentEventFields(agent) {
	return {
		name: agent.name,
		command: agent.command,
		description: agent.description,
		installHint: agent.installHint,
	}
}
