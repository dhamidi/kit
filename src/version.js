import pkg from '../package.json'

/**
 * Returns the Kit CLI version tag, such as "v0.4.0".
 *
 * The single source of truth is the `version` field in package.json; release
 * builds verify the git tag matches it (see scripts/build.js).
 *
 * @example
 * kitVersion() // 'v0.4.0'
 */
export function kitVersion() {
	return `v${pkg.version}`
}
