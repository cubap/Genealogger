/**
 * @module pages/person
 * @description The person page's only entry point: the hub every other page
 * hangs off. It resolves the store once (store-bootstrap) and moves data between
 * the DOM and model/person — it never fetches and never encodes storage shapes.
 *
 * Flow:
 *   resolveStore()                    once, on load; also sets the model default
 *   #<id> or ?person=<id>         ->  loadPerson({ store, personId })  (read)
 *   <gl-person-name-form> submit  ->  assertPersonName({ store, ...})   (write)
 *   no id yet                     ->  the first saved name mints the Person
 *
 * The assembled view is grouped by assertion type (issue #14 story 3) and a
 * group holding more than one distinct value is flagged, not collapsed:
 * disagreement between sources is displayed side by side (story 4).
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { loadPerson, assertPersonName, PROPERTY_LABELS, ASSERTION_ORDER } from '../model/person.js'
import { listEntities } from '../model/entities.js'
import { TYPES, NV, QUALIFIER_LABELS, NAME_PROPERTY_TOKENS } from '../model/vocabulary.js'
import { toAssertionRows, toAssertionGroups } from '../components/gl-assertion.js'
import '../components/gl-evidence-picker.js'
import '../components/gl-person-name-form.js'

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag)
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val)
    if (text !== undefined) node.textContent = text
    return node
}

/**
 * The person this page is showing. `person.html#<id>` is the deep-link contract
 * gl-person-chip writes; `?person=<id>` is how the birth/death pages hand the
 * person over, so both are accepted on read.
 * @returns {string|undefined}
 */
function readPersonId() {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    return hash || new URLSearchParams(window.location.search).get('person') || undefined
}

/** Rewrite the URL to the canonical `#<id>` form, leaving ?store= alone. */
function writePersonId(personId) {
    const url = new URL(window.location.href)
    url.searchParams.delete('person')
    url.hash = personId
    window.history.replaceState({}, '', url)
}

/**
 * Point every hub link at this person (the legacy .person-detail convention).
 * The id goes in RAW, un-encoded, exactly as gl-person-chip writes it and as the
 * DEER v1 pages read it back with location.hash.substr(1).
 */
function setHubLinks(personId) {
    const actions = document.getElementById('personActions')
    for (const link of document.querySelectorAll('.person-detail')) {
        const base = link.getAttribute('data-href')
        if (!base) continue
        link.href = personId ? base + personId : base
        link.classList.toggle('hidden', !personId)
    }
    actions.classList.toggle('hidden', !personId)
}

async function loadEvidenceRecords(store) {
    const records = await listEntities({ store, type: TYPES.Record })
    return records.map(rec => ({ id: rec['@id'], title: rec.label || '(untitled document)' }))
}

function renderAssertions(container, person) {
    container.innerHTML = ''
    const rows = toAssertionRows(person.assertions, {
        propertyLabels: PROPERTY_LABELS,
        evidenceLabels: person.evidenceLabels,
        qualifierLabels: QUALIFIER_LABELS,
        order: ASSERTION_ORDER
    })
    if (!rows.length) {
        container.appendChild(el('p', { class: 'empty' }, 'No assertions recorded yet — record a name to start this person.'))
        return
    }
    for (const group of toAssertionGroups(rows)) {
        const section = el('div', { class: 'assertion-group', 'data-property': group.property })
        const heading = group.conflicting
            ? `${group.propertyLabel} — ${group.rows.length} sources disagree`
            : group.propertyLabel
        section.appendChild(el('h4', { class: 'group-label' }, heading))
        for (const row of group.rows) {
            const node = el('gl-assertion', { readonly: '' })
            node.row = { ...row, conflicting: group.conflicting }
            section.appendChild(node)
        }
        container.appendChild(section)
    }
}

function relationLines(person) {
    const lines = []
    for (const vo of person.parents) {
        lines.push({ kind: 'parent', text: `Parent: ${person.personLabels[vo.value] || vo.value}`, confidence: vo[NV.confidence] })
    }
    for (const vo of person.children) {
        lines.push({ kind: 'child', text: `Child: ${person.personLabels[vo.target] || vo.target}`, confidence: vo[NV.confidence] })
    }
    for (const vo of person.lacunae) {
        lines.push({ kind: 'lacuna', text: `Missing: ${vo.value || 'unknown'}`, confidence: vo[NV.confidence] })
    }
    return lines
}


function renderRelations(container, person) {
    container.innerHTML = ''
    const lines = relationLines(person)
    if (!lines.length) {
        container.appendChild(el('p', { class: 'empty' }, 'No parents, children or recorded gaps yet.'))
        return
    }
    for (const line of lines) {
        const label = line.confidence === undefined ? line.text : `${line.text} (confidence ${Math.round(line.confidence * 100)}%)`
        container.appendChild(el('div', { class: 'participant', 'data-kind': line.kind }, label))
    }
}

async function refresh(store, form) {
    const personId = readPersonId()
    const banner = document.getElementById('personBanner')
    setHubLinks(personId)
    if (!personId) {
        banner.classList.add('hidden')
        form.personId = ''
        document.getElementById('existingAssertions').innerHTML = ''
        document.getElementById('existingRelations').innerHTML = ''
        return
    }
    form.personId = personId
    const person = await loadPerson({ store, personId })
    if (!person) {
        banner.textContent = 'No such person.'
        banner.classList.remove('hidden')
        document.getElementById('existingAssertions').innerHTML = ''
        document.getElementById('existingRelations').innerHTML = ''
        return
    }
    banner.textContent = person.legacy
        ? `${person.label} — legacy DEER v1 record: its facts are shown as migrated rows, and anything you record here is written in the new shape.`
        : `${person.label}`
    banner.classList.remove('hidden')
    renderAssertions(document.getElementById('existingAssertions'), person)
    renderRelations(document.getElementById('existingRelations'), person)
}

async function main() {
    const store = await resolveStore()
    const form = document.getElementById('nameForm')
    const status = document.getElementById('nameStatus')

    form.evidencePicker.records = await loadEvidenceRecords(store)

    form.addEventListener('gl-person-name-submit', async event => {
        const data = event.detail
        status.textContent = ''
        try {
            const saved = await assertPersonName({
                store,
                personId: data.personId,
                property: NAME_PROPERTY_TOKENS[data.propertyToken],
                value: data.value,
                nameType: data.nameType,
                activeFrom: data.activeFrom,
                activeTo: data.activeTo,
                evidence: data.evidence,
                confidence: data.confidence
            })
            writePersonId(saved.personId)
            form.value = { personId: saved.personId, name: '', activeFrom: '', activeTo: '', nameType: '' }
            form.evidencePicker.records = await loadEvidenceRecords(store)
            status.textContent = `Saved “${data.value}”.`
            await refresh(store, form)
        } catch (err) {
            status.textContent = err.message
        }
    })

    // gl-person-chip and the sibling pages move between people by changing the
    // hash, so re-read the person whenever it changes.
    window.addEventListener('hashchange', () => {
        refresh(store, form).catch(err => { status.textContent = err.message })
    })

    await refresh(store, form)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main)
} else {
    main()
}
