/**
 * @module model/config
 * @description Central configuration for the store-agnostic Eventities model layer.
 * Mirrors antlers DEERConfig keys (URLS.BASE_URI, ID_BASES, READ_ID_BASES) so a
 * future RERUM adapter can move from devstore to production purely by config.
 * This module performs NO I/O.
 */

/**
 * Generate an RFC4122 v4 style unique suffix for minted ids.
 * @returns {string} a uuid-ish string
 */
function uuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID()
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.floor(Math.random() * 16)
        const v = c === 'x' ? r : (r % 4) + 8
        return v.toString(16)
    })
}

export const config = {
    URLS: {
        // Documents are READ from this host: GET <BASE_URI>/id/<hex> -> the doc.
        // Verified live against devstore.
        BASE_URI: 'https://devstore.rerum.io/v1',
        READ_BASE_URIS: ['https://devstore.rerum.io/v1'],
        // Documents are WRITTEN and QUERIED through a different service. Verified
        // live: POST <API_BASE>/create -> 201 + stored doc with a server-minted
        // '@id' under BASE_URI/id/; POST <API_BASE>/query -> array of current
        // versions; PUT <API_BASE>/update (doc in the body, no id in the path)
        // -> 200 + the NEW version under a fresh '@id'. (BASE_URI/create is a 404.)
        // Production RERUM is a second API_BASE + BASE_URI pair; no caller changes.
        API_BASE: 'https://tinydev.rerum.io'
    },
    // Write ids are minted here so shapes match devstore documents today.
    ID_BASE: 'https://devstore.rerum.io/v1/id/',
    // All id bases this model recognises as "ours" (lazy migration reads both).
    ID_BASES: ['https://devstore.rerum.io/v1/id/'],
    // Stores consulted on reads. Production RERUM is added here when it lands.
    READ_ID_BASES: ['https://devstore.rerum.io/v1/id/'],
    /**
     * Mint a new, globally unique id under the configured ID_BASE.
     * @returns {string}
     */
    mintId() {
        return `${this.ID_BASE}${uuid()}`
    }
}

export default config
