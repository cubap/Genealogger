/**
 * @module adapters/rerum-store
 * @description RERUM store adapter. Implements the SAME Store contract as the
 * memory/fixture adapters (see module:adapters/store) but persists to a RERUM
 * document store over HTTP. This is the adapter the birth page (and every
 * future page) reaches in production; flipping devstore -> production is a
 * CONFIG change only (see below), no caller edit.
 *
 * Config-gating (constraint: writes target devstore; production stays a switch):
 *   - `writeBase`/`queryBase` default to config.URLS.API_BASE, the RERUM
 *     write/query service (tinydev today). It is NOT the same host as the
 *     document host: devstore serves GETs, tinydev serves create/query/update.
 *   - `readBases` default to config.READ_BASE_URIS (devstore today; production
 *     id bases are added to that list to widen reads without touching callers).
 *   - `idBases` from config.ID_BASES tell this adapter which ids are "ours" so
 *     a foreign id is read verbatim instead of rewritten.
 * Nothing here hardcodes a host; every base flows from model config.
 *
 * Versioning: RERUM mints the '@id' on create (a client-sent '@id' is ignored)
 * and an update produces a NEW '@id' with the previous version linked via
 * `__rerum.history`. Callers must therefore always use the '@id' on the object
 * returned by create()/update(), never one they guessed up front.
 *
 * Lazy migration (constraint: legacy devstore records open read-only, editing
 * writes the new shape): every document that comes back over the wire is run
 * through the read-only legacy reader (module:adapters/legacy). A legacy DEER
 * v1 entity is split into a bare entity + new-shape ValueObject annotations the
 * moment it is read, so the model layer only ever sees the new shape. The
 * original legacy document is never rewritten here; it is superseded only when
 * the user edits and the model creates fresh new-shape documents.
 *
 * I/O lives ONLY here. Components and pages never fetch; they talk to the model
 * API which talks to this injected store. `fetchImpl` is injectable so the
 * adapter is unit-testable with no network.
 */

import config from '../model/config.js'
import { assertStore, relOf } from './store.js'
import { convertLegacyEntity, convertLegacyAnnotation, isSubtypeMirror } from './legacy.js'

const clone = doc => JSON.parse(JSON.stringify(doc))

/** Annotations are documents with a target; entities are everything else. */
function isAnnotation(doc) {
    return Boolean(doc) && (doc.type === 'Annotation' || Boolean(doc.target))
}

/** True when a bare '@type' (string or array) equals/includes `type`. */
function hasType(value, type) {
    return Array.isArray(value) ? value.includes(type) : value === type
}

/** Normalize an annotation body property to an array of ValueObjects. */
function valueObjectsOf(body, property) {
    const raw = body && body[property]
    if (raw === undefined) return []
    return Array.isArray(raw) ? raw : [raw]
}

/** Annotations matching a QueryFilter's clauses (AND semantics). */
function matchesFilter(anno, filter) {
    if (filter.rel !== undefined && !relOf(anno).includes(filter.rel)) return false
    if (filter.type !== undefined && valueObjectsOf(anno.body, filter.type).length === 0) return false
    if (filter.value !== undefined) {
        const keys = filter.type !== undefined ? [filter.type] : Object.keys(anno.body || {})
        return keys.some(key => valueObjectsOf(anno.body, key).some(vo => vo && vo.value === filter.value))
    }
    return true
}

/** Normalize a filter's rel clause to an array (devstore matches array members). */
function relValues(filter) {
    return Array.isArray(filter.rel) ? filter.rel : [filter.rel]
}

/** Keys a DEER v1 document can carry as plumbing rather than as asserted facts. */
const PLUMBING_KEYS = ['@id', '@type', '@context', '@graph', '__rerum', 'label', 'name', 'evidence']

/**
 * Run one raw store document through the legacy reader into new-shape
 * documents. Returns an array because a legacy entity fans out into a bare
 * entity plus one annotation per asserted fact. Documents already in the new
 * shape pass through unchanged (single-element array).
 *
 * Detection is STRUCTURAL, never "has __rerum": devstore stamps `__rerum`
 * versioning metadata on every document it serves, new shape included, so the
 * metadata says nothing about shape. (An earlier cut keyed off `__rerum` and
 * exploded every real annotation into `#legacy-*` pseudo-facts on read.) A
 * non-annotation document is legacy when it carries facts directly on itself —
 * except the dcterms:type subtype mirror, which the new shape writes itself.
 * @param {Object} raw a document straight from the store
 * @returns {Array<Object>} new-shape document(s)
 */
function migrate(raw) {
    if (!raw || typeof raw !== 'object') return []
    const isLegacyEntity = !isAnnotation(raw) && Boolean(raw['@id']) &&
        Object.keys(raw).some(key => !PLUMBING_KEYS.includes(key) && !isSubtypeMirror(raw, key))
    const isLegacyAnnotation = isAnnotation(raw) && raw.body && (
        Object.values(raw.body).some(entry => entry && typeof entry === 'object' && !('value' in entry) && Object.keys(entry).some(k => !['value', 'source', 'evidence', 'https://cubap.github.io/Genealogger/nv#confidence'].includes(k)))
    )
    if (isLegacyAnnotation) {
        const converted = convertLegacyAnnotation(raw)
        return converted ? [converted] : []
    }
    if (isLegacyEntity) {
        return convertLegacyEntity(raw)
    }
    return [raw]
}

/** Strip devstore __rerum/JSON-LD plumbing we do not carry in the model shape. */
function toModelShape(doc) {
    if (!doc) return doc
    if (isAnnotation(doc)) {
        const { type, target, body } = doc
        const anno = { '@id': doc['@id'], type: type || 'Annotation', target, body }
        if (doc.motivation) anno.motivation = doc.motivation
        if (doc.creator) anno.creator = doc.creator
        if (doc.rel !== undefined) anno.rel = clone(doc.rel)
        if (doc['http://purl.org/dc/terms/source']) anno['http://purl.org/dc/terms/source'] = doc['http://purl.org/dc/terms/source']
        return anno
    }
    const entity = { '@id': doc['@id'], '@type': doc['@type'] }
    if (doc.label) entity.label = doc.label
    else if (doc.name) entity.label = doc.name
    return entity
}

export class RerumStore {
    /**
     * @param {Object} [options]
     * @param {Function} [options.fetchImpl] fetch-compatible fn (global fetch by default)
     * @param {string} [options.writeBase] POST/PUT base for create/update; config URLS.API_BASE by default
     * @param {Array<string>} [options.readBases] GET bases; config READ_BASE_URIS by default
     * @param {string} [options.queryBase] POST base for query/listByType; config URLS.API_BASE by default
     */
    constructor(options = {}) {
        const {
            fetchImpl,
            writeBase = config.URLS.API_BASE,
            readBases = config.URLS.READ_BASE_URIS,
            queryBase = config.URLS.API_BASE
        } = options
        if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
            throw new TypeError('RerumStore requires a fetch implementation (inject fetchImpl in tests)')
        }
        // Keep the call late-bound: `const f = fetch; f(...)` detaches the native
        // method from Window and Chromium throws "Illegal invocation".
        this.fetch = fetchImpl
            ? ((...args) => fetchImpl(...args))
            : ((...args) => globalThis.fetch(...args))
        this.writeBase = writeBase.replace(/\/$/, '')
        this.readBases = readBases.map(base => base.replace(/\/$/, ''))
        this.queryBase = queryBase.replace(/\/$/, '')
    }

    /** Small JSON POST helper; resolves null on 404/!ok rather than throwing. */
    async _post(url, body) {
        const res = await this.fetch(url, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        if (!res.ok) return null
        return await res.json()
    }

    /**
     * Persist a new document. The store mints the '@id'; a legacy-shaped input
     * is sent as-is (the write target keeps the new shape we hand it).
     * @param {Object} doc BareEntity or Annotation in the new shape
     * @returns {Promise<Object>} stored document with '@id'
     */
    async create(doc) {
        if (!doc || typeof doc !== 'object') {
            throw new TypeError('create() requires a document object')
        }
        const created = await this._post(`${this.writeBase}/create`, clone(doc))
        if (!created || !created['@id']) {
            throw new Error(`create() failed for document @type=${doc['@type'] || doc.type}`)
        }
        return created
    }

    /**
     * Read one document by id (or URL), lazily migrating any legacy shape to the
     * new model shape. Tries every configured read base before giving up.
     * @param {string} id full id or URL
     * @returns {Promise<Object|null>} new-shape document or null
     */
    async read(id) {
        const primary = await this._readRaw(id)
        if (!primary) return null
        const migrated = migrate(primary).map(toModelShape)
        return migrated.find(doc => !isAnnotation(doc)) || null
    }

    /**
     * Read every annotation targeting an id, lazily migrated to the new shape.
     * Shared by query() and listByType(); memoized per instance per target so a
     * single getPerson() does not re-fetch the same annotations.
     * @param {string} target
     * @returns {Promise<Array<Object>>} new-shape annotations
     */
    async _annotationsFor(target) {
        if (!this._cache) this._cache = new Map()
        if (this._cache.has(target)) return this._cache.get(target)
        const filter = { target, '__rerum.history.next': { $exists: true, $size: 0 } }
        const rows = await this._post(`${this.queryBase}/query`, filter)
        const annotations = []
        const seen = new Set()
        const push = doc => {
            if (isAnnotation(doc) && doc['@id'] && !seen.has(doc['@id'])) {
                seen.add(doc['@id'])
                annotations.push(toModelShape(doc))
            }
        }
        for (const raw of Array.isArray(rows) ? rows : []) {
            for (const doc of migrate(raw)) push(doc)
        }
        // Legacy DEER v1 wrote facts DIRECTLY on the target entity document, not
        // as separate annotations, so they never appear in a target query. Read
        // the entity itself and fan its facts out into new-shape annotations so
        // a legacy record opens as a read-only migrated view (constraint #6).
        const rawTarget = await this._readRaw(target)
        if (rawTarget) {
            for (const doc of migrate(rawTarget)) push(doc)
        }
        this._cache.set(target, annotations)
        return annotations
    }

    /** GET one raw document by id/URL, trying every read base. Internal. */
    async _readRaw(id) {
        if (!id) return null
        const urls = String(id).startsWith('http')
            ? [id]
            : this.readBases.map(base => `${base}/${String(id).replace(/^\/+/, '')}`)
        for (const url of urls) {
            let res
            try {
                res = await this.fetch(url, { mode: 'cors' })
            } catch (err) {
                continue
            }
            if (!res || !res.ok) continue
            const json = await res.json()
            const docs = Array.isArray(json) ? json : [json]
            return docs.find(doc => doc && doc['@id'] === id) || docs[0] || null
        }
        return null
    }

    /**
     * Supersede a stored document with a new version. RERUM answers PUT /update
     * (document in the body, no id in the path) with the NEW version under a
     * freshly minted '@id'; the previous version links forward via
     * `__rerum.history.next`, which is why reads filter on an empty next.
     * @param {Object} doc must carry an existing '@id'
     * @returns {Promise<Object>} the new-version document
     */
    async update(doc) {
        if (!doc || !doc['@id']) throw new Error('update() requires an @id')
        const res = await this.fetch(`${this.writeBase}/update`, {
            method: 'PUT',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc)
        })
        if (!res || !res.ok) throw new Error(`update() failed for ${doc['@id']}`)
        const updated = await res.json()
        if (this._cache) this._cache.clear()
        return updated
    }

    /**
     * Remove a document. RERUM stores are append-only (history-based); the
     * closest supported operation is a soft overwrite, so this is a no-op that
     * reports false. Nothing in the birth slice deletes; present to satisfy the
     * Store contract.
     * @returns {Promise<boolean>} false (devstore does not hard-delete)
     */
    async remove() {
        return false
    }

    /**
     * All entities of a given '@type'.
     *
     * The result is a FLOOR, not a total: devstore `/query` returns at most 10
     * documents and accepts no paging (see docs/devstore-query-contract.md). A
     * caller that needs "everything of this type" must be scoped by something
     * indexed instead. Each generation spells its '@type' differently (v1 stores
     * the bare name, the new shape an array holding the subtype URI), so use
     * `typeTokens()` to ask for both.
     * @param {string} type e.g. 'Person' or 'Event'
     * @returns {Promise<Array<Object>>} new-shape bare entities
     */
    async listByType(type) {
        const filter = {
            '__rerum.history.next': { $exists: true, $size: 0 },
            $or: [{ '@type': type }, { '@type': { $all: [type] } }]
        }
        const rows = await this._post(`${this.queryBase}/query`, filter)
        const entities = []
        const seen = new Set()
        for (const raw of Array.isArray(rows) ? rows : []) {
            for (const doc of migrate(raw)) {
                if (isAnnotation(doc)) continue
                const entity = toModelShape(doc)
                if (entity['@id'] && !seen.has(entity['@id']) && hasType(entity['@type'], type)) {
                    seen.add(entity['@id'])
                    entities.push(entity)
                }
            }
        }
        return entities
    }

    /**
     * Annotations matching target/rel/type/value.
     *
     * Only `target` and `rel` can be resolved by the server, because devstore
     * filters with dot-notation and EVERY path segment containing a '.' is
     * unreachable — verified live: `body.https://schema.org/x.value` returns 0
     * rows while `body.note.value` and top-level `rel` return the documents.
     * So a body property URI (always a dotted URL) cannot be queried
     * server-side; `type`/`value` are applied client-side after a `target` or
     * `rel` fetch. A query with neither is a full-collection scan, which is
     * never acceptable against a shared store, and throws instead of silently
     * returning a truncated or empty set.
     * @param {{target?: string, rel?: string, type?: string, value?: *}} [filter]
     * @returns {Promise<Array<Object>>}
     */
    async query(filter = {}) {
        if (filter.target) {
            const annotations = await this._annotationsFor(filter.target)
            return annotations.filter(anno => matchesFilter(anno, filter)).map(clone)
        }
        if (filter.rel !== undefined) {
            const out = []
            const seen = new Set()
            for (const value of relValues(filter)) {
                const rows = await this._post(`${this.queryBase}/query`, {
                    type: 'Annotation',
                    rel: value,
                    '__rerum.history.next': { $exists: true, $size: 0 }
                })
                for (const raw of Array.isArray(rows) ? rows : []) {
                    for (const doc of migrate(raw)) {
                        if (!isAnnotation(doc) || !doc['@id'] || seen.has(doc['@id'])) continue
                        const anno = toModelShape(doc)
                        if (!matchesFilter(anno, filter)) continue
                        seen.add(doc['@id'])
                        out.push(clone(anno))
                    }
                }
            }
            return out
        }
        throw new Error(
            'RerumStore.query() requires a target or a rel: devstore can only filter dot-free ' +
            'top-level paths, so a body-property search would mean scanning every annotation in the store.'
        )
    }
}

/**
 * Factory mirroring createMemoryStore/createFixtureStore.
 * @param {Object} [options] see RerumStore constructor
 * @returns {RerumStore}
 */
export function createRerumStore(options) {
    return assertStore(new RerumStore(options))
}

export default RerumStore
