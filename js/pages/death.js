/**
 * @module pages/death
 * @description The death page's only entry point — the wiring recipe of
 * docs/page-model-adapter.md applied to death, mirroring pages/birth.js. It
 * resolves the store once (store-bootstrap), then moves data between the DOM
 * (gl-* components) and the model API (model/death). It never fetches and never
 * encodes storage shapes — the adapter owns the wire format and the model owns
 * the domain rules.
 *
 * Flow:
 *   resolveStore()           once, on load; also set as the model default store
 *   <gl-death-form> submit ->  saveDeath({ store, ...formData })  (write path)
 *   ?person=<id> present  ->   loadDeath({ store, personId })     (read path)
 * Legacy records render read-only (migrated view) until the user edits; the first
 * save writes the new shape (lazy migration) because saveDeath always does.
 * The ?store= query param is preserved across the replaceState because the URL is
 * cloned from the current location and only `person` is written.
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { saveDeath, loadDeath, PROPERTY_LABELS } from '../model/death.js'
import { listEntities } from '../model/entities.js'
import { TYPES, SCHEMA, NV } from '../model/vocabulary.js'
import { toAssertionRows } from '../components/gl-assertion.js'
import '../components/gl-evidence-picker.js'
import '../components/gl-death-form.js'

// Name/parentage properties are surfaced elsewhere (participants panel), so the
// audit list shows the death facts and the display name.
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

function renderAssertions(container, death) {
    container.innerHTML = ''
    const rows = toAssertionRows(death.assertions, {
        propertyLabels: PROPERTY_LABELS,
        evidenceLabels: death.evidenceLabels,
        order: ASSERTION_ORDER
    }).filter(row => !HIDDEN_PROPERTIES.has(row.property))
    for (const row of rows) {
        const node = el('gl-assertion', { readonly: '' })
        node.row = row
        container.appendChild(node)
    }
    if (!rows.length) {
        container.appendChild(el('p', { class: 'empty' }, 'No death assertions recorded yet.'))
    }
}

function renderParticipants(container, death) {
    container.innerHTML = ''
    for (const event of death.events) {
        const legend = event.record ? (death.evidenceLabels[event.record.id] || 'Evidence') : 'Event'
        const fieldset = el('fieldset', { class: 'event-participants' })
        fieldset.appendChild(el('legend', {}, legend))
        for (const row of event.participants) {
            // The deceased is the event's subject; the banner names them instead.
            if (row.role === NV.child) continue
            const roleLabel = (row.role || '').split(/[#/]/).pop() || 'participant'
            const who = death.personLabels[row.agent] || row.agent || '(unknown)'
            const conf = row.confidence !== undefined ? ` — ${Math.round(row.confidence * 100)}%` : ''
            fieldset.appendChild(el('div', { class: 'participant' }, `${roleLabel}: ${who}${conf}`))
        }
        container.appendChild(fieldset)
    }
}

function setCrossLinks(personId) {
    const birthLink = document.getElementById('birthLink')
    if (birthLink) birthLink.href = `birth.html?person=${encodeURIComponent(personId || '')}`
}

async function refresh(store, form) {
    const personId = readPersonId()
    const banner = document.getElementById('personBanner')
    const assertions = document.getElementById('existingDeath')
    const participants = document.getElementById('existingParticipants')
    setCrossLinks(personId)
    if (!personId) {
        banner.classList.add('hidden')
        assertions.innerHTML = ''
        participants.innerHTML = ''
        return
    }
    const death = await loadDeath({ store, personId })
    if (!death) {
        banner.textContent = 'No such person.'
        banner.classList.remove('hidden')
        return
    }
    banner.textContent = death.legacy
        ? `Legacy death record for ${death.label} — read-only until you save an edit (it will be migrated).`
        : `Death record for ${death.label}`
    banner.classList.remove('hidden')
    form.value = {
        personId,
        name: {
            given: firstValue(death.assertions, SCHEMA.givenName),
            family: firstValue(death.assertions, SCHEMA.familyName),
            additional: firstValue(death.assertions, SCHEMA.additionalName),
            alternate: firstValue(death.assertions, SCHEMA.alternateName)
        },
        deathDate: firstValue(death.assertions, SCHEMA.deathDate),
        deathPlace: firstValue(death.assertions, SCHEMA.deathPlace),
        gender: firstValue(death.assertions, SCHEMA.gender),
        evidence: death.events[0] && death.events[0].record ? { id: death.events[0].record.id } : undefined
    }
    renderAssertions(assertions, death)
    renderParticipants(participants, death)
}

async function main() {
    const store = await resolveStore()
    const form = document.getElementById('deathForm')

    form.evidencePicker.records = await loadEvidenceRecords(store)

    form.addEventListener('gl-death-submit', async event => {
        const result = await saveDeath({ store, ...event.detail })
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
