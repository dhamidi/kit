import { defineCommand } from '../cli.js'
import { kitVersion } from '../version.js'

/**
 * Command that prints the installed Kit version.
 *
 * @example
 * await createCLI([version]).run(['version']) // 'kit v0.4.0'
 */
export default defineCommand({
	name: 'version',
	description: 'Print the Kit version',
	options: {},
	run: () => `kit ${kitVersion()}`,
})
