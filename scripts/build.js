#!/usr/bin/env bun
import { $ } from 'bun'
import { mkdir, rm } from 'node:fs/promises'

const version = Bun.argv[2]
if (!version || !/^v\d+\.\d+\.\d+/.test(version)) {
	console.error('Usage: bun scripts/build.js v0.1.0')
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
	await $`bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig --target=${target} --outfile=${output} src/main.js`
}
