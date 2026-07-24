import { providerHookError } from '../provider.js'
import {
	normalizeSchemaValue,
	schemaViolations,
	schemaWithKitFields,
} from '../schema_normalizer.js'

/**
 * A manifest batch knows how to move each operation through the same lifecycle.
 *
 * The runner tells the batch to resolve, asks it for accumulated errors, then tells it to run.
 */
export class ManifestOperations {
	/**
	 * Accepts the few manifest container shapes Kit currently hands around.
	 *
	 * Bad input becomes a failed operation so the runner can report it with the rest of the batch
	 * instead of switching to exception flow before validation.
	 */
	static from(manifest) {
		try {
			return new ManifestOperations(inputOperations(manifest).map((operation) => {
				return ManifestOperation.from(operation)
			}))
		} catch (error) {
			return new ManifestOperations([ManifestOperation.invalid(errorMessage(error))])
		}
	}

	constructor(operations) {
		this.operations = operations
	}

	/**
	 * Lets each operation find its provider and component type without exposing that lookup here.
	 */
	async resolveWith(registry) {
		const operations = []

		for (const operation of this.operations) {
			operations.push(await operation.resolveWith(registry))
		}

		return new ManifestOperations(operations)
	}

	/**
	 * Returns every problem found before execution so one bad form never hides the next one.
	 */
	errors() {
		return this.operations.flatMap((operation) => operation.errors)
	}

	/**
	 * Runs operations in manifest order and lets the caller decide what emitted events mean.
	 */
	async *run(env, eventHandler) {
		for (const operation of this.operations) {
			for await (const event of operation.run(env)) {
				yield event
				await eventHandler.handle(event)
			}
		}
	}
}

/**
 * A manifest operation knows how to become executable, or how to explain why it cannot.
 */
export class ManifestOperation {
	/**
	 * Converts parser/resolver output into an object that can receive registry messages.
	 */
	static from(operation) {
		return new ManifestOperation({
			providerName: valueOf(operation.provider),
			typeName: valueOf(operation.type ?? operation.typeName),
			spec: operation.spec,
			location: operation.location ?? operation.start,
		})
	}

	/**
	 * Turns boundary-shape failures into normal operation errors for batch reporting.
	 */
	static invalid(message) {
		return new FailedManifestOperation({
			providerName: undefined,
			typeName: undefined,
			spec: undefined,
			location: undefined,
			errors: [{ message }],
		})
	}

	constructor({ providerName, typeName, spec, location }) {
		this.providerName = providerName
		this.typeName = typeName
		this.spec = spec
		this.location = location
		this.errors = []
	}

	/**
	 * Asks the registry to bind this operation to the live provider vocabulary.
	 */
	resolveWith(registry) {
		return registry.resolve(this)
	}

	/**
	 * Returns the same intent after a provider has claimed responsibility for it.
	 */
	withProvider(provider) {
		return new ProviderManifestOperation({
			providerName: this.providerName,
			typeName: this.typeName,
			spec: this.spec,
			location: this.location,
			provider,
		})
	}

	/**
	 * Records a domain failure without raising, so the whole manifest can be checked first.
	 */
	fail(message, fields = {}) {
		return new FailedManifestOperation({
			providerName: this.providerName,
			typeName: this.typeName,
			spec: this.spec,
			location: this.location,
			errors: [this.error(message, fields)],
		})
	}

	/**
	 * Builds an error that still remembers which manifest operation caused it.
	 */
	error(message, fields = {}) {
		return {
			message,
			provider: this.providerName,
			type: this.typeName,
			location: this.location,
			...fields,
		}
	}

	/**
	 * Unresolved operations cannot touch files; they must be bound and validated first.
	 */
	async *run() {
		throw new Error('Cannot run unresolved manifest operation')
	}
}

class ProviderManifestOperation extends ManifestOperation {
	constructor(fields) {
		super(fields)
		this.provider = fields.provider
	}

	/**
	 * Returns the same intent after a component type has accepted it.
	 */
	withType(type) {
		return new RunnableManifestOperation({
			providerName: this.providerName,
			typeName: this.typeName,
			spec: this.spec,
			location: this.location,
			provider: this.provider,
			type,
		})
	}
}

class RunnableManifestOperation extends ProviderManifestOperation {
	constructor(fields) {
		super(fields)
		this.type = fields.type
		this.spec = normalizeSchemaValue(schemaWithKitFields(this.type.schema()), this.spec)
		this.errors = this.validationErrors()
	}

	/**
	 * Applies the final TypeBox gate to the already-resolved JS spec.
	 */
	validationErrors() {
		if (this.spec === undefined) {
			return [
				this.error('ManifestRunner requires resolved spec values; parse and resolve first'),
			]
		}

		return schemaViolations(schemaWithKitFields(this.type.schema()), this.spec).map(
			(error) => {
				return this.error(`${this.providerName} ${this.typeName}${error.path}: ${error.message}`, {
					path: error.path,
					value: error.value,
				})
			},
		)
	}

	/**
	 * Delegates creation to the provider-owned component type, converting
	 * unexpected provider exceptions into clean user-facing errors.
	 */
	async *run(env) {
		try {
			for await (const event of this.type.create(this.spec, env)) {
				yield event
			}
		} catch (error) {
			throw providerHookError({
				providerName: this.providerName,
				typeId: this.typeName,
				hook: 'create',
				error,
			})
		}
	}
}

class FailedManifestOperation extends ManifestOperation {
	constructor(fields) {
		super(fields)
		this.errors = fields.errors
	}

	/**
	 * Failed operations stay failed when the batch asks every operation to resolve.
	 */
	resolveWith() {
		return this
	}

	/**
	 * Invalid operations are reported before this can be called.
	 */
	async *run() {
		throw new Error('Cannot run invalid manifest operation')
	}
}

/**
 * The live provider vocabulary answers whether a manifest operation can be claimed.
 */
export class ProviderRegistry {
	/**
	 * Wraps provider instances so missing providers and real providers answer the same message.
	 */
	static async from(providers) {
		const map = new Map()

		for await (const provider of providers) {
			map.set(provider.name(), new ProviderBinding(provider))
		}

		return new ProviderRegistry(map)
	}

	constructor(providers) {
		this.providers = providers
	}

	/**
	 * Tells the matching provider binding to continue resolving the operation.
	 */
	resolve(operation) {
		return this.providerFor(operation).resolve(operation)
	}

	/**
	 * Returns a real binding or a missing binding that can explain the failure.
	 */
	providerFor(operation) {
		return this.providers.get(operation.providerName) ?? new MissingProviderBinding()
	}
}

class ProviderBinding {
	constructor(provider) {
		this.provider = provider
	}

	/**
	 * Claims the operation for this provider, then asks the provider for the requested type.
	 */
	async resolve(operation) {
		return this.resolveType(operation.withProvider(this.provider))
	}

	/**
	 * Lets the component type binding decide whether the provider can run this operation.
	 */
	async resolveType(operation) {
		return (await this.typeFor(operation)).resolve(operation)
	}

	/**
	 * Finds the matching component type or returns an object that reports the miss.
	 */
	async typeFor(operation) {
		for await (const type of this.provider.types()) {
			if (type.id() === operation.typeName) {
				return new ComponentTypeBinding(type)
			}
		}

		return new MissingTypeBinding()
	}
}

class MissingProviderBinding {
	/**
	 * A missing provider still resolves the operation by turning it into a useful error.
	 */
	async resolve(operation) {
		return operation.fail(`Unknown provider: ${operation.providerName}`)
	}
}

class ComponentTypeBinding {
	constructor(type) {
		this.type = type
	}

	/**
	 * Hands the operation the component type that will validate and execute it.
	 */
	resolve(operation) {
		return operation.withType(this.type)
	}
}

class MissingTypeBinding {
	/**
	 * A missing type keeps provider resolution successful while reporting the bad type name.
	 */
	resolve(operation) {
		return operation.fail(
			`Unknown component type: ${operation.providerName} ${operation.typeName}`,
		)
	}
}

function inputOperations(manifest) {
	if (Array.isArray(manifest)) {
		return manifest
	}

	if (Array.isArray(manifest?.operations)) {
		return manifest.operations
	}

	if (Array.isArray(manifest?.components)) {
		return manifest.components
	}

	throw new Error('ManifestRunner requires a resolved manifest operation list')
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error)
}

function valueOf(value) {
	return typeof value === 'object' && value !== null && 'value' in value ? value.value : value
}
