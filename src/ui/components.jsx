import React from 'react'
import { Icon, iconForComponentType, iconForSymbol } from './lucide_icons.jsx'

const h = React.createElement

/** Renders Kit's provider and component domain as the primary UI. */
export function KitDocument({ model, rootName }) {
	return h(
		'html',
		{ lang: 'en' },
		h('head', null,
			h('meta', { charSet: 'utf-8' }),
			h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
			h('meta', { name: 'color-scheme', content: 'dark light' }),
			h('title', null, `${rootName} · Kit Browser`),
			h('link', { rel: 'stylesheet', href: '/assets/ui.css?v=6' }),
		),
		h('body', { 'data-init': "@get('/events')" },
			h('header', { className: 'masthead' },
				Brand(rootName),
				h('nav', { className: 'view-switcher', 'aria-label': 'Browser view' },
					h('a', { href: '/', className: 'active' }, 'Components'),
					h('a', { href: '/files' }, 'Source files'),
				),
				h(LiveStatus, { message: 'Watching for changes', state: 'connected' }),
			),
			h(KitBrowser, { model }),
		),
	)
}

/** Renders the complete, server-only Kit UI document. */
export function Document({ model }) {
	return h(
		'html',
		{ lang: 'en' },
		h('head', null,
			h('meta', { charSet: 'utf-8' }),
			h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
			h('meta', { name: 'color-scheme', content: 'dark light' }),
			h('title', null, `${model.rootName} · Kit Browser`),
			h('link', { rel: 'stylesheet', href: '/assets/ui.css?v=6' }),
		),
		h('body', { 'data-init': "@get('/events')" },
			h('header', { className: 'masthead' },
				Brand(model.rootName),
			Search(model),
			h(LiveStatus, { message: 'Watching for changes', state: 'connected' }),
		),
		h(Browser, { model }),
	),
	)
}

/** Renders provider, type, component, and inspector columns. */
export function KitBrowser({ model }) {
	return h('main', { id: 'kit-browser', className: 'browser kit-browser' },
		h('div', { className: 'context' },
			h('div', { className: 'breadcrumb' },
				h('span', null, 'Kit'),
				model.selectedProvider === undefined ? null : h('span', null, model.selectedProvider),
			),
		),
		h('div', { className: 'columns kit-columns' },
			h(Pane, { title: 'Providers', count: model.providers.length },
				...model.providers.map((provider) => h(Action, {
					key: provider.name,
					label: provider.name,
					icon: 'package',
					selected: provider.name === model.selectedProvider,
					action: kitAction({ provider: provider.name }),
				})),
			),
			h(Pane, { title: 'Component types', count: model.types.length },
				...model.types.map((type) => h(Action, {
					key: type.id,
					label: type.id,
					icon: iconForComponentType(type.id),
					selected: model.selectedType === type.id,
					action: kitAction({ provider: model.selectedProvider, type: type.id }),
				})),
			),
			h(Pane, { title: 'Components', count: model.components.length },
				...model.components.map((component) => h(Action, {
					key: component.id,
					label: component.id,
					icon: iconForComponentType(component.type),
					selected: model.selection?.kind === 'component' && model.selection.title === component.id,
					action: kitAction({ provider: model.selectedProvider, type: model.selectedType, component: component.id }),
				})),
			),
			h(Inspector, { selection: model.selection, allowWrites: model.allowWrites }),
		),
	)
}

/** Renders generation feedback into the compact form result area. */
export function GenerationResult({ result, error }) {
	if (error !== undefined) {
		return h('div', { id: 'generation-result', className: 'generation-result failed', role: 'status' },
			h('strong', null, 'Could not generate component'),
			h('pre', null, error),
		)
	}

	return h('div', { id: 'generation-result', className: 'generation-result succeeded', role: 'status' },
		h('strong', null, result.dryRun ? 'Preview ready' : 'Component files created'),
		h('ul', null, ...result.events.map((event, index) => h('li', { key: index }, eventSummary(event)))),
	)
}

/** Renders the replaceable Smalltalk-style browser workspace. */
export function Browser({ model }) {
	return h('main', { id: 'browser', className: 'browser', 'aria-busy': 'false' },
		h('div', { className: 'context' },
			h('div', { className: 'breadcrumb' },
				h('span', null, model.rootName),
				model.directory === '' ? null : h('span', null, model.directory),
			),
			h('div', { className: 'context-actions' },
				h('a', { className: 'back-to-kit', href: '/' }, '← Components'),
			),
		),
		h('div', { className: 'columns' },
			h(Pane, { title: 'Folders', count: model.folders.length },
				model.parent === undefined ? null : h(Action, {
					label: '..',
					icon: 'folder',
					action: browseAction({ dir: model.parent, query: model.query }),
				}),
				...model.folders.map((folder) => h(Action, {
					key: folder.path,
					label: folder.name,
					icon: 'folder',
					action: browseAction({ dir: folder.path, query: model.query }),
				})),
			),
			h(Pane, { title: 'Files', count: model.files.length },
				...model.files.map((file) => h(Action, {
					key: file.path,
					label: file.name,
					icon: 'file',
					selected: file.path === model.selectedFile,
					action: browseAction({ dir: model.directory, file: file.path, query: model.query }),
				})),
			),
			h(Pane, { title: 'Symbols', count: model.symbols.length },
				...model.symbols.map((symbol) => h(Action, {
					key: symbol.key,
					label: symbol.label,
					icon: iconForSymbol(symbol.kind),
					meta: `L${symbol.line}`,
					nested: symbol.nested,
					selected: symbol.selected,
					action: browseAction({
						dir: model.directory,
						file: model.selectedFile,
						symbol: symbol.key,
						query: model.query,
					}),
				})),
			),
			h(SourcePane, { model }),
		),
	)
}

/** Renders the status fragment used by the long-lived Datastar stream. */
export function LiveStatus({ message, state = 'connected' }) {
	return h('div', { id: 'live-status', className: `live-status ${state}`, role: 'status' },
		h('span', { className: 'pulse', 'aria-hidden': 'true' }),
		message,
	)
}

/** Renders a recoverable browser error in place of the workspace. */
export function BrowserError({ message }) {
	return h('main', { id: 'browser', className: 'browser error' },
		h('strong', null, 'Could not open this location'),
		h('p', null, message),
	)
}

function Brand(rootName) {
	return h('div', { className: 'brand' },
		h('span', { className: 'mark', 'aria-hidden': 'true' }, 'K'),
		h('div', null, h('strong', null, 'Kit Browser'), h('span', null, rootName)),
	)
}

function Inspector({ selection, allowWrites }) {
	return h('section', { className: 'inspector' },
		h('header', null,
			h('div', { className: 'inspector-title' },
				h(Icon, { name: iconForSelection(selection) }),
				h('h1', null, selection?.title ?? 'Choose a structure'),
			),
		),
		selection === undefined
			? h('div', { className: 'inspector-empty' }, 'Select a provider, component type, or component.')
			: h('div', { className: 'inspector-body' },
				h('p', { className: 'inspector-description' }, selection.description),
				selection.kind === 'type'
					? h(SchemaForm, { selection, allowWrites })
					: selection.kind === 'component'
						? h(SchemaForm, { selection, readOnly: true })
						: h('p', { className: 'inspector-hint' }, 'Choose a type to create a component, or an instance to inspect its properties.'),
			),
	)
}

function SchemaForm({ selection, allowWrites, readOnly = false }) {
	const required = selection.form.requiredFields
	const optional = selection.form.optionalFields
	const endpoint = `/generate?provider=${encodeURIComponent(selection.provider)}&type=${encodeURIComponent(selection.title)}`

	return h('form', { className: 'schema-form' },
		h('div', { className: 'form-section' },
			h('h3', null, 'Required'),
			...(required.length === 0
				? [h('p', { className: 'inspector-hint', key: 'none' }, 'This type has no required fields.')]
				: required.map((field) => h(SchemaField, {
					key: field.name,
					field,
					readOnly,
				}))),
		),
		optional.length === 0 ? null : h('details', { className: 'optional-fields', open: readOnly },
			h('summary', null, `Optional fields · ${optional.length}`),
			h('div', { className: 'form-section' },
				...optional.map((field) => h(SchemaField, {
					key: field.name,
					field,
					readOnly,
				})),
		),
		),
		readOnly ? h('p', { className: 'write-note' }, 'Read-only provider spec') : h('div', { className: 'form-actions' },
			h('button', {
				type: 'button',
				className: 'secondary-button',
				'data-on:click': `@post('${endpoint}&dryRun=true', {contentType: 'form'})`,
			}, 'Preview'),
			h('button', {
				type: 'button',
				className: 'primary-button',
				disabled: !allowWrites,
				title: allowWrites ? 'Create deterministic files without running follow-up plans' : 'Restart with --allow-writes to enable creation',
				'data-on:click': allowWrites ? `@post('${endpoint}', {contentType: 'form'})` : undefined,
			}, 'Create files'),
		),
		readOnly || allowWrites ? null : h('p', { className: 'write-note' }, 'Preview only. Start with --allow-writes to enable file creation.'),
		readOnly ? null : h('div', { id: 'generation-result' }),
	)
}

function SchemaField({ field, readOnly = false }) {
	let control

	if (field.fileLinks !== undefined) {
		control = h('div', { className: 'form-file-values' },
			...field.fileLinks.map((link) => h('a', { key: link.href, href: link.href }, link.label)),
		)
	} else if (field.control === 'choices') {
		control = h('select', { name: field.name, required: field.required, defaultValue: field.value, disabled: readOnly },
			!field.required ? h('option', { value: '' }, 'Not set') : null,
			...field.choices.map((choice) => h('option', { key: choice.toString(), value: choice.toString() }, choice.toString())),
		)
	} else if (field.control === 'boolean') {
		control = h('select', { name: field.name, required: field.required, defaultValue: field.value.toString(), disabled: readOnly },
			!field.required ? h('option', { value: '' }, 'Not set') : null,
			h('option', { value: 'true' }, 'Yes'),
			h('option', { value: 'false' }, 'No'),
		)
	} else if (['array', 'object', 'textarea'].includes(field.control)) {
		control = h('textarea', {
			name: field.name,
			required: field.required,
			rows: field.rows,
			readOnly,
			defaultValue: field.value,
			placeholder: field.placeholder,
		})
	} else {
		control = h('input', {
			name: field.name,
			required: field.required,
			type: field.control,
			readOnly,
			defaultValue: field.value,
			pattern: field.pattern,
			min: field.minimum,
			max: field.maximum,
		})
	}

	return h('label', { className: 'schema-field' },
		h('span', null, field.name, field.required ? h('b', { 'aria-label': 'required' }, ' *') : null),
		control,
		field.description === undefined ? null : h('small', null, field.description),
	)
}

function Search(model) {
	const base = browseURL({ dir: model.directory, file: model.selectedFile })
	const separator = base.includes('?') ? '&' : '?'

	return h('label', { className: 'search' },
		h('span', { 'aria-hidden': 'true' }, '⌕'),
		h('input', {
			type: 'search',
			name: 'query',
			defaultValue: model.query,
			placeholder: 'Filter this context…',
			'aria-label': 'Filter folders, files, and symbols',
			'data-bind:query': '',
			'data-on:input__debounce.250ms': `@get('${base}${separator}query=' + encodeURIComponent($query))`,
			'data-indicator': 'browsing',
		}),
		h('kbd', null, '/'),
	)
}

function Pane({ title, count, children }) {
	const items = React.Children.toArray(children).filter(Boolean)

	return h('section', { className: 'pane' },
		h('header', null, h('h2', null, title), h('span', null, count)),
		h('div', { className: 'items' },
			items.length === 0 ? h('p', { className: 'empty' }, `No ${title.toLowerCase()}`) : items,
		),
	)
}

function Action({ label, icon, meta, action, selected = false, nested = false }) {
	return h('button', {
		type: 'button',
		className: ['item', selected ? 'selected' : undefined, nested ? 'nested' : undefined].filter(Boolean).join(' '),
		'data-on:click': action,
		'data-indicator': 'browsing',
	}, h('span', { className: 'item-identity' },
		icon === undefined ? null : h(Icon, { name: icon }),
		h('span', null, label),
	), meta === undefined ? null : h('small', null, meta))
}

function iconForSelection(selection) {
	if (selection?.kind === 'provider') return 'package'
	if (selection?.kind === 'type' || selection?.kind === 'component') return iconForComponentType(selection.type ?? selection.title)
	return 'component'
}

function SourcePane({ model }) {
	const selection = model.source?.selection
	const editable = model.source?.editable ?? false
	const wholeFileAction = browseAction({ dir: model.directory, file: model.selectedFile, query: model.query })

	return h('section', { className: 'source-pane', 'data-signals:editing': 'false' },
		h('header', null,
			h('div', { className: 'source-title' },
				h('h2', null, selection?.name ?? model.selectedFile ?? 'Source'),
				selection === undefined ? null : h('small', null, `${model.selectedFile} · L${model.source.startLine}`),
			),
			h('div', { className: 'source-actions' },
				selection === undefined ? null : h('button', { type: 'button', 'data-on:click': wholeFileAction }, 'Whole file'),
				selection === undefined ? null : h('button', {
					type: 'button',
					disabled: !editable,
					title: editable
						? model.allowWrites ? 'Edit this definition' : 'Preview the source editor'
						: 'This declaration has no editable body',
					'data-on:click': editable ? '$editing = true' : undefined,
				}, 'Edit'),
				model.source?.extension === undefined ? null : h('span', null, model.source.extension.slice(1) || 'text'),
			),
		),
		model.source === undefined
			? h('div', { className: 'source-empty' }, h('strong', null, 'Choose a file'), h('p', null, 'Its source and structure will appear here.'))
			: model.source.error === undefined
				? h(React.Fragment, null,
					h('ol', {
						className: 'source',
						start: model.source.startLine,
						'aria-label': `Source of ${model.selectedFile}`,
						'data-show': '!$editing',
					}, ...model.source.lines.map((segments, index) => h('li', {
						key: index,
						id: `L${model.source.startLine + index}`,
					}, h('code', null, segments.length === 0
							? '\u00a0'
							: segments.map((segment, segmentIndex) => h('span', {
								key: segmentIndex,
								className: syntaxClass(segment.capture),
							}, segment.text))))),
					),
					selection === undefined || !editable ? null : h(SourceEditor, { model }),
				)
				: h('div', { className: 'source-empty' }, h('strong', null, 'Preview unavailable'), h('p', null, model.source.error)),
	)
}

function SourceEditor({ model }) {
	const selection = model.source.selection

	return h('form', { className: 'source-editor', 'data-show': '$editing' },
		h('input', { type: 'hidden', name: 'dir', value: model.directory }),
		h('input', { type: 'hidden', name: 'file', value: model.selectedFile }),
		h('input', { type: 'hidden', name: 'query', value: model.query }),
		h('input', { type: 'hidden', name: 'symbol', value: selection.selectionKey() }),
		h('input', { type: 'hidden', name: 'expectedHash', value: model.source.contentHash }),
		h('textarea', {
			name: 'replacement',
			defaultValue: model.source.selectedText,
			spellCheck: false,
			'aria-label': `Edit ${selection.name}`,
		}),
		h('div', { className: 'source-editor-actions' },
			h('button', { type: 'button', className: 'secondary-button', 'data-on:click': '$editing = false' }, 'Cancel'),
			h('button', {
				type: 'button',
				className: 'primary-button',
				disabled: !model.allowWrites,
				title: model.allowWrites ? 'Replace this definition' : 'Restart with --allow-writes to enable saving',
				'data-on:click': model.allowWrites ? "@post('/source/edit', {contentType: 'form'})" : undefined,
			}, 'Save definition'),
			model.allowWrites ? null : h('span', { className: 'source-write-note' }, 'Preview only · start with --allow-writes to save'),
			model.source.editError === undefined ? null : h('span', { className: 'source-edit-error', role: 'alert' }, model.source.editError),
		),
	)
}

function syntaxClass(capture) {
	return capture === undefined ? undefined : `syntax-${capture.replaceAll('.', '-')}`
}

function browseAction(params) {
	return `@get(${JSON.stringify(browseURL(params))})`
}

function kitAction(params) {
	const search = new URLSearchParams()

	for (const [name, value] of Object.entries(params)) {
		if (value !== undefined) search.set(name, value)
	}

	return `@get(${JSON.stringify(`/kit?${search}`)})`
}

function eventSummary(event) {
	if (event.type === 'file.created') return `Create ${event.path}`
	if (event.type === 'file.edited') return `Edit ${event.path}`
	if (event.type === 'file.removed') return `Remove ${event.path}`
	if (event.type === 'command.spawned') return `Run ${event.command.join(' ')}`
	if (event.type === 'plan') return `Follow-up plan not run: ${event.title ?? event.intent ?? 'pending'}`
	return event.type
}

function browseURL(params) {
	const search = new URLSearchParams()

	for (const [name, value] of Object.entries(params)) {
		if (value !== undefined && value !== '') {
			search.set(name, value)
		}
	}

	const query = search.toString()
	return query === '' ? '/browse' : `/browse?${query}`
}
