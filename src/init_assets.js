import kitAgentProvider from './assets/providers/kit-agent/index.js.txt' with { type: 'text' }
import kitProviderProvider from './assets/providers/kit-provider/index.js.txt' with { type: 'text' }
import skill from '../.agents/skills/use-kit/SKILL.md' with { type: 'text' }
import exampleProviderReference from '../.agents/skills/use-kit/reference/example-provider.md' with { type: 'text' }
import examplesReference from '../.agents/skills/use-kit/reference/examples.md' with { type: 'text' }
import manifestsReference from '../.agents/skills/use-kit/reference/manifests.md' with { type: 'text' }
import providersReference from '../.agents/skills/use-kit/reference/providers.md' with { type: 'text' }
import replReference from '../.agents/skills/use-kit/reference/repl-and-runtime.md' with { type: 'text' }

/**
 * Files installed by `kit init` into a project so Kit can bootstrap itself from
 * a standalone binary without depending on this repository checkout.
 */
export const initAssets = [
	{
		segments: ['.kit', 'providers', 'kit-provider', 'index.js'],
		content: kitProviderProvider,
		description: 'Kit provider generator',
	},
	{
		segments: ['.kit', 'providers', 'kit-agent', 'index.js'],
		content: kitAgentProvider,
		description: 'Kit agent runner provider',
	},
]

/**
 * Skill files bundled into Kit and installed into local agent directories by
 * `kit init`.
 */
export const skillAssets = [
	{ segments: ['SKILL.md'], content: skill },
	{ segments: ['reference', 'example-provider.md'], content: exampleProviderReference },
	{ segments: ['reference', 'examples.md'], content: examplesReference },
	{ segments: ['reference', 'manifests.md'], content: manifestsReference },
	{ segments: ['reference', 'providers.md'], content: providersReference },
	{ segments: ['reference', 'repl-and-runtime.md'], content: replReference },
]
