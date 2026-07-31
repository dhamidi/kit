import { watch } from 'node:fs'
import { basename } from 'node:path'
import React from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { CodebaseBrowser } from './codebase_browser.js'
import {
	Browser,
	BrowserError,
	Document,
	GenerationResult,
	KitBrowser as KitBrowserComponent,
	KitDocument,
	LiveStatus,
} from './components.jsx'
import { KitBrowser } from './kit_browser.js'

const uiStyles = Bun.file(new URL('./ui.css', import.meta.url))
const datastar = Bun.file(new URL('../assets/datastar-1.0.2.js', import.meta.url))

/**
 * Starts the Bun HTTP server that hosts Kit's codebase browser.
 *
 * @example
 * const server = startUIServer({ root: FileURI.fromPath('.'), port: 3000 })
 */
export function startUIServer({ root, hostname = '127.0.0.1', port = 3000, allowWrites = false }) {
	const browser = new CodebaseBrowser(root, { allowWrites })
	const kitBrowser = new KitBrowser({ cwd: root.path(), allowWrites })
	const rootName = basename(root.path()) || root.path()

	return Bun.serve({
		hostname,
		port,
		async fetch(request, server) {
			const url = new URL(request.url)

			if (request.method === 'POST' && url.pathname === '/generate') {
				if (request.headers.get('Datastar-Request') !== 'true') {
					return new Response('Datastar request required', { status: 403 })
				}

				return generationResponse(kitBrowser, request, url.searchParams)
			}

			if (request.method === 'POST' && url.pathname === '/source/edit') {
				if (request.headers.get('Datastar-Request') !== 'true') {
					return new Response('Datastar request required', { status: 403 })
				}

				return sourceEditResponse(browser, request)
			}

			if (request.method !== 'GET') {
				return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
			}

			switch (url.pathname) {
				case '/':
					return documentResponse(React.createElement(KitDocument, {
						model: await kitBrowser.snapshot(url.searchParams),
						rootName,
					}))
				case '/files':
					return documentResponse(React.createElement(Document, {
						model: await browser.snapshot(url.searchParams),
					}))
				case '/kit':
					return kitBrowserResponse(kitBrowser, url.searchParams)
				case '/browse':
					return browserResponse(browser, url.searchParams)
				case '/events':
					server.timeout(request, 0)
					return changesResponse(root)
				case '/assets/ui.css':
					return new Response(uiStyles, { headers: styleHeaders() })
				case '/assets/datastar.js':
					return new Response(datastar, { headers: assetHeaders('text/javascript; charset=utf-8') })
				default:
					return new Response('Not found', { status: 404 })
			}
		},
	})
}

async function documentResponse(element) {
	const stream = await renderToReadableStream(element, {
		bootstrapModules: ['/assets/datastar.js'],
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	})
}

async function kitBrowserResponse(browser, searchParams) {
	try {
		const model = await browser.snapshot(searchParams)
		return datastarResponse(React.createElement(KitBrowserComponent, { model }))
	} catch (error) {
		return datastarResponse(React.createElement(BrowserError, { message: error.message }))
	}
}

async function generationResponse(browser, request, searchParams) {
	try {
		const result = await browser.generate({
			providerName: searchParams.get('provider'),
			typeID: searchParams.get('type'),
			formData: await request.formData(),
			dryRun: searchParams.get('dryRun') === 'true',
		})
		return datastarResponse(React.createElement(GenerationResult, { result }))
	} catch (error) {
		return datastarResponse(React.createElement(GenerationResult, { error: error.message }))
	}
}

async function browserResponse(browser, searchParams) {
	try {
		const model = await browser.snapshot(searchParams)
		return datastarResponse(React.createElement(Browser, { model }))
	} catch (error) {
		return datastarResponse(React.createElement(BrowserError, { message: error.message }))
	}
}

async function sourceEditResponse(browser, request) {
	const formData = await request.formData()
	const searchParams = new URLSearchParams({
		dir: field(formData, 'dir'),
		file: field(formData, 'file'),
		query: field(formData, 'query'),
		symbol: field(formData, 'symbol'),
	})

	try {
		await browser.editSource({
			relativePath: field(formData, 'file'),
			expectedHash: field(formData, 'expectedHash'),
			symbolKey: field(formData, 'symbol'),
			replacement: field(formData, 'replacement'),
		})
		return datastarResponse(React.createElement(Browser, { model: await browser.snapshot(searchParams) }))
	} catch (error) {
		try {
			const model = await browser.snapshot(searchParams)
			if (model.source !== undefined) model.source.editError = error.message
			return datastarResponse(React.createElement(Browser, { model }))
		} catch {
			return datastarResponse(React.createElement(BrowserError, { message: error.message }))
		}
	}
}

function field(formData, name) {
	const value = formData.get(name)
	if (typeof value !== 'string') throw new Error(`${name} is required`)
	return value
}

function changesResponse(root) {
	let watcher
	let closed = false
	const stream = new ReadableStream({
		async start(controller) {
			controller.enqueue(await patchEvent(React.createElement(LiveStatus, {
				message: 'Watching for changes',
				state: 'connected',
			})))

			watcher = watch(root.path(), { recursive: true }, async (_event, filename) => {
				if (closed) return

				const message = filename === null
					? `Codebase changed · ${new Date().toLocaleTimeString()}`
					: `${filename} changed · ${new Date().toLocaleTimeString()}`

				try {
					controller.enqueue(await patchEvent(React.createElement(LiveStatus, { message, state: 'changed' })))
				} catch {
					closed = true
					watcher.close()
				}
			})
			watcher.on('error', async () => {
				if (closed) return
				closed = true
				controller.enqueue(await patchEvent(React.createElement(LiveStatus, {
					message: 'File watching is unavailable',
					state: 'disconnected',
				})))
				controller.close()
			})
		},
		cancel() {
			closed = true
			watcher?.close()
		},
	})

	return new Response(stream, { headers: eventStreamHeaders() })
}

async function datastarResponse(element, status = 200) {
	return new Response(await patchEvent(element), { status, headers: eventStreamHeaders() })
}

async function patchEvent(element) {
	const stream = await renderToReadableStream(element)
	const html = await new Response(stream).text()
	const data = html.split('\n').map((line) => `data: elements ${line}`).join('\n')

	return `event: datastar-patch-elements\n${data}\n\n`
}

function eventStreamHeaders() {
	return {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache',
		'X-Accel-Buffering': 'no',
	}
}

function assetHeaders(contentType) {
	return {
		'Content-Type': contentType,
		'Cache-Control': 'public, max-age=31536000, immutable',
		'X-Content-Type-Options': 'nosniff',
	}
}

function styleHeaders() {
	return {
		'Content-Type': 'text/css; charset=utf-8',
		'Cache-Control': 'no-cache',
		'X-Content-Type-Options': 'nosniff',
	}
}
