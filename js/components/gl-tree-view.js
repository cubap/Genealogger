/**
 * @module components/gl-tree-view
 * @description `gl-tree-view` is the family tree page's read-only canvas. It
 * replaces DEER v1's `deer-tree`/`deer-svg-tree` pair with ONE component and
 * no external visualization library: parity only (issue #14), so the SVG is
 * hand-rolled. All positioning lives in the PURE `layoutTree()` below — it
 * takes the plain node/edge rows `model/tree.loadTree()` returns and computes
 * coordinates without touching a store or the DOM, which is exactly the
 * non-delegating logic the milestone says to unit-test.
 *
 * Layout rule: deterministic in-order DFS from the root (each person's parent
 * subtrees, then the person, then the child subtrees; siblings ordered by
 * label). Everyone gets their own column, so nodes never overlap, and
 * generation fixes the row. It is legible, not beautiful — polish is out of
 * scope for this milestone.
 *
 * Contested parentage is drawn in the SHAPE of the tree: every competing claim
 * keeps its own edge, contested edges render dashed, and the contested person
 * gets a dashed amber outline and a warning glyph. Each edge is labelled with
 * the role and the Record documenting the birth where the model provided one.
 *
 * Attributes — none required.
 * Properties
 *   tree   the view model `{ rootId, nodes, edges }` from loadTree(); null clears
 * Events (bubbles, composed)
 *   gl-tree-root   detail: { id } — a node was clicked; the page re-roots
 * Nodes also carry a plain link to `person.html#<id>` (PERSON_HREF from
 * gl-person-chip) so the person page stays one click away without scripting.
 *
 * Shadow DOM owns its <style>; class names mirror css/site.css
 * (person-name, parent-child-line, generation-label) where they already fit.
 */

import { PERSON_HREF } from './gl-person-chip.js'

export const COL_WIDTH = 200
export const ROW_HEIGHT = 120
export const NODE_WIDTH = 152
export const NODE_HEIGHT = 44
export const PADDING = 16

/**
 * PURE: turn node/edge rows into coordinates. No store, no DOM, deterministic.
 * @param {Object} data `{ rootId?, nodes: [{ id, label?, gen }], edges: [{ from, to }] }`
 * @param {Object} [options] layout overrides (tests pass tiny numbers)
 * @param {number} [options.colWidth] horizontal slot per person
 * @param {number} [options.rowHeight] vertical band per generation
 * @returns {{ positions: Object<string, { x: number, y: number, gen: number }>,
 *   order: Array<string>, width: number, height: number }} `positions[id]` is
 *   the node's top-left corner; `order` is the sequence the layout visited.
 */
export function layoutTree(data = {}, options = {}) {
    const colWidth = options.colWidth ?? COL_WIDTH
    const rowHeight = options.rowHeight ?? ROW_HEIGHT
    const nodes = data.nodes || []
    const edges = data.edges || []
    const byId = new Map(nodes.map(node => [node.id, node]))
    const parents = new Map()
    const children = new Map()
    for (const edge of edges) {
        if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue
        if (!parents.has(edge.to)) parents.set(edge.to, [])
        parents.get(edge.to).push(edge.from)
        if (!children.has(edge.from)) children.set(edge.from, [])
        children.get(edge.from).push(edge.to)
    }
    const sortKey = id => `${byId.get(id)?.label || ''}\u0000${id}`
    const sorted = ids => [...new Set(ids)].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1))

    const positions = {}
    const order = []
    const seen = new Set()
    let slot = 0
    const visit = id => {
        if (seen.has(id)) return
        // Mark before recursing so cyclic (corrupt) data terminates instead of
        // hanging the page.
        seen.add(id)
        for (const parent of sorted(parents.get(id) || [])) visit(parent)
        order.push(id)
        positions[id] = { x: PADDING + slot * colWidth, y: 0, gen: Number(byId.get(id)?.gen) || 0 }
        slot += 1
        for (const child of sorted(children.get(id) || [])) visit(child)
    }
    if (byId.has(data.rootId)) visit(data.rootId)
    for (const node of nodes) visit(node.id)

    const placed = Object.values(positions)
    const minGen = Math.min(0, ...placed.map(p => p.gen))
    const rows = Math.max(1, Math.max(0, ...placed.map(p => p.gen)) - minGen + 1)
    for (const p of placed) p.y = PADDING + (p.gen - minGen) * rowHeight
    return {
        positions,
        order,
        width: placed.length ? PADDING * 2 + slot * colWidth : 0,
        height: placed.length ? PADDING * 2 + rows * rowHeight : 0
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'
    })[c])
}

function edgeLabel(edge) {
    return [edge.role, edge.evidenceLabel].filter(Boolean).join(' \u00b7 ')
}

export class GLTreeView extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
    }

    /** @param {{ rootId: string, nodes: Array, edges: Array }|null} view */
    set tree(view) {
        this._view = view
        this._render()
    }

    get tree() {
        return this._view || null
    }

    connectedCallback() {
        this._render()
    }

    _render() {
        const view = this._view
        if (!view || !view.nodes || !view.nodes.length) {
            this.shadowRoot.innerHTML = `<style>${STYLE}</style>
                <p class="generation-label">No tree to draw yet.</p>`
            return
        }
        const { positions, width, height } = layoutTree(view)
        const parts = []
        for (const edge of view.edges) {
            const from = positions[edge.from]
            const to = positions[edge.to]
            if (!from || !to) continue
            const x1 = from.x + NODE_WIDTH / 2
            const y1 = from.y + NODE_HEIGHT
            const x2 = to.x + NODE_WIDTH / 2
            const y2 = to.y
            const midY = y1 + Math.max(0, y2 - y1) / 2
            const cls = `parent-child-line edge${edge.contested ? ' contested' : ''}`
            parts.push(`<path class="${cls}" d="M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}" />`)
            const label = edgeLabel(edge)
            if (label) {
                parts.push(`<text class="edge-label${edge.contested ? ' contested' : ''}" x="${(x1 + x2) / 2}" y="${midY - 4}" text-anchor="middle">${escapeHtml(label)}</text>`)
            }
        }
        for (const node of view.nodes) {
            const pos = positions[node.id]
            if (!pos) continue
            const classes = ['node']
            if (node.id === view.rootId) classes.push('root')
            if (node.contested) classes.push('contested')
            parts.push(`
                <g class="${classes.join(' ')}" data-person-id="${escapeHtml(node.id)}" transform="translate(${pos.x}, ${pos.y})">
                    <rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="6"></rect>
                    <text class="person-name" x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT / 2 - (node.contested ? 2 : -5)}" text-anchor="middle">${node.contested ? '\u26a0 ' : ''}${escapeHtml(node.label)}</text>
                    ${node.contested ? `<text class="contested-note" x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT / 2 + 13}" text-anchor="middle">contested parentage</text>` : ''}
                    <a class="person-link" href="${PERSON_HREF}${escapeHtml(node.id)}" aria-label="Open person page">
                        <text x="${NODE_WIDTH - 8}" y="13" text-anchor="end">\u2197</text>
                    </a>
                </g>`)
        }
        this.shadowRoot.innerHTML = `<style>${STYLE}</style>
            <svg class="tree-svg" role="img" aria-label="Family tree of ${escapeHtml(view.rootLabel || view.rootId)}"
                width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
        for (const g of this.shadowRoot.querySelectorAll('.node')) {
            g.addEventListener('click', event => {
                // The ↗ anchor means "open the person page"; anything else on
                // the node means "re-root the tree here".
                if (event.target.closest('a')) return
                this.dispatchEvent(new CustomEvent('gl-tree-root', {
                    bubbles: true, composed: true, detail: { id: g.dataset.personId }
                }))
            })
        }
    }
}

const STYLE = `
    :host { display: block; overflow: auto; }
    .tree-svg { font-family: inherit; }
    .node rect { fill: #fff; stroke: #607d8b; stroke-width: 1.5; cursor: pointer; }
    .node.root rect { stroke: #1a73e8; stroke-width: 2.5; }
    .node.contested rect { stroke: #b26a00; stroke-dasharray: 5 3; fill: #fff8e1; }
    .person-name { font-size: 12px; fill: #212121; pointer-events: none; }
    .contested-note { font-size: 9px; fill: #b26a00; pointer-events: none; }
    .parent-child-line { fill: none; stroke: #90a4ae; stroke-width: 1.5; }
    .edge.contested { stroke: #b26a00; stroke-dasharray: 4 3; }
    .edge-label { font-size: 9px; fill: #546e7a; }
    .edge-label.contested { fill: #b26a00; }
    .person-link text { font-size: 11px; fill: #1a73e8; cursor: pointer; }
    .generation-label { color: #546e7a; font-style: italic; }
`

if (!customElements.get('gl-tree-view')) customElements.define('gl-tree-view', GLTreeView)

export default GLTreeView
