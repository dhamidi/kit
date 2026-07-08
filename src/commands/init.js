import { mkdir, stat } from 'node:fs/promises'
import { defineCommand, UserError } from '../cli.js'
import { FileURI } from '../file_uri.js'
import { initAssets, skillAssets } from '../init_assets.js'

/**
 * Initializes a project with Kit's bundled bootstrap providers and agent skill.
 */
export default defineCommand({
	name: 'init',
	description: 'Install Kit bootstrap providers and bundled agent skill into this project',
	options: {
		force: { type: 'boolean' },
	},
	async run({ parsed }) {
		const installer = new ProjectInitializer({
			root: FileURI.fromPath(process.cwd()),
			force: parsed.values.force === true,
		})

		const changes = await installer.run()
		return changes.map((change) => change.toString()).join('\n')
	},
})

class ProjectInitializer {
	constructor({ root, force }) {
		this.root = root
		this.force = force
	}

	async run() {
		return [
			...(await this.installFiles(initAssets)),
			...(await this.installSkill(this.root.join('.agents'))),
			...(await this.installClaudeSkill()),
		]
	}

	async installClaudeSkill() {
		const claudeDirectory = this.root.join('.claude')

		if (!(await exists(claudeDirectory))) {
			return []
		}

		return this.installSkill(claudeDirectory)
	}

	installSkill(agentDirectory) {
		const files = skillAssets.map((asset) => {
			return {
				segments: ['skills', 'use-kit', ...asset.segments],
				content: asset.content,
				description: 'use-kit skill',
			}
		})

		return this.installFiles(files, agentDirectory)
	}

	async installFiles(assets, root = this.root) {
		const changes = []

		for (const asset of assets) {
			const path = root.join(...asset.segments)
			changes.push(await this.installFile(path, asset.content, asset.description))
		}

		return changes
	}

	async installFile(path, content, description) {
		const current = await existingText(path)

		if (current === content) {
			return new InitChange('unchanged', path, description)
		}

		if (current !== undefined && !this.force) {
			return new InitChange('skipped', path, description)
		}

		await mkdir(path.parent().path(), { recursive: true })
		await Bun.write(path.path(), content)
		return new InitChange(current === undefined ? 'created' : 'updated', path, description)
	}
}

class InitChange {
	constructor(status, path, description) {
		this.status = status
		this.path = path
		this.description = description
	}

	toString() {
		if (this.status === 'skipped') {
			return `Skipped ${this.path.path()} (${this.description} already exists; use --force to overwrite)`
		}

		return `${title(this.status)} ${this.path.path()} (${this.description})`
	}
}

async function existingText(path) {
	try {
		return await Bun.file(path.path()).text()
	} catch (error) {
		if (error?.code === 'ENOENT') {
			return undefined
		}

		throw new UserError(`Cannot read ${path.path()}: ${error.message}`)
	}
}

async function exists(path) {
	try {
		await stat(path.path())
		return true
	} catch {
		return false
	}
}

function title(value) {
	return `${value[0].toUpperCase()}${value.slice(1)}`
}
