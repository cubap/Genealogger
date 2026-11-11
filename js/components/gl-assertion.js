/**
 * @module components/gl-assertion
 * @description `gl-assertion` renders ONE ValueObject as an auditable row: the
 * asserted value, the evidence it rests on, and a per-assertion confidence
 * control that writes nv:confidence. Conflicting claims of the same property
 * are separate rows because the model hands each ValueObject down individually
 * (see toAssertionRows) — the component never merges them.
 *
 * The component is presentational: it receives a plain view row via `.row` and
 * dispatches `gl-confidence-change`. It does NOT fetch or know storage shapes.
 * The pure helpers (`parseConfidence`, `formatConfidence`, `toAssertionRows`)
 * are exported so the non-trivial logic (confidence parsing, ValueObject list
 * rendering) is unit-tested without a DOM.
 *
 * Attributes / properties
 *   row        {Object} view row: { property, propertyLabel, value, evidence,
 *                    evidenceLabel, confidence, qualifiers?, conflicting? }
 *   readonly   {boolean} hide the confidence control (migrated view)
 *
 * Events (bubbles, composed)
 *   gl-confidence-change  detail: { property, value, confidence }
 *
 * Pure helpers exported: CONFIDENCE_LEVELS, parseConfidence, formatConfidence,
 * toAssertionRows (ValueObjects -> ordered rows, qualifiers included) and
 * toAssertionGroups (rows -> one group per assertion type, conflicts flagged).
 */

import { NV } from '../model/vocabulary.js'

/** Named confidence levels -> nv:confidence, kept in step with the control. */
export const CONFIDENCE_LEVELS = [
    { token: 'certain', label: 'Certain', value: 1 },
    { token: 'high', label: 'High', value: 0.9 },
    { token: 'medium', label: 'Medium', value: 0.5 },
    { token: 'low', label: 'Low', value: 0.25 },
    { token: 'uncertain', label: 'Uncertain', value: 0.1 }
]

const LEVEL_BY_TOKEN = Object.fromEntries(CONFIDENCE_LEVELS.map(l => [l.token, l.value]))

/**
 * Parse a confidence control value into an nv:confidence number 0-1.
 * Accepts numbers, numeric strings, percentages, and named levels; returns
 * undefined for empty/unparseable input so callers can omit the assertion's
 * confidence rather than guess.
 * @param {number|string|null|undefined} raw
 * @returns {number|undefined}
 */
export function parseConfidence(raw) {
    if (raw === null || raw === undefined || raw === '') return undefined
    if (typeof raw === 'number') {
        if (Number.isNaN(raw)) return undefined
        return Math.min(1, Math.max(0, raw))
    }
    const text = String(raw).trim().toLowerCase()
    if (!text) return undefined
    if (text in LEVEL_BY_TOKEN) return LEVEL_BY_TOKEN[text]
    if (text.endsWith('%')) {
        const pct = parseFloat(text)
        return Number.isNaN(pct) ? undefined : Math.min(1, Math.max(0, pct / 100))
    }
    const num = Number(text)
    if (Number.isFinite(num)) return Math.min(1, Math.max(0, num))
    return undefined
}

/**
 * Render a stored nv:confidence number back to a display string.
 * @param {number|string|null|undefined} raw
 * @returns {string} e.g. '90%', or '' when absent
 */
export function formatConfidence(raw) {
    const value = parseConfidence(raw)
    return value === undefined ? '' : `${Math.round(value * 100)}%`
}

function confidenceToken(value) {
    const parsed = parseConfidence(value)
    if (parsed === undefined) return ''
    const exact = CONFIDENCE_LEVELS.find(l => l.value === parsed)
    if (exact) return exact.token
    return String(parsed)
}

/** Keys a ValueObject always reserves; anything else is a qualifier on it. */
const RESERVED_VO_KEYS = ['value', 'source', 'evidence', NV.confidence]

/**
 * Every extra key a ValueObject carries beyond value/source/evidence/confidence,
 * as `{ key, label, value }`. This is how a name assertion ships its type and
 * active range without inventing a second, unjoinable annotation.
 * @param {Object} vo a resolved ValueObject
 * @param {Object<string,string>} [qualifierLabels] property URI -> display label
 * @returns {Array<Object>} qualifiers, empty for a plain ValueObject
 */
function qualifiersOf(vo, qualifierLabels = {}) {
    const qualifiers = []
    for (const [key, raw] of Object.entries(vo)) {
        if (RESERVED_VO_KEYS.includes(key)) continue
        // A qualifier is itself a ValueObject; one with no value carries nothing.
        if (raw && typeof raw === 'object' && !('value' in raw)) continue
        const value = raw && typeof raw === 'object' ? raw.value : raw
        if (value === undefined || value === null || value === '') continue
        qualifiers.push({ key, label: qualifierLabels[key] || key.split(/[#/]/).pop(), value })
    }
    return qualifiers
}

/**
 * Flatten a grouped-assertions map (property -> ValueObject | ValueObject[])
 * into an ordered list of view rows. One row per ValueObject, so two disagreeing
 * sources of the same property become two rows and are never collapsed.
 * @param {Object<string, Object|Array<Object>>} grouped the resolved assertions
 * @param {Object} [options]
 * @param {Object<string,string>} [options.propertyLabels] property URI -> label
 * @param {Object<string,string>} [options.evidenceLabels] evidence id -> label
 * @param {Array<string>} [options.order] preferred property order
 * @param {Object<string,string>} [options.qualifierLabels] qualifier URI -> label
 * @returns {Array<Object>} view rows
 */
export function toAssertionRows(grouped = {}, options = {}) {
    const { propertyLabels = {}, evidenceLabels = {}, qualifierLabels = {}, order } = options
    const properties = order
        ? [...order.filter(p => p in grouped), ...Object.keys(grouped).filter(p => !order.includes(p))]
        : Object.keys(grouped)
    const rows = []
    for (const property of properties) {
        const raw = grouped[property]
        const valueObjects = Array.isArray(raw) ? raw : [raw]
        for (const vo of valueObjects) {
            if (!vo || typeof vo !== 'object') continue
            const evidence = vo.evidence
            const row = {
                property,
                propertyLabel: propertyLabels[property] || property.split(/[#/]/).pop(),
                value: vo.value,
                comment: vo.source && vo.source.comment,
                citation: vo.source && (vo.source.citationSource || vo.source.citationNote),
                evidence,
                evidenceLabel: (evidence && evidenceLabels[evidence]) || evidence || '',
                confidence: vo[NV.confidence]
            }
            const qualifiers = qualifiersOf(vo, qualifierLabels)
            if (qualifiers.length) row.qualifiers = qualifiers
            rows.push(row)
        }
    }
    return rows
}

/**
 * Bucket flat assertion rows into one group per assertion type — the audit view
 * of #14 story 3 — and mark a group `conflicting` when it holds more than one
 * distinct value. Grouping never merges rows: a conflict is two rows displayed
 * side by side, which is exactly what the flag tells the page to highlight.
 * @param {Array<Object>} rows output of toAssertionRows()
 * @returns {Array<{property: string, propertyLabel: string, conflicting: boolean, rows: Array<Object>}>}
 */
export function toAssertionGroups(rows = []) {
    const groups = []
    const byProperty = new Map()
    for (const row of rows) {
        if (!byProperty.has(row.property)) {
            const group = { property: row.property, propertyLabel: row.propertyLabel, conflicting: false, rows: [] }
            byProperty.set(row.property, group)
            groups.push(group)
        }
        byProperty.get(row.property).rows.push(row)
    }
    for (const group of groups) {
        const values = new Set(group.rows.map(row => String(row.value ?? '')))
        group.conflicting = values.size > 1
    }
    return groups
}

export class GLAssertion extends HTMLElement {
    static get observedAttributes() {
        return ['readonly']
    }

    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
        this._row = null
    }

    /** @returns {boolean} whether the confidence control is suppressed */
    get readonly() {
        return this.hasAttribute('readonly')
    }

    set readonly(flag) {
        if (flag) this.setAttribute('readonly', '')
        else this.removeAttribute('readonly')
    }

    /** @param {Object} row view row produced by toAssertionRows() */
    set row(row) {
        this._row = row
        this.render()
    }

    get row() {
        return this._row
    }

    attributeChangedCallback() {
        this.render()
    }

    connectedCallback() {
        this.render()
    }

    render() {
        const row = this._row
        if (!row) {
            this.shadowRoot.innerHTML = ''
            return
        }
        const readonly = this.readonly
        const token = confidenceToken(row.confidence)
        const qualifierText = (row.qualifiers || [])
            .map(qualifier => `${qualifier.label}: ${String(qualifier.value ?? '')}`)
            .join(' · ')
        const options = CONFIDENCE_LEVELS
            .map(level => `<option value="${level.token}"${level.token === token ? ' selected' : ''}>${level.label}</option>`)
            .join('')
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; margin: 0.4rem 0; padding: 0.4rem 0.5rem; border-left: 3px solid #9aa; }
                .prop { font-weight: 600; }
                .value { margin-left: 0.4rem; }
                .meta { display: block; font-size: 0.85rem; color: #556; margin-top: 0.15rem; }
                .conf { margin-left: 0.5rem; }
                .conflict { margin-left: 0.5rem; font-size: 0.75rem; color: #8a2b2b; border: 1px solid #8a2b2b; border-radius: 3px; padding: 0 0.25rem; }
            </style>
            <span class="prop">${escapeHtml(row.propertyLabel)}</span>
            <span class="value">${escapeHtml(String(row.value ?? ''))}</span>
            ${row.conflicting ? '<span class="conflict">conflicting claims</span>' : ''}
            <span class="meta">
                evidence: ${escapeHtml(row.evidenceLabel || '—')}
                <span class="conf">confidence: ${escapeHtml(formatConfidence(row.confidence) || '—')}</span>
                ${row.comment ? `&nbsp;(${escapeHtml(row.comment)})` : ''}
                ${qualifierText ? `&nbsp;·&nbsp;${escapeHtml(qualifierText)}` : ''}
            </span>
            ${readonly ? '' : `<label class="meta">Set confidence
                <select class="confidence">${options}</select>
            </label>`}
        `
        if (!readonly) {
            const select = this.shadowRoot.querySelector('select.confidence')
            select.addEventListener('change', () => {
                const confidence = parseConfidence(select.value)
                this.dispatchEvent(new CustomEvent('gl-confidence-change', {
                    bubbles: true,
                    composed: true,
                    detail: { property: row.property, value: row.value, confidence }
                }))
            })
        }
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'
    }[ch]))
}

if (!customElements.get('gl-assertion')) {
    customElements.define('gl-assertion', GLAssertion)
}

export default GLAssertion
