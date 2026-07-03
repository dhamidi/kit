import fs from 'node:fs'
import { defineCommand, UserError } from '../cli.js'
import { kit } from '../index.js'
import {
	replSessionFile,
	replSocketPath,
	replStateDirectory,
	sendReplExpression,
	startRepl,
} from '../repl.js'

const AsyncFunction = (async () => {}).constructor

/**
 * Command for inspecting the live Kit API through a persistent async REPL.
 *
 * @example
 * await createCLI([repl]).run(['repl', 'new'])
 */
export default defineCommand({
	name: 'repl',
	description: 'Inspect Kit runtime APIs through a persistent async REPL',
	strict: false,
	async run({ argv }) {
		const [command, ...args] = argv

		switch (command) {
			case 'serve':
				return serve()
			case 'new':
				return newSession()
			case 'do':
				return evalInSession(args)
			case 'transcript':
				return transcript(args)
			case 'ls':
				return listSessions()
			case 'raw':
				return evalRaw(args)
			default:
				throw new UserError('usage: kit repl <new|do|transcript|ls|raw> [session] [code]')
		}
	},
})

async function serve() {
	startRepl(
		() => ({
			env: kit.createFileEnv(),
			kit,
		}),
		replSocketPath(),
	)

	await new Promise(() => {})
}

async function newSession() {
	await ensureServer()
	const response = await sendReplExpression('repl.new()')
	const id = response.split('\n')[0]
	fs.writeFileSync(replSessionFile(), id)

	return response.trimEnd()
}

async function evalInSession(args) {
	await ensureServer()
	const next = [...args]
	const id = next[0]?.length === 8 ? next.shift() : currentSession()
	const code = next.length === 0 ? fs.readFileSync(0, 'utf8') : next.join(' ')

	return sendReplExpression(`repl.do(${JSON.stringify(id)}, async (ctx) => { with (ctx) {
${wrap(code)}
} })`)
}

async function transcript(args) {
	await ensureServer()
	return sendReplExpression(`repl.transcript(${JSON.stringify(args[0] ?? currentSession())})`)
}

async function listSessions() {
	await ensureServer()
	return sendReplExpression('repl.ls()')
}

async function evalRaw(args) {
	await ensureServer()
	const source = args.length === 0 ? fs.readFileSync(0, 'utf8') : args.join(' ')

	return sendReplExpression(source)
}

function currentSession() {
	try {
		return fs.readFileSync(replSessionFile(), 'utf8').trim()
	} catch {
		throw new UserError('no session — run: kit repl new')
	}
}

async function ensureServer() {
	try {
		await sendReplExpression('repl.ls()')
		return
	} catch {}

	fs.mkdirSync(replStateDirectory(), { recursive: true })

	try {
		fs.rmSync(replSocketPath(), { force: true })
	} catch {}

	const child = Bun.spawn([process.execPath, process.argv[1], 'repl', 'serve'], {
		cwd: process.cwd(),
		env: process.env,
		stderr: 'ignore',
		stdin: 'ignore',
		stdout: 'ignore',
	})

	child.unref()

	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			await sendReplExpression('repl.ls()')
			return
		} catch {
			await Bun.sleep(50)
		}
	}

	throw new Error('Timed out waiting for Kit REPL server to start')
}

function wrap(body) {
	const lines = body.trimEnd().split('\n')
	const last = lines.pop()

	try {
		new AsyncFunction(`return (${last})`)
		lines.push(`return (${last})`)
	} catch {
		lines.push(last)
	}

	return lines.join('\n')
}
