/**
 * @module model/lacunae
 * @description A Lacuna marks an expected-but-unrecorded slot on a target,
 * e.g. "birth mother unknown". It is an ordinary annotation of type
 * `nv:Lacuna` whose ValueObject describes the gap, so it resolves exactly
 * like every other assertion. Lacunae distinguish "absent because
 * unrecorded" from "absent because no evidence was sought".
 */

import { NV } from './vocabulary.js'
import { assert as assertAnnotation } from './assertions.js'
import { valuesOf } from './search.js'
import { getDefaultStore } from './default-store.js'

/**
 * Mark a Lacuna on a target (person, event, or assertion-covered entity).
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.target id of the entity with the gap
 * @param {string} options.value description of the gap,
 * e.g. "birth mother unknown"
 * @param {string} [options.about] property URI of the empty slot
 * (e.g. nv:hasParent) for later reconciliation
 * @param {string} [options.evidence] Record id demonstrating the gap
 * (e.g. the certificate that omits the mother)
 * @param {Object} [options.source] citation metadata
 * @param {number} [options.confidence] nv:confidence
 * @returns {Promise<Object>} the stored Annotation
 */
export async function markLacuna(options = {}) {
    const { store = getDefaultStore(), target, value, about, ...rest } = options
    if (!value) throw new TypeError('markLacuna() requires a value describing the gap')
    const annotation = await assertAnnotation({
        store, target, property: NV.Lacuna, value, ...rest
    })
    if (about) annotation.body[NV.Lacuna].about = about
    return await store.update(annotation)
}

/**
 * All Lacunae marked on a target, resolved as ValueObjects.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.target
 * @returns {Promise<Array<Object>>}
 */
export async function lacunaeOn(options = {}) {
    const { store = getDefaultStore(), target } = options
    return await valuesOf({ store, targetId: target, type: NV.Lacuna })
}
