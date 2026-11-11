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
 *                    evidenceLabel, confidence }
 *   readonly   {boolean} hide the confidence control (migrated view)
 *
 * Events (bubbles, composed)
 *   gl-confidence-change  detail: { property, value, confidence }
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

/**
 * Flatten a grouped-assertions map (property -> ValueObject | ValueObject[])
 * into an ordered list of view rows. One row per ValueObject, so two disagreeing
 * sources of the same property become two rows and are never collapsed.
 * @param {Object<string, Object|Array<Object>>} grouped the resolved assertions
 * @param {Object} [options]
 * @param {Object<string,string>} [options.propertyLabels] property URI -> label
 * @param {Object<string,string>} [options.evidenceLabels] evidence id -> label
 * @param {Array<string>} [options.order] preferred property order
 * @returns {Array<Object>} view rows
 */
export function toAssertionRows(grouped = {}, options = {}) {
    const { propertyLabels = {}, evidenceLabels = {}, order } = options
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
            rows.push({
                property,
                propertyLabel: propertyLabels[property] || property.split(/[#/]/).pop(),
                value: vo.value,
                comment: vo.source && vo.source.comment,
                citation: vo.source && (vo.source.citationSource || vo.source.citationNote),
                evidence,
                evidenceLabel: (evidence && evidenceLabels[evidence]) || evidence || '',
                confidence: vo[NV.confidence]
            })
        }
    }
    return rows
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
            </style>
            <span class="prop">${escapeHtml(row.propertyLabel)}</span>
            <span class="value">${escapeHtml(String(row.value ?? ''))}</span>
            <span class="meta">
                evidence: ${escapeHtml(row.evidenceLabel || '—')}
                <span class="conf">confidence: ${escapeHtml(formatConfidence(row.confidence) || '—')}</span>
                ${row.comment ? `&nbsp;(${escapeHtml(row.comment)})` : ''}
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
