/**
 * @module adapters/local-store
 * @description localStorage-backed Store that satisfies the same contract as the
 * memory/fixture adapters. It exists so the birth slice (and any page) is
 * demoable and end-to-end testable in the browser with NO network and NO build
 * step: a save survives a page reload, which is exactly what the birth journey
 * E2E asserts. It is a stand-in for the RerumStore used in dev; the page chooses
 * between them via config/query (see module:adapters/store-bootstrap), so
 * switching to devstore requires no caller change.
 *
 * Every mutation flushes the whole document map under a single namespaced key.
 * Documents are stored new-shape only; legacy import is the RerumStore/legacy
 * reader's concern, not this store's.
 */

import { MemoryStore } from './memory-store.js'
import { assertStore } from './store.js'

const STORAGE_KEY = 'genealogger.localstore.v1'

export class LocalStore extends MemoryStore {
    /**
     * @param {Object} [options]
     * @param {Object} [options.storage] localStorage-compatible object (injected in tests)
     * @param {string} [options.key] storage key (defaults to the app key)
     */
    constructor(options = {}) {
        super()
        const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null)
        this.storage = storage
        this.key = options.key || STORAGE_KEY
        this._hydrate()
    }

    _hydrate() {
        if (!this.storage) return
        try {
            const raw = this.storage.getItem(this.key)
            if (!raw) return
            for (const doc of JSON.parse(raw)) {
                if (doc && doc['@id'] && !this.documents.has(doc['@id'])) {
                    this.documents.set(doc['@id'], doc)
                }
            }
        } catch (err) {
            // Corrupt cache: start clean rather than crash the page.
            this.documents.clear()
        }
    }

    _flush() {
        if (!this.storage) return
        try {
            this.storage.setItem(this.key, JSON.stringify(Array.from(this.documents.values())))
        } catch (err) {
            // Quota exceeded: in-memory copy stays authoritative for the session.
        }
    }

    create(doc) {
        const created = super.create(doc)
        this._flush()
        return created
    }

    update(doc) {
        const updated = super.update(doc)
        this._flush()
        return updated
    }

    remove(id) {
        const removed = super.remove(id)
        this._flush()
        return removed
    }
}

/**
 * @param {Object} [options] see LocalStore constructor
 * @returns {LocalStore}
 */
export function createLocalStore(options) {
    return assertStore(new LocalStore(options))
}

export default LocalStore
