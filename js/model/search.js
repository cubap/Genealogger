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
import { participations } from './events.js'
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
 * Events a Person took part in, via (event, agent, role) annotations.
 *
 * The normal read is ONE `rel` lookup: every participation written by
 * `events.participate()` indexes both its agent and its event, so asking the
 * store for `rel: personId` finds the rows without scanning (see
 * docs/devstore-query-contract.md). Documents written BEFORE that index existed
 * -- every migrated DEER v1 record -- carry no `rel`, and the server cannot
 * filter on a field a document does not have. When the caller names the event
 * types it cares about (`legacyTypes`), an empty index result triggers a bounded
 * enumeration of those types instead: `listByType()` plus per-event `target`
 * queries are the two shapes devstore can answer. The fallback never runs when
 * the index has data, so new-shape reads stay single-query.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @param {string} [options.role] optional canonical role filter (NV.child...)
 * @param {Array<string>} [options.legacyTypes] '@type' tokens to enumerate when
 *   the rel index is empty; include both the bare v1 token ('Birth') and the
 *   canonical URI, since v1 documents store the bare word
 * @returns {Promise<Array<Object>>} Event entities
 */
export async function eventsForPerson(options = {}) {
    const { store = getDefaultStore(), personId, role, legacyTypes } = options
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
    if (events.length || !legacyTypes || !legacyTypes.length) return events
    return eventsWithoutIndex({ store, personId, role, legacyTypes })
}

/**
 * The bounded scan behind `legacyTypes`: find events of the given types whose
 * participations name this person (in this role, when a role is given). Kept
 * separate so a page can filter the results by subtype without re-implementing
 * the enumeration.
 * @param {Object} options see `eventsForPerson`
 * @returns {Promise<Array<Object>>} Event entities
 */
export async function eventsWithoutIndex(options = {}) {
    const { store = getDefaultStore(), personId, role, legacyTypes = [] } = options
    if (!personId) throw new TypeError('eventsWithoutIndex() requires a personId')
    const found = []
    for (const token of legacyTypes) {
        for (const event of await store.listByType(token)) {
            if (!event || !event['@id']) continue
            if (found.some(other => other['@id'] === event['@id'])) continue
            const rows = await participations({ store, event })
            if (rows.some(row => row.agent === personId && (role === undefined || row.role === role))) {
                found.push(event)
            }
        }
    }
    return found
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

/**
 * Text of an assertion entry, which `resolve()` returns as a lone ValueObject
 * or as an array of coexisting ones. Display shows ONE: a label cannot be two
 * values at once. Pages that present the fact itself must render every
 * ValueObject with its provenance instead of calling this.
 */
function firstText(value) {
    if (Array.isArray(value)) return rawText(value[0])
    return rawText(value)
}

/** Bare DEER v1 keys still present on migrated identity data. */
const LEGACY_NAME_KEYS = ['givenName', 'additionalName', 'familyName']

/** Name parts, in display order. Assertions win over bare entity properties. */
const NAME_PART_PROPERTIES = [SCHEMA.givenName, SCHEMA.additionalName, SCHEMA.familyName]

/**
 * THE one label rule for a Person (issue #14). Every surface that has to name a
 * person -- the index, a chip, the person page, the label form -- goes through
 * here, so a person cannot be called one thing in a list and another thing on
 * its own page.
 *
 * Preference order:
 *   1. `label` -- what createPerson stores, and what the legacy reader copies
 *      from v1 `name`. A stored summary wins because it is what a previous
 *      write decided to call this person.
 *   2. `name` on the entity -- bare (DEER v1) or expanded to the schema.org URI,
 *      since a JSON-LD store may hand back either -- or asserted under schema.org
 *   3. name parts (given, additional, family) -- asserted first, then bare
 *      identity properties, then the unmapped v1 bare keys
 *   4. UNLABELED, so absence is visible instead of blank
 *
 * Conflicting assertions are NOT merged or ranked against each other here; the
 * first readable value is used for display, and pages that show the fact itself
 * must render every coexisting ValueObject with its provenance.
 *
 * WRITE-SIDE INVARIANT: because the list read cannot afford annotations, the
 * bare `label` is a denormalized cache of the name. Anything that asserts a new
 * name must update that cache too, or accept that lists show the old one. This
 * is also why the bare label outranks an assertion here -- there is no
 * third option that keeps a list cheap.
 *
 * @param {Object} [options]
 * @param {Object} options.entity bare Person entity (any identity shape)
 * @param {Object} [options.assertions] resolved assertion map, as returned by
 *   `assertions.resolve()` -- omit it for the cheap list read, which then sees
 *   identity data only and costs no extra query
 * @returns {string} display label; never throws on odd input
 */
export function personLabel(options = {}) {
    const { entity, assertions } = options
    if (!entity || typeof entity !== 'object') return UNLABELED
    const direct = rawText(entity.label) || firstText(assertions?.label)
        || rawText(entity.name) || rawText(entity[SCHEMA.name]) || firstText(assertions?.[SCHEMA.name])
    if (direct) return direct
    const parts = NAME_PART_PROPERTIES
        .map(property => firstText(assertions?.[property]) || rawText(entity[property]))
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
 * The cheap list label of a bare Person: `personLabel()` with no assertions,
 * i.e. identity data only (issue #14 story 1, #12 story 13). A list row must
 * never resolve an annotation.
 * @param {Object} entity a bare Person entity (any identity shape)
 * @returns {string} display label; never throws on odd input
 */
export function deriveLabel(entity) {
    return personLabel({ entity })
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
 *
 * LIMITATION (server-side, not fixable here): devstore `/query` returns at most
 * 10 documents and has no paging, so this lists at most 10 people and the sort
 * only orders that sample. Production data needs a scoped/paged read.
 * There is also no collection scoping in the new stack, so this sees every
 * Person document in the shared sandbox, not just Genealogger's.
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
