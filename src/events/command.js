import { Type } from '@sinclair/typebox'

/**
 * Command events describe plan verification command execution: spawned commands,
 * stdout/stderr byte chunks, and final exit codes.
 */
const commandSchema = Type.Object(
	{
		command: Type.Array(Type.String()),
	},
	{ additionalProperties: false },
)

export const commandSchemas = {
	commandSpawned: Type.Composite(
		[Type.Object({ type: Type.Literal('command.spawned') }), commandSchema],
		{ description: 'External command process spawned' },
	),
	commandOutput: Type.Composite(
		[
			Type.Object({
				type: Type.Literal('command.output'),
				stream: Type.Union([Type.Literal('stdout'), Type.Literal('stderr')]),
				bytes: Type.Uint8Array(),
			}),
			commandSchema,
		],
		{ description: 'External command wrote stdout or stderr bytes' },
	),
	commandExited: Type.Composite(
		[
			Type.Object({
				type: Type.Literal('command.exited'),
				code: Type.Number(),
			}),
			commandSchema,
		],
		{ description: 'External command exited with a status code' },
	),
}

/**
 * Builds a command spawned payload.
 */
export function commandSpawnedEvent(command) {
	return { type: 'command.spawned', command }
}

export function commandOutputEvent(command, stream, bytes) {
	return { type: 'command.output', command, stream, bytes: new Uint8Array(bytes) }
}

export function commandExitedEvent(command, code) {
	return { type: 'command.exited', command, code }
}
