/**
 * Introspectable adds small Ruby-style runtime method discovery to plain JS
 * objects and classes.
 *
 * @example
 * kit.methods().map(String)
 * kit.method('spawn').parameterNames()
 * kit.method('spawn').source()
 */
export const Introspectable = {
	docSymbol: Symbol.for('kit.introspectable.docs'),

	Method: class {
		#doc
		#fn
		#owner

		constructor({ name, fn, owner, doc }) {
			this.name = name
			this.#doc = doc
			this.#fn = fn
			this.#owner = owner
		}

		get owner() {
			return this.#owner
		}

		get function() {
			return this.#fn
		}

		signature() {
			return `${this.name}(${this.parameterNames().join(', ')})`
		}

		parameterNames() {
			return parameterNamesFrom(this.#fn)
		}

		doc() {
			return this.#doc ?? ''
		}

		documentation() {
			return this.doc()
		}

		source() {
			return this.#fn.toString()
		}

		toString() {
			return this.name
		}

		[Symbol.toPrimitive]() {
			return this.toString()
		}

		[Symbol.for('nodejs.util.inspect.custom')]() {
			return this.toString()
		}
	},

	includeIn(klass) {
		Object.defineProperties(klass, {
			instanceMethods: {
				configurable: true,
				value(options = {}) {
					return methodsFrom(this.prototype, {
						stopAt: instanceStopFor(this),
						includeInherited: options.includeInherited ?? true,
						exclude: helperNamesWith('constructor'),
					})
				},
			},

			staticMethods: {
				configurable: true,
				value(options = {}) {
					return methodsFrom(this, {
						stopAt: staticStopFor(this),
						includeInherited: options.includeInherited ?? true,
						exclude: helperNamesWith('length', 'name', 'prototype'),
					})
				},
			},

			methods: {
				configurable: true,
				value(options = {}) {
					return {
						instance: this.instanceMethods(options),
						static: this.staticMethods(options),
					}
				},
			},
		})

		this.includeInObject(klass.prototype)
		return klass
	},

	document(value, docs) {
		if (typeof docs === 'string') {
			documentFunction(value, docs)
			return value
		}

		if (isClass(value)) {
			documentMethods(value.prototype, docs?.instance)
			documentMethods(value, docs?.static)
			return value
		}

		documentMethods(value, docs?.methods)
		documentMethods(value, docs)

		return value
	},

	includeInObject(object) {
		this.includeClassValuesIn(object)

		Object.defineProperties(object, {
			method: {
				configurable: true,
				value(name, options = {}) {
					const method = Introspectable.methodOf(this, name, options)

					if (method === undefined) {
						throw new Error(`Unknown method: ${name}`)
					}

					return method
				},
			},

			methods: {
				configurable: true,
				value(options = {}) {
					return Introspectable.methodsOf(this, options)
				},
			},

			respondsTo: {
				configurable: true,
				value(name) {
					return Introspectable.methodOf(this, name) !== undefined
				},
			},
		})

		return object
	},

	includeClassValuesIn(object) {
		for (const value of Object.values(object)) {
			if (isClass(value)) {
				this.includeIn(value)
			}
		}
	},

	methodOf(value, name, options = {}) {
		return this.methodsOf(value, options).find((method) => method.name === name)
	},

	methodsOf(value, options = {}) {
		return methodsFrom(value, {
			stopAt: typeof value === 'function' ? Function.prototype : Object.prototype,
			includeInherited: options.includeInherited ?? true,
			exclude: helperNamesWith(),
		})
	},
}

function methodsFrom(start, { stopAt, includeInherited, exclude }) {
	const methods = []
	const seen = new Set()
	let cursor = start

	while (cursor && cursor !== stopAt) {
		for (const name of Reflect.ownKeys(cursor)) {
			if (typeof name !== 'string' || exclude.has(name) || seen.has(name)) {
				continue
			}

			const descriptor = Object.getOwnPropertyDescriptor(cursor, name)
			if (typeof descriptor?.value === 'function') {
				methods.push(
					new Introspectable.Method({
						name,
						fn: descriptor.value,
						owner: cursor,
						doc: docFor(cursor, name, descriptor.value),
					}),
				)
				seen.add(name)
			}
		}

		if (!includeInherited) {
			break
		}

		cursor = Object.getPrototypeOf(cursor)
	}

	return methods.sort((left, right) => left.name.localeCompare(right.name))
}

function helperNamesWith(...names) {
	return new Set(['method', 'methods', 'respondsTo', 'instanceMethods', 'staticMethods', ...names])
}

function isClass(value) {
	return typeof value === 'function' && /^class\s/.test(Function.prototype.toString.call(value))
}

function instanceStopFor(klass) {
	return klass.prototype instanceof Error ? Error.prototype : Object.prototype
}

function staticStopFor(klass) {
	return klass.prototype instanceof Error ? Error : Function.prototype
}

function docFor(owner, name, fn) {
	return functionDoc(fn) ?? ownerDoc(owner, name)
}

function documentMethods(owner, docs) {
	if (docs === undefined) {
		return
	}

	for (const [name, doc] of Object.entries(docs)) {
		if (typeof doc === 'string') {
			documentFunction(owner?.[name], doc)
		}
	}
}

function documentFunction(value, doc) {
	if (typeof value !== 'function') {
		return
	}

	Object.defineProperty(value, Introspectable.docSymbol, {
		configurable: true,
		value: doc,
	})
}

function functionDoc(fn) {
	const docs = docsOf(fn)

	if (typeof docs === 'string') {
		return docs
	}

	return undefined
}

function ownerDoc(owner, name) {
	const docs = docsOf(owner)
	const direct = docAt(docs, name) ?? docAt(docs?.methods, name)

	if (direct !== undefined) {
		return direct
	}

	if (typeof owner === 'function') {
		return docAt(docs?.static, name)
	}

	const classDocs = docsOf(owner?.constructor)
	return docAt(classDocs?.instance, name) ?? docAt(classDocs, name)
}

function docAt(docs, name) {
	const value = docs?.[name]
	return typeof value === 'string' ? value : undefined
}

function docsOf(value) {
	return value?.[Introspectable.docSymbol]
}

function parameterNamesFrom(fn) {
	return splitParameters(parameterSourceFrom(fn.toString())).map(parameterNameFrom).filter(Boolean)
}

function parameterSourceFrom(source) {
	const openParenIndex = source.indexOf('(')
	const bodyIndex = source.indexOf('{')
	const arrowIndex = source.indexOf('=>')

	if (openParenIndex !== -1 && (bodyIndex === -1 || openParenIndex < bodyIndex)) {
		return source.slice(openParenIndex + 1, matchingParenIndex(source, openParenIndex))
	}

	if (arrowIndex !== -1 && (bodyIndex === -1 || arrowIndex < bodyIndex)) {
		return source
			.slice(0, arrowIndex)
			.trim()
			.replace(/^\(?\s*/, '')
			.replace(/\s*\)?$/, '')
	}

	return ''
}

function matchingParenIndex(source, openParenIndex) {
	let depth = 0

	for (let index = openParenIndex; index < source.length; index += 1) {
		if (source[index] === '(') {
			depth += 1
		} else if (source[index] === ')') {
			depth -= 1

			if (depth === 0) {
				return index
			}
		}
	}

	return source.length
}

function splitParameters(source) {
	const parameters = []
	let depth = 0
	let start = 0

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index]

		if ('([{'.includes(character)) {
			depth += 1
		} else if (')]}'.includes(character)) {
			depth -= 1
		} else if (character === ',' && depth === 0) {
			parameters.push(source.slice(start, index))
			start = index + 1
		}
	}

	parameters.push(source.slice(start))
	return parameters
}

function parameterNameFrom(parameter) {
	return removeDefaultValue(parameter)
		.trim()
		.replace(/^\.\.\./, '')
		.trim()
}

function removeDefaultValue(parameter) {
	let depth = 0

	for (let index = 0; index < parameter.length; index += 1) {
		const character = parameter[index]

		if ('([{'.includes(character)) {
			depth += 1
		} else if (')]}'.includes(character)) {
			depth -= 1
		} else if (character === '=' && depth === 0) {
			return parameter.slice(0, index)
		}
	}

	return parameter
}
