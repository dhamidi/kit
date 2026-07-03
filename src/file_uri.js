import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const fileURISchema = Type.String({
	description: 'An absolute file URL such as file:///path/to/file',
	pattern: '^file://.+',
})

/**
 * FileURI is a value object for file references used in kit events and plans.
 *
 * It keeps file references serialized as absolute `file://` URLs while letting
 * callers use native filesystem paths at the boundary. Relative paths are
 * resolved from the current working directory before serialization, and all
 * absolute paths round-trip through `node:url` so POSIX paths, Windows
 * drive-letter paths, and UNC paths use the same platform rules as the runtime.
 *
 * @example
 * const uri = FileURI.fromPath('/workspace/kit/src/main.js')
 * console.log(uri.toString())
 * console.log(uri.path())
 */
export class FileURI {
	static schema = fileURISchema

	/**
	 * Parses an existing absolute file URL or returns the given FileURI unchanged.
	 *
	 * @example
	 * FileURI.from('file:///workspace/kit/src/main.js').path()
	 */
	static from(raw) {
		if (raw instanceof FileURI) {
			return raw
		}

		return new FileURI(Value.Parse(FileURI.schema, raw.toString()))
	}

	/**
	 * Converts a native path or existing file URI into a FileURI.
	 *
	 * Relative paths resolve against `process.cwd()`. Absolute paths are delegated
	 * to `pathToFileURL`, which handles platform-specific roots, drive letters,
	 * spaces, and other characters that must be escaped in URLs.
	 *
	 * @example
	 * FileURI.fromPath('src/main.js').toString()
	 */
	static fromPath(nativePath) {
		const value = nativePath.toString()

		if (value.startsWith('file:')) {
			return FileURI.from(value)
		}

		return FileURI.from(pathToFileURL(path.resolve(value)).toString())
	}

	/**
	 * Returns a new file URI with relative path segments appended.
	 *
	 * Parts are raw relative path segments, not FileURI values. Absolute parts
	 * and traversal segments are rejected so callers cannot escape the base URI.
	 *
	 * @example
	 * FileURI.fromPath('/tmp').join('kit', 'plan').path()
	 */
	join(...parts) {
		return FileURI.fromPath(path.join(this.path(), ...parts.map((part) => safePathSegment(part))))
	}

	/**
	 * Returns the containing directory as a file URI.
	 *
	 * Root paths return themselves. Relative single-segment paths have `.` as
	 * their parent.
	 *
	 * @example
	 * FileURI.fromPath('/tmp/kit/plan.json').parent().path()
	 */
	parent() {
		const nativePath = this.path()
		const parentPath = path.dirname(nativePath)

		if (parentPath === nativePath) {
			return this
		}

		if (parentPath === '.') {
			return FileURI.fromPath('.')
		}

		return FileURI.fromPath(parentPath)
	}

	/**
	 * Returns this URI path relative to another file URI.
	 *
	 * Throws when this URI is not contained by the base URI. The return value is
	 * a relative path string because StateStore keys are relative names, not file
	 * locations.
	 *
	 * @example
	 * FileURI.fromPath('/tmp/kit/plan/a').relativeTo(FileURI.fromPath('/tmp/kit'))
	 */
	relativeTo(base) {
		const basePath = FileURI.from(base).path()
		const nativePath = this.path()

		if (nativePath === basePath) {
			return ''
		}

		const relativePath = path.relative(basePath, nativePath)

		if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			throw new Error(`${this} is not relative to ${base}`)
		}

		return normalizeRelativePath(relativePath)
	}

	/**
	 * Returns a new file URI with a suffix appended.
	 *
	 * The extension must include its leading dot. The suffix is appended even
	 * when the path already ends with the same extension.
	 *
	 * @example
	 * FileURI.fromPath('/tmp/kit/plan/a').withExtension('.json').path()
	 */
	withExtension(extension) {
		if (!extension.startsWith('.')) {
			throw new Error(`Extension must start with '.': ${extension}`)
		}

		return FileURI.fromPath(`${this.path()}${extension}`)
	}

	/**
	 * Returns a new file URI with the given extension removed when present.
	 *
	 * The extension must include its leading dot. Matching is case-sensitive. If
	 * the extension is not present, this FileURI is returned unchanged.
	 *
	 * @example
	 * FileURI.fromPath('/tmp/kit/plan/a.json').withoutExtension('.json').path()
	 */
	withoutExtension(extension) {
		if (!extension.startsWith('.')) {
			throw new Error(`Extension must start with '.': ${extension}`)
		}

		const path = this.path()

		if (!path.endsWith(extension)) {
			return this
		}

		return FileURI.fromPath(path.slice(0, -extension.length))
	}

	path() {
		return fileURLToPath(this.value)
	}

	constructor(value) {
		this.value = value
	}

	toString() {
		return this.value
	}

	toJSON() {
		return this.toString()
	}
}

function safePathSegment(part) {
	const value = part.toString()

	if (value === '' || path.isAbsolute(value) || value.startsWith('file:') || value.includes('://')) {
		throw new Error(`Invalid relative path segment: ${value}`)
	}

	if (value.split(/[\\/]/).some((segment) => segment === '..')) {
		throw new Error(`Path segment cannot traverse upward: ${value}`)
	}

	return value
}

function normalizeRelativePath(value) {
	return path.normalize(value).split(path.sep).join('/')
}
