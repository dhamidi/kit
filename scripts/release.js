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
	console.error(`Release tag ${version} does not exist. Create the annotated tag before releasing.`)
	process.exit(1)
}

const tagType = (await $`git cat-file -t refs/tags/${version}`.text()).trim()
if (tagType !== 'tag') {
	console.error(`Release tag ${version} is not annotated. Recreate it with: git tag -a ${version}`)
	process.exit(1)
}

const remoteTagExists = await $`git ls-remote --exit-code --tags origin refs/tags/${version}`.quiet().nothrow()
if (remoteTagExists.exitCode !== 0) {
	console.error(`Release tag ${version} has not been pushed to origin. Run: git push origin ${version}`)
	process.exit(1)
}

const releaseExists = await $`gh release view ${version}`.quiet().nothrow()
if (releaseExists.exitCode !== 0) {
	await $`gh release create ${version} --title ${version} --notes ${`Release ${version}`} --verify-tag`
}

await $`gh release upload ${version} ${dist}/* --clobber`
