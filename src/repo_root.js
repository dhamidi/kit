import { FileURI } from './file_uri.js'
import { spawn } from './spawn.js'

/**
 * Returns the current Git repository root as a FileURI.
 *
 * @example
 * const root = await repoRoot()
 * console.log(root.toString())
 */
export async function repoRoot(cwd = process.cwd()) {
	const chunks = []

	for await (const event of spawn(['git', 'rev-parse', '--show-toplevel'], { cwd })) {
		const value = event.toJSON()

		if (value.type === 'command.output' && value.stream === 'stdout') {
			chunks.push(value.bytes)
		}

		if (value.type === 'command.exited' && value.code !== 0) {
			throw new Error(`git rev-parse --show-toplevel exited with code ${value.code}`)
		}
	}

	return FileURI.fromPath(new TextDecoder().decode(join(chunks)).trim())
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
