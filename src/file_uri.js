import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const fileURISchema = Type.String({
	description: 'A file URI, absolute as file:///path/to/file or relative as file:src/file.js',
	pattern: '^file:(?:///.+|[^/].*)$',
})

/**
 * FileURI is a value object for file references used in kit events and plans.
 */
export class FileURI {
	static schema = fileURISchema

	static from(raw) {
		if (raw instanceof FileURI) {
			return raw
		}

		return new FileURI(Value.Parse(FileURI.schema, raw.toString()))
	}

	static fromPath(path) {
		const value = path.toString()

		if (value.startsWith('file:')) {
			return FileURI.from(value)
		}

		if (value.startsWith('/')) {
			return FileURI.from(`file://${value}`)
		}

		return FileURI.from(`file:${value}`)
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
		return FileURI.fromPath([this.path(), ...parts.map((part) => safePathSegment(part))].join('/'))
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
		const path = this.path()
		const index = path.lastIndexOf('/')

		if (index === -1) {
			return FileURI.fromPath('.')
		}

		if (index === 0) {
			return FileURI.fromPath('/')
		}

		return FileURI.fromPath(path.slice(0, index))
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
		const path = this.path()

		if (path === basePath) {
			return ''
		}

		if (!path.startsWith(`${basePath}/`)) {
			throw new Error(`${this} is not relative to ${base}`)
		}

		return path.slice(`${basePath}/`.length)
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
		if (this.value.startsWith('file://')) {
			return new URL(this.value).pathname
		}

		return this.value.slice('file:'.length)
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

	if (value === '' || value.startsWith('/') || value.startsWith('file:') || value.includes('://')) {
		throw new Error(`Invalid relative path segment: ${value}`)
	}

	if (value.split('/').some((segment) => segment === '..')) {
		throw new Error(`Path segment cannot traverse upward: ${value}`)
	}

	return value
}
