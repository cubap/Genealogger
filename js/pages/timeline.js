/**
 * @module pages/timeline
 * @description The ancestor timeline page's only entry point (issue #14 story
 * 9) — the third worked example of the page -> model -> adapter wiring (see
 * pages/birth.js, pages/death.js). It resolves the store once, reads the
 * subject from the URL, hands `model/timeline.loadAncestorTimeline()` the
 * result, and gives the plain rows to `<gl-ancestor-timeline>`. It never
 * fetches and never encodes a storage shape.
 *
 * Deep links, both honoured:
 *   timeline.html?person=<id>   the convention every other page uses
 *   timeline.html#<id>          the DEER v1 form (person.html and bookmarks
 *                               still emit it, so it keeps working)
 *
 * The "sample family" button only NAVIGATES to `?store=fixture`: the demo data
 * lives in js/adapters/fixtures/sample-family.js, not in this page — v1's
 * hard-coded `demo=true` inside the component is gone with it.
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { loadAncestorTimeline } from '../model/timeline.js'
import { listPersons } from '../model/search.js'
import '../components/gl-ancestor-timeline.js'
import '../components/gl-person-chip.js'
import '../components/gl-typeahead-filter.js'

/** Deep link into the FIXTURE store's sample family (see adapters/fixtures). */
const FIXTURE_SAMPLE_PERSON = 'https://devstore.rerum.io/v1/id/fixture-person-ada'

function readPersonId() {
    const fromParam = new URLSearchParams(window.location.search).get('person')
    if (fromParam) return fromParam
    const raw = window.location.hash ? window.location.hash.slice(1) : ''
    if (!raw) return ''
    try {
        return raw.includes('%') ? decodeURIComponent(raw) : raw
    } catch {
        return raw
    }
}

function readQuery() {
    return new URLSearchParams(window.location.search).get('q') || ''
}

function syncToUrl({ personId, query }) {
    const url = new URL(window.location.href)
    if (personId) url.searchParams.set('person', personId)
    else url.searchParams.delete('person')
    if (query) url.searchParams.set('q', query)
    else url.searchParams.delete('q')
    url.hash = ''
    window.history.replaceState({}, '', url)
}

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag)
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val)
    if (text !== undefined) node.textContent = text
    return node
}

async function main() {
    const store = await resolveStore()
    const status = document.getElementById('timelineStatus')
    const filter = document.getElementById('personFilter')
    const picker = document.getElementById('personPicker')
    const timeline = document.getElementById('ancestorTimeline')
    // Read the subject BEFORE anything rewrites the URL: a legacy `#<id>` link
    // must survive the picker's ?q= sync (which drops the hash once consumed).
    let subjectId = readPersonId()

    async function load(personId) {
        subjectId = personId || subjectId
        if (!subjectId) {
            status.textContent = 'Pick a person below, or open a timeline with ?person=<id> (the legacy #<id> link still works).'
            return
        }
        status.textContent = 'Loading timeline…'
        syncToUrl({ personId: subjectId, query: filter.value })
        try {
            const data = await loadAncestorTimeline({ store, personId: subjectId })
            timeline.data = data
            if (!data.people.length) {
                status.textContent = `No Person found for ${subjectId}.`
                return
            }
            const dated = data.items.length
            const facts = data.undated.length
            status.textContent =
                `Ancestor timeline for ${data.label}: ${data.people.length} `
                + `${data.people.length === 1 ? 'person' : 'people'}, ${dated} dated `
                + `assertion${dated === 1 ? '' : 's'}`
                + (facts ? `, ${facts} without a usable year` : '')
                + (data.legacy ? ' (includes DEER v1 records)' : '')
                + '.'
        } catch (error) {
            timeline.data = { people: [], items: [], undated: [] }
            status.textContent = `Could not load the timeline: ${error.message}`
        }
    }

    async function refreshPicker() {
        const query = filter.value
        syncToUrl({ personId: subjectId, query })
        try {
            const rows = await listPersons({ store, query })
            picker.innerHTML = ''
            for (const row of rows) {
                // href="" renders the chip as a picker BUTTON, not a link to
                // person.html: selecting one stays on this page.
                const chip = el('gl-person-chip', {
                    'person-id': row.id,
                    label: row.label,
                    detail: row.detail || '',
                    href: ''
                })
                if (row.id === subjectId) {
                    chip.setAttribute('selected', '')
                }
                picker.appendChild(chip)
            }
            if (!rows.length) picker.textContent = query ? `No people match "${query}".` : 'No people yet.'
        } catch (error) {
            picker.innerHTML = ''
            picker.textContent = `Could not load people: ${error.message}`
        }
    }

    picker.addEventListener('gl-person-select', async event => {
        syncToUrl({ personId: event.detail.id, query: filter.value })
        for (const chip of picker.querySelectorAll('gl-person-chip')) {
            chip.toggleAttribute('selected', chip.getAttribute('person-id') === event.detail.id)
        }
        await load(event.detail.id)
    })
    filter.addEventListener('gl-filter-change', refreshPicker)
    document.getElementById('showDemo').addEventListener('click', () => {
        window.location.href = `timeline.html?store=fixture&person=${encodeURIComponent(FIXTURE_SAMPLE_PERSON)}`
    })

    filter.value = readQuery()
    await refreshPicker()
    await load(subjectId)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main)
} else {
    main()
}
