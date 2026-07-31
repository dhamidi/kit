import { Database } from 'bun:sqlite'
import { SymbolOccurrence } from './symbol_occurrence.js'

/**
 * SymbolIndex stores normalized syntax occurrences in an in-memory SQLite database.
 * Parsers replace one file atomically, so readers never observe a partial index.
 */
export class SymbolIndex {
	constructor() {
		this.database = new Database(':memory:', { create: true, strict: true })
		this.database.exec('PRAGMA foreign_keys = ON')
		this.database.exec(`
			CREATE TABLE files (
				path TEXT PRIMARY KEY,
				language TEXT NOT NULL,
				content_hash TEXT NOT NULL
			) STRICT;

			CREATE TABLE symbol_occurrences (
				id INTEGER PRIMARY KEY,
				file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
				role TEXT NOT NULL,
				kind TEXT NOT NULL,
				name TEXT NOT NULL,
				start_byte INTEGER NOT NULL,
				end_byte INTEGER NOT NULL,
				start_line INTEGER NOT NULL,
				start_column INTEGER NOT NULL,
				end_line INTEGER NOT NULL,
				end_column INTEGER NOT NULL,
				entity_start_byte INTEGER NOT NULL,
				entity_end_byte INTEGER NOT NULL,
				entity_start_line INTEGER NOT NULL,
				entity_end_line INTEGER NOT NULL,
				container_name TEXT,
				container_start_byte INTEGER,
				signature TEXT,
				content_start_byte INTEGER,
				content_end_byte INTEGER,
				content_start_line INTEGER,
				content_indent TEXT
			) STRICT;

			CREATE INDEX symbols_by_file ON symbol_occurrences(file_path, start_byte);
			CREATE INDEX symbols_by_name ON symbol_occurrences(name, role, kind);
		`)

		this.replaceTransaction = this.database.transaction((document) => {
			this.database.query('DELETE FROM symbol_occurrences WHERE file_path = ?').run(document.path)
			this.database.query(`
				INSERT INTO files(path, language, content_hash) VALUES (?, ?, ?)
				ON CONFLICT(path) DO UPDATE SET language = excluded.language, content_hash = excluded.content_hash
			`).run(document.path, document.language, document.contentHash)

			const insert = this.database.query(`
				INSERT INTO symbol_occurrences(
					file_path, role, kind, name, start_byte, end_byte,
					start_line, start_column, end_line, end_column,
					entity_start_byte, entity_end_byte, entity_start_line, entity_end_line,
					container_name, container_start_byte, signature,
					content_start_byte, content_end_byte, content_start_line, content_indent
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)

			for (const symbol of document.symbols) {
				insert.run(
					document.path,
					symbol.role,
					symbol.kind,
					symbol.name,
					symbol.startByte,
					symbol.endByte,
					symbol.startLine,
					symbol.startColumn,
					symbol.endLine,
					symbol.endColumn,
					symbol.entityStartByte ?? symbol.startByte,
					symbol.entityEndByte ?? symbol.endByte,
					symbol.entityStartLine ?? symbol.startLine,
					symbol.entityEndLine ?? symbol.endLine,
					symbol.containerName ?? null,
					symbol.containerStartByte ?? null,
					symbol.signature ?? null,
					symbol.contentStartByte ?? null,
					symbol.contentEndByte ?? null,
					symbol.contentStartLine ?? null,
					symbol.contentIndent ?? null,
				)
			}
		})
	}

	/** Atomically replaces every indexed occurrence for one source file. */
	replaceFile(document) {
		this.replaceTransaction(document)
	}

	/** Returns occurrences in source order for one file. */
	symbolsForFile(path) {
		return this.database.query(`
			SELECT
				role,
				kind,
				name,
				start_byte AS startByte,
				end_byte AS endByte,
				start_line AS line,
				start_column AS column,
				end_line AS endLine,
				end_column AS endColumn,
				entity_start_byte AS entityStartByte,
				entity_end_byte AS entityEndByte,
				entity_start_line AS entityStartLine,
				entity_end_line AS entityEndLine,
				container_name AS containerName,
				container_start_byte AS containerStartByte,
				signature,
				content_start_byte AS contentStartByte,
				content_end_byte AS contentEndByte,
				content_start_line AS contentStartLine,
				content_indent AS contentIndent
			FROM symbol_occurrences
			WHERE file_path = ?
			ORDER BY start_byte, end_byte
		`).all(path).map((row) => new SymbolOccurrence({ ...row, startLine: row.line }))
	}

	/** Returns definitions with an exact name across all indexed files. */
	definitionsNamed(name) {
		return this.occurrencesNamed(name, 'definition')
	}

	/** Returns references with an exact name across all indexed files. */
	referencesNamed(name) {
		return this.occurrencesNamed(name, 'reference')
	}

	occurrencesNamed(name, role) {
		return this.database.query(`
			SELECT
				file_path AS file,
				role,
				kind,
				name,
				start_line AS line,
				start_column AS column,
				end_line AS endLine,
				end_column AS endColumn
			FROM symbol_occurrences
			WHERE name = ? AND role = ?
			ORDER BY file_path, start_byte
		`).all(name, role).map((row) => new SymbolOccurrence(row))
	}

	close() {
		this.database.close()
	}
}
