#!/usr/bin/env bun
import { $ } from 'bun'

const version = Bun.argv[2]
if (!version || !/^v\d+\.\d+\.\d+/.test(version)) {
	console.error('Usage: mise run release v0.1.0')
	process.exit(1)
}

const dist = 'dist/release'
await $`bun scripts/build.js ${version}`

const tagExists = await $`git rev-parse -q --verify refs/tags/${version}`.quiet().nothrow()
if (tagExists.exitCode !== 0) {
	await $`git tag ${version}`
}

const releaseExists = await $`gh release view ${version}`.quiet().nothrow()
if (releaseExists.exitCode !== 0) {
	await $`gh release create ${version} --title ${version} --notes ${`Release ${version}`}`
}

await $`gh release upload ${version} ${dist}/* --clobber`
