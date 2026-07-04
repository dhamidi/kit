import { createCLI, UserError } from './cli.js'
import components from './commands/components.js'
import generate from './commands/generate.js'
import help from './commands/help.js'
import manifest from './commands/manifest.js'
import plan from './commands/plan.js'
import provider from './commands/provider.js'
import repl from './commands/repl.js'

/**
 * Runs Kit's command line interface with the built-in commands.
 *
 * @example
 * await main(['help'])
 */
export async function main(argv = Bun.argv.slice(2)) {
	const result = await createCLI([help, components, provider, generate, plan, repl, manifest]).run(
		argv.length === 0 ? ['help'] : argv,
	)

	if (typeof result === 'string') {
		console.log(result)
	}
}

if (import.meta.main) {
	try {
		await main()
	} catch (error) {
		if (error instanceof UserError) {
			console.error(error.message)
			process.exit(1)
		}

		throw error
	}
}
