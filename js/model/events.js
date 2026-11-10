/**
 * @module model/events
 * @description First-class Event entities with their own evidence
 * annotations, (event, agent, role) participation, and derivation of
 * person-side assertions from event outcomes.
 *
 * An Event is a bare annotated target like a Person: `@type` includes 'Event'
 * plus an `nv:` subtype URI (e.g. nv:Birth). Documents about the event
 * (certificate, entry) are `dcterms:source`-style annotations ON the event.
 *
 * Derivation rules:
 * - `deriveParentAssertions(event)` turns (event, agent, role) participation
 *   into `nv:hasParent` annotations on each nv:child participant, one per
 *   nv:parent participant, each with `evidence` set to the event id and
 *   `nv:confidence` inherited from the event's own evidence unless
 *   explicitly overridden. Derived assertions COEXIST with conflicting ones
 *   from other events; nothing is deduped.
 * - The inverse `nv:hasChild` is NEVER stored; it is computed at read time
 *   (see model/search.js and model/person.js).
 * - One event yields MULTIPLE outcome assertions (name, birthDate, sex...)
 *   via assertOutcome(), each annotated with evidence = event id.
 */

import { NV, TYPES, EVENT_SUBTYPES, DCTERMS } from './vocabulary.js'
import { assert as assertAnnotation, valueObjectsFor } from './assertions.js'
import { getDefaultStore } from './default-store.js'

/**
 * Resolve a subtype token ('Birth', 'nv:Birth' shorthand, or full URI).
 * @param {string} subtype
 * @returns {string} full subtype URI
 */
export function resolveSubtype(subtype) {
    if (typeof subtype !== 'string' || !subtype) {
        throw new TypeError('an Event requires a subtype such as "Birth"')
    }
    if (subtype.includes('#') || subtype.includes('/')) return subtype
    if (subtype.startsWith('nv:') && EVENT_SUBTYPES[subtype.slice(3)]) {
        return EVENT_SUBTYPES[subtype.slice(3)]
    }
    if (EVENT_SUBTYPES[subtype]) return EVENT_SUBTYPES[subtype]
    return EVENT_SUBTYPES.Birth.replace('Birth', subtype)
}

/**
 * Create a bare Event entity with its subtype, optionally attaching the
 * document that evidences it (a Record) as the event's own provenance
 * annotation, complete with confidence.
 * @param {Object} [options]
 * @param {Object} [options.store] Store implementation (defaults to memory)
 * @param {string} options.subtype e.g. 'Birth', 'Christening', or a URI
 * @param {string} [options.label] display label for the event
 * @param {string} [options.evidence] Record id evidencing this event
 * @param {number} [options.confidence] nv:confidence carried by the evidence
 * @returns {Promise<Object>} the stored Event entity
 */
export async function createEvent(options = {}) {
    const { store = getDefaultStore(), subtype, label, evidence, confidence } = options
    const typeUri = resolveSubtype(subtype)
    const event = await store.create({
        '@type': [TYPES.Event, typeUri],
        'http://purl.org/dc/terms/type': typeUri,
        ...(label ? { label } : {})
    })
    if (evidence) {
        await assertAnnotation({
            store,
            target: event['@id'],
            property: DCTERMS.source,
            value: evidence,
            confidence,
            evidence
        })
    }
    return event
}

/**
 * Read the event's own provenance (first dcterms:source annotation), used to
 * inherit confidence into derived assertions.
 * @param {Object} options
 * @param {Object} [options.store]
 * @param {string|Object} options.event Event entity or id
 * @returns {Promise<{ evidence: string|undefined, confidence: number|undefined }>}
 */
export async function eventProvenance(options = {}) {
    const { store = getDefaultStore(), event } = options
    const eventId = typeof event === 'string' ? event : event?.['@id']
    if (!eventId) throw new TypeError('eventProvenance() requires an event or event id')
    const annos = await store.query({ target: eventId, type: DCTERMS.source })
    for (const anno of annos) {
        for (const vo of valueObjectsFor(anno, DCTERMS.source)) {
            return { evidence: vo.value, confidence: vo[NV.confidence] }
        }
    }
    return {}
}

/**
 * Record participation as an (event, agent, role) annotation on the event.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string|Object} options.event Event entity or id
 * @param {string} options.agent participating Person id
 * @param {string} options.role canonical role URI (NV.child, NV.parent,
 * NV.godParent, NV.informant) or any role term URI
 * @param {string} [options.evidence] Record id evidencing the participation
 * @param {number} [options.confidence] nv:confidence for this participation
 * @returns {Promise<Object>} the stored participation Annotation
 */
export async function participate(options = {}) {
    const { store = getDefaultStore(), event, agent, role, evidence, confidence } = options
    const eventId = typeof event === 'string' ? event : event?.['@id']
    if (!eventId) throw new TypeError('participate() requires an event')
    if (!agent) throw new TypeError('participate() requires an agent id')
    if (!role) throw new TypeError('participate() requires a role URI')
    const vo = { value: agent }
    if (evidence) vo.evidence = evidence
    if (confidence !== undefined) vo[NV.confidence] = confidence
    const annotation = {
        type: 'Annotation',
        target: eventId,
        body: {
            [NV.participant]: vo,
            [NV.role]: { value: role }
        }
    }
    if (evidence) annotation[DCTERMS.source] = evidence
    return await store.create(annotation)
}

/**
 * All participations recorded on an event.
 * @param {Object} options
 * @param {Object} [options.store]
 * @param {string|Object} options.event
 * @returns {Promise<Array<{ agent: string, role: string, evidence: string|undefined, confidence: number|undefined }>>}
 */
export async function participations(options = {}) {
    const { store = getDefaultStore(), event } = options
    const eventId = typeof event === 'string' ? event : event?.['@id']
    if (!eventId) throw new TypeError('participations() requires an event')
    const annos = await store.query({ target: eventId, type: NV.participant })
    const rows = []
    for (const anno of annos) {
        const participants = valueObjectsFor(anno, NV.participant)
        const roles = valueObjectsFor(anno, NV.role)
        for (const vo of participants) {
            rows.push({
                agent: vo.value,
                role: roles.length ? roles[0].value : undefined,
                evidence: vo.evidence,
                confidence: vo[NV.confidence]
            })
        }
    }
    return rows
}

/**
 * Assert an outcome fact about a participant (or any target) on behalf of an
 * event: a normal annotation whose evidence is the event id. One call per
 * property; an event routinely yields many outcome assertions.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string|Object} options.event the Event asserting the outcome
 * @param {string} options.target Person (or other entity) id receiving the assertion
 * @param {string} options.property property URI, e.g. schema:birthDate
 * @param {*} options.value asserted value
 * @param {Object} [options.source] citation metadata
 * @param {number} [options.confidence] override; defaults to the event's
 * evidence confidence
 * @returns {Promise<Object>} the stored Annotation
 */
export async function assertOutcome(options = {}) {
    const { store = getDefaultStore(), event, target, property, value, source } = options
    const eventId = typeof event === 'string' ? event : event?.['@id']
    if (!eventId) throw new TypeError('assertOutcome() requires an event')
    let { confidence } = options
    if (confidence === undefined) {
        confidence = (await eventProvenance({ store, event: eventId })).confidence
    }
    return await assertAnnotation({
        store, target, property, value, source, confidence, evidence: eventId
    })
}

/**
 * Derive `nv:hasParent` assertions on every nv:child participant, one per
 * nv:parent participant, with evidence = event id and inherited confidence
 * unless overridden. Conflicting derivations (two baptism records naming
 * different fathers) coexist.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string|Object} options.event
 * @param {number} [options.confidence] override for derived assertions
 * @returns {Promise<Array<Object>>} the created annotations
 */
export async function deriveParentAssertions(options = {}) {
    const { store = getDefaultStore(), event } = options
    const eventId = typeof event === 'string' ? event : event?.['@id']
    if (!eventId) throw new TypeError('deriveParentAssertions() requires an event')
    const rows = await participations({ store, event: eventId })
    const children = rows.filter(row => row.role === NV.child).map(row => row.agent)
    const parents = rows.filter(row => row.role === NV.parent).map(row => row.agent)
    let confidence = options.confidence
    if (confidence === undefined) {
        confidence = (await eventProvenance({ store, event: eventId })).confidence
    }
    const created = []
    for (const child of children) {
        for (const parent of parents) {
            created.push(await assertAnnotation({
                store,
                target: child,
                property: NV.hasParent,
                value: parent,
                evidence: eventId,
                confidence
            }))
        }
    }
    return created
}
