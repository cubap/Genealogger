/**
 * @module pages/tree
 * @description Page wiring for tree.html (M3, issue #14 story 10). Owns URL
 * state and store bootstrap; all knowledge of the data shape stays in
 * model/tree.js and all rendering inside gl-tree-view.js.
 *
 * Deep-link contract: `?person=<id>` is the convention the other migrated
 * pages use, and the legacy `#<id>` hash still works because person.html emits
 * `tree.html#<id>`. Re-rooting (a node click) rewrites the URL to the query
 * form with history.replaceState so a refresh returns the same tree.
 * `?generations=N` optionally widens the walk (bounded by the model anyway).
 */

import { resolveStore } from '../adapters/store-bootstrap.js'
import { loadTree, DEFAULT_MAX_GENERATIONS } from '../model/tree.js'
import '../components/gl-tree-view.js'

function readParams() {
    const params = new URLSearchParams(window.location.search)
    const fromHash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    const generations = parseInt(params.get('generations') ?? '', 10)
    return {
        personId: params.get('person') || fromHash,
        maxGenerations: Number.isFinite(generations) && generations > 0
            ? generations
            : DEFAULT_MAX_GENERATIONS
    }
}

function setUrlPerson(id) {
    const url = new URL(window.location.href)
    url.searchParams.set('person', id)
    url.hash = ''
    window.history.replaceState({}, '', url)
}

async function refresh(store, view, banner) {
    const { personId, maxGenerations } = readParams()
    if (!personId) {
        view.tree = null
        banner.textContent = 'No person selected. Link here as tree.html?person=<id> (tree.html#<id> also works).'
        banner.classList.remove('hidden')
        return
    }
    banner.textContent = 'Loading tree…'
    let tree
    try {
        tree = await loadTree({ store, rootId: personId, maxGenerations })
    } catch (err) {
        view.tree = null
        banner.textContent = `Could not load the tree: ${err.message}`
        banner.classList.remove('hidden')
        return
    }
    if (!tree) {
        view.tree = null
        banner.textContent = `No such person: ${personId}`
        banner.classList.remove('hidden')
        return
    }
    const units = tree.maxGenerations === 1 ? 'generation' : 'generations'
    const contested = tree.nodes.filter(node => node.contested).length
    banner.textContent = `${tree.rootLabel} — ${tree.nodes.length} people within ${tree.maxGenerations} ${units}` +
        (contested ? `, ${contested} contested` : '') +
        '. Edges are derived from nv:hasParent reads; nothing here stores nv:hasChild.'
    banner.classList.remove('hidden')
    view.tree = tree
}

async function main() {
    const store = await resolveStore()
    const view = document.getElementById('treeView')
    const banner = document.getElementById('personBanner')
    const rerender = () => refresh(store, view, banner)
    view.addEventListener('gl-tree-root', event => {
        if (!event.detail || !event.detail.id) return
        setUrlPerson(event.detail.id)
        rerender()
    })
    window.addEventListener('hashchange', rerender)
    window.addEventListener('popstate', rerender)
    await rerender()
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => main())
} else {
    main()
}
