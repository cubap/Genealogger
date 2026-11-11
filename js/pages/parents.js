/**
 * @module pages/parents
 * @description The parents page's only entry point and another worked example of
 * the "page -> model -> adapter" wiring (see pages/birth.js). It resolves the
 * store once (store-bootstrap), then moves data between the DOM (gl-* components)
 * and the model API (model/parents). It never fetches and never encodes a storage
 * shape — so it also never writes `hasFather`/`hasMother` onto a Person, however
 * tempting the retained deer-key names on the form are.
 *
 * Flow:
 *   resolveStore()                     once, on load; also set as the model default store
 *   ?person=<id> (or #<id>) present -> loadParents({ store, personId })  (read path)
 *   no person selected            ->  listPersons() picker, filtered by the model
 *   <gl-parents-form> submit      ->  saveParents({ store, ...formData }) (write path)
 *
 * Reads are child-side and event-derived (issue #14 story 7): the parent panel
 * shows one row per nv:hasParent claim WITH the birth event, source document and
 * confidence behind it, and leaves conflicting claims side by side. The children
 * direction is derived too — it is a cheap read of the same assertions — but the
 * child's view is primary. A DEER v1 person whose parents were written straight
 * onto the Person document still opens, flagged as migrated.
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { loadParents, saveParents } from '../model/parents.js'
import { listEntities } from '../model/entities.js'
import { listPersons } from '../model/search.js'
import { TYPES, SCHEMA, NV } from '../model/vocabulary.js'
import { formatConfidence } from '../components/gl-assertion.js'
import '../components/gl-evidence-picker.js'
import '../components/gl-parents-form.js'
import '../components/gl-assertion.js'
import '../components/gl-typeahead-filter.js'
import '../components/gl-person-chip.js'

/** Keep a picker embedded on a form page short; refine it with the filter. */
const MAX_PICKER_ROWS = 25

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag)
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val)
    if (text !== undefined) node.textContent = text
    return node
}

/**
 * Which child this page is about. `?person=` is the contract other pages use;
 * the bare `#<id>` fragment form is accepted too because DEER v1 linked here that
 * way (`parents.html?#<id>`) and a half-migrated site must not dead-end a reader.
 */
function readPersonId() {
    const params = new URLSearchParams(window.location.search)
    return params.get('person') || window.location.hash.replace(/^#/, '')
}

function localName(uri) {
    return String(uri ?? '').split(/[#/]/).pop() || ''
}

function syncPersonToUrl(personId) {
    const url = new URL(window.location.href)
    url.searchParams.set('person', personId)
    // replaceState on the current URL keeps ?store= (and anything else) intact.
    url.hash = ''
    window.history.replaceState({}, '', url)
}

async function loadEvidenceRecords(store) {
    const records = await listEntities({ store, type: TYPES.Record })
    return records.map(rec => ({ id: rec['@id'], title: rec.label || '(untitled document)' }))
}

async function loadPersonOptions(store) {
    const rows = await listPersons({ store })
    return rows.map(row => ({ id: row.id, label: row.label }))
}

function assertionRow(props) {
    const node = el('gl-assertion', { readonly: '' })
    node.row = props
    return node
}

/**
 * One row per derived claim. Two sources that disagree name two rows — the point
 * of the panel is that the disagreement is visible, not that one row wins.
 */
function renderClaims(container, loaded) {
    container.innerHTML = ''
    if (!loaded.parents.length) {
        container.appendChild(el('p', { class: 'empty' }, 'No parents recorded for this person yet.'))
        return
    }
    // Two rows for one role only mean DISAGREEMENT when they name different
    // people; several sources naming the same mother is corroboration, and a
    // page that called it a conflict would be crying wolf.
    const rowsPerRole = new Map()
    const peoplePerRole = new Map()
    for (const claim of loaded.parents) {
        rowsPerRole.set(claim.role, (rowsPerRole.get(claim.role) || 0) + 1)
        if (!peoplePerRole.has(claim.role)) peoplePerRole.set(claim.role, new Set())
        peoplePerRole.get(claim.role).add(claim.label)
    }
    const announced = new Set()
    for (const claim of loaded.parents) {
        if (peoplePerRole.get(claim.role).size > 1 && !announced.has(claim.role)) {
            announced.add(claim.role)
            container.appendChild(el('p', { class: 'hint' },
                `${rowsPerRole.get(claim.role)} sources disagree about this person's ${claim.roleLabel.toLowerCase()} — both are kept.`))
        }
        container.appendChild(assertionRow({
            property: NV.hasParent,
            propertyLabel: claim.roleLabel + (claim.migrated ? ' (from v1 record)' : ''),
            value: claim.label,
            comment: claim.eventLabel ? `event: ${claim.eventLabel}` : undefined,
            evidence: claim.recordId || claim.eventId,
            evidenceLabel: claim.recordLabel || claim.evidenceLabel || '',
            confidence: claim.confidence
        }))
    }
}

/** Which event says so? Every birth-family event this child appears in. */
function renderEvents(container, loaded) {
    container.innerHTML = ''
    for (const entry of loaded.events) {
        const fieldset = el('fieldset', { class: 'event-participants' })
        fieldset.appendChild(el('legend', {}, entry.recordId
            ? (loaded.evidenceLabels[entry.recordId] || 'Evidence')
            : (entry.label || 'Event')))
        for (const row of entry.participants) {
            if (row.role === NV.child) continue
            const who = loaded.personLabels[row.agent] || row.agent || '(unknown)'
            const conf = row.confidence !== undefined ? ` — ${formatConfidence(row.confidence)}` : ''
            fieldset.appendChild(el('div', { class: 'participant' }, `${localName(row.role) || 'relative'}: ${who}${conf}`))
        }
        container.appendChild(fieldset)
    }
}

function renderChildren(container, loaded) {
    container.innerHTML = ''
    if (!loaded.children.length) {
        container.appendChild(el('p', { class: 'empty' }, 'No children derived from this person.'))
        return
    }
    for (const child of loaded.children) {
        container.appendChild(assertionRow({
            property: NV.hasChild,
            propertyLabel: 'Child' + (child.migrated ? ' (from v1 record)' : ''),
            value: child.label,
            evidence: child.eventId,
            evidenceLabel: child.recordLabel || '',
            confidence: child.confidence
        }))
    }
}

function renderResidence(container, loaded) {
    container.innerHTML = ''
    for (const fact of loaded.residence) {
        container.appendChild(assertionRow({
            property: SCHEMA.homeLocation,
            propertyLabel: 'Residence' + (fact.migrated ? ' (from v1 record)' : ''),
            value: fact.value,
            evidenceLabel: fact.recordLabel || '',
            confidence: fact.confidence
        }))
    }
}

async function refresh(store, form) {
    const personId = readPersonId()
    const banner = document.getElementById('personBanner')
    const picker = document.getElementById('personPicker')
    const panels = ['existingParents', 'existingEvents', 'existingChildren', 'existingResidence']
        .map(id => document.getElementById(id))

    if (!personId) {
        banner.classList.add('hidden')
        for (const panel of panels) panel.innerHTML = ''
        picker.classList.remove('hidden')
        await renderPicker(store)
        return
    }
    picker.classList.add('hidden')

    const loaded = await loadParents({ store, personId })
    if (!loaded) {
        banner.textContent = 'No such person.'
        banner.classList.remove('hidden')
        return
    }
    banner.textContent = loaded.legacy
        ? `Parents of ${loaded.label} — this record still holds DEER v1 values; saving below writes them as an event.`
        : `Parents of ${loaded.label}`
    banner.classList.remove('hidden')
    document.getElementById('birthLink').href = `birth.html?person=${encodeURIComponent(personId)}`
    document.getElementById('personLink').href = `person.html#${encodeURIComponent(personId)}`

    const firstEvent = loaded.events[0]
    form.value = {
        personId,
        residence: loaded.residence[0] ? loaded.residence[0].value : '',
        evidence: firstEvent && firstEvent.recordId ? { id: firstEvent.recordId } : undefined,
        parents: loaded.parents.map(claim => ({
            role: localName(claim.role).toLowerCase(),
            agentId: claim.agentId,
            name: claim.label,
            confidence: claim.confidence
        }))
    }

    renderClaims(document.getElementById('existingParents'), loaded)
    renderEvents(document.getElementById('existingEvents'), loaded)
    renderChildren(document.getElementById('existingChildren'), loaded)
    renderResidence(document.getElementById('existingResidence'), loaded)
}

/**
 * The child picker, shown until a person is selected. Filtering goes THROUGH the
 * model (listPersons) exactly like index.html, so a pick here behaves identically.
 */
async function renderPicker(store) {
    const filter = document.getElementById('childFilter')
    const container = document.getElementById('childList')
    const status = document.getElementById('pickerStatus')
    const query = filter.value
    const rows = await listPersons({ store, query })
    container.innerHTML = ''
    for (const row of rows.slice(0, MAX_PICKER_ROWS)) {
        // href="" (not an assigned `.person`) makes the chip a button: a picker
        // selects the child, it does not navigate away from the form.
        container.appendChild(el('gl-person-chip', { href: '', 'person-id': row.id, label: row.label }))
    }
    status.textContent = rows.length
        ? `${rows.length} person${rows.length === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}. Pick the child.`
        : 'No people yet. Add the child on the birth page first.'
}

async function main() {
    const store = await resolveStore()
    const form = document.getElementById('parentsForm')
    const status = document.getElementById('saveStatus')

    form.evidencePicker.records = await loadEvidenceRecords(store)
    form.personOptions = await loadPersonOptions(store)

    form.addEventListener('gl-parents-submit', async event => {
        try {
            const result = await saveParents({ store, ...event.detail })
            syncPersonToUrl(result.personId)
            form.evidencePicker.records = await loadEvidenceRecords(store)
            form.personOptions = await loadPersonOptions(store)
            status.textContent = 'Saved as a birth event; the parents below are derived from it.'
            await refresh(store, form)
        } catch (error) {
            status.textContent = error.message
        }
    })

    const filter = document.getElementById('childFilter')
    filter.addEventListener('gl-filter-change', async () => {
        await renderPicker(store)
    })
    document.getElementById('childList').addEventListener('gl-person-select', async event => {
        syncPersonToUrl(event.detail.id)
        await refresh(store, form)
    })

    await refresh(store, form)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main)
} else {
    main()
}
