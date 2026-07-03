import { Event } from './event.js'
import { FileURI } from './file_uri.js'
import { Introspectable } from './introspectable.js'
import { spawn as runCommand } from './spawn.js'

/**
 * Creates the file/process environment passed to provider `create()` methods.
 *
 * Real environments perform writes and subprocess execution. Dry-run
 * environments expose the same API and return the same event shapes without
 * mutating files or running external commands, so providers can branch on
 * `env.dryRun` only when they truly need different generation logic.
 *
 * @example
 * const env = createFileEnv({ dryRun: true })
 * console.log(env.dryRun)
 */
export function createFileEnv({ dryRun = false } = {}) {
	const env = {
		dryRun,

		async createFile(path, content) {
			if (!dryRun) {
				await Bun.write(FileURI.fromPath(path).path(), content)
			}

			return Event.fileCreated(path)
		},

		async editFile(path, edit) {
			const file = FileURI.fromPath(path).path()
			const source = await Bun.file(file).text()
			const next = typeof edit === 'function' ? edit(source) : source

			if (!dryRun) {
				await Bun.write(file, next)
			}

			return Event.fileEdited(path)
		},

		async readFile(path) {
			return Bun.file(FileURI.fromPath(path).path()).text()
		},

		async *spawn(command, options = {}) {
			if (dryRun) {
				yield Event.commandSpawned(command)
				yield Event.commandExited(command, 0)
				return
			}

			yield* runCommand(command, options)
		},

		async exec(command, options = {}) {
			const events = []
			const stdout = []
			const stderr = []
			let code = 0

			for await (const event of env.spawn(command, options)) {
				const value = event.toJSON()
				events.push(event)

				if (value.type === 'command.output' && value.stream === 'stdout') {
					stdout.push(value.bytes)
				}

				if (value.type === 'command.output' && value.stream === 'stderr') {
					stderr.push(value.bytes)
				}

				if (value.type === 'command.exited') {
					code = value.code
				}
			}

			return {
				code,
				stdout: decode(stdout),
				stderr: decode(stderr),
				events,
			}
		},
	}

	Introspectable.document(env, {
		createFile: [
			'Creates or replaces a file and returns a file.created event.',
			'Use this inside provider create() methods instead of Bun.write so Kit can preview generation in dry-run mode.',
			'In dry-run mode no file is written, but the same event is returned for plan/apply parity.',
		].join('\n'),
		editFile: [
			'Reads a file, applies an edit function, writes the result, and returns a file.edited event.',
			'The edit callback receives the current source text and should return the next source text.',
			'In dry-run mode Kit still reads and runs the transform to catch errors, but does not write the result.',
		].join('\n'),
		readFile: [
			'Reads a text file through Kit FileURI path handling.',
			'Use this for generation-time reads when provider logic needs current source content; discovery outside create() may still use normal Bun APIs.',
		].join('\n'),
		spawn: [
			'Runs a generation-time command as command.* events, or simulates it during dry-run.',
			'Use env.spawn() for side-effecting provider commands such as migration generators so kit generate -n and manifest plan do not run them.',
			'Use kit.spawn() instead for read-only discovery commands that should always execute.',
		].join('\n'),
		exec: [
			'Runs env.spawn() and collects command output into { code, stdout, stderr, events }.',
			'Use this when generation needs command output. In dry-run mode the command is not run, code is 0, and stdout/stderr are empty.',
			'If callers should see the command lifecycle, yield the returned events yourself.',
		].join('\n'),
	})

	return Introspectable.includeInObject(env)
}

function decode(chunks) {
	return new TextDecoder().decode(join(chunks))
}

function join(chunks) {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
	const bytes = new Uint8Array(length)
	let offset = 0

	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}

	return bytes
}
