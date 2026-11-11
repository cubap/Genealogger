/**
 * @module components/gl-birth-form
 * @description `gl-birth-form` is the birth page's form component. It renders in
 * LIGHT DOM so the familiar DEER surface vocabulary survives untouched: the
 * inputs keep their `deer-key` names (givenName, familyName, birthDate, ...) and
 * the element reads `deereventtype` for the event subtype. On submit it does NOT
 * save anything and NEVER fetches — it maps the HTML surface to a plain
 * form-data object and dispatches `gl-birth-submit`; the page handler calls the
 * model (model/birth.saveBirth) which performs the writes. That keeps "no
 * data-shape knowledge in components" true while the attribute names stay put.
 *
 * Mother/father are entered as PARTICIPANT ROWS carrying a role (parent,
 * godparent, informant) rather than "father/mother" blanks — user story #3 —
 * and each participant (and each fact) can carry its own confidence (#7).
 *
 * Attributes
 *   deereventtype  event subtype token (default "Birth")
 *   person         id of an existing person being edited (optional)
 *
 * Properties
 *   evidencePicker the inner <gl-evidence-picker> (records set by the page)
 *   value          collected form data (get); loads values into the fields (set)
 *
 * Events (bubbles)
 *   gl-birth-submit   detail: the collected form data object
 */

import { parseConfidence } from './gl-assertion.js'
import './gl-evidence-picker.js'

/** Fact inputs this form recognises, by their retained deer-key name. */
const FACT_KEYS = ['givenName', 'familyName', 'additionalName', 'alternateName', 'birthPlace', 'birthDate', 'gender']

const PARTICIPANT_ROLES = [
    { token: 'parent', label: 'Parent' },
    { token: 'godparent', label: 'Godparent' },
    { token: 'informant', label: 'Informant' }
]

const CONFIDENCE_CHOICES = [
    { token: '', label: '(inherit)' },
    { token: 'certain', label: 'Certain' },
    { token: 'high', label: 'High' },
    { token: 'medium', label: 'Medium' },
    { token: 'low', label: 'Low' },
    { token: 'uncertain', label: 'Uncertain' }
]

function confidenceSelect(attr) {
    const opts = CONFIDENCE_CHOICES.map(c => `<option value="${c.token}">${c.label}</option>`).join('')
    return `<select ${attr}>${opts}</select>`
}

export class GLBirthForm extends HTMLElement {
    connectedCallback() {
        if (this._wired) return
        this._wired = true
        this.renderParticipantsChrome()
        this.querySelector('form').addEventListener('submit', event => {
            event.preventDefault()
            const detail = this.value
            this.dispatchEvent(new CustomEvent('gl-birth-submit', { bubbles: true, detail }))
        })
    }

    get eventType() {
        return this.getAttribute('deereventtype') || 'Birth'
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

    renderParticipantsChrome() {
        const list = this.querySelector('[data-participants]')
        if (!list) return
        list.addEventListener('click', event => {
            if (event.target.matches('[data-add-participant]')) {
                list.appendChild(this.createParticipantRow({ role: 'parent' }))
            } else if (event.target.matches('[data-remove-participant]')) {
                event.target.closest('[data-participant]').remove()
            }
        })
        if (!list.querySelector('[data-participant]')) {
            list.appendChild(this.createParticipantRow({ role: 'parent' }))
        }
    }

    createParticipantRow(participant = {}) {
        const template = document.createElement('template')
        template.innerHTML = `
            <div data-participant class="participant-row">
                <input type="text" data-participant-given placeholder="Given name" value="${escapeAttr(participant.given || '')}">
                <input type="text" data-participant-family placeholder="Family name" value="${escapeAttr(participant.family || '')}">
                <select data-role>${PARTICIPANT_ROLES.map(r => `<option value="${r.token}"${r.token === participant.role ? ' selected' : ''}>${r.label}</option>`).join('')}</select>
                <label>confidence ${confidenceSelect('data-confidence')}</label>
                <button type="button" data-remove-participant aria-label="Remove participant">&times;</button>
            </div>
        `
        const row = template.content.firstElementChild
        if (participant.agentId) row.setAttribute('data-agent-id', participant.agentId)
        if (participant.confidence !== undefined) {
            row.querySelector('[data-confidence]').value = tokenForConfidence(participant.confidence)
        }
        return row
    }

    /** Load existing values into the fields (used when editing a person). */
    set value(data) {
        if (!data) return
        if (data.personId) this.personId = data.personId
        const name = data.name || {}
        const keyToValue = {
            givenName: name.given, familyName: name.family,
            additionalName: name.additional, alternateName: name.alternate,
            birthPlace: data.birthPlace, birthDate: data.birthDate, gender: data.gender
        }
        for (const key of FACT_KEYS) {
            const input = this.querySelector(`[deer-key="${key}"]`)
            if (input && keyToValue[key] !== undefined && keyToValue[key] !== null) {
                input.value = keyToValue[key]
            }
        }
        if (data.evidence && this.evidencePicker) this.evidencePicker.value = data.evidence
        const list = this.querySelector('[data-participants]')
        if (list && Array.isArray(data.participants)) {
            list.innerHTML = ''
            for (const participant of data.participants) {
                list.appendChild(this.createParticipantRow(participant))
            }
            if (!list.children.length) list.appendChild(this.createParticipantRow({ role: 'parent' }))
        }
    }

    /** @returns {Object} the collected form data (model input shape). */
    get value() {
        const get = key => {
            const input = this.querySelector(`[deer-key="${key}"]`)
            return input ? input.value.trim() : ''
        }
        const confidences = {}
        for (const input of this.querySelectorAll('[data-confidence-for]')) {
            const parsed = parseConfidence(input.value)
            if (parsed !== undefined) confidences[input.getAttribute('data-confidence-for')] = parsed
        }
        const participants = []
        for (const row of this.querySelectorAll('[data-participant]')) {
            const agentId = row.getAttribute('data-agent-id') || ''
            const given = (row.querySelector('[data-participant-given]') || {}).value || ''
            const family = (row.querySelector('[data-participant-family]') || {}).value || ''
            const role = (row.querySelector('[data-role]') || {}).value || 'parent'
            const confidence = parseConfidence((row.querySelector('[data-confidence]') || {}).value)
            if (!agentId && !given.trim() && !family.trim()) continue
            participants.push({
                agentId: agentId || undefined,
                role,
                confidence,
                name: { given: given.trim(), family: family.trim() }
            })
        }
        const evidence = this.evidencePicker ? this.evidencePicker.value : { id: '', title: '' }
        return {
            personId: this.personId || undefined,
            subtype: this.eventType,
            name: {
                given: get('givenName'),
                family: get('familyName'),
                additional: get('additionalName'),
                alternate: get('alternateName')
            },
            birthPlace: get('birthPlace'),
            birthDate: get('birthDate'),
            gender: get('gender'),
            evidence,
            confidences,
            participants
        }
    }
}

function tokenForConfidence(value) {
    const parsed = parseConfidence(value)
    if (parsed === undefined) return ''
    const found = CONFIDENCE_CHOICES.find(c => c.token && parseConfidence(c.token) === parsed)
    return found ? found.token : String(parsed)
}

function escapeAttr(str) {
    return String(str).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

if (!customElements.get('gl-birth-form')) {
    customElements.define('gl-birth-form', GLBirthForm)
}

export default GLBirthForm
