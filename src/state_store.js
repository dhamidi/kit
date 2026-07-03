import { readdir } from 'node:fs/promises'
import { FileURI } from './file_uri.js'

/**
 * StateStore defines resumable state persistence for plan execution.
 */
export class StateStore {
	async get() {}
	async set() {}
	async delete() {}
	/**
	 * Lists slash-separated state keys stored under an optional key prefix.
	 *
	 * Keys are logical names like `plan/<id>`, not file paths. Prefix matching
	 * is hierarchical for persistent stores and string-prefix based for ephemeral
	 * stores. Implementations return keys sorted when they have filesystem order.
	 *
	 * @example
	 * await store.list('plan')
	 */
	async list() {}
}

export class EphemeralStateStore extends StateStore {
	constructor(map = new Map()) {
		super()
		this.map = map
	}

	async get(key) {
		return this.map.get(key)
	}

	async set(key, value) {
		this.map.set(key, value)
	}

	async delete(key) {
		this.map.delete(key)
	}

	/**
	 * Lists in-memory keys that begin with the given logical key prefix.
	 *
	 * @example
	 * await new EphemeralStateStore(new Map([['plan/demo', {}]])).list('plan')
	 */
	async list(prefix = '') {
		return Array.from(this.map.keys()).filter((key) => key.startsWith(prefix))
	}
}

/**
 * PersistentStateStore stores JSON state below the Kit cache directory.
 *
 * The root may be a raw path or FileURI. Directories are created lazily on
 * write. State keys must be relative slash-separated names without `..`, and
 * each key maps to one `.json` file below the root.
 */
export class PersistentStateStore extends StateStore {
	constructor(root = defaultStateRoot()) {
		super()
		this.root = FileURI.fromPath(root)
	}

	async get(key) {
		const file = Bun.file(this.file(key).path())

		if (!(await file.exists())) {
			return undefined
		}

		return await file.json()
	}

	async set(key, value) {
		const path = this.file(key)

		await Bun.$`mkdir -p ${path.parent().path()}`
		await Bun.write(path.path(), JSON.stringify(value, null, 2))
	}

	async delete(key) {
		await Bun.$`rm -f ${this.file(key).path()}`
	}

	/**
	 * Lists persisted JSON state keys under an optional logical prefix.
	 *
	 * Returned keys do not include `.json`.
	 *
	 * @example
	 * await new PersistentStateStore().list('plan')
	 */
	async list(prefix = '') {
		const keys = []
		const files = await listJSONFiles(this.root)

		for (const file of files) {
			const key = file.withoutExtension('.json').relativeTo(this.root)

			if (key.startsWith(prefix)) {
				keys.push(key)
			}
		}

		return keys.sort()
	}

	/**
	 * Returns the absolute filesystem path for a state key.
	 *
	 * Prefer `file(key)` inside Kit. This exists for APIs like Bun.file that need
	 * a native filesystem path string.
	 *
	 * @example
	 * new PersistentStateStore('/tmp/kit').path('plan/demo')
	 */
	path(key) {
		return this.file(key).path()
	}

	/**
	 * Returns the file URI for a state key's JSON file.
	 *
	 * The key should not include `.json`; that suffix is added here. Invalid keys
	 * that would escape the store root are rejected.
	 *
	 * @example
	 * new PersistentStateStore('/tmp/kit').file('plan/demo').toString()
	 */
	file(key) {
		return this.root.join(stateKey(key)).withExtension('.json')
	}
}

function stateKey(key) {
	const value = key.toString()

	if (value === '' || value.startsWith('/') || value.endsWith('.json')) {
		throw new Error(`Invalid state key: ${value}`)
	}

	return value
}

async function listJSONFiles(root) {
	let entries

	try {
		entries = await readdir(root.path(), { withFileTypes: true })
	} catch (error) {
		if (error.code === 'ENOENT') {
			return []
		}

		throw error
	}

	const files = []

	for (const entry of entries) {
		const file = root.join(entry.name)

		if (entry.isDirectory()) {
			files.push(...(await listJSONFiles(file)))
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(file)
		}
	}

	return files
}

export function defaultStateRoot() {
	return `${process.env.XDG_CACHE_DIR ?? `${process.env.HOME}/.cache`}/kit`
}
