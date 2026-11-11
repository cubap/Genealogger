/**
 * @module adapters/store-bootstrap
 * @description The one place a page decides WHICH store the model layer talks
 * to. It reads a config/query switch and returns a Store, then installs it as
 * the model layer's default so model API calls need no per-call store argument.
 * This is the "injected store adapter" seam every page reuses: the page never
 * imports a concrete adapter itself, it calls resolveStore() and hands the model
 * the result.
 *
 * Selection order (first match wins):
 *   1. ?store=local               -> LocalStore (localStorage; no network)
 *   2. ?store=memory              -> in-memory (no persistence; smoke checks)
 *   3. ?store=fixture             -> sample-family FixtureStore (dynamic import)
 *   4. default (browser)          -> RerumStore (devstore; production is a config switch)
 *
 * The default is the real remote store because that is what the legacy birth page
 * did (it posted straight to tinydev.rerum.io) and what user story 15 of #12 asks
 * for: a saved record is usable data, not a per-browser sketch. ?store=local exists
 * so E2E and demos can prove the create -> reload -> read cycle deterministically,
 * without writing throwaway records into the shared sandbox. Flipping devstore ->
 * production is a config change in `model/config.js` bases, never a caller change.
 */

import { createMemoryStore } from './memory-store.js'
import { createLocalStore } from './local-store.js'
import { createRerumStore } from './rerum-store.js'
import { setDefaultStore } from '../model/default-store.js'

export const STORE_KINDS = ['local', 'memory', 'rerum', 'fixture']

/**
 * Build a Store from a kind name.
 * @param {string} kind one of STORE_KINDS
 * @param {Object} [options] passed through to the adapter factory
 * @returns {Promise<Object>} a Store implementing the contract
 */
export async function createStore(kind, options = {}) {
    switch (kind) {
    case 'rerum':
    case 'devstore':
        return createRerumStore(options)
    case 'memory':
        return createMemoryStore()
    case 'fixture': {
        const { createFixtureStore } = await import('./fixture-store.js')
        return createFixtureStore()
    }
    case 'local':
        return createLocalStore(options)
    default:
        throw new TypeError(`unknown store kind '${kind}' (expected one of ${STORE_KINDS.join(', ')})`)
    }
}

/**
 * Resolve the store for the current page and install it as the model default.
 * @param {Object} [options]
 * @param {string} [options.search] location.search to read ?store= from
 * @param {string} [options.fallback] kind to use when no ?store= is present
 * @param {Object} [options.storeOptions] forwarded to the chosen factory
 * @returns {Promise<Object>} the installed Store
 */
export async function resolveStore(options = {}) {
    const search = options.search
        ?? (typeof globalThis.location !== 'undefined' ? globalThis.location.search : '')
    const param = new URLSearchParams(search).get('store')
    const browser = typeof globalThis.localStorage !== 'undefined'
    const kind = param || options.fallback || (browser ? 'rerum' : 'memory')
    const store = await createStore(kind, options.storeOptions)
    setDefaultStore(store)
    return store
}

export default resolveStore
