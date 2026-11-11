/**
 * @module model/search
 * @description Minimal read helpers over the store: find people by what is
 * asserted about them, find events a person took part in, and compute the
 * derived parent/child edges. `nv:hasChild` exists ONLY here, computed at
 * read time from stored `nv:hasParent` assertions -- it is never written.
 */

import { NV, TYPES } from './vocabulary.js'
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
    const annos = await store.query({ type: NV.participant, value: personId })
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
 * Derived children of a person: the COMPUTED inverse of nv:hasParent. Never
 * stored anywhere.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Array<Object>>} ValueObjects whose `value` equals personId,
 * each `target` being a child id
 */
export async function childrenOf(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('childrenOf() requires a personId')
    const annos = await store.query({ type: NV.hasParent, value: personId })
    const rows = []
    for (const anno of annos) {
        for (const vo of valueObjectsFor(anno, NV.hasParent)) {
            if (vo.value === personId) rows.push({ ...vo, target: anno.target })
        }
    }
    return rows
}
