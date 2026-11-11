/**
 * @module components/gl-ancestor-timeline
 * @description `gl-ancestor-timeline` draws the ancestor timeline (issue #14
 * story 9) as hand-rolled SVG in an open shadow root. It is PRESENTATION ONLY:
 * the page hands it the plain rows `model/timeline.js` produced (`data =
 * { people, items, undated }`) and this file turns them into positions and
 * marks. No store, no fetch, no data-shape knowledge.
 *
 * The visual grammar is inherited from DEER v1's `deer-ancestor-timeline`:
 * newest on the LEFT (you read a life right-to-left, backwards), one row per
 * person grouped by generation, and an ESTIMATED date drawn hollow/dotted so
 * it can never be mistaken for a recorded one. Where two sources disagree
 * about the same event, BOTH markers are drawn and joined by a bracket --
 * disagreement is the point, so it stays legible instead of picking a winner.
 *
 * `layoutTimeline()` is exported and pure (plain rows in, plain geometry out):
 * the reversed scale, row assignment, stacking, and dispute grouping are the
 * non-delegating logic issue #14's testing decision calls unit tests for.
 *
 * Properties
 *   data  the `loadAncestorTimeline()` result to render
 */

const MARGIN = { top: 56, right: 28, bottom: 24, left: 200 }
const ROW_HEIGHT = 84
const STACK_STEP = 50
const MIN_GAP = 150

const GENERATION_NAMES = ['self', 'parents', 'grandparents']

function bare(token) {
    return String(token ?? '').split(/[#/]/).pop()
}

/**
 * Assign pixel positions to timeline rows and markers. Pure: no DOM.
 * @param {Object} input
 * @param {Array<Object>} input.people `{id,label,generation}` chain members
 * @param {Array<Object>} input.items dated assertion rows (see model/timeline)
 * @param {Object} [input.options] `{ width }` overrides
 * @returns {{width:number,height:number,ticks:Array,rows:Array,markers:Array,disputes:Array}}
 */
export function layoutTimeline({ people = [], items = [], options = {} } = {}) {
    const width = options.width || 1200
    const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 100)

    const order = [...people].sort((a, b) =>
        (a.generation - b.generation)
        || (b.subject === true ? 1 : 0) - (a.subject === true ? 1 : 0)
        || String(a.label).localeCompare(String(b.label)))
    const rows = order.map((person, index) => ({
        personId: person.id,
        label: person.label,
        generation: person.generation,
        generationLabel: GENERATION_NAMES[person.generation] || `g${person.generation + 1}`,
        y: MARGIN.top + index * ROW_HEIGHT + ROW_HEIGHT / 2
    }))

    const dated = items.filter(item => Number.isFinite(item.year))
    const years = dated.map(item => item.year)
    const minYear = years.length ? Math.min(...years) : null
    const maxYear = years.length ? Math.max(...years) : null
    // A little headroom so end markers do not sit on the axis edge.
    const domainMin = minYear === null ? null : minYear - 2
    const domainMax = maxYear === null ? null : maxYear + 2

    // REVERSED x-scale: the newest year is at the left edge.
    const xFor = year => {
        if (minYear === null) return MARGIN.left
        if (maxYear === minYear) return MARGIN.left + innerWidth / 2
        return MARGIN.left + ((domainMax - year) / (domainMax - domainMin)) * innerWidth
    }

    const ticks = []
    if (minYear !== null) {
        const step = pickTickStep(maxYear - minYear)
        const first = Math.ceil(domainMin / step) * step
        for (let year = first; year <= domainMax; year += step) {
            ticks.push({ year, x: xFor(year), label: String(year) })
        }
    }

    const markers = []
    for (const row of rows) {
        const rowItems = dated
            .filter(item => item.personId === row.personId)
            .sort((a, b) => b.year - a.year)
        let previous = null
        let stack = 0
        for (const item of rowItems) {
            const x = xFor(item.year)
            if (previous !== null && Math.abs(x - previous) < MIN_GAP) stack += 1
            else stack = 0
            previous = x
            markers.push({
                ...item,
                x,
                y: row.y - STACK_STEP / 2 + stack * STACK_STEP,
                stacked: stack > 0
            })
        }
    }

    // Two rows disagreeing about the same (person, event/fact): connect them.
    const disputes = []
    const groups = new Map()
    for (const marker of markers) {
        const key = `${marker.personId}|${marker.eventId || marker.property || marker.id}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(marker)
    }
    for (const group of groups.values()) {
        const distinct = new Set(group.map(marker => marker.display))
        if (group.length > 1 && distinct.size > 1) {
            const xs = group.map(marker => marker.x)
            disputes.push({
                personId: group[0].personId,
                eventId: group[0].eventId,
                y: group[0].y,
                x1: Math.min(...xs),
                x2: Math.max(...xs),
                count: group.length,
                label: `disputed ×${group.length}`
            })
        }
    }

    const height = MARGIN.top + Math.max(rows.length, 1) * ROW_HEIGHT + MARGIN.bottom
    return { width, height, ticks, rows, markers, disputes }
}

function pickTickStep(span) {
    for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) {
        if (span / step <= 12) return step
    }
    return 1000
}

export class GLAncestorTimeline extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
    }

    set data(data) {
        this._data = data
        this._render()
    }

    get data() {
        return this._data
    }

    connectedCallback() {
        if (this._data) this._render()
        else this.shadowRoot.innerHTML = '<p class="hint">Nothing to draw yet.</p>'
    }

    _render() {
        const data = this._data || { people: [], items: [], undated: [] }
        const layout = layoutTimeline(data)
        const parts = [`<style>${STYLE}</style>`, renderSvg(layout), renderLegend(), renderUndated(data.undated || [])]
        this.shadowRoot.innerHTML = parts.join('')
    }
}

function renderSvg({ width, height, ticks, rows, markers, disputes }) {
    const grid = ticks.map(tick => `
        <line class="grid" x1="${tick.x}" x2="${tick.x}" y1="${MARGIN.top - 16}" y2="${height - MARGIN.bottom}"/>
        <text class="tick" x="${tick.x}" y="${MARGIN.top - 24}" text-anchor="middle">${tick.label}</text>`).join('')
    const rowLines = rows.map(row => `
        <line class="life" x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${row.y}" y2="${row.y}"/>
        <text class="who" x="${MARGIN.left - 12}" y="${row.y - 2}" text-anchor="end">${escapeHtml(row.label)}</text>
        <text class="gen" x="${MARGIN.left - 12}" y="${row.y + 14}" text-anchor="end">${escapeHtml(row.generationLabel)}</text>`).join('')
    const brackets = disputes.map(dispute => `
        <path class="dispute" d="M ${dispute.x1} ${dispute.y + 22} q ${(dispute.x2 - dispute.x1) / 2} 16 ${dispute.x2 - dispute.x1} 0" fill="none"/>
        <text class="dispute-label" x="${(dispute.x1 + dispute.x2) / 2}" y="${dispute.y + 40}" text-anchor="middle">${dispute.label}</text>`).join('')
    const dots = markers.map(marker => {
        const cls = marker.estimated ? 'marker estimated' : 'marker'
        const confidence = Number.isFinite(marker.confidence) ? ` · confidence ${Math.round(marker.confidence * 100)}%` : ''
        const note = marker.estimatedNote ? `\n${marker.estimatedNote}` : ''
        const range = marker.span ? ` (${marker.span[0]}–${marker.span[1]})` : ''
        const title = `${marker.roleLabel} · ${marker.eventLabel}${range}${confidence}${note}`
        return `
            <g>
                <title>${escapeHtml(title)}</title>
                <circle class="${cls}" cx="${marker.x}" cy="${marker.y}" r="6"/>
                <text class="m-date${marker.estimated ? ' estimated' : ''}" x="${marker.x + 10}" y="${marker.y + 4}">${escapeHtml(marker.display)}${marker.estimated ? ' ⊙' : ''}</text>
                <text class="m-sub" x="${marker.x + 10}" y="${marker.y + 18}">${escapeHtml(marker.roleLabel)} · ${escapeHtml(bare(marker.eventSubtype) || 'fact')}</text>
                <text class="m-ev" x="${marker.x + 10}" y="${marker.y + 31}">${escapeHtml(marker.evidenceLabel || 'no evidence cited')}</text>
            </g>`
    }).join('')
    return `
        <div class="scroller">
            <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
                 role="img" aria-label="Ancestor timeline; newest events at the left">
                ${grid}${rowLines}${brackets}${dots}
            </svg>
        </div>`
}

function renderLegend() {
    return `
        <p class="legend">
            <span><span class="dot solid"></span> asserted date</span>
            <span><span class="dot hollow"></span> estimated / qualified</span>
            <span>newest dates are on the left; markers sharing an event show every conflicting assertion</span>
        </p>`
}

function renderUndated(undated) {
    if (!undated.length) return ''
    const rows = undated.map(entry => {
        const who = (entry.persons || []).map(person => `${person.label} (${person.roleLabel})`).join(', ')
        const what = entry.eventLabel || 'assertion'
        const value = entry.display ? ` “${escapeHtml(entry.display)}”` : ''
        const evidence = entry.evidenceLabel ? ` — evidence: ${escapeHtml(entry.evidenceLabel)}` : ''
        return `<li>${escapeHtml(what)}${value}: ${escapeHtml(who)}${evidence}</li>`
    }).join('')
    return `<p class="undated-heading">Dated events and assertions without a usable year</p><ul class="undated">${rows}</ul>`
}

const STYLE = `
    :host { display: block; }
    .scroller { overflow-x: auto; background: #fff; border-radius: 8px; }
    svg { display: block; font-family: inherit; }
    .grid { stroke: #e4e9ef; stroke-width: 1; }
    .tick { fill: #556677; font-size: 12px; }
    .life { stroke: #b8c4d0; stroke-width: 2; }
    .who { fill: #222; font-size: 14px; font-weight: 600; }
    .gen { fill: #78909c; font-size: 11px; }
    .marker { fill: #1976d2; stroke: #1976d2; }
    .marker.estimated { fill: #fff; stroke: #1976d2; stroke-dasharray: 3 2; }
    .m-date { fill: #222; font-size: 13px; font-weight: 600; }
    .m-date.estimated { fill: #b26a00; font-style: italic; }
    .m-sub { fill: #556677; font-size: 11px; }
    .m-ev { fill: #78909c; font-size: 11px; font-style: italic; }
    .dispute { stroke: #c62828; stroke-width: 1.5; stroke-dasharray: 4 3; }
    .dispute-label { fill: #c62828; font-size: 11px; }
    .legend { display: flex; flex-wrap: wrap; gap: 1.5em; color: #556677; font-size: 13px; margin: 0.5em 0 0; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 0.35em; }
    .dot.solid { background: #1976d2; }
    .dot.hollow { background: #fff; border: 2px dashed #1976d2; }
    .undated-heading { margin: 1em 0 0.25em; font-weight: 600; color: #556677; }
    .undated { margin: 0; padding-left: 1.25em; color: #556677; }
    .hint { color: #556677; }
`

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'
    }[c]))
}

if (!customElements.get('gl-ancestor-timeline')) {
    customElements.define('gl-ancestor-timeline', GLAncestorTimeline)
}

export default GLAncestorTimeline
