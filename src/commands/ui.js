import { stat } from 'node:fs/promises'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { defineCommand, UserError } from '../cli.js'
import { FileURI } from '../file_uri.js'
import { startUIServer } from '../ui/server.js'

const optionsSchema = Type.Object({
	hostname: Type.String({ description: 'Hostname on which the UI server listens', minLength: 1 }),
	port: Type.Integer({ description: 'TCP port on which the UI server listens', minimum: 1, maximum: 65535 }),
})

/**
 * Starts Kit's server-rendered codebase browser.
 *
 * @example
 * await createCLI([ui]).run(['ui', '--port', '3333'])
 */
export default defineCommand({
	name: 'ui',
	description: 'Browse a codebase in a server-rendered web UI',
	options: {
		hostname: {
			type: 'string',
			description: 'Hostname on which to listen',
			default: '127.0.0.1',
		},
		port: { type: 'string', short: 'p', description: 'TCP port on which to listen', default: '3000' },
		'allow-writes': {
			type: 'boolean',
			description: 'Allow creation forms to write deterministic provider output',
		},
	},
	async run({ parsed }) {
		const root = FileURI.fromPath(parsed.positionals[0] ?? process.cwd())

		try {
			if (!(await stat(root.path())).isDirectory()) {
				throw new Error('not a directory')
			}
		} catch {
			throw new UserError(`Cannot browse ${root.path()}: not a directory`)
		}

		let options

		try {
			options = Value.Parse(optionsSchema, {
				hostname: parsed.values.hostname,
				port: Number(parsed.values.port),
			})
		} catch {
			throw new UserError(`Invalid UI address: ${parsed.values.hostname}:${parsed.values.port}`)
		}

		const server = startUIServer({ root, allowWrites: parsed.values['allow-writes'] === true, ...options })
		console.log(`Kit UI browsing ${root.path()} at ${server.url}`)
	},
})
