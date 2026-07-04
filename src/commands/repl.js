import fs from 'node:fs'
import { createInterface } from 'node:readline'
import { defineCommand, UserError } from '../cli.js'
import { kit } from '../index.js'
import {
	replHistoryFile,
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

		if (command === '--interactive' || command === '-i') {
			return interactive(args)
		}

		switch (command) {
			case 'serve':
				return serve()
			case 'new':
				return newSession()
			case 'interactive':
				return interactive(args)
			case 'do':
				return evalInSession(args)
			case 'transcript':
				return transcript(args)
			case 'ls':
				return listSessions()
			case 'stop':
				return stop()
			default:
				throw new UserError('usage: kit repl <new|interactive|do|transcript|ls|stop> [session] [code]')
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

	return evalCode(id, code)
}

async function interactive(args) {
	await ensureServer()
	let id = args[0]?.length === 8 ? args[0] : await currentSessionOrNew()
	let buffer = []
	let closed = false

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: primaryPrompt(id),
		completer: completeInSession(() => id),
	})

	loadHistory(rl)
	console.log(`Kit REPL session ${id}. Type .help for help, .exit to quit.`)
	rl.prompt()
	let pending = Promise.resolve()

	rl.on('line', (line) => {
		rl.pause()
		pending = pending
			.then(() => processInteractiveLine(line))
			.catch((error) => {
				console.error(error.message ?? String(error))
			})
			.finally(() => {
				if (!closed) {
					rl.resume()
					rl.setPrompt(buffer.length === 0 ? primaryPrompt(id) : continuationPrompt(id))
					rl.prompt()
				}
			})
	})

	async function processInteractiveLine(line) {
		if (buffer.length === 0 && line.trimStart().startsWith('.')) {
			id = await handleDotCommand(line.trim(), id, rl)
			return
		}

		const done = await handleInputLine(line, buffer, id)

		if (done) {
			buffer = []
		}
	}

	rl.on('SIGINT', () => {
		if (buffer.length > 0 || rl.line.length > 0) {
			buffer = []
			rl.write(null, { ctrl: true, name: 'u' })
			rl.setPrompt(primaryPrompt(id))
			rl.prompt()
			return
		}

		console.log('Use .exit to quit or Ctrl+D.')
		rl.prompt()
	})

	rl.on('close', () => {
		closed = true
	})

	await new Promise((resolve) => rl.on('close', resolve))
	await pending
}

async function handleInputLine(line, buffer, id) {
	const continued = line.endsWith('\\')
	buffer.push(continued ? line.slice(0, -1) : line)
	const code = buffer.join('\n')

	if (continued || !isComplete(code)) {
		return false
	}

	recordHistory(code)
	const output = await evalCode(id, code)
	writeReplOutput(output)
	return true
}

async function handleDotCommand(command, id, rl) {
	if (command === '.help') {
		console.log(interactiveHelp())
		return id
	}

	if (command === '.exit') {
		rl.close()
		return id
	}

	if (command === '.clear') {
		process.stdout.write('\x1bc')
		return id
	}

	if (command === '.session') {
		console.log(id)
		return id
	}

	if (command === '.new') {
		const response = await newSession()
		const next = response.split('\n')[0]
		console.log(response.trimEnd())
		return next
	}

	if (command === '.ls') {
		writeReplOutput(await listSessions())
		return id
	}

	if (command === '.transcript') {
		writeReplOutput(await transcript([id]))
		return id
	}

	if (command === '.reload') {
		console.log(await stop())
		await Bun.sleep(50)
		await ensureServer()
		const response = await newSession()
		const next = response.split('\n')[0]
		console.log(response.trimEnd())
		return next
	}

	console.log(`Unknown REPL command: ${command}`)
	return id
}

async function currentSessionOrNew() {
	try {
		const id = currentSession()
		const sessions = await listSessions()

		if (sessions.split('\n').map((session) => session.trim()).includes(id)) {
			return id
		}
	} catch (error) {
		if (error instanceof UserError === false) {
			throw error
		}
	}

	const response = await newSession()
	return response.split('\n')[0]
}

async function transcript(args) {
	await ensureServer()
	return sendReplExpression(`repl.transcript(${JSON.stringify(args[0] ?? currentSession())})`)
}

async function listSessions() {
	await ensureServer()
	return sendReplExpression('repl.ls()')
}

async function stop() {
	try {
		await sendReplExpression('repl.stop()')
	} catch {
		return 'Kit REPL server is not running.'
	}

	try {
		fs.rmSync(replSocketPath(), { force: true })
	} catch {}

	return 'Kit REPL server stopped.'
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

	const child = Bun.spawn(replServerCommand(), {
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

function replServerCommand() {
	if (isStandaloneExecutable()) {
		return [process.execPath, 'repl', 'serve']
	}

	return [process.execPath, process.argv[1], 'repl', 'serve']
}

function isStandaloneExecutable() {
	return Bun.isStandaloneExecutable === true || process.argv[1]?.startsWith('/$bunfs/')
}

function evalCode(id, code) {
	return sendReplExpression(replDoExpression(id, code))
}

function replDoExpression(id, code) {
	return `repl.do(${JSON.stringify(id)}, ${JSON.stringify(code)})`
}

function primaryPrompt(id) {
	return `kit[${id}]> `
}

function continuationPrompt(id) {
	return `${'.'.repeat(`kit[${id}]`.length)}> `
}

function writeReplOutput(output) {
	const text = output.trimEnd()

	if (text !== '') {
		console.log(text)
	}
}

function isComplete(code) {
	try {
		new AsyncFunction(code)
		return true
	} catch (error) {
		return !isIncompleteSyntax(error)
	}
}

function isIncompleteSyntax(error) {
	return /unexpected end|missing \)|missing \}|unterminated/i.test(error.message ?? '')
}

function loadHistory(rl) {
	try {
		rl.history = readHistory().reverse()
	} catch {}
}

function recordHistory(code) {
	const entry = code.trimEnd()

	if (entry === '') {
		return
	}

	fs.mkdirSync(replStateDirectory(), { recursive: true })
	const history = readHistory().filter((item) => item !== entry)
	history.push(entry)
	fs.writeFileSync(
		replHistoryFile(),
		history.slice(-1000).map((item) => JSON.stringify(item)).join('\n') + '\n',
	)
}

function readHistory() {
	try {
		return fs.readFileSync(replHistoryFile(), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line)
				} catch {
					return line
				}
			})
	} catch {
		return []
	}
}

function completeInSession(currentID) {
	return (line, callback) => {
		const token = completionToken(line)

		sendReplExpression(`repl.complete(${JSON.stringify(currentID())}, ${JSON.stringify(line)})`)
			.then((response) => callback(null, [JSON.parse(response), token]))
			.catch(() => callback(null, [[], token]))
	}
}

function completionToken(line) {
	return line.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$|kit\.method\(["'][^"']+["']\)\.[A-Za-z_$]*$/)?.[0] ?? ''
}

function interactiveHelp() {
	return [
		'Kit interactive REPL commands:',
		'  .help        Show this help',
		'  .exit        Close this client; the REPL server keeps running',
		'  .clear       Clear the terminal',
		'  .session     Print the current session id',
		'  .new         Create and switch to a new session',
		'  .ls          List server sessions',
		'  .transcript  Show the current session transcript',
		'  .reload      Restart the REPL server and create a new session',
		'',
		'JavaScript expressions and statements run in the persistent session context.',
		'Available objects include kit, env, and repl. Top-level await is supported.',
	].join('\n')
}
