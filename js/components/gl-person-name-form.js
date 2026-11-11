/**
 * @module components/gl-person-name-form
 * @description `gl-person-name-form` is the person page's "add any name" form
 * (issue #14 user story 5). Like `gl-birth-form` it renders in LIGHT DOM with
 * `deer-key` inputs so the DEER surface vocabulary survives, and it saves
 * nothing: on submit it maps the HTML to a plain object and dispatches
 * `gl-person-name-submit`; the page handler calls model/person.assertPersonName,
 * which does the writes. A name therefore always travels with the three things
 * the model needs to keep it auditable — the property it is asserted under, its
 * type + active range, and the evidence document behind it.
 *
 * Attributes
 *   person   id of the existing Person being annotated (optional; omit to have
 *            the model mint a Person from this name — the index "New Person"
 *            link lands on a bare person.html)
 *
 * Properties
 *   evidencePicker  the inner <gl-evidence-picker> (records set by the page)
 *   value           collected form data (get); loads values into the fields (set)
 *
 * Events (bubbles)
 *   gl-person-name-submit  detail: the collected form data object
 */

import { parseConfidence } from './gl-assertion.js'
import './gl-evidence-picker.js'

/** deer-key inputs the form collects. */
const FIELD_KEYS = ['name', 'nameProperty', 'nameType', 'activeFrom', 'activeTo']

export class GLPersonNameForm extends HTMLElement {
    connectedCallback() {
        if (this._wired) return
        this._wired = true
        this.querySelector('form').addEventListener('submit', event => {
            event.preventDefault()
            this.dispatchEvent(new CustomEvent('gl-person-name-submit', { bubbles: true, detail: this.value }))
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

    /** Load values into the fields (used when prefilling from an assertion). */
    set value(data) {
        if (!data) return
        if (data.personId) this.personId = data.personId
        for (const key of FIELD_KEYS) {
            const input = this.querySelector(`[deer-key="${key}"]`)
            if (input && data[key] !== undefined && data[key] !== null) input.value = data[key]
        }
        if (data.evidence && this.evidencePicker) this.evidencePicker.value = data.evidence
    }

    /** @returns {Object} the collected form data (model input shape). */
    get value() {
        const get = key => {
            const input = this.querySelector(`[deer-key="${key}"]`)
            return input ? input.value.trim() : ''
        }
        const confidenceInput = this.querySelector('[data-confidence-for="name"]')
        return {
            personId: this.personId || undefined,
            propertyToken: get('nameProperty') || 'full',
            value: get('name'),
            nameType: get('nameType'),
            activeFrom: get('activeFrom'),
            activeTo: get('activeTo'),
            confidence: confidenceInput ? parseConfidence(confidenceInput.value) : undefined,
            evidence: this.evidencePicker ? this.evidencePicker.value : { id: '', title: '' }
        }
    }
}

if (!customElements.get('gl-person-name-form')) {
    customElements.define('gl-person-name-form', GLPersonNameForm)
}

export default GLPersonNameForm
