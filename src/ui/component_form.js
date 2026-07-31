import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { FileURI } from '../file_uri.js'

/** A schema-derived form that groups fields and translates browser submissions. */
export class ComponentForm {
	static async create(schema, { values = {}, workspace } = {}) {
		const required = new Set(schema.required ?? [])
		const fields = await Promise.all(Object.entries(schema.properties ?? {}).map(async ([name, property]) => {
			return FormField.create(name, property, {
				required: required.has(name),
				value: values[name],
				workspace,
			})
		}))

		return new ComponentForm(fields)
	}

	constructor(fields) {
		this.requiredFields = fields.filter((field) => field.required)
		this.optionalFields = fields.filter((field) => !field.required)
	}

	/** Parses fields present in a FormData submission into an unnormalized spec. */
	parse(formData) {
		const spec = {}

		for (const field of [...this.requiredFields, ...this.optionalFields]) {
			const raw = formData.get(field.name)
			if (raw === null || (raw === '' && !field.required)) continue
			spec[field.name] = field.parse(raw)
		}

		return spec
	}
}

/** One behavior-rich form field derived from a JSON schema property. */
export class FormField {
	static async create(name, schema, context) {
		const choices = schema.anyOf?.filter((option) => option.const !== undefined)
		const literalChoices = schema.anyOf !== undefined && choices.length === schema.anyOf.length
			? choices.map((option) => option.const)
			: undefined
		const field = new FormField(name, schema, { ...context, literalChoices })
		field.fileLinks = await field.workspaceFileLinks(context.workspace)
		return field
	}

	constructor(name, schema, { required, value, literalChoices }) {
		this.name = name
		this.schema = schema
		this.required = required
		this.description = schema.description
		this.choices = literalChoices
		this.control = this.controlKind()
		this.value = this.format(value ?? schema.default ?? schema.examples?.[0] ?? '')
		this.pattern = schema.pattern
		this.minimum = schema.minimum
		this.maximum = schema.maximum
		this.rows = name === 'intent' ? 4 : 2
		this.placeholder = this.control === 'array' ? 'One value per line' : this.control === 'object' ? '{ }' : undefined
		this.fileLinks = undefined
	}

	controlKind() {
		if (this.choices !== undefined) return 'choices'
		if (this.schema.type === 'boolean') return 'boolean'
		if (this.schema.type === 'array') return 'array'
		if (this.schema.type === 'object') return 'object'
		if (this.name === 'intent') return 'textarea'
		if (this.schema.type === 'number' || this.schema.type === 'integer') return 'number'
		return 'text'
	}

	format(value) {
		if (this.control === 'object' && value !== '') return JSON.stringify(value, null, 2)
		if (this.control === 'array' && Array.isArray(value)) return value.join('\n')
		return value
	}

	parse(raw, schema = this.schema) {
		if (schema.anyOf !== undefined) {
			const literal = schema.anyOf.find((option) => option.const?.toString() === raw)
			return this.parse(raw, literal ?? schema.anyOf[0])
		}
		if (schema.type === 'boolean') return raw === 'true'
		if (schema.type === 'number' || schema.type === 'integer') return Number(raw)
		if (schema.type === 'array') {
			return raw.split('\n').map((value) => value.trim()).filter(Boolean).map((value) => this.parse(value, schema.items))
		}
		if (schema.type === 'object') return JSON.parse(raw)
		return raw
	}

	async workspaceFileLinks(workspace) {
		if (workspace === undefined) return undefined
		const rawValue = this.value
		const values = this.control === 'array' ? rawValue.split('\n') : [rawValue]
		const links = []

		for (const value of values) {
			if (typeof value !== 'string' || value === '') continue
			try {
				const file = isAbsolute(value) ? FileURI.fromPath(value) : workspace.join(value)
				file.relativeTo(workspace)
				if (!(await stat(file.path())).isFile()) continue
				const directory = file.parent().toString() === workspace.toString() ? '' : file.parent().relativeTo(workspace)
				const search = new URLSearchParams({ file: file.relativeTo(workspace) })
				if (directory !== '') search.set('dir', directory)
				links.push({ label: value, href: `/files?${search}` })
			} catch {
				// Non-file values remain ordinary controls.
			}
		}

		return links.length === 0 ? undefined : links
	}
}
