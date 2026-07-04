import { Identifier } from '../component_identifier.js'
import { PlanFormatter } from './plan.js'
import { TableFormatter } from './table.js'

/**
 * CommandFormatter renders command results for terminal output.
 */
export class CommandFormatter {
	constructor(cli, output = process.stdout) {
		this.cli = cli
		this.output = output
	}

	help() {
		const commands = this.commandsWithChildren()
		const width = Math.max(...commands.map((command) => command.name.length))
		const lines = ['Usage: kit <command> [options]', '', 'Commands:']

		for (const command of commands) {
			lines.push(`  ${command.name.padEnd(width)}  ${command.description}`)
		}

		return lines.join('\n')
	}

	commandHelp(command, path = [command.name]) {
		const lines = [`Usage: kit ${path.join(' ')}${usageSuffix(command)}`, '', command.description]

		if (command.commands.size > 0) {
			const commands = Array.from(command.commands.values())
			const width = Math.max(...commands.map((child) => child.name.length))

			lines.push('', 'Commands:')

			for (const child of commands) {
				lines.push(`  ${child.name.padEnd(width)}  ${child.description}`)
			}
		}

		const optionEntries = Object.entries(command.options)
		const options = [
			...optionEntries,
			['help', { type: 'boolean', description: 'Show help for this command' }],
		]

		if (options.length > 0) {
			const width = Math.max(...options.map(([name]) => optionUsage(name).length))

			lines.push('', 'Options:')

			for (const [name, option] of options) {
				lines.push(`  ${optionUsage(name, option).padEnd(width)}  ${option.description ?? ''}`)
			}
		}

		return lines.join('\n')
	}

	commandsWithChildren() {
		return this.cli.list().flatMap((command) => {
			const commands = [{ name: command.name, description: command.description }]

			for (const child of command.commands.values()) {
				commands.push({
					name: `${command.name} ${child.name}`,
					description: child.description,
				})
			}

			return commands
		})
	}

	async providersList(events) {
		const table = new TableFormatter(['Provider', 'Path'], this.output)

		for await (const event of events) {
			const value = event.toJSON()

			if (value.type === 'provider.loaded') {
				table.row([value.name, value.path])
			}
		}

		if (table.isEmpty()) {
			this.writeLine('No providers discovered')
		} else {
			table.flush()
		}
	}

	async providerShow(provider) {
		this.writeLine(`Provider: ${provider.name()}`)
		this.writeLine('')

		const table = new TableFormatter(['Type', 'Description'], this.output)

		for await (const type of provider.types()) {
			table.row([type.id(), type.description()])
		}

		if (table.isEmpty()) {
			this.writeLine('No component types')
		} else {
			table.flush()
		}
	}

	providerTypeShow(provider, type) {
		this.writeLine(`Provider: ${provider.name()}`)
		this.writeLine(`Type: ${type.id()}`)
		this.writeLine(`Description: ${type.description()}`)
		this.writeLine('')
		writeSchema(type.schema(), this.output)
	}

	async componentsList(events, { prefix } = {}) {
		const table = new TableFormatter(['Component', 'Description'], this.output)
		const prefixID = prefix === undefined ? undefined : Identifier.fromString(prefix)

		for await (const event of events) {
			const value = event.toJSON()

			if (value.type === 'component.listed') {
				const componentID = new Identifier([
					value.provider,
					...Identifier.fromString(value.id).parts(),
				])

				if (prefixID !== undefined && !componentID.startsWith(prefixID)) {
					continue
				}

				table.row([componentID.toString(), value.description])
			}
		}

		if (table.isEmpty()) {
			this.writeLine(
				prefix === undefined ? 'No components discovered' : `No components matching ${prefix}`,
			)
		} else {
			table.flush()
		}
	}

	componentShow(componentName, record) {
		const table = new TableFormatter(['Field', 'Value'], this.output)
		const { component } = record
		const inspect = component.inspect()

		table.row(['Component', componentName])
		table.row(['Description', component.description()])

		if (inspect.files !== undefined) {
			table.row(['Files', inspectFieldValue(inspect.files)])
		}

		for (const [name, value] of Object.entries(extraInspect(inspect))) {
			table.row([inspectFieldName(name), inspectFieldValue(value)])
		}

		table.flush()
	}

	planShow(state) {
		new PlanFormatter(this.output).write(state)
	}

	writeLine(line) {
		this.output.write(`${line}\n`)
	}
}

function extraInspect(inspect) {
	const { files, family, name, type, ...extra } = inspect
	return extra
}

function usageSuffix(command) {
	const subcommands = command.commands.size > 0 ? ' <command>' : ''
	const options = Object.keys(command.options).length > 0 ? ' [options]' : ''

	return `${subcommands}${options}`
}

function optionUsage(name, option = {}) {
	const long = `--${name}`
	const short = option.short === undefined ? '' : `-${option.short}, `
	const value = option.type === 'string' ? ` <${name}>` : ''

	return `${short}${long}${value}`
}

function inspectFieldName(name) {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

function inspectFieldValue(value) {
	if (Array.isArray(value)) {
		return value.map(inspectFieldValue).join(', ')
	}

	if (value !== null && typeof value === 'object') {
		return JSON.stringify(value)
	}

	return String(value)
}

function writeSchema(schema, output) {
	if (schema.properties !== undefined) {
		writeMetadata(schema, output, '')
		writeObjectFields('Fields', schema, output, '')
		return
	}

	output.write(`Schema: ${schemaTypeName(schema)}\n`)
	writeMetadata(schema, output, '  ')
}

function writeObjectFields(title, schema, output, indent) {
	const entries = Object.entries(schema.properties ?? {})
	const required = new Set(schema.required ?? [])

	output.write(`${indent}${title}:\n`)

	if (entries.length === 0) {
		output.write(`${indent}  (none)\n`)
		return
	}

	const nameWidth = Math.max(...entries.map(([name]) => name.length))
	const typeWidth = Math.max(...entries.map(([, field]) => schemaTypeName(field).length))

	for (const [name, field] of entries) {
		const presence = required.has(name) ? 'required' : 'optional'
		output.write(
			`${indent}  ${name.padEnd(nameWidth)}  ${schemaTypeName(field).padEnd(typeWidth)}  ${presence}\n`,
		)
		writeMetadata(field, output, `${indent}    `)
		writeNestedSchema(field, output, `${indent}    `)
	}
}

function writeNestedSchema(schema, output, indent) {
	if (schema.patternProperties !== undefined) {
		writeRecordSchema(schema, output, indent)
		return
	}

	if (schema.properties !== undefined) {
		writeObjectFields('Fields', schema, output, indent)
	}
}

function writeRecordSchema(schema, output, indent) {
	for (const [pattern, value] of Object.entries(schema.patternProperties)) {
		output.write(`${indent}Keys: string\n`)
		output.write(`${indent}  Pattern: ${pattern}\n`)
		output.write(`${indent}Values: ${schemaTypeName(value)}\n`)
		writeMetadata(value, output, `${indent}  `)
		writeNestedSchema(value, output, `${indent}  `)
	}
}

function writeMetadata(schema, output, indent) {
	if (schema.description !== undefined) {
		output.write(`${indent}${schema.description}\n`)
	}

	if (schema.pattern !== undefined) {
		output.write(`${indent}Pattern: ${schema.pattern}\n`)
	}

	if (schema.minLength !== undefined || schema.maxLength !== undefined) {
		output.write(`${indent}Length: ${lengthRange(schema)}\n`)
	}

	if (schema.default !== undefined) {
		output.write(`${indent}Default: ${formatValue(schema.default)}\n`)
	}

	if (schema.examples !== undefined) {
		writeExamples(schema.examples, output, indent)
	}

	if (schema.kit?.cli === false) {
		output.write(`${indent}Generate flag: hidden\n`)
	}

	if (schema.multiple === true) {
		output.write(`${indent}Multiple: true\n`)
	}

	if (schema.additionalProperties === false) {
		output.write(`${indent}Additional properties: false\n`)
	}
}

function writeExamples(examples, output, indent) {
	if (examples.every((example) => example === null || typeof example !== 'object')) {
		output.write(`${indent}Examples: ${examples.map(formatValue).join(', ')}\n`)
		return
	}

	output.write(`${indent}Examples:\n`)

	for (const example of examples) {
		for (const line of JSON.stringify(example, null, 2).split('\n')) {
			output.write(`${indent}  ${line}\n`)
		}
	}
}

function schemaTypeName(schema) {
	if (schema.const !== undefined) {
		return formatLiteral(schema.const)
	}

	if (schema.anyOf !== undefined) {
		return schema.anyOf.map(schemaTypeName).join(' | ')
	}

	if (schema.allOf !== undefined) {
		return schema.allOf.map(schemaTypeName).join(' & ')
	}

	if (schema.type === 'array') {
		return `${schemaTypeName(schema.items)}[]`
	}

	if (schema.patternProperties !== undefined) {
		const value = Object.values(schema.patternProperties)[0]
		return `record<string, ${schemaTypeName(value)}>`
	}

	return schema.type ?? 'unknown'
}

function lengthRange(schema) {
	if (schema.minLength !== undefined && schema.maxLength !== undefined) {
		return `${schema.minLength}..${schema.maxLength}`
	}

	if (schema.minLength !== undefined) {
		return `>= ${schema.minLength}`
	}

	return `<= ${schema.maxLength}`
}

function formatValue(value) {
	return typeof value === 'string' ? value : JSON.stringify(value)
}

function formatLiteral(value) {
	return JSON.stringify(value)
}
