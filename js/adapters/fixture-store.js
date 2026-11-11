/**
 * @module adapters/fixture-store
 * @description MemoryStore seeded from a plain JSON array of entities and
 * annotations. Use for demos (and storybooks-style examples) without a
 * network. See js/adapters/fixtures/sample-family.json for the shipped fixture.
 */

import { MemoryStore } from './memory-store.js'
import { assertStore } from './store.js'
import sampleFamily from './fixtures/sample-family.json'

export class FixtureStore extends MemoryStore {
    /**
     * @param {Array<Object>} [documents] entities + annotations to seed; the
     * shipped sample-family fixture is used when omitted.
     */
    constructor(documents = sampleFamily) {
        super()
        for (const doc of documents) {
            // Preserve fixture ids verbatim so tests/demos can reference them.
            if (this.documents.has(doc['@id'])) continue
            this.documents.set(doc['@id'], JSON.parse(JSON.stringify(doc)))
        }
        assertStore(this)
    }
}

/**
 * @param {Array<Object>} [documents] optional fixture documents
 * @returns {FixtureStore}
 */
export function createFixtureStore(documents) {
    return new FixtureStore(documents)
}

export default FixtureStore
