import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { inspect } from 'node:util'

const AsyncFunction = (async () => {}).constructor

/**
 * Returns Kit's REPL state directory under XDG_CACHE_DIR or $HOME/.cache.
 *
 * @example
 * replStateDirectory()
 */
export function replStateDirectory() {
	const cache = process.env.XDG_CACHE_DIR ?? path.join(process.env.HOME ?? '.', '.cache')
	return path.join(cache, 'kit')
}

/**
 * Returns the Unix socket path used by the Kit REPL server.
 *
 * @example
 * replSocketPath()
 */
export function replSocketPath() {
	return process.env.REPL_SOCK ?? path.join(replStateDirectory(), `repl-${replWorkspaceID()}.sock`)
}

/**
 * Returns the file used to remember the current Kit REPL session.
 *
 * @example
 * replSessionFile()
 */
export function replSessionFile() {
	return path.join(replStateDirectory(), `session-${replWorkspaceID()}`)
}

function replWorkspaceID() {
	return createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12)
}

/**
 * Starts a small Unix-socket REPL server with per-session contexts.
 *
 * @example
 * startRepl(() => ({ kit }))
 */
export function startRepl(createContext = () => ({}), socketPath = replSocketPath()) {
	fs.mkdirSync(path.dirname(socketPath), { recursive: true })

	const sessions = new Map()
	const api = {
		new() {
			const id = randomUUID().slice(0, 8)
			const ctx = typeof createContext === 'function' ? createContext() : { ...createContext }
			ctx.repl = api
			sessions.set(id, { ctx, transcript: [] })

			return welcomeMessage(id, ctx)
		},

		ls() {
			return [...sessions.keys()].join('\n')
		},

		async do(id, code) {
			const session = sessions.get(id)

			if (session === undefined) {
				throw new Error(`no session ${id}`)
			}

			const { output, source } = await evaluate(session.ctx, code)
			session.transcript.push({ source, output })

			return output
		},

		transcript(id) {
			const session = sessions.get(id)

			if (session === undefined) {
				throw new Error(`no session ${id}`)
			}

			return session.transcript
				.map(({ source, output }) => `${promptedCode(source)}\n${output}`)
				.join('\n\n')
		},

		stop() {
			setTimeout(() => {
				server.close()
				process.exit(0)
			}, 20)

			return 'stopped'
		},
	}

	const server = net.createServer((socket) => {
		let buffer = ''
		let timer
		let responded = false

		socket.on('data', (chunk) => {
			buffer += chunk
			clearTimeout(timer)
			timer = setTimeout(respond, 5)
		})

		socket.on('end', respond)

		async function respond() {
			if (responded) {
				return
			}

			responded = true
			clearTimeout(timer)

			try {
				const result = await replEvaluatorFor(buffer)(api)
				socket.write(`${String(result ?? '')}\n`)
			} catch (error) {
				socket.write(`! ${error.stack ?? String(error)}\n`)
			}

			socket.end()
		}
	})

	server.listen(socketPath)
	return server
}

function replEvaluatorFor(source) {
	try {
		return new AsyncFunction('repl', `return (${source})`)
	} catch {
		return new AsyncFunction('repl', source)
	}
}

function welcomeMessage(id, ctx) {
	return [
		id,
		'',
		'Kit JavaScript REPL session started.',
		'Evaluate JavaScript expressions or statements. `await` is supported.',
		'',
		'Available objects:',
		...Object.keys(ctx)
			.sort()
			.map((name) => `  ${name}`),
		'',
		'Introspectable object API:',
		'  methods()                 list callable methods',
		'  method(name)              get one method by name',
		'  respondsTo(name)          test whether a method exists',
		'',
		'Introspectable Method API:',
		'  name                      method name',
		'  signature()               method name and parameter names',
		'  parameterNames()          parameter names parsed from source',
		'  source()                  JavaScript source from Function#toString()',
		'  function                  original function object',
		'  owner                     object where the method was discovered',
		'  toString()                method name',
		'',
		'Manifest APIs:',
		'  kit.parseManifest(source)                 parse TCL-ish manifest syntax',
		'  new kit.ManifestResolver(providers)       resolve syntax to provider specs',
		'  new kit.ManifestRunner({ providers })     validate and run resolved specs',
		'  kit.ManifestVocabulary.from(providers)    inspect live manifest vocabulary',
		'',
		'Manifest CLI:',
		'  kit manifest vocabulary          print valid provider-backed examples',
		'  kit manifest check <file|->      validate without running providers',
		'  kit manifest plan <file|->       preview provider effects',
		'  kit manifest apply <file|->      invoke providers sequentially',
		'',
		'Examples, using `kit` as a placeholder for however you invoke Kit:',
		"  kit repl do 'kit.methods().map(method => method.signature())'",
		'  kit repl do \'kit.method("spawn").source()\'',
		"  kit repl do 'kit.ManifestRunner.instanceMethods().map(String)'",
		'  kit repl do \'kit.parseManifest(`kit-event event { family provider }`)\'',
		"  kit repl do 'env.methods().map(method => method.signature())'",
		'  kit repl do \'await Promise.resolve(kit.method("spawn").signature())\'',
		'',
		'Use `kit repl transcript` to review this session.',
		'',
	].join('\n')
}

async function evaluate(ctx, code) {
	const { fn, source } = evaluatorFor(code)
	const logs = []
	const originalLog = console.log
	console.log = (...args) => {
		logs.push(args.map((value) => (typeof value === 'string' ? value : inspect(value))).join(' '))
	}

	try {
		const value = await fn(ctx)
		return { output: `${logOutput(logs)}=> ${inspect(value, { depth: 6 })}`, source }
	} catch (error) {
		return { output: `${logOutput(logs)}! ${error.stack ?? String(error)}`, source }
	} finally {
		console.log = originalLog
	}
}

function evaluatorFor(code) {
	if (typeof code === 'function') {
		return { fn: code, source: code.toString() }
	}

	const source = String(code)

	try {
		return { fn: new AsyncFunction('ctx', `with (ctx) { return (${source}) }`), source }
	} catch {
		return { fn: new AsyncFunction('ctx', `with (ctx) { ${source} }`), source }
	}
}

function logOutput(logs) {
	return logs.length === 0 ? '' : `${logs.join('\n')}\n`
}

function promptedCode(code) {
	return code
		.trimEnd()
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n')
}

/**
 * Sends JavaScript to a Kit REPL server with `repl` in scope.
 *
 * @example
 * await sendReplExpression('repl.ls()')
 */
export function sendReplExpression(source, socketPath = replSocketPath()) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(socketPath)
		let output = ''

		socket.on('connect', () => {
			socket.write(source)
		})

		socket.on('data', (chunk) => {
			output += chunk
		})

		socket.on('end', () => {
			resolve(output)
		})

		socket.on('error', reject)
	})
}
