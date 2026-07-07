import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { inspect } from 'node:util'
import vm from 'node:vm'

const AsyncFunction = (async () => {}).constructor

/** Thirty minutes in milliseconds, the default idle lifetime for spawned REPL servers. */
export const REPL_IDLE_TIMEOUT_MS = 30 * 60 * 1000

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

/**
 * Returns the file used to store interactive Kit REPL history for this workspace.
 *
 * @example
 * replHistoryFile()
 */
export function replHistoryFile() {
	return path.join(replStateDirectory(), `history-${replWorkspaceID()}`)
}

function replWorkspaceID() {
	return createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12)
}

/**
 * Starts a small Unix-socket REPL server with per-session contexts.
 * Set `idleTimeoutMs` to expire the server after a quiet period; every
 * incoming command resets the timer.
 *
 * @example
 * startRepl(() => ({ kit }))
 */
export function startRepl(createContext = () => ({}), socketPath = replSocketPath(), options = {}) {
	fs.mkdirSync(path.dirname(socketPath), { recursive: true })

	const sessions = new Map()
	let idleTimer
	const idleTimeoutMs = options.idleTimeoutMs ?? null
	const expireOnIdle = () => {
		server.close()
		fs.rmSync(socketPath, { force: true })
		process.exit(0)
	}
	const keepAlive = () => {
		if (idleTimeoutMs === null) {
			return
		}

		clearTimeout(idleTimer)
		idleTimer = setTimeout(expireOnIdle, idleTimeoutMs)
	}
	const api = {
		new() {
			const id = randomUUID().slice(0, 8)
			const ctx = typeof createContext === 'function' ? createContext() : { ...createContext }
			ctx.repl = api
			sessions.set(id, { ctx, context: vm.createContext(ctx), transcript: [] })

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

			const { output, source } = await evaluate(session, code)
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

		complete(id, line) {
			const session = sessions.get(id)

			if (session === undefined) {
				throw new Error(`no session ${id}`)
			}

			return JSON.stringify(completionCandidates(session, line))
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
		keepAlive()

		let buffer = ''
		let timer
		let responded = false

		socket.on('data', (chunk) => {
			keepAlive()
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
	keepAlive()
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
		'  doc()                     documentation string when one is registered',
		'  documentation()           alias for doc()',
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
		'Schema argv helpers:',
		'  kit.parseSchemaArgs(schema, argv).values       TypeBox schema + argv -> values',
		'  kit.argvFromSchemaValues(schema, values)       TypeBox schema + values -> argv',
		'  Arrays use zero-based dotted indexes, e.g. --items.0.name value',
		'',
		'Examples, using `kit` as a placeholder for however you invoke Kit:',
		'  kit repl --interactive',
		"  kit repl do 'kit.methods().map(method => method.signature())'",
		'  kit repl do \'kit.method("spawn").source()\'',
		"  kit repl do 'kit.ManifestRunner.instanceMethods().map(String)'",
		'  kit repl do \'kit.parseManifest(`kit-event event { family provider }`)\'',
		'  kit repl do \'kit.argvFromSchemaValues(kit.Type.Object({ tags: kit.Type.Array(kit.Type.String()) }), { tags: ["one"] })\'',
		"  kit repl do 'env.methods().map(method => method.signature())'",
		'  kit repl do \'await Promise.resolve(kit.method("spawn").signature())\'',
		'',
		'Use `kit repl transcript` to review this session.',
		'',
	].join('\n')
}

async function evaluate(session, code) {
	const source = String(code)
	const logs = []
	const hadConsole = Object.hasOwn(session.ctx, 'console')
	const originalConsole = session.ctx.console
	const console = { ...globalThis.console }
	console.log = (...args) => {
		logs.push(args.map((value) => (typeof value === 'string' ? value : inspect(value))).join(' '))
	}
	session.ctx.console = console

	try {
		const value = await evaluateInContext(source, session.context)
		return { output: `${logOutput(logs)}=> ${inspect(value, { depth: 6 })}`, source }
	} catch (error) {
		return { output: `${logOutput(logs)}! ${error.stack ?? String(error)}`, source }
	} finally {
		if (hadConsole) {
			session.ctx.console = originalConsole
		} else {
			delete session.ctx.console
		}
	}
}

function evaluateInContext(source, context) {
	try {
		return vm.runInContext(source, context)
	} catch (error) {
		if (error.name === 'SyntaxError' && usesTopLevelAwait(source)) {
			return vm.runInContext(`(async () => (${source}))()`, context)
		}

		throw error
	}
}

function usesTopLevelAwait(source) {
	return /\bawait\b/.test(source)
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

function completionCandidates(session, line) {
	const ctx = session.ctx
	const token = completionToken(line)

	if (token === '') {
		return []
	}

	const method = token.match(/^kit\.method\((["'])([^"']+)\1\)\.([A-Za-z_$][\w$]*)?$/)

	if (method !== null) {
		const prefix = method[3] ?? ''
		return propertyCompletions(`kit.method(${method[1]}${method[2]}${method[1]}).`, ctx.kit?.method(method[2]), prefix)
	}

	const parts = token.split('.')

	if (parts.length === 1) {
		return Object.keys(ctx).filter((name) => name.startsWith(token)).sort()
	}

	const propertyPrefix = parts.at(-1) ?? ''
	const owner = resolvePath(ctx, parts.slice(0, -1))

	if (owner === undefined || owner === null) {
		return []
	}

	return propertyCompletions(`${parts.slice(0, -1).join('.')}.`, owner, propertyPrefix)
}

function completionToken(line) {
	return line.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$|kit\.method\(["'][^"']+["']\)\.[A-Za-z_$]*$/)?.[0] ?? ''
}

function resolvePath(ctx, parts) {
	let value = ctx[parts[0]]

	for (const part of parts.slice(1)) {
		value = value?.[part]
	}

	return value
}

function propertyCompletions(base, value, prefix) {
	return propertyNames(value)
		.filter((name) => name.startsWith(prefix))
		.sort()
		.map((name) => `${base}${name}`)
}

function propertyNames(value) {
	if (value === undefined || value === null) {
		return []
	}

	const names = new Set()
	let object = Object(value)

	while (object !== null) {
		for (const name of Object.getOwnPropertyNames(object)) {
			if (!name.startsWith('_')) {
				names.add(name)
			}
		}

		object = Object.getPrototypeOf(object)
	}

	if (typeof value?.methods === 'function') {
		for (const method of value.methods()) {
			names.add(String(method))
		}
	}

	return [...names]
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
