/**
 * @module pages/index
 * @description The index (person list) page's only entry point and the second
 * worked example of the "page -> model -> adapter" wiring (see pages/birth.js).
 * It resolves the store once (store-bootstrap), then moves data between the DOM
 * (gl-person-chip / gl-typeahead-filter) and the model API (model/search). It
 * never fetches and never encodes a storage shape.
 *
 * Flow:
 *   resolveStore()                    once, on load; also set as the model default store
 *   first paint                   ->  listPersons({ store, query })   (ONE identity read)
 *   <gl-typeahead-filter> gl-filter-change
 *                               ->  listPersons({ store, query }) again, re-render chips
 *   ?q=<text>                    preserved across reloads via history.replaceState
 *
 * Filtering is a MODEL operation, not a DOM one: the query goes into
 * `listPersons()` and the list re-renders from the rows that come back, so a
 * picker embedded on any page filters exactly like this index does.
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { listPersons } from '../model/search.js'
import '../components/gl-person-chip.js'
import '../components/gl-typeahead-filter.js'

function readQuery() {
    return new URLSearchParams(window.location.search).get('q') || ''
}

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag)
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val)
    if (text !== undefined) node.textContent = text
    return node
}

function describe(rows, query) {
    if (rows.length) {
        const people = rows.length === 1 ? 'person' : 'people'
        return `${rows.length} ${people}${query ? ` matching "${query}"` : ''}`
    }
    return query
        ? `No people match "${query}".`
        : 'No people yet. Add a person to get started.'
}

function renderPeople(container, status, rows, query) {
    container.innerHTML = ''
    for (const row of rows) {
        const chip = el('gl-person-chip', { 'data-person-id': row.id })
        chip.person = row
        container.appendChild(chip)
    }
    status.textContent = describe(rows, query)
    status.setAttribute('data-count', String(rows.length))
}

async function refresh(store, filter, container, status) {
    const query = filter.value
    try {
        const rows = await listPersons({ store, query })
        renderPeople(container, status, rows, query)
    } catch (error) {
        // The index is the app's landing page; a store that is unreachable must
        // say so instead of leaving "Loading..." on screen forever.
        container.innerHTML = ''
        status.textContent = `Could not load people: ${error.message}`
        status.setAttribute('data-count', '0')
    }
}

function syncQueryToUrl(query) {
    const url = new URL(window.location.href)
    if (query) url.searchParams.set('q', query)
    else url.searchParams.delete('q')
    // replaceState on the current URL keeps ?store= (and anything else) intact.
    window.history.replaceState({}, '', url)
}

async function main() {
    const store = await resolveStore()
    const filter = document.getElementById('personFilter')
    const container = document.getElementById('peopleList')
    const status = document.getElementById('indexStatus')

    // A shared query in the URL is the page's own idea of what a filter means:
    // restore it silently, then let the model do the matching.
    filter.value = readQuery()

    filter.addEventListener('gl-filter-change', async () => {
        syncQueryToUrl(filter.value)
        await refresh(store, filter, container, status)
    })

    await refresh(store, filter, container, status)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main)
} else {
    main()
}
