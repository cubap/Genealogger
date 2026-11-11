/**
 * @module model/search
 * @description Minimal read helpers over the store: list and filter People for
 * an index/picker, find people by what is asserted about them, find events a
 * person took part in, and compute the derived parent/child edges.
 * `nv:hasChild` exists ONLY here, computed at read time from stored
 * `nv:hasParent` assertions -- it is never written.
 *
 * `listPersons()` is the index read (issue #14 story 1): ONE `listByType` query
 * plus a label DERIVED from each bare entity's identity data. It deliberately
 * resolves no annotations, so a thousand people cost one read, not a thousand.
 * The deeper "most relevant name" lookup belongs to `getPerson()` on the person
 * page, where one person's assertions are worth resolving.
 */

import { NV, SCHEMA, TYPES } from './vocabulary.js'
import { list as listAssertions, valueObjectsFor } from './assertions.js'
import { getDefaultStore } from './default-store.js'

/**
 * All assertions on a target, optionally limited to one property URI.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.targetId
 * @param {string} [options.type] property URI filter
 * @returns {Promise<Array<Object>>} annotations
 */
export async function assertionsOn(options = {}) {
    const { store = getDefaultStore(), targetId, type } = options
    return await listAssertions({ store, target: targetId, property: type })
}

/**
 * Value(s) asserted for one property on a target, unwrapped from their
 * ValueObjects but with provenance kept alongside. Returns every coexisting
 * assertion -- conflicting values are not merged.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.targetId
 * @param {string} options.type property URI
 * @returns {Promise<Array<Object>>} ValueObjects
 */
export async function valuesOf(options = {}) {
    const { store = getDefaultStore(), targetId, type } = options
    const annotations = await listAssertions({ store, target: targetId, property: type })
    return annotations.flatMap(anno => valueObjectsFor(anno, type))
}

/**
 * Every Person with at least one assertion of the given property URI.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.type property URI, e.g. nv:hasParent
 * @returns {Promise<Array<Object>>} bare Person entities
 */
export async function personsByAnnotationType(options = {}) {
    const { store = getDefaultStore(), type } = options
    if (!type) throw new TypeError('personsByAnnotationType() requires a type')
    const people = await store.listByType(TYPES.Person)
    const matches = []
    for (const person of people) {
        const hits = await store.query({ target: person['@id'], type })
        if (hits.length) matches.push(person)
    }
    return matches
}

/**
 * Events a Person participated in, via (event, agent, role) annotations.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @param {string} [options.role] optional canonical role filter (NV.child...)
 * @returns {Promise<Array<Object>>} Event entities
 */
export async function eventsForPerson(options = {}) {
    const { store = getDefaultStore(), personId, role } = options
    if (!personId) throw new TypeError('eventsForPerson() requires a personId')
    const annos = await store.query({ rel: personId, type: NV.participant })
    const eventIds = [...new Set(annos
        .filter(anno => role === undefined || valueObjectsFor(anno, NV.role).some(vo => vo.value === role))
        .map(anno => anno.target))]
    const events = []
    for (const id of eventIds) {
        const entity = await store.read(id)
        if (entity) events.push(entity)
    }
    return events
}

/**
 * Derived parents of a person: the values of its stored nv:hasParent
 * assertions (conflicting parents all returned, each with its evidence).
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Array<Object>>} ValueObjects whose `value` is a parent id
 */
export async function parentsOf(options = {}) {
    const { store = getDefaultStore(), personId } = options
    return await valuesOf({ store, targetId: personId, type: NV.hasParent })
}

/**
 * Derived children of a person: the COMPUTED inverse of nv:hasParent. The
 * parent->child edge is never stored as its own document; it is recovered from
 * the `rel` reverse index the hasParent assertion carries (the assertion
 * targets the child, so `target` alone cannot answer this question).
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Array<Object>>} ValueObjects whose `value` equals personId,
 * each `target` being a child id
 */
export async function childrenOf(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('childrenOf() requires a personId')
    const annos = await store.query({ rel: personId, type: NV.hasParent })
    const rows = []
    for (const anno of annos) {
        for (const vo of valueObjectsFor(anno, NV.hasParent)) {
            if (vo.value === personId) rows.push({ ...vo, target: anno.target })
        }
    }
    return rows
}

/** What a Person shows in a list when its identity carries nothing displayable. */
export const UNLABELED = '[ unlabeled ]'

/**
 * Read one raw identity property out of a bare entity as display text. Tolerates
 * every shape identity data arrives in: a plain string, a ValueObject-shaped
 * `{ value }`, a `{ label }`/`{ name }` object, or an array of those. No
 * annotation is consulted -- this reads what is ALREADY on the entity.
 * @param {*} value
 * @returns {string} text, or '' when there is nothing to show
 */
function rawText(value) {
    if (value === null || value === undefined) return ''
    if (Array.isArray(value)) return value.map(rawText).filter(Boolean).join(' ')
    if (typeof value === 'object') return rawText(value.value ?? value.label ?? value.name ?? '')
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
    return ''
}

/** Bare DEER v1 keys still present on migrated identity data. */
const LEGACY_NAME_KEYS = ['givenName', 'additionalName', 'familyName']

/**
 * The cheap list label of a bare Person, DERIVED at read time from identity data
 * only (issue #14 story 1, #12 story 13). Preference order:
 *   1. `label` (what createPerson stores and the legacy reader copies from `name`)
 *   2. `name`
 *   3. name parts, schema.org URIs first then the bare v1 keys
 *   4. UNLABELED
 * @param {Object} entity a bare Person entity (any identity shape)
 * @returns {string} display label; never throws on odd input
 */
export function deriveLabel(entity) {
    if (!entity || typeof entity !== 'object') return UNLABELED
    const direct = rawText(entity.label) || rawText(entity.name)
    if (direct) return direct
    const parts = [SCHEMA.givenName, SCHEMA.additionalName, SCHEMA.familyName]
        .map(property => rawText(entity[property]))
        .filter(Boolean)
    if (!parts.length) {
        for (const key of LEGACY_NAME_KEYS) {
            const text = rawText(entity[key])
            if (text) parts.push(text)
        }
    }
    return parts.join(' ').trim() || UNLABELED
}

/**
 * Split free text into the lowercase tokens a search must satisfy.
 * @param {string|null|undefined} query raw user input
 * @returns {Array<string>} tokens; empty when there is no query
 */
export function normalizeQuery(query) {
    return String(query ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean)
}

/**
 * Does a label satisfy a query? Every token must appear (case-insensitive
 * substring); an empty query matches everything. Pure, so the matching rule the
 * index and any picker share is testable without a store or a DOM.
 * @param {string} label display text to test
 * @param {string|Array<string>} query raw text or pre-normalized tokens
 * @returns {boolean}
 */
export function matchesQuery(label, query) {
    const tokens = Array.isArray(query) ? query : normalizeQuery(query)
    if (!tokens.length) return true
    const text = String(label ?? '').toLowerCase()
    return tokens.every(token => text.includes(token))
}

/**
 * The index/picker read: every bare Person as a list row, filtered and sorted,
 * from ONE `listByType` read. Labels come from `deriveLabel()`, so no
 * annotation is resolved for any row.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} [options.query] filter text; every token must be in the label
 * @param {boolean} [options.sort=true] sort rows by label (A-Z)
 * @returns {Promise<Array<{id: string, label: string, entity: Object}>>} rows
 *   ready for `gl-person-chip`
 */
export async function listPersons(options = {}) {
    const { store = getDefaultStore(), query = '', sort = true } = options
    const entities = await store.listByType(TYPES.Person)
    const tokens = normalizeQuery(query)
    const rows = entities
        .map(entity => ({ id: entity['@id'], label: deriveLabel(entity), entity }))
        .filter(row => matchesQuery(row.label, tokens))
    if (sort) {
        rows.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
    }
    return rows
}
