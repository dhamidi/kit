import { Type } from '@sinclair/typebox'
import { FileURI } from '../file_uri.js'

const fileEventSchema = Type.Object(
	{
		type: Type.String(),
		path: FileURI.schema,
	},
	{ additionalProperties: false },
)

/**
 * File events describe filesystem reads and mutations for the agent's file-editing feature area.
 */
export const fileSchemas = {
	fileCreated: Type.Composite(
		[fileEventSchema, Type.Object({ type: Type.Literal('file.created') })],
		{ description: 'File was created' },
	),
	fileRead: Type.Composite([fileEventSchema, Type.Object({ type: Type.Literal('file.read') })], {
		description: 'File was read',
	}),
	fileRemoved: Type.Composite(
		[fileEventSchema, Type.Object({ type: Type.Literal('file.removed') })],
		{ description: 'File was removed' },
	),
	fileEdited: Type.Composite(
		[fileEventSchema, Type.Object({ type: Type.Literal('file.edited') })],
		{ description: 'File was edited' },
	),
}

export function fileEvent(type, path) {
	return { type, path: FileURI.fromPath(path).toString() }
}
