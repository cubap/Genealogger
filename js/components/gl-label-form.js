/**
 * @module components/gl-label-form
 * @description `gl-label-form` is the label page's form component — the label
 * twin of gl-death-form/gl-birth-form. It renders in LIGHT DOM so the familiar
 * DEER surface vocabulary survives untouched: the input keeps its
 * `deer-key="name"` name and the element is a plain container around the page's
 * own markup. On submit it does NOT save anything and NEVER fetches — it maps
 * the HTML surface to a plain form-data object and dispatches
 * `gl-label-submit`; the page handler calls the model (model/label.saveLabel),
 * which performs the writes and refreshes the bare `label` cache.
 *
 * One name, one source, one confidence: the label page has no participant rows
 * and no date/place fields, because a display name is not an event fact — the
 * evidence document named here supports the name claim directly.
 *
 * Attributes
 *   person  id of the person being named (required to save; set by the page)
 *
 * Properties
 *   evidencePicker  the inner <gl-evidence-picker> (records set by the page)
 *   value           collected form data (get); loads values into the fields (set)
 *
 * Events (bubbles)
 *   gl-label-submit  detail: the collected form data object
 */

import { parseConfidence } from './gl-assertion.js'
import './gl-evidence-picker.js'

const CONFIDENCE_CHOICES = [
    { token: '', label: '(inherit)' },
    { token: 'certain', label: 'Certain' },
    { token: 'high', label: 'High' },
    { token: 'medium', label: 'Medium' },
    { token: 'low', label: 'Low' },
    { token: 'uncertain', label: 'Uncertain' }
]

function tokenForConfidence(value) {
    const parsed = parseConfidence(value)
    if (parsed === undefined) return ''
    const found = CONFIDENCE_CHOICES.find(c => c.token && parseConfidence(c.token) === parsed)
    return found ? found.token : String(parsed)
}

export class GLLabelForm extends HTMLElement {
    connectedCallback() {
        if (this._wired) return
        this._wired = true
        // Bound on the inner form looked up FROM THE HOST, not on a wrapper
        // element: gl-death-form documents the failure mode where a control that
        // is a sibling of the container its handler sits on silently never fires.
        // Scoping the lookup to `this` keeps the submit working wherever the page
        // puts the submit control inside this element.
        const form = this.querySelector('form')
        if (!form) return
        form.addEventListener('submit', event => {
            event.preventDefault()
            const detail = this.value
            this.dispatchEvent(new CustomEvent('gl-label-submit', { bubbles: true, detail }))
        })
    }

    get personId() {
        return this.getAttribute('person') || ''
    }

    set personId(id) {
        if (id) this.setAttribute('person', id)
        else this.removeAttribute('person')
    }

    /** @returns {HTMLElement} the inner evidence picker */
    get evidencePicker() {
        return this.querySelector('gl-evidence-picker')
    }

    /** @returns {HTMLSelectElement|undefined} the confidence control */
    get confidenceControl() {
        return this.querySelector('[data-confidence]') || undefined
    }

    /**
     * The option token for a confidence value, adding an option when the page's
     * markup has no word for it. A stored 0.73 that quietly fell back to
     * "(inherit)" would be re-asserted with no confidence at all, so an unknown
     * number keeps its value instead of being lost.
     * @param {number|string} value raw nv:confidence
     * @returns {string} option value to select ('' means "(inherit)")
     */
    ensureConfidenceToken(value) {
        const control = this.confidenceControl
        const token = tokenForConfidence(value)
        if (token && !Array.from(control.options).some(option => option.value === token)) {
            control.appendChild(new Option(token, token))
        }
        return token
    }

    /** Load existing values into the fields (used when showing a person). */
    set value(data) {
        if (!data) return
        if (data.personId) this.personId = data.personId
        const input = this.querySelector('[deer-key="name"]')
        if (input && data.name !== undefined && data.name !== null) input.value = data.name
        if (this.confidenceControl && data.confidence !== undefined) {
            this.confidenceControl.value = this.ensureConfidenceToken(data.confidence)
        }
        if (data.evidence && this.evidencePicker) this.evidencePicker.value = data.evidence
    }

    /** @returns {Object} the collected form data (model input shape). */
    get value() {
        const input = this.querySelector('[deer-key="name"]')
        const evidence = this.evidencePicker ? this.evidencePicker.value : { id: '', title: '' }
        return {
            personId: this.personId || undefined,
            name: input ? input.value.trim() : '',
            evidence,
            // `(inherit)` and an absent control both mean "no opinion", which the
            // model stores as an assertion without nv:confidence — never as 0.
            confidence: parseConfidence(this.confidenceControl ? this.confidenceControl.value : undefined)
        }
    }
}

if (!customElements.get('gl-label-form')) {
    customElements.define('gl-label-form', GLLabelForm)
}

export default GLLabelForm
