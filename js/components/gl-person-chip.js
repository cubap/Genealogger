/**
 * @module components/gl-person-chip
 * @description `gl-person-chip` is THE person list-item / picker-row element
 * (issue #14 story 2): the index renders every Person through it and a person
 * picker embeds the very same element, so a person is displayed identically
 * everywhere instead of each page reinventing a `<li>`.
 *
 * Presentational by design. It renders a plain view object it is handed -- a
 * `listPersons()` row, a bare Person entity, or an `{ id, label }` pair -- and
 * dispatches `gl-person-select`. It never fetches, never touches a store, and
 * derives nothing expensive: birth/death spans are ANNOTATIONS, and resolving
 * them per row is exactly the N-query pattern the index must avoid. A caller
 * that already has a date to show passes it in as `detail`.
 *
 * Attributes (declarative use, e.g. hand-written markup)
 *   person-id  the Person id
 *   label      display text; derived from `person` data when omitted
 *   href       link target; defaults to `person.html#<person-id>`, and an
 *              explicit empty value renders an unlinked chip (picker mode)
 *   detail     secondary text (a date, a role, anything the caller resolved)
 *   selected   mark the chip as the picker's current choice
 * Properties
 *   person     plain object/view to render; wins over the attributes
 * Events (bubbles, composed)
 *   gl-person-select  detail: { id, label }
 */

import { deriveLabel, UNLABELED } from '../model/search.js'

/** Where a Person's own page lives; the id is appended as the fragment. */
export const PERSON_HREF = 'person.html#'

function firstText(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue
        const text = String(value).trim()
        if (text) return text
    }
    return ''
}

/**
 * Normalize anything chip-shaped into the view the element renders. Kept pure
 * (no DOM) so the mapping -- the chip's only non-trivial logic -- is unit-testable.
 * @param {Object|string|null} [source] a `listPersons()` row, a bare entity, an
 *   `{ id, label }` pair, or a plain label/id string
 * @param {Object} [options] explicit overrides (`id`, `label`, `href`, `detail`)
 * @returns {{id: string, label: string, href: string, detail: string}}
 */
export function toChipView(source, options = {}) {
    const fallback = typeof source === 'string' ? { label: source } : (source || {})
    const entity = fallback.entity || fallback
    const id = firstText(options.id, fallback.id, entity['@id'], entity.id)
    const label = firstText(options.label, fallback.label) || deriveLabel(entity) || UNLABELED
    const detail = firstText(options.detail, fallback.detail)
    const href = options.href !== undefined
        ? firstText(options.href)
        : (id ? PERSON_HREF + id : '')
    return { id, label, href, detail }
}

export class GLPersonChip extends HTMLElement {
    static get observedAttributes() {
        return ['person-id', 'label', 'href', 'detail', 'selected']
    }

    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
    }

    connectedCallback() {
        this._render()
    }

    attributeChangedCallback() {
        if (this.isConnected) this._render()
    }

    /**
     * The view to render: an assigned object wins, otherwise build one from the
     * attributes so `<gl-person-chip label="Ada" person-id="...">` works too.
     * @returns {{id: string, label: string, href: string, detail: string}}
     */
    get view() {
        if (this._view) return this._view
        return toChipView(null, {
            id: this.getAttribute('person-id'),
            label: this.getAttribute('label'),
            href: this.hasAttribute('href') ? this.getAttribute('href') : undefined,
            detail: this.getAttribute('detail')
        })
    }

    set person(view) {
        this._view = toChipView(view)
        this._render()
    }

    get person() {
        return this.view
    }

    get selected() {
        return this.hasAttribute('selected')
    }

    set selected(value) {
        this.toggleAttribute('selected', Boolean(value))
    }

    _render() {
        const view = this.view
        const selectedClass = this.selected ? ' selected' : ''
        const detail = view.detail
            ? `<span class="detail">${escapeHtml(view.detail)}</span>`
            : ''
        const inner = `<span class="name">${escapeHtml(view.label)}</span>${detail}`
        // A chip with a target is a link (the index); without one it is a button
        // a picker selects.
        const control = view.href
            ? `<a class="chip${selectedClass}" href="${escapeHtml(view.href)}" title="${escapeHtml(view.label)}">${inner}</a>`
            : `<button type="button" class="chip${selectedClass}" title="${escapeHtml(view.label)}">${inner}</button>`
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: inline-block; }
                .chip {
                    align-items: center;
                    background: #f0f0f0;
                    border: 1px solid #e0e0e0;
                    border-radius: 16px;
                    color: inherit;
                    cursor: pointer;
                    display: inline-flex;
                    font: inherit;
                    gap: 0.5em;
                    padding: 0.45em 1em;
                    text-decoration: none;
                }
                .chip:hover { background: #e0e0e0; }
                .chip:focus-visible { outline: 2px solid #1976d2; outline-offset: 1px; }
                .chip.selected { background: #d7e8fb; border-color: #1976d2; }
                .name { font-weight: 600; }
                .detail { color: #556677; font-size: 0.9em; }
            </style>
            ${control}
        `
        this._wire()
    }

    _wire() {
        const control = this.shadowRoot.querySelector('.chip')
        if (!control || control._wired) return
        control._wired = true
        control.addEventListener('click', () => {
            // Pickers listen for this. A chip with an href also navigates, so a
            // listener must not assume it owns the click.
            this.dispatchEvent(new CustomEvent('gl-person-select', {
                bubbles: true,
                composed: true,
                detail: { id: this.view.id, label: this.view.label }
            }))
        })
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'
    }[c]))
}

if (!customElements.get('gl-person-chip')) {
    customElements.define('gl-person-chip', GLPersonChip)
}
