import { Event } from './event.js'

/**
 * Spawns a command and yields command lifecycle events for process start, output, and exit.
 *
 * @example
 * for await (const event of spawn(['printf', 'hello'])) {
 * 	console.log(event.toJSON())
 * }
 */
export async function* spawn(command, options = {}) {
	yield Event.commandSpawned(command)

	const child = Bun.spawn(command, {
		...options,
		stdout: 'pipe',
		stderr: 'pipe',
	})

	yield* readOutput(command, 'stdout', child.stdout)
	yield* readOutput(command, 'stderr', child.stderr)

	yield Event.commandExited(command, await child.exited)
}

async function* readOutput(command, stream, output) {
	if (output === null) {
		return
	}

	for await (const bytes of output) {
		yield Event.commandOutput(command, stream, bytes)
	}
}
