import React from 'react'

const h = React.createElement

// Vendored from lucide-static 1.28.0. See vendor/lucide-static-1.28.0.LICENSE.
const icons = {
	box: [['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }], ['path', { d: 'm3.3 7 8.7 5 8.7-5' }], ['path', { d: 'M12 22V12' }]],
	braces: [['path', { d: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1' }], ['path', { d: 'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1' }]],
	component: [['path', { d: 'M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z' }], ['path', { d: 'M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z' }], ['path', { d: 'M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z' }], ['path', { d: 'M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z' }]],
	database: [['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }], ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }], ['path', { d: 'M3 12A9 3 0 0 0 21 12' }]],
	file: [['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }], ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }]],
	folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
	function: [['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }], ['path', { d: 'M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3' }], ['path', { d: 'M9 11.2h5.7' }]],
	hash: [['line', { x1: 4, x2: 20, y1: 9, y2: 9 }], ['line', { x1: 4, x2: 20, y1: 15, y2: 15 }], ['line', { x1: 10, x2: 8, y1: 3, y2: 21 }], ['line', { x1: 16, x2: 14, y1: 3, y2: 21 }]],
	heading: [['path', { d: 'M6 12h12' }], ['path', { d: 'M6 20V4' }], ['path', { d: 'M18 20V4' }]],
	languages: [['path', { d: 'm5 8 6 6' }], ['path', { d: 'm4 14 6-6 2-3' }], ['path', { d: 'M2 5h12' }], ['path', { d: 'M7 2h1' }], ['path', { d: 'm22 22-5-10-5 10' }], ['path', { d: 'M14 18h6' }]],
	package: [['path', { d: 'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z' }], ['path', { d: 'M12 22V12' }], ['polyline', { points: '3.29 7 12 12 20.71 7' }], ['path', { d: 'm7.5 4.27 9 5.15' }]],
	route: [['circle', { cx: 6, cy: 19, r: 3 }], ['path', { d: 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15' }], ['circle', { cx: 18, cy: 5, r: 3 }]],
	shapes: [['path', { d: 'M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z' }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }], ['circle', { cx: 17.5, cy: 17.5, r: 3.5 }]],
	table: [['path', { d: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18' }]],
	terminal: [['path', { d: 'M12 19h8' }], ['path', { d: 'm4 17 6-6-6-6' }]],
	type: [['path', { d: 'M12 4v16' }], ['path', { d: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' }], ['path', { d: 'M9 20h6' }]],
	variable: [['path', { d: 'M8 21s-4-3-4-9 4-9 4-9' }], ['path', { d: 'M16 3s4 3 4 9-4 9-4 9' }], ['line', { x1: 15, x2: 9, y1: 9, y2: 15 }], ['line', { x1: 9, x2: 15, y1: 9, y2: 15 }]],
}

/** Renders a vendored Lucide icon. */
export function Icon({ name, label }) {
	const children = icons[name] ?? icons.shapes
	return h('svg', {
		className: `icon icon-${name}`,
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: 'currentColor',
		strokeWidth: 2,
		strokeLinecap: 'round',
		strokeLinejoin: 'round',
		'aria-hidden': label === undefined ? 'true' : undefined,
		'aria-label': label,
		role: label === undefined ? undefined : 'img',
	}, ...children.map(([element, properties], index) => h(element, { ...properties, key: index })))
}

/** Chooses a compact visual cue for a provider component type. */
export function iconForComponentType(type = '') {
	const id = type.toLowerCase()
	if (/(route|endpoint|url)/.test(id)) return 'route'
	if (/(command|task|script|job)/.test(id)) return 'terminal'
	if (/(language|grammar|parser)/.test(id)) return 'languages'
	if (/(table|model|schema|database|migration)/.test(id)) return 'database'
	if (/(module|package|blueprint|plugin|provider)/.test(id)) return 'package'
	return 'component'
}

/** Chooses an IDE-style icon for a source symbol kind. */
export function iconForSymbol(kind = '') {
	if (['class', 'struct', 'enum', 'union'].includes(kind)) return 'box'
	if (['function', 'method', 'constructor', 'call', 'macro', 'trigger'].includes(kind)) return 'function'
	if (['interface', 'type', 'type-alias', 'implementation', 'element'].includes(kind)) return 'braces'
	if (['heading', 'section'].includes(kind)) return 'heading'
	if (['table', 'schema', 'view'].includes(kind)) return 'table'
	if (['constant', 'number', 'index'].includes(kind)) return 'hash'
	if (['variable', 'field', 'column', 'property', 'attribute'].includes(kind)) return 'variable'
	if (['module', 'namespace'].includes(kind)) return 'package'
	return 'shapes'
}
