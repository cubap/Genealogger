/**
 * @module pages/label
 * @description The label page's only entry point — the wiring recipe of
 * docs/page-model-adapter.md applied to naming a person, mirroring pages/death.js.
 * It resolves the store once (store-bootstrap), then moves data between the DOM
 * (gl-label-form, gl-assertion) and the model API (model/label). It never fetches
 * and never encodes storage shapes — the adapter owns the wire format and the
 * model owns the domain rules, including the naming rule this page exists to obey.
 *
 * Flow:
 *   resolveStore()            once, on load; also set as the model default store
 *   ?person=<id> | #<id>  ->  loadLabel({ store, personId })   (read path)
 *   <gl-label-form> submit -> saveLabel({ store, ...formData })(write path)
 * The legacy URL contract survives: `label.html#<person-id>` still opens a person
 * (the DEER v1 page read `location.hash.substr(1)` and re-read on hashchange), and
 * the id is normalised to `?person=<id>` — the deep-link form every other new page
 * uses — without disturbing `?store=`.
 * The ?store= query param is preserved across the replaceState because the URL is
 * cloned from the current location and only `person`/the fragment are written.
 * The dead legacy links (Residence/Occupation/Marriage/Depiction had no href at
 * all) and the hidden `targetCollection`/`creator` inputs (legacy plumbing the
 * model layer does not use) are gone; the links that reach real pages stayed.
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { saveLabel, loadLabel, PROPERTY_LABELS } from '../model/label.js'
import { listEntities } from '../model/entities.js'
import { TYPES } from '../model/vocabulary.js'
import { UNLABELED } from '../model/search.js'
import { toAssertionRows } from '../components/gl-assertion.js'
import { PERSON_HREF } from '../components/gl-person-chip.js'
import '../components/gl-evidence-picker.js'
import '../components/gl-label-form.js'

// Only the name claims are audited here; the rest of a person's facts belong to
// the entry pages. `order` puts the formal full name above the cached label.
const ASSERTION_ORDER = Object.keys(PROPERTY_LABELS)

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag)
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val)
    if (text !== undefined) node.textContent = text
    return node
}

/**
 * The person this page is about: `?person=<id>`, falling back to the legacy
 * `#<id>` fragment the DEER v1 page used.
 * @returns {string} id, or '' when the URL names nobody
 */
function readPersonId() {
    const fromQuery = new URLSearchParams(window.location.search).get('person')
    if (fromQuery) return fromQuery
    return window.location.hash.replace(/^#/, '')
}

/**
 * Put the resolved id into the URL in the form every new page accepts, so a
 * reload (or a shared link) works without the legacy fragment. Leaves every other
 * parameter — `store` above all — exactly as it was.
 * @param {string} personId
 */
function normalizePersonId(personId) {
    const url = new URL(window.location.href)
    if (url.searchParams.get('person') === personId && !url.hash) return
    url.searchParams.set('person', personId)
    url.hash = ''
    window.history.replaceState({}, '', url)
}

async function loadEvidenceRecords(store) {
    const records = await listEntities({ store, type: TYPES.Record })
    return records.map(rec => ({ id: rec['@id'], title: rec.label || '(untitled document)' }))
}

function renderAssertions(container, label) {
    container.innerHTML = ''
    const rows = toAssertionRows(label.names, {
        propertyLabels: PROPERTY_LABELS,
        evidenceLabels: label.evidenceLabels,
        order: ASSERTION_ORDER
    })
    for (const row of rows) {
        const node = el('gl-assertion', { readonly: '' })
        node.row = row
        container.appendChild(node)
    }
    if (!rows.length) {
        container.appendChild(el('p', { class: 'empty' }, 'No name assertions recorded yet.'))
    }
}

function setCrossLinks(personId) {
    const menu = document.getElementById('adding')
    const links = {
        profileLink: PERSON_HREF + personId,
        birthLink: `birth.html?person=${encodeURIComponent(personId)}`,
        childLink: `birth.html?parent=${encodeURIComponent(personId)}`,
        deathLink: `death.html?person=${encodeURIComponent(personId)}`
    }
    for (const [id, href] of Object.entries(links)) {
        const link = document.getElementById(id)
        if (link) link.href = href
    }
    if (menu) menu.classList.toggle('hidden', !personId)
}

async function refresh(store, form) {
    const personId = readPersonId()
    const banner = document.getElementById('personBanner')
    const current = document.getElementById('currentLabel')
    const note = document.getElementById('cacheNote')
    const assertions = document.getElementById('existingNames')
    const noPerson = document.getElementById('noPerson')
    if (!personId) {
        setCrossLinks('')
        banner.classList.add('hidden')
        current.textContent = ''
        note.classList.add('hidden')
        assertions.innerHTML = ''
        if (noPerson) noPerson.classList.remove('hidden')
        return
    }
    normalizePersonId(personId)
    if (noPerson) noPerson.classList.add('hidden')

    const view = await loadLabel({ store, personId })
    setCrossLinks(personId)
    if (!view) {
        banner.textContent = 'No such person.'
        banner.classList.remove('hidden')
        current.textContent = ''
        note.classList.add('hidden')
        assertions.innerHTML = ''
        return
    }

    banner.textContent = view.legacy
        ? `Migrated view of ${view.label} — the DEER v1 facts on this record are read-only here; anything this page records is stored in the new shape.`
        : `Naming ${view.label}`
    banner.classList.remove('hidden')
    current.textContent = view.label === UNLABELED ? '' : view.label

    // The cache is what a list reads, so say so when the two disagree: recording
    // the display name again is the repair, and this page is the write path that
    // does it (model/label.saveLabel).
    if (view.cacheStale) {
        note.textContent = `Lists currently show "${view.listLabel}" but this page shows "${view.label}". Record the name to refresh the cached label.`
        note.classList.remove('hidden')
    } else {
        note.textContent = ''
        note.classList.add('hidden')
    }

    form.value = {
        personId,
        name: view.label === UNLABELED ? '' : view.label
    }
    renderAssertions(assertions, view)
}

/**
 * Plain-language outcome of a save, including the one case where the cache was
 * deliberately left alone: a person the store still serves as a DEER v1 document.
 * Lists keep showing that record's old name, and saying so beats a silent no-op.
 * @param {Object} result result of model/label.saveLabel
 * @returns {string} message for the page's status line
 */
function saveMessage(result) {
    if (result.cacheSkipped === 'legacy') {
        return `Recorded "${result.label}" as an evidenced fact. This person is still a DEER v1 document, so its cached label was not rewritten — lists keep showing the old name until the record is migrated.`
    }
    if (result.cacheSkipped === 'unchanged') {
        return `Recorded "${result.label}" — the cached label already said that.`
    }
    return `Recorded "${result.label}" and refreshed the cached label.`
}

function say(message) {
    const status = document.getElementById('status')
    if (!status) return
    status.textContent = message || ''
    status.hidden = !message
}

async function main() {
    const store = await resolveStore()
    const form = document.getElementById('labelForm')

    form.evidencePicker.records = await loadEvidenceRecords(store)

    form.addEventListener('gl-label-submit', async event => {
        try {
            // The page owns who it is about (it came from the URL); the form owns the
            // claim. Falling back to the form's copy would let a page that never
            // learned the id write a name onto nobody.
            const subject = readPersonId() || event.detail.personId
            const result = await saveLabel({ store, ...event.detail, personId: subject })
            const url = new URL(window.location.href)
            url.searchParams.set('person', result.personId)
            window.history.replaceState({}, '', url)
            form.evidencePicker.records = await loadEvidenceRecords(store)
            await refresh(store, form)
            say(saveMessage(result))
        } catch (error) {
            say(error.message)
        }
    })

    // The legacy page re-read on every hash change; keep that behaviour now that
    // the canonical form is a query parameter.
    window.addEventListener('hashchange', () => {
        say('')
        refresh(store, form)
    })

    await refresh(store, form)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main)
} else {
    main()
}
