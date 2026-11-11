/**
 * @module adapters/memory-store
 * @description Map-backed Store implementation for unit tests and as the
 * model layer's default store. No network, no DOM. Documents are deep-copied
 * on the way in and out so callers can never mutate store-held state.
 * @see module:adapters/store
 */

import config from '../model/config.js'
import { assertStore, relOf } from './store.js'

const clone = doc => JSON.parse(JSON.stringify(doc))

/** Annotations are documents with a target; entities are everything else. */
function isAnnotation(doc) {
    return doc.type === 'Annotation' || Boolean(doc.target)
}

/** True when a document's '@type' (string or array) equals/includes `type`. */
function hasType(value, type) {
    return Array.isArray(value) ? value.includes(type) : value === type
}

/** Normalize an annotation body property to an array of ValueObjects. */
function valueObjectsOf(body, property) {
    const raw = body && body[property]
    if (raw === undefined) return []
    return Array.isArray(raw) ? raw : [raw]
}

export class MemoryStore {
    constructor() {
        /** @type {Map<string, Object>} id -> document */
        this.documents = new Map()
    }

    /**
     * Persist a new document, minting an '@id' when absent.
     * @param {Object} doc BareEntity or Annotation shape
     * @returns {Object} stored copy with '@id'
     */
    create(doc) {
        if (!doc || typeof doc !== 'object') {
            throw new TypeError('create() requires a document object')
        }
        const stored = clone(doc)
        if (!stored['@id']) {
            stored['@id'] = config.mintId()
        }
        if (this.documents.has(stored['@id'])) {
            throw new Error(`document already exists: ${stored['@id']}`)
        }
        this.documents.set(stored['@id'], stored)
        return clone(stored)
    }

    /**
     * @param {string} id
     * @returns {Object|null} copy of the document, or null when unknown
     */
    read(id) {
        const doc = this.documents.get(id)
        return doc ? clone(doc) : null
    }

    /**
     * Replace the stored copy of a document by '@id'.
     * @param {Object} doc must carry an existing '@id'
     * @returns {Object} stored copy
     */
    update(doc) {
        if (!doc || !doc['@id'] || !this.documents.has(doc['@id'])) {
            throw new Error('update() requires an existing @id')
        }
        const stored = clone(doc)
        this.documents.set(stored['@id'], stored)
        return clone(stored)
    }

    /**
     * @param {string} id
     * @returns {boolean} true when a document was removed
     */
    remove(id) {
        return this.documents.delete(id)
    }

    /**
     * All entities (non-annotations) of a given '@type'.
     * @param {string} type e.g. 'Person' or 'Event'
     * @returns {Array<Object>}
     */
    listByType(type) {
        const found = []
        for (const doc of this.documents.values()) {
            if (!isAnnotation(doc) && hasType(doc['@type'], type)) {
                found.push(clone(doc))
            }
            if (doc['@graph']) {
                for (const member of doc['@graph']) {
                    if (!isAnnotation(member) && hasType(member['@type'], type)) {
                        found.push(clone(member))
                    }
                }
            }
        }
        return found
    }

    /**
     * Annotations matching all provided filters (AND semantics).
     * @param {{target?: string, rel?: string, type?: string, value?: *}} [filter]
     * `type` is a property URI that must key some body ValueObject. `rel` is an
     * id carried by the annotation's top-level `rel` reverse index.
     * @returns {Array<Object>}
     */
    query(filter = {}) {
        const results = []
        for (const doc of this.documents.values()) {
            if (!isAnnotation(doc)) continue
            if (filter.target !== undefined && doc.target !== filter.target) continue
            if (filter.rel !== undefined && !relOf(doc).includes(filter.rel)) continue
            if (filter.type !== undefined && valueObjectsOf(doc.body, filter.type).length === 0) continue
            if (filter.value !== undefined) {
                const matching = filter.type !== undefined
                    ? valueObjectsOf(doc.body, filter.type)
                    : Object.keys(doc.body || {}).flatMap(key => valueObjectsOf(doc.body, key))
                if (!matching.some(vo => vo && vo.value === filter.value)) continue
            }
            results.push(clone(doc))
        }
        return results
    }

    /**
     * Every stored document (debug/fixture helpers).
     * @returns {Array<Object>}
     */
    all() {
        return Array.from(this.documents.values(), clone)
    }
}

/**
 * Factory for the default store used by the model layer.
 * @returns {MemoryStore}
 */
export function createMemoryStore() {
    return assertStore(new MemoryStore())
}

export default MemoryStore
