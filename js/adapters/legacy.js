/**
 * @module adapters/legacy
 * @description READ-ONLY adapter converting legacy DEER v1 devstore shapes to
 * the new model shapes. TRIMMABLE: once nothing depends on old devstore data
 * (lazy migration, per M1 spec), delete this module.
 *
 * Legacy shapes mirrored from js/deer.js, js/deer-record.js, and
 * js/utils/data-utils.js of the v1 app:
 * - Entities live at `https://devstore.rerum.io/v1/<id>` (or `.../id/<id>`),
 *   are bare JSON-LD with `@type` ('Person', 'Event', ...), a `name`/`label`,
 *   and the person's FACTS WRITTEN DIRECTLY ON THE DOCUMENT (the "expanded"
 *   shape produced by deer-utils expand(): schema-style bare keys such as
 *   `givenName`, `birthDate`, `hasFather`, `additionalType`, `hasAgent`).
 *   Some documents also carry a `@graph` wrapper and `__rerum` metadata.
 * - Annotations are Web Annotations: `{ type: 'Annotation', target, body }`
 *   where `body` is a single-key object keyed by the bare property name with
 *   a `{ value }` (or plain value) payload, plus optional `creator`,
 *   `motivation`, and `evidence`.
 *
 * Interpretation choices (simplest faithful reading of the v1 code):
 * - Bare fact properties on an entity become nv-style ValueObject assertions
 *   targeting that entity. `evidence` on the legacy document becomes each
 *   ValueObject's evidence.
 * - Bare v1 keys map onto preferred standard URIs where one exists
 *   (schema.org etc.); `hasFather`/`hasMother` map to nv:hasParent;
 *   `hasAgent` maps to nv:participant; a doc-level `additionalType` ('Birth',
 *   'Death', ...) maps to the Event subtype URI, and an agent-level
 *   `additionalType` ('mother', 'witness', ...) becomes that participant's
 *   nv:role. Reference values may be a bare id or an embedded `{ '@id': ... }`
 *   object; both are stored as the id so derived reads can match them.
 *   Unknown bare keys are kept verbatim as their bare name so no data is dropped.
 * - Legacy `__rerum`/`@context`/`@graph` plumbing is discarded; identity keys
 *   are preserved raw.
 */

import { NV, SCHEMA, TYPES, DCTERMS, EVENT_SUBTYPES, CANONICAL_ROLES } from '../model/vocabulary.js'

/** Bare v1 property name -> model property URI. */
const LEGACY_KEY_MAP = {
    givenName: SCHEMA.givenName,
    familyName: SCHEMA.familyName,
    additionalName: SCHEMA.additionalName,
    alternateName: SCHEMA.alternateName,
    name: SCHEMA.name,
    nickname: SCHEMA.alternateName,
    birthDate: SCHEMA.birthDate,
    birthPlace: SCHEMA.birthPlace,
    deathDate: SCHEMA.deathDate,
    deathPlace: SCHEMA.deathPlace,
    sex: SCHEMA.sex,
    gender: SCHEMA.gender,
    homeLocation: SCHEMA.homeLocation,
    hasFather: NV.hasParent,
    hasMother: NV.hasParent,
    hasAgent: NV.participant,
    hasGodparent: NV.participant
}

const IDENTITY_KEYS = ['@id', '@type', '@context', '__rerum', '@graph']

/**
 * The new shape mirrors an Event's subtype into top-level dcterms:type so DEER
 * v1 tooling can still read it (adapters/rerum-store.js writes both slots).
 * That mirror is type metadata, not an asserted fact: a document whose only
 * non-plumbing key is its own subtype mirror is already new-shape, and must not
 * fan out into a `#legacy-*` pseudo-assertion on read.
 * @param {Object} doc raw store document
 * @param {string} key property name being considered
 * @returns {boolean} true when `key` is the dcterms:type mirror of an @type entry
 */
export function isSubtypeMirror(doc, key) {
    if (key !== DCTERMS.type) return false
    const value = rawValue(doc[DCTERMS.type])
    return typeof value === 'string' && [].concat(doc['@type'] || []).includes(value)
}

/** Legacy facts may arrive as `value`, `{ value }`, or arrays thereof. */
function rawValue(entry) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry) {
        return entry.value
    }
    return entry
}

function mapKey(key) {
    if (key.includes('/') || key.includes('#') || key.includes(':')) return key
    return LEGACY_KEY_MAP[key] || key
}

/**
 * v1 reference-valued facts (`hasAgent`, `hasFather`, …) arrive either as a bare
 * id string or as an embedded object (`{ '@id': …, additionalType: 'mother' }`,
 * which is how the per-agent role rode along). Downstream lookups match on the
 * id, so unwrap to `@id` and keep the object around for its qualifiers.
 */
function refId(value) {
    return value && typeof value === 'object' && typeof value['@id'] === 'string' ? value['@id'] : null
}

/** Case-insensitive `nv:` role URIs for the v1 `additionalType` spellings. */
const LEGACY_ROLES = Object.fromEntries(
    Object.entries(CANONICAL_ROLES).map(([token, uri]) => [token.toLowerCase(), uri])
)

function legacyRole(item) {
    const token = rawValue(item && item.additionalType)
    if (typeof token !== 'string' || !token.trim()) return NV.child
    return LEGACY_ROLES[token.trim().toLowerCase()] || token.trim()
}

function legacyValueObjects(key, entry) {
    const property = mapKey(key)
    const entries = Array.isArray(entry) ? entry : [entry]
    const vos = []
    for (const item of entries) {
        const raw = rawValue(item)
        const value = refId(raw) || raw
        if (value === undefined || value === null) continue
        const vo = { value }
        if (item && typeof item === 'object' && (item.name || item.source || item.comment)) {
            vo.source = {}
            if (item.name) vo.source.citationNote = String(item.name)
            if (item.source) vo.source.citationSource = String(item.source)
            if (item.comment) vo.source.comment = String(item.comment)
        }
        vos.push({ property, vo, item })
    }
    return vos
}

/**
 * Convert one legacy annotation document to the new Annotation shape.
 * @param {Object} anno legacy `{ type:'Annotation', target, body, evidence?, creator? }`
 * @returns {Object|null} new Annotation, or null when it isn't one
 */
export function convertLegacyAnnotation(anno) {
    if (!anno || anno.type !== 'Annotation' || !anno.target || !anno.body) return null
    const body = {}
    for (const [key, entry] of Object.entries(anno.body)) {
        for (const { property, vo } of legacyValueObjects(key, entry)) {
            if (anno.evidence && !vo.evidence) vo.evidence = anno.evidence
            body[property] = body[property] ? [].concat(body[property], vo) : vo
        }
    }
    if (!Object.keys(body).length) return null
    const converted = {
        '@id': anno['@id'],
        type: 'Annotation',
        target: anno.target,
        body
    }
    if (anno.motivation) converted.motivation = anno.motivation
    if (anno.creator) converted.creator = anno.creator
    if (anno.evidence) converted['http://purl.org/dc/terms/source'] = anno.evidence
    return converted
}

/**
 * Split one legacy entity document into its bare entity plus ValueObject
 * assertions for every non-identity fact found directly on the document
 * (the v1 "expanded"/DOM-as-database shape).
 * @param {Object} entity legacy devstore document
 * @returns {Array<Object>} [bareEntity, ...Annotations]
 */
export function convertLegacyEntity(entity) {
    if (!entity || !entity['@id']) return []
    const members = Array.isArray(entity['@graph']) ? entity['@graph'] : [entity]
    const primary = members.find(m => m['@id'] === entity['@id']) || members[0]
    const type = primary['@type'] || TYPES.Person
    const bare = { '@id': primary['@id'], '@type': type }
    const label = primary.label || primary.name
    if (label) bare.label = String(rawValue(label))
    const annotations = []
    const evidence = rawValue(primary.evidence) || undefined
    const makeAnnotation = (property, vo) => {
        if (evidence && !vo.evidence) vo.evidence = evidence
        const body = { [property]: vo }
        if (LEGACY_KEY_MAP.hasGodparent === mapKey(property) && property === NV.participant) {
            body[NV.role] = { value: NV.godParent }
        }
        annotations.push({
            '@id': `${primary['@id']}#legacy-${property.replace(/[^a-zA-Z0-9]/g, '-')}-${annotations.length}`,
            type: 'Annotation',
            target: primary['@id'],
            body,
            ...(evidence ? { 'http://purl.org/dc/terms/source': evidence } : {})
        })
    }
    for (const [key, entry] of Object.entries(primary)) {
        if (IDENTITY_KEYS.includes(key) || key === 'label' || key === 'name' || key === 'evidence') continue
        if (key === 'additionalType') {
            // v1 event subtypes: 'Birth', 'Death', ...
            const subtype = rawValue(entry)
            const uri = EVENT_SUBTYPES[subtype] || (typeof subtype === 'string' ? EVENT_SUBTYPES.Birth.replace('Birth', subtype) : undefined)
            if (uri) {
                const types = Array.isArray(bare['@type']) ? bare['@type'] : [bare['@type']]
                if (!types.includes(uri)) types.push(uri)
                bare['@type'] = types.length === 1 ? types[0] : types
            }
            continue
        }
        if (isSubtypeMirror(primary, key)) {
            // Same slot as `additionalType`, spelled with the URI the new shape
            // writes: fold it into @type rather than asserting it as a fact.
            const uri = rawValue(primary[key])
            const types = Array.isArray(bare['@type']) ? bare['@type'] : [bare['@type']]
            if (!types.includes(uri)) types.push(uri)
            bare['@type'] = types.length === 1 ? types[0] : types
            continue
        }
        if (key === 'hasFather' || key === 'hasMother') {
            makeAnnotation(NV.hasParent, { value: refId(rawValue(entry)) || rawValue(entry) })
            continue
        }
        if (key === 'hasGodparent') {
            makeAnnotation(NV.participant, { value: refId(rawValue(entry)) || rawValue(entry) })
            continue
        }
        for (const { property, vo, item } of legacyValueObjects(key, entry)) {
            if (property === NV.participant) {
                if (evidence && !vo.evidence) vo.evidence = evidence
                const body = { [property]: vo, [NV.role]: { value: legacyRole(item) } }
                annotations.push({
                    '@id': `${primary['@id']}#legacy-agent-${annotations.length}`,
                    type: 'Annotation',
                    target: primary['@id'],
                    body,
                    ...(evidence ? { 'http://purl.org/dc/terms/source': evidence } : {})
                })
                continue
            }
            makeAnnotation(property, vo)
        }
    }
    return [bare, ...annotations]
}

/**
 * Convert an array of legacy devstore documents (entities and/or annotations)
 * into new-model documents. Pure function: no fetching, no store writes.
 * @param {Array<Object>} jsonArray raw legacy JSON documents
 * @returns {Array<Object>} new-shape BareEntity and Annotation documents
 */
export function readDevstoreJson(jsonArray) {
    if (!Array.isArray(jsonArray)) throw new TypeError('readDevstoreJson() expects an array of legacy documents')
    const docs = []
    for (const doc of jsonArray) {
        if (doc && doc.type === 'Annotation') {
            const converted = convertLegacyAnnotation(doc)
            if (converted) docs.push(converted)
        } else if (doc && doc['@id']) {
            docs.push(...convertLegacyEntity(doc))
        }
    }
    return docs
}

/**
 * Async stub: fetch legacy documents from devstore and convert them.
 * `fetchImpl` is injectable for tests; nothing in the model layer fetches
 * URLs directly.
 * @param {Array<string>} ids legacy devstore ids
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl] fetch-compatible function
 * @param {string} [options.baseUrl] devstore base, from model config by default
 * @returns {Promise<Array<Object>>} new-shape documents
 */
export async function loadLegacy(ids, { fetchImpl = globalThis.fetch, baseUrl } = {}) {
    const { default: config } = await import('../model/config.js')
    const base = baseUrl || config.URLS.BASE_URI
    if (typeof fetchImpl !== 'function') {
        throw new TypeError('loadLegacy() requires a fetch implementation (inject fetchImpl in tests)')
    }
    const docs = []
    for (const id of ids) {
        const url = String(id).startsWith('http') ? id : `${base}/${id}`
        const json = await fetchImpl(url).then(r => r.json())
        docs.push(...(Array.isArray(json) ? json : [json]))
    }
    return readDevstoreJson(docs)
}
