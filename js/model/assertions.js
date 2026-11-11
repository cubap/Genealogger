/**
 * @module model/assertions
 * @description Create, resolve, and list typed annotations (assertions) on a
 * target. Payload shape mirrors DEER v2 (antlers) ValueObject: every non-
 * identity property resolves to `{ value, source?, evidence?, [nv:confidence]? }`
 * or an array thereof.
 *
 * CONFLICTS ARE A FEATURE: multiple assertions of the same property on the
 * same target always coexist as separate annotations. Nothing here overwrites
 * or dedupes; reconciliation is a read-time (UI) concern.
 */

import { NV } from './vocabulary.js'
import { getDefaultStore } from './default-store.js'

const clone = doc => JSON.parse(JSON.stringify(doc))

/**
 * Build a ValueObject in the DEER v2 shape.
 * @param {*} value the asserted value
 * @param {Object} [meta]
 * @param {Object} [meta.source] `{ citationSource?, citationNote?, comment? }`
 * @param {string} [meta.evidence] id of the Record/Event supporting the claim
 * @param {number} [meta.confidence] nv:confidence, 0-1
 * @returns {Object} ValueObject
 */
export function valueObject(value, { source, evidence, confidence } = {}) {
    if (confidence !== undefined) {
        if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
            throw new RangeError('nv:confidence must be a number between 0 and 1')
        }
    }
    const vo = { value }
    if (source && (source.citationSource || source.citationNote || source.comment)) {
        vo.source = {}
        if (source.citationSource) vo.source.citationSource = source.citationSource
        if (source.citationNote) vo.source.citationNote = source.citationNote
        if (source.comment) vo.source.comment = source.comment
    }
    if (evidence) vo.evidence = evidence
    if (confidence !== undefined) vo[NV.confidence] = confidence
    return vo
}

/**
 * Create one assertion annotation on a target. Never merges with existing
 * assertions of the same property.
 * @param {Object} [options]
 * @param {Object} [options.store] Store implementation (defaults to memory)
 * @param {string} options.target id of the annotated entity
 * @param {string} options.property property URI being asserted (e.g. nv:hasParent)
 * @param {*} options.value asserted value
 * @param {Object} [options.source] ValueObject citation metadata
 * @param {string} [options.evidence] evidence document id (Record/Event)
 * @param {number} [options.confidence] nv:confidence 0-1
 * @param {string} [options.motivation] OA motivation
 * @param {string} [options.creator] attributing agent
 * @param {string|Array<string>} [options.rel] reverse-index ids (see
 * adapters/store~QueryFilter.rel). Required whenever the asserted VALUE is an
 * entity id that other pages must find from the value's side — e.g. a parent
 * id, so the parent's page can list its children.
 * @returns {Promise<Object>} the stored Annotation
 */
export async function assert(options = {}) {
    const { store = getDefaultStore(), target, property, value, source, evidence, confidence, motivation, creator, rel } = options
    if (!target) throw new TypeError('assert() requires a target id')
    if (!property) throw new TypeError('assert() requires a property URI')
    const vo = valueObject(value, { source, evidence, confidence })
    const annotation = {
        type: 'Annotation',
        target,
        body: { [property]: vo }
    }
    if (motivation) annotation.motivation = motivation
    if (creator) annotation.creator = creator
    if (rel !== undefined) annotation.rel = Array.isArray(rel) ? rel : [rel]
    if (evidence) annotation['http://purl.org/dc/terms/source'] = evidence
    return await store.create(annotation)
}

/**
 * List every annotation targeting an entity, optionally filtered by property.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.target
 * @param {string} [options.property] restrict to assertions of this property URI
 * @returns {Promise<Array<Object>>} annotations, in stored order
 */
export async function list(options = {}) {
    const { store = getDefaultStore(), target, property } = options
    if (!target) throw new TypeError('list() requires a target id')
    const annotations = await store.query({ target })
    if (!property) return annotations
    return annotations.filter(anno => anno.body && Object.prototype.hasOwnProperty.call(anno.body, property))
}

/**
 * Extract the ValueObject(s) one annotation asserts for a property.
 * @param {Object} annotation
 * @param {string} property
 * @returns {Array<Object>} ValueObjects (empty when the property is absent)
 */
export function valueObjectsFor(annotation, property) {
    const raw = annotation && annotation.body && annotation.body[property]
    if (raw === undefined) return []
    return Array.isArray(raw) ? clone(raw) : [clone(raw)]
}

/**
 * Resolve all assertions on a target into a property -> ValueObject(s) map.
 * Conflicting values stay as separate ValueObjects in an array; resolution
 * returns ValueObjects, never merged raw values.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.target
 * @returns {Promise<Object<string, Object|Array<Object>>>} grouped assertions;
 * a lone ValueObject is returned directly, multiple values as an array
 */
export async function resolve(options = {}) {
    const { store = getDefaultStore(), target } = options
    if (!target) throw new TypeError('resolve() requires a target id')
    const annotations = await store.query({ target })
    const grouped = {}
    for (const anno of annotations) {
        for (const [property, raw] of Object.entries(anno.body || {})) {
            const vos = Array.isArray(raw) ? raw : [raw]
            if (!grouped[property]) grouped[property] = []
            grouped[property].push(...clone(vos))
        }
    }
    for (const property of Object.keys(grouped)) {
        if (grouped[property].length === 1) {
            grouped[property] = grouped[property][0]
        }
    }
    return grouped
}
