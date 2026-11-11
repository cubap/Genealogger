/**
 * @module model/entities
 * @description Create and resolve bare Eventities entities. A bare Person
 * carries identity only (`@id`, `@type`, a cheap `label`); every fact about
 * the person lives in annotations (see model/assertions.js). The label is set
 * at creation from the creating evidence and is itself tracked as a
 * ValueObject assertion so its provenance is never lost.
 */

import { TYPES, SCHEMA } from './vocabulary.js'
import { assert as assertAnnotation } from './assertions.js'
import { getDefaultStore } from './default-store.js'

/**
 * Create any bare entity, minting an '@id' under config.ID_BASE.
 * @param {Object} [options]
 * @param {Object} [options.store] Store implementation (defaults to memory)
 * @param {string|Array<string>} options['@type'] entity type(s), e.g. 'Person'
 * @param {string} [options.label] cheap display string
 * @param {Object} [options.extra] additional raw properties to keep on the
 * bare entity (identity-adjacent only; facts belong in annotations)
 * @returns {Promise<Object>} the stored BareEntity
 */
export async function createEntity(options = {}) {
    const { store = getDefaultStore(), label, extra, ...rest } = options
    const type = options['@type'] || rest['@type']
    if (!type) throw new TypeError('createEntity() requires an @type')
    const entity = { '@type': type }
    if (label) entity.label = label
    if (extra) Object.assign(entity, extra)
    return await store.create(entity)
}

/**
 * Create a bare Person. The label becomes a ValueObject-tracked `label`
 * assertion carrying the creating evidence/confidence.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.label display name derived from creating evidence
 * @param {string} [options.evidence] id of the Record/Event that created it
 * @param {number} [options.confidence] nv:confidence for the label claim
 * @param {Object} [options.source] citation metadata for the label
 * @returns {Promise<Object>} the stored bare Person entity
 */
export async function createPerson(options = {}) {
    const { store = getDefaultStore(), label, evidence, confidence, source } = options
    if (!label || typeof label !== 'string') {
        throw new TypeError('createPerson() requires a string label')
    }
    const entity = await store.create({ '@type': TYPES.Person, label })
    await assertAnnotation({
        store,
        target: entity['@id'],
        property: 'label',
        value: label,
        source,
        evidence,
        confidence
    })
    return entity
}

/**
 * Resolve a bare entity document by id (identity keys stay raw).
 * @param {Object} options
 * @param {Object} [options.store]
 * @param {string} options.id
 * @returns {Promise<Object|null>} the entity or null
 */
export async function readEntity(options = {}) {
    const { store = getDefaultStore(), id } = options
    if (!id) throw new TypeError('readEntity() requires an id')
    return await store.read(id)
}

/**
 * List bare entities of a type (e.g. all Persons for an index view).
 * @param {Object} options
 * @param {Object} [options.store]
 * @param {string} options.type
 * @returns {Promise<Array<Object>>}
 */
export async function listEntities(options = {}) {
    const { store = getDefaultStore(), type } = options
    if (!type) throw new TypeError('listEntities() requires a type')
    return await store.listByType(type)
}

/** Property URI used for a person's cheapest display name. */
export const LABEL_PROPERTY = 'label'

/** Re-export for convenience: schema:name is the formal "full name" property. */
export const FULL_NAME_PROPERTY = SCHEMA.name
