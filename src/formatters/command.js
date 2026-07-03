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
