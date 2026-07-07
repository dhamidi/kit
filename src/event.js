import { Value } from '@sinclair/typebox/value'
import {
	agentAvailableEvent,
	agentDiscoveredEvent,
	agentSchemas,
	agentSelectedEvent,
	agentUnavailableEvent,
} from './events/agent.js'
import {
	commandExitedEvent,
	commandOutputEvent,
	commandSchemas,
	commandSpawnedEvent,
} from './events/command.js'
import { componentListedEvent, componentSchemas } from './events/component.js'
import { errorEvent, errorSchemas } from './events/error.js'
import { fileEvent, fileSchemas } from './events/file.js'
import { planEvent, planSchemas } from './events/plan.js'
import {
	providerDiscoveredEvent,
	providerLoadedEvent,
	providerLoadFailedEvent,
	providerLoadingEvent,
	providerSchemas,
} from './events/provider.js'

/**
 * Event is Kit's central registry for all event families.
 *
 * Individual event families live in `src/events/<family>.js`; add schemas and
 * payload builders there, then register constructor methods here.
 */
export class Event {
	static schemas = {
		...fileSchemas,
		...errorSchemas,
		...planSchemas,
		...providerSchemas,
		...componentSchemas,
		...commandSchemas,
		...agentSchemas,
	}

	static fileCreated(path) {
		return Event.from(Event.schemas.fileCreated, fileEvent('file.created', path))
	}

	static fileRead(path) {
		return Event.from(Event.schemas.fileRead, fileEvent('file.read', path))
	}

	static fileRemoved(path) {
		return Event.from(Event.schemas.fileRemoved, fileEvent('file.removed', path))
	}

	static fileEdited(path) {
		return Event.from(Event.schemas.fileEdited, fileEvent('file.edited', path))
	}

	static error(message, cause) {
		return Event.from(Event.schemas.error, errorEvent(message, cause))
	}

	static plan(instructions, steps, fields) {
		return Event.from(Event.schemas.plan, planEvent(instructions, steps, fields))
	}

	static providerDiscovered(path) {
		return Event.from(Event.schemas.providerDiscovered, providerDiscoveredEvent(path))
	}

	static providerLoaded(name, path) {
		return Event.from(Event.schemas.providerLoaded, providerLoadedEvent(name, path))
	}

	static providerLoading(path) {
		return Event.from(Event.schemas.providerLoading, providerLoadingEvent(path))
	}

	static providerLoadFailed(path, message, cause) {
		return Event.from(
			Event.schemas.providerLoadFailed,
			providerLoadFailedEvent(path, message, cause),
		)
	}

	static componentListed(provider, id, description) {
		return Event.from(
			Event.schemas.componentListed,
			componentListedEvent(provider, id, description),
		)
	}

	static commandSpawned(command) {
		return Event.from(Event.schemas.commandSpawned, commandSpawnedEvent(command))
	}

	static commandOutput(command, stream, bytes) {
		return Event.from(Event.schemas.commandOutput, commandOutputEvent(command, stream, bytes))
	}

	static commandExited(command, code) {
		return Event.from(Event.schemas.commandExited, commandExitedEvent(command, code))
	}

	static agentDiscovered(agent) {
		return Event.from(Event.schemas.agentDiscovered, agentDiscoveredEvent(agent))
	}

	static agentAvailable(agent, path) {
		return Event.from(Event.schemas.agentAvailable, agentAvailableEvent(agent, path))
	}

	static agentUnavailable(agent, reason) {
		return Event.from(Event.schemas.agentUnavailable, agentUnavailableEvent(agent, reason))
	}

	static agentSelected(agent, reason) {
		return Event.from(Event.schemas.agentSelected, agentSelectedEvent(agent, reason))
	}

	static from(schema, value) {
		return new Event(Value.Parse(schema, value))
	}

	constructor(value) {
		this.value = value
	}

	toJSON() {
		return this.value
	}
}
