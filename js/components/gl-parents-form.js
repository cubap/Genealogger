/**
 * @module components/gl-parents-form
 * @description `gl-parents-form` is the parents page's form component. Like
 * gl-birth-form it renders in LIGHT DOM so the familiar DEER surface vocabulary
 * survives untouched: the retained `deer-key` names (hasFather, hasMother,
 * homeLocation) and the `.personDropdown` selects stay in the HTML. On submit it
 * saves NOTHING and never fetches — it maps the surface to a plain form-data
 * object and dispatches `gl-parents-submit`; the page handler calls
 * model/parents.saveParents(), which is what turns a "Father" row into an
 * nv:mother/nv:father PARTICIPATION on a birth Event. The deer-key names are an
 * input affordance, not a storage shape: nothing here writes hasFather onto a
 * Person.
 *
 * A row is a `[data-participant]` container. The two fixed rows carry
 * `data-parent-role` (the DEER v1 Father/Mother blanks); "+ Add another parent"
 * appends generic rows with a `[data-role]` select so a third or conflicting
 * claim — a step-mother, a disputed father — can be recorded next to the first
 * instead of replacing it.
 *
 * Attributes
 *   person   id of the existing CHILD whose parents are being recorded
 *
 * Properties
 *   evidencePicker  the inner <gl-evidence-picker> (records set by the page)
 *   personOptions   Array<{ id, label }> existing persons for the dropdowns
 *   value           collected form data (get); loads values into the rows (set)
 *
 * Events (bubbles)
 *   gl-parents-submit   detail: the collected form data object
 */

import { parseConfidence } from './gl-assertion.js'
import './gl-evidence-picker.js'

const PARENT_ROLE_CHOICES = [
    { token: 'mother', label: 'Mother' },
    { token: 'father', label: 'Father' },
    { token: 'parent', label: 'Parent' }
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

function tokenForConfidence(value) {
    const parsed = parseConfidence(value)
    if (parsed === undefined) return ''
    const found = CONFIDENCE_CHOICES.find(c => c.token && parseConfidence(c.token) === parsed)
    return found ? found.token : String(parsed)
}

function escapeAttr(str) {
    return String(str).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

export class GLParentsForm extends HTMLElement {
    connectedCallback() {
        if (this._wired) return
        this._wired = true
        // Delegate on the host, not the row container: "+ Add another parent" is
        // a SIBLING of [data-participants] in the page template, so a listener on
        // the container never sees its clicks (the bug #27 fixed for birth).
        this.addEventListener('click', event => {
            if (event.target.matches('[data-add-parent]')) {
                this.addParticipantRow({ role: 'parent' })
            } else if (event.target.matches('[data-remove-participant]')) {
                event.target.closest('[data-participant]').remove()
            }
        })
        this.addEventListener('change', event => {
            if (event.target.matches('.personDropdown')) this.applyDropdown(event.target)
        })
        // Typing a name means "this is a new person", not the picked one.
        this.addEventListener('input', event => {
            if (event.target.matches('[data-participant-name]')) {
                event.target.closest('[data-participant]').removeAttribute('data-agent-id')
            }
        })
        this.populateConfidenceSelects()
        this.populateDropdowns()
        this.querySelector('form').addEventListener('submit', event => {
            event.preventDefault()
            this.dispatchEvent(new CustomEvent('gl-parents-submit', { bubbles: true, detail: this.value }))
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

    /** @param {Array<{id: string, label: string}>} options */
    set personOptions(options) {
        this._personOptions = Array.isArray(options) ? options : []
        this.populateDropdowns()
    }

    get personOptions() {
        return this._personOptions || []
    }

    populateDropdowns() {
        for (const select of this.querySelectorAll('.personDropdown')) {
            const current = select.value
            select.innerHTML = '<option value="">— or name a new person —</option>' + this.personOptions
                .map(opt => `<option value="${escapeAttr(opt.id)}">${escapeAttr(opt.label)}</option>`)
                .join('')
            select.value = current
        }
    }

    /**
     * The fixed father/mother rows are authored in parents.html so the DEER v1
     * surface stays visible in the page; their confidence selects are filled here
     * rather than repeated in markup.
     */
    populateConfidenceSelects() {
        for (const select of this.querySelectorAll('[data-confidence]')) {
            if (select.options.length) continue
            select.innerHTML = CONFIDENCE_CHOICES.map(c => `<option value="${c.token}">${c.label}</option>`).join('')
        }
    }

    /** @returns {Array<HTMLElement>} every parent row, fixed and added */
    get rows() {
        return [...this.querySelectorAll('[data-participant]')]
    }

    applyDropdown(select) {
        const row = select.closest('[data-participant]')
        if (!row) return
        const nameInput = row.querySelector('[data-participant-name]')
        if (!select.value) {
            row.removeAttribute('data-agent-id')
            if (nameInput) nameInput.value = ''
            return
        }
        row.setAttribute('data-agent-id', select.value)
        if (nameInput) nameInput.value = (select.selectedOptions[0] || {}).textContent?.trim() || ''
    }

    addParticipantRow(participant = {}) {
        const list = this.querySelector('[data-participants]')
        if (!list) return null
        const template = document.createElement('template')
        template.innerHTML = `
            <div data-participant class="participant-row">
                <input type="text" data-participant-name placeholder="Parent name" value="${escapeAttr(participant.name || '')}">
                <select class="personDropdown" title="Select a person"></select>
                <select data-role>${PARENT_ROLE_CHOICES.map(r => `<option value="${r.token}"${r.token === participant.role ? ' selected' : ''}>${r.label}</option>`).join('')}</select>
                <label>confidence ${confidenceSelect('data-confidence')}</label>
                <button type="button" data-remove-participant aria-label="Remove parent">&times;</button>
            </div>
        `
        const row = template.content.firstElementChild
        if (participant.agentId) row.setAttribute('data-agent-id', participant.agentId)
        if (participant.confidence !== undefined) {
            row.querySelector('[data-confidence]').value = tokenForConfidence(participant.confidence)
        }
        list.appendChild(row)
        this.populateDropdowns()
        return row
    }

    /** Reset the fixed rows and drop every added row before a fresh load. */
    clearRows() {
        for (const row of this.rows) {
            if (row.hasAttribute('data-parent-role')) {
                row.removeAttribute('data-agent-id')
                const nameInput = row.querySelector('[data-participant-name]')
                if (nameInput) nameInput.value = ''
                const dropdown = row.querySelector('.personDropdown')
                if (dropdown) dropdown.value = ''
                const conf = row.querySelector('[data-confidence]')
                if (conf) conf.value = ''
            } else {
                row.remove()
            }
        }
    }

    /** Load existing values into the fields (used when editing a person). */
    set value(data) {
        if (!data) return
        if (data.personId) this.personId = data.personId
        this.clearRows()
        if (data.residence !== undefined) {
            const residence = this.querySelector('[deer-key="homeLocation"]')
            if (residence) residence.value = data.residence || ''
        }
        if (data.evidence && this.evidencePicker) this.evidencePicker.value = data.evidence
        if (!Array.isArray(data.parents)) return
        for (const claim of data.parents) {
            if (!claim) continue
            const fixed = this.querySelector(`[data-participant][data-parent-role="${claim.role}"]`)
            const row = fixed && !fixed.getAttribute('data-agent-id') &&
                !(fixed.querySelector('[data-participant-name]') || {}).value ? fixed : null
            const target = row || this.addParticipantRow({ role: claim.role })
            if (!target) continue
            const nameInput = target.querySelector('[data-participant-name]')
            if (nameInput) nameInput.value = claim.name || ''
            if (claim.agentId) {
                target.setAttribute('data-agent-id', claim.agentId)
                const dropdown = target.querySelector('.personDropdown')
                if (dropdown) dropdown.value = claim.agentId
            }
            const conf = target.querySelector('[data-confidence]')
            if (conf && claim.confidence !== undefined) conf.value = tokenForConfidence(claim.confidence)
        }
    }

    /** @returns {Object} the collected form data (model input shape). */
    get value() {
        const residenceInput = this.querySelector('[deer-key="homeLocation"]')
        const parents = []
        for (const row of this.rows) {
            const agentId = row.getAttribute('data-agent-id') || ''
            const nameInput = row.querySelector('[data-participant-name]')
            const name = ((nameInput && nameInput.value) || '').trim()
            if (!agentId && !name) continue
            const roleSelect = row.querySelector('[data-role]')
            parents.push({
                role: row.getAttribute('data-parent-role') || (roleSelect && roleSelect.value) || 'parent',
                agentId: agentId || undefined,
                name: agentId ? undefined : name || undefined,
                confidence: parseConfidence((row.querySelector('[data-confidence]') || {}).value)
            })
        }
        return {
            personId: this.personId || undefined,
            residence: residenceInput ? residenceInput.value.trim() : '',
            evidence: this.evidencePicker ? this.evidencePicker.value : { id: '', title: '' },
            parents
        }
    }
}

if (!customElements.get('gl-parents-form')) {
    customElements.define('gl-parents-form', GLParentsForm)
}

export default GLParentsForm
