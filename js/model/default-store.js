/**
 * @module model/default-store
 * @description Shared lazy MemoryStore singleton used as the default injected
 * store across the model layer, so callers (and quick demos) work with zero
 * setup and tests never touch the network. Production callers pass their own
 * store to every model function instead.
 */

import { createMemoryStore } from '../adapters/memory-store.js'
import { assertStore } from '../adapters/store.js'

let defaultStore = null

/**
 * @returns {Object} a process-wide MemoryStore satisfying the Store contract
 */
export function getDefaultStore() {
    if (!defaultStore) {
        defaultStore = createMemoryStore()
    }
    return defaultStore
}

/**
 * Install a Store (e.g. the RERUM or localStorage adapter a page resolved) as
 * the model layer's default, so model calls need no per-call store argument.
 * @param {Object} store a Store implementing the contract
 * @returns {Object} the installed store
 */
export function setDefaultStore(store) {
    defaultStore = assertStore(store)
    return defaultStore
}

/**
 * Replace the shared default store (used by tests to reset state).
 * @param {Object|null} [store] a Store, or null to rebuild a fresh MemoryStore
 * @returns {Object} the new default store
 */
export function resetDefaultStore(store = null) {
    defaultStore = store || createMemoryStore()
    return defaultStore
}
