import { createCLI, UserError } from './cli.js'
import agent from './commands/agent.js'
import components from './commands/components.js'
import generate from './commands/generate.js'
import help from './commands/help.js'
import init from './commands/init.js'
import manifest from './commands/manifest.js'
import plan from './commands/plan.js'
import provider from './commands/provider.js'
import repl from './commands/repl.js'
import version from './commands/version.js'

/**
 * Runs Kit's command line interface with the built-in commands.
 *
 * @example
 * await main(['help'])
 */
export async function main(argv = Bun.argv.slice(2)) {
	const result = await createCLI([help, version, init, components, provider, agent, generate, plan, repl, manifest]).run(
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
