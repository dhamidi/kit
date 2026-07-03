import { spawn as nodeSpawn } from 'node:child_process'
import { Event } from './event.js'

/**
 * Spawns a command and yields command lifecycle events for process start, output, and exit.
 *
 * Uses `node:child_process` rather than `Bun.spawn`: because `amp` (and other agents)
 * are themselves `bun --compile` standalone binaries, spawning them from Kit — which
 * also runs under Bun — triggers a Bun-in-Bun hang where the child produces no output
 * and never starts (oven-sh/bun#14459, oven-sh/bun#24690). The Node spawner is not
 * affected. stdout and stderr are drained concurrently so a child that fills one pipe
 * buffer before writing to the other cannot deadlock.
 *
 * @example
 * for await (const event of spawn(['printf', 'hello'])) {
 * 	console.log(event.toJSON())
 * }
 */
export async function* spawn(command, options = {}) {
	yield Event.commandSpawned(command)

	const child = nodeSpawn(command[0], command.slice(1), {
		...options,
		stdio: ['ignore', 'pipe', 'pipe'],
	})

	const queue = []
	let wake
	let finished = false
	let exitCode = 0
	let spawnError

	const wakeUp = () => {
		if (wake !== undefined) {
			const resolve = wake
			wake = undefined
			resolve()
		}
	}

	const push = (event) => {
		queue.push(event)
		wakeUp()
	}

	child.stdout.on('data', (bytes) => push(Event.commandOutput(command, 'stdout', bytes)))
	child.stderr.on('data', (bytes) => push(Event.commandOutput(command, 'stderr', bytes)))

	child.on('error', (error) => {
		spawnError = error
		finished = true
		wakeUp()
	})

	child.on('close', (code) => {
		exitCode = typeof code === 'number' ? code : 1
		finished = true
		wakeUp()
	})

	while (true) {
		while (queue.length > 0) {
			yield queue.shift()
		}

		if (finished) {
			break
		}

		await new Promise((resolve) => {
			wake = resolve
		})
	}

	if (spawnError !== undefined) {
		throw spawnError
	}

	yield Event.commandExited(command, exitCode)
}
