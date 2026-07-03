#!/usr/bin/env bun
import { $ } from 'bun'
import { rm, mkdir } from 'node:fs/promises'

const version = Bun.argv[2]
if (!version || !/^v\d+\.\d+\.\d+/.test(version)) {
	console.error('Usage: mise run release v0.1.0')
	process.exit(1)
}

const targets = [
	['bun-linux-x64', 'linux-x64', 'kit'],
	['bun-linux-arm64', 'linux-arm64', 'kit'],
	['bun-darwin-x64', 'darwin-x64', 'kit'],
	['bun-darwin-arm64', 'darwin-arm64', 'kit'],
	['bun-windows-x64', 'windows-x64', 'kit.exe'],
]

const dist = 'dist/release'
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

for (const [target, platform, binaryName] of targets) {
	const output = `${dist}/kit-${version}-${platform}${binaryName.endsWith('.exe') ? '.exe' : ''}`
	await $`bun build --compile --target=${target} --outfile=${output} src/main.js`
}

const tagExists = await $`git rev-parse -q --verify refs/tags/${version}`.quiet().nothrow()
if (tagExists.exitCode !== 0) {
	await $`git tag ${version}`
}

const releaseExists = await $`gh release view ${version}`.quiet().nothrow()
if (releaseExists.exitCode !== 0) {
	await $`gh release create ${version} --title ${version} --notes ${`Release ${version}`}`
}

await $`gh release upload ${version} ${dist}/* --clobber`
