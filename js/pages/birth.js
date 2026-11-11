/**
 * @module pages/birth
 * @description The birth page's only entry point and the reference "page -> model
 * -> adapter" wiring. It resolves the store once (store-bootstrap), then moves
 * data between the DOM (gl-* components) and the model API (model/birth). It never
 * fetches and never encodes storage shapes — the adapter owns the wire format and
 * the model owns the domain rules.
 *
 * Flow:
 *   resolveStore()            once, on load; also set as the model default store
 *   <gl-birth-form> submit ->  saveBirth({ store, ...formData })  (write path)
 *   ?person=<id> present  ->   loadBirth({ store, personId })     (read path)
 * Legacy records render read-only (migrated view) until the user edits; the first
 * save writes the new shape (lazy migration) because saveBirth always does.
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { saveBirth, loadBirth, PROPERTY_LABELS } from '../model/birth.js'
import { listEntities } from '../model/entities.js'
import { TYPES, SCHEMA, NV } from '../model/vocabulary.js'
import { toAssertionRows } from '../components/gl-assertion.js'
import '../components/gl-evidence-picker.js'
import '../components/gl-birth-form.js'

// Name/parentage properties are surfaced elsewhere (participants panel), so the
// audit list shows the birth facts and the display name.
const ASSERTION_ORDER = Object.keys(PROPERTY_LABELS)
const HIDDEN_PROPERTIES = new Set([NV.hasParent, SCHEMA.givenName, SCHEMA.familyName, SCHEMA.additionalName, SCHEMA.alternateName])

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag)
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val)
    if (text !== undefined) node.textContent = text
    return node
}

function readPersonId() {
    return new URLSearchParams(window.location.search).get('person')
}

async function loadEvidenceRecords(store) {
    const records = await listEntities({ store, type: TYPES.Record })
    return records.map(rec => ({ id: rec['@id'], title: rec.label || '(untitled document)' }))
}

function firstValue(assertions, property) {
    const raw = assertions[property]
    if (!raw) return undefined
    const vo = Array.isArray(raw) ? raw[0] : raw
    return vo ? vo.value : undefined
}

function renderAssertions(container, birth) {
    container.innerHTML = ''
    const rows = toAssertionRows(birth.assertions, {
        propertyLabels: PROPERTY_LABELS,
        evidenceLabels: birth.evidenceLabels,
        order: ASSERTION_ORDER
    }).filter(row => !HIDDEN_PROPERTIES.has(row.property))
    for (const row of rows) {
        const node = el('gl-assertion', { readonly: '' })
        node.row = row
        container.appendChild(node)
    }
    if (!rows.length) {
        container.appendChild(el('p', { class: 'empty' }, 'No birth assertions recorded yet.'))
    }
}

function renderParticipants(container, birth) {
    container.innerHTML = ''
    for (const event of birth.events) {
        const legend = event.record ? (birth.evidenceLabels[event.record.id] || 'Evidence') : 'Event'
        const fieldset = el('fieldset', { class: 'event-participants' })
        fieldset.appendChild(el('legend', {}, legend))
        for (const row of event.participants) {
            if (row.role === NV.child) continue
            const roleLabel = (row.role || '').split(/[#/]/).pop() || 'relative'
            const who = birth.personLabels[row.agent] || row.agent || '(unknown)'
            const conf = row.confidence !== undefined ? ` — ${Math.round(row.confidence * 100)}%` : ''
            fieldset.appendChild(el('div', { class: 'participant' }, `${roleLabel}: ${who}${conf}`))
        }
        container.appendChild(fieldset)
    }
}

async function refresh(store, form) {
    const personId = readPersonId()
    const banner = document.getElementById('personBanner')
    const assertions = document.getElementById('existingBirth')
    const participants = document.getElementById('existingParticipants')
    if (!personId) {
        banner.classList.add('hidden')
        assertions.innerHTML = ''
        participants.innerHTML = ''
        return
    }
    const birth = await loadBirth({ store, personId })
    if (!birth) {
        banner.textContent = 'No such person.'
        banner.classList.remove('hidden')
        return
    }
    banner.textContent = birth.legacy
        ? `Legacy birth record for ${birth.label} — read-only until you save an edit (it will be migrated).`
        : `Birth record for ${birth.label}`
    banner.classList.remove('hidden')
    form.value = {
        personId,
        name: {
            given: firstValue(birth.assertions, SCHEMA.givenName),
            family: firstValue(birth.assertions, SCHEMA.familyName),
            additional: firstValue(birth.assertions, SCHEMA.additionalName),
            alternate: firstValue(birth.assertions, SCHEMA.alternateName)
        },
        birthDate: firstValue(birth.assertions, SCHEMA.birthDate),
        birthPlace: firstValue(birth.assertions, SCHEMA.birthPlace),
        gender: firstValue(birth.assertions, SCHEMA.gender),
        evidence: birth.events[0] && birth.events[0].record ? { id: birth.events[0].record.id } : undefined
    }
    renderAssertions(assertions, birth)
    renderParticipants(participants, birth)
}

async function main() {
    const store = await resolveStore()
    const form = document.getElementById('birthForm')

    form.evidencePicker.records = await loadEvidenceRecords(store)

    form.addEventListener('gl-birth-submit', async event => {
        const result = await saveBirth({ store, ...event.detail })
        const url = new URL(window.location.href)
        url.searchParams.set('person', result.personId)
        window.history.replaceState({}, '', url)
        form.evidencePicker.records = await loadEvidenceRecords(store)
        await refresh(store, form)
    })

    await refresh(store, form)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main)
} else {
    main()
}
