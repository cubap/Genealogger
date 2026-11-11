/**
 * @module components/gl-evidence-picker
 * @description `gl-evidence-picker` is the control that names the EVIDENCE
 * DOCUMENT (a Record: certificate, announcement, family bible) SEPARATELY from
 * the facts it asserts — user story #2 and constraint #9. It either supplies a
 * fresh title for a new Record or selects an existing one the page handed it.
 * It carries no fetch and no storage shape: the page loads known records via the
 * model and sets them on `.records`; the picker just reports a choice.
 *
 * Attributes (retained DEER surface vocabulary)
 *   deerlabel   field label text (defaults to "Evidence document")
 *   deerequired presence makes an empty title invalid
 *
 * Properties
 *   records     Array<{ id, title }> existing Records to choose among
 *   value       { id, title } current selection (get/set)
 *
 * Events (bubbles, composed)
 *   gl-evidence-change   detail: { id, title }
 */

export class GLEvidencePicker extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
        this._records = []
    }

    get label() {
        return this.getAttribute('deerlabel') || 'Evidence document'
    }

    /** @param {Array<{id: string, title: string}>} records */
    set records(records) {
        this._records = Array.isArray(records) ? records : []
        this.render()
    }

    get records() {
        return this._records
    }

    get value() {
        const titleInput = this.shadowRoot.querySelector('input.title')
        const existing = this.shadowRoot.querySelector('select.existing')
        const chosenId = existing && existing.value ? existing.value : ''
        return {
            id: chosenId || '',
            title: (titleInput && titleInput.value.trim()) || (chosenId ? this._titleFor(chosenId) : '')
        }
    }

    set value(val) {
        this.render()
        if (!val) return
        const titleInput = this.shadowRoot.querySelector('input.title')
        const existing = this.shadowRoot.querySelector('select.existing')
        if (val.id && existing) existing.value = val.id
        if (val.title && titleInput && !val.id) titleInput.value = val.title
    }

    _titleFor(id) {
        const found = this._records.find(rec => rec.id === id)
        return found ? found.title : ''
    }

    connectedCallback() {
        this.render()
    }

    render() {
        const options = this._records
            .map(rec => `<option value="${rec.id}">${escapeHtml(rec.title)}</option>`)
            .join('')
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; margin: 0.5rem 0; padding: 0.5rem; background: #f6f7fb; border-radius: 4px; }
                .row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
                label { font-weight: 600; }
                input.title { flex: 1 1 14rem; }
                small { display: block; color: #556; font-weight: 400; }
            </style>
            <label>${escapeHtml(this.label)}<small>Name the source document, separate from the facts it supports.</small></label>
            <div class="row">
                <input class="title" type="text" placeholder="e.g. Parish baptism certificate, 1815" aria-label="${escapeHtml(this.label)} title">
                ${this._records.length ? `<select class="existing" aria-label="Existing evidence document"><option value="">— new document —</option>${options}</select>` : ''}
            </div>
        `
        const emit = () => this.dispatchEvent(new CustomEvent('gl-evidence-change', {
            bubbles: true, composed: true, detail: this.value
        }))
        this.shadowRoot.querySelector('input.title').addEventListener('input', emit)
        const existing = this.shadowRoot.querySelector('select.existing')
        if (existing) {
            existing.addEventListener('change', () => {
                const titleInput = this.shadowRoot.querySelector('input.title')
                titleInput.value = existing.value ? this._titleFor(existing.value) : ''
                emit()
            })
        }
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'
    }[ch]))
}

if (!customElements.get('gl-evidence-picker')) {
    customElements.define('gl-evidence-picker', GLEvidencePicker)
}

export default GLEvidencePicker
