/**
 * @module model/birth
 * @description The birth vertical slice's use-case layer. It composes the
 * generic Eventities primitives (entities, events, assertions) into the two
 * operations the birth page performs — saveBirth() and loadBirth() — so that
 * ALL data-shape knowledge (property URIs, participation triples, derivation
 * of parentage) lives here and NEVER in a component or the page. A page handler
 * collects human-meaningful form fields, calls saveBirth(), and the model does
 * the RERUM-shaped writes through the injected store.
 *
 * Invariants this module is responsible for upholding (mirrors the model tests):
 *   - mother/father are recorded as PARTICIPANTS WITH ROLES (nv:participant +
 *     nv:role on the event), then nv:hasParent is DERIVED; there are no
 *     "father/mother" columns. The same path already supports godparent /
 *     informant by passing a different role token.
 *   - the evidence document (Record) is named separately from the facts it
 *     asserts; each asserted fact is its own annotation with evidence = the
 *     Birth Event id and a per-assertion nv:confidence.
 *   - conflicting sources coexist: saveBirth never dedupes or overwrites an
 *     existing assertion, so a second save from a different Record adds a
 *     second, separate claim.
 *   - nv:hasChild is NEVER written; it is computed at read time elsewhere.
 */

import { NV, SCHEMA, TYPES, EVENT_SUBTYPES, typeTokens } from './vocabulary.js'
import { createEntity, createPerson, readEntity } from './entities.js'
import { createEvent, participate, participations, assertOutcome, eventProvenance, deriveParentAssertions } from './events.js'
import { list as listAssertions } from './assertions.js'
import { getPerson } from './person.js'
import { eventsForPerson, deriveLabel, UNLABELED } from './search.js'
import { getDefaultStore } from './default-store.js'

/** Human labels for the properties the birth page surfaces (read view). */
export const PROPERTY_LABELS = {
    [SCHEMA.name]: 'Full name',
    [SCHEMA.givenName]: 'Given name',
    [SCHEMA.familyName]: 'Family name',
    [SCHEMA.additionalName]: 'Middle name(s)',
    [SCHEMA.alternateName]: 'Alternate name(s)',
    [SCHEMA.birthDate]: 'Date of birth',
    [SCHEMA.birthPlace]: 'Place of birth',
    [SCHEMA.gender]: 'Gender',
    [SCHEMA.sex]: 'Sex',
    [NV.hasParent]: 'Parent',
    label: 'Label'
}

/** Semantic role token -> canonical role URI (participants, not blanks). */
export const ROLE_TOKENS = {
    child: NV.child,
    parent: NV.parent,
    mother: NV.mother,
    father: NV.father,
    godparent: NV.godParent,
    informant: NV.informant
}

/** Birth-ish event subtypes the slice recognises for the read view. */
const BIRTH_SUBTYPES = new Set([EVENT_SUBTYPES.Birth, EVENT_SUBTYPES.Christening, EVENT_SUBTYPES.Baptism])

/**
 * Bare local name -> canonical subtype URI. A migrated DEER v1 document stores
 * '@type: "Birth"' where a new-shape document stores the full URI, so the read
 * view recognises both and always reports the URI.
 */
const BIRTH_SUBTYPE_BY_NAME = new Map([...BIRTH_SUBTYPES].map(uri => [uri.split(/[#/]/).pop(), uri]))

/**
 * The canonical birth subtype URI of an event, or null when the event is not
 * birth-ish. Handles the v1 bare name and an '@type' array.
 * @param {Object} event bare Event entity
 * @returns {string|null}
 */
function birthSubtypeOf(event) {
    const types = Array.isArray(event?.['@type']) ? event['@type'] : [event?.['@type']]
    for (const type of types) {
        if (BIRTH_SUBTYPES.has(type)) return type
        const canonical = BIRTH_SUBTYPE_BY_NAME.get(String(type ?? '').split(/[#/]/).pop())
        if (canonical) return canonical
    }
    return null
}

function fullName(name = {}) {
    if (name.full) return name.full
    return [name.given, name.additional, name.family].filter(Boolean).join(' ').trim()
}

/** Map human field names to the property URI asserted for a birth outcome. */
const FACT_FIELDS = [
    ['name.given', SCHEMA.givenName],
    ['name.family', SCHEMA.familyName],
    ['name.additional', SCHEMA.additionalName],
    ['name.alternate', SCHEMA.alternateName],
    ['name.full', SCHEMA.name],
    ['gender', SCHEMA.gender],
    ['birthDate', SCHEMA.birthDate],
    ['birthPlace', SCHEMA.birthPlace]
]

async function resolveLabels(store, ids) {
    const labels = {}
    for (const id of new Set(ids.filter(Boolean))) {
        if (labels[id]) continue
        const entity = await readEntity({ store, id })
        // One label rule for the whole app (#31). The id is kept as the fallback
        // where a list would show `[ unlabeled ]`: these strings label form rows
        // and evidence pickers, where an id is at least selectable.
        const label = entity ? deriveLabel(entity) : UNLABELED
        labels[id] = label === UNLABELED ? id : label
    }
    return labels
}

/**
 * Save a birth: create/find the child Person, name the evidence Record, create
 * a Birth Event evidenced by it, record participants with roles, assert each
 * fact with its own confidence, and derive parentage. Everything flows through
 * the injected store; nothing here fetches or touches the DOM.
 * @param {Object} [options]
 * @param {Object} [options.store] Store (defaults to the model's configured one)
 * @param {string} [options.personId] existing child; omit to create a Person
 * @param {Object} [options.name] `{ given, family, additional, alternate, full }`
 * @param {string} [options.gender]
 * @param {string} [options.birthDate]
 * @param {string} [options.birthPlace]
 * @param {Object} options.evidence `{ title, id?, confidence? }` the Record naming the source
 * @param {Object} [options.confidences] per-field nv:confidence overrides, keyed by field name
 * @param {number} [options.confidence] default nv:confidence for facts without an override
 * @param {Array<Object>} [options.participants] `{ role, agentId?|name?, confidence? }`
 * @param {string} [options.subtype] event subtype token/URI; 'Birth' by default
 * @returns {Promise<{ personId: string, eventId: string, recordId: string }>}
 */
export async function saveBirth(options = {}) {
    const { store = getDefaultStore(), name = {}, evidence = {}, confidences = {}, participants = [] } = options
    if (!evidence.title && !evidence.id) {
        throw new TypeError('saveBirth() requires evidence: name the evidence document (Record) separately from the facts')
    }

    // 1. The evidence document, named separately from the facts it supports.
    const recordId = evidence.id
        || (await createEntity({ store, '@type': TYPES.Record, label: evidence.title }))['@id']

    // 2. The child Person (existing id, or created from the entered name).
    const childLabel = fullName(name) || 'Unnamed person'
    const personId = options.personId
        || (await createPerson({
            store, label: childLabel, evidence: recordId, confidence: evidence.confidence ?? options.confidence
        }))['@id']

    // 3. The Birth Event, evidenced by the record (its own provenance annotation).
    const event = await createEvent({
        store,
        subtype: options.subtype || 'Birth',
        label: `Birth of ${childLabel}`,
        evidence: recordId,
        confidence: evidence.confidence ?? options.confidence
    })

    // 4. The child participates as the subject of the event.
    await participate({ store, event, agent: personId, role: NV.child, evidence: recordId })

    // 5. Mother/father (and later godparent/informant) are participants with roles.
    for (const participant of participants) {
        if (!participant) continue
        const role = ROLE_TOKENS[participant.role] || participant.role || NV.parent
        let agentId = participant.agentId
        if (!agentId) {
            const label = fullName(participant.name) || participant.label
            if (!label) continue
            agentId = (await createPerson({ store, label, evidence: recordId, confidence: participant.confidence }))['@id']
        }
        await participate({ store, event, agent: agentId, role, evidence: recordId, confidence: participant.confidence })
    }

    // 6. One outcome assertion per populated fact, each with its own confidence.
    const factValues = {
        'name.given': name.given,
        'name.family': name.family,
        'name.additional': name.additional,
        'name.alternate': name.alternate,
        'name.full': fullName(name),
        gender: options.gender,
        birthDate: options.birthDate,
        birthPlace: options.birthPlace
    }
    for (const [field, property] of FACT_FIELDS) {
        const value = factValues[field]
        if (value === undefined || value === null || value === '') continue
        await assertOutcome({
            store,
            event,
            target: personId,
            property,
            value,
            confidence: confidences[field] ?? options.confidence
        })
    }

    // 7. Derive nv:hasParent on the child from the participation roles.
    await deriveParentAssertions({ store, event })

    return { personId, eventId: event['@id'], recordId }
}

/**
 * Load an existing person's birth view for the page: every assertion with its
 * evidence and confidence, the participants grouped by event with their roles,
 * the evidence/related-person labels resolved for display, and a `legacy` flag
 * used to render the read-only "migrated view" until first edit.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Object|null>} assembled birth view, or null when the id is
 * not a Person. Shape:
 * `{ personId, label, legacy, view, events, assertions, evidenceLabels, personLabels }`
 */
export async function loadBirth(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('loadBirth() requires a personId')
    const view = await getPerson({ store, id: personId })
    if (!view) return null

    const events = []
    const evidenceIds = []
    const personIds = []

    const childEvents = await eventsForPerson({
        store,
        personId,
        role: NV.child,
        // A DEER v1 birth carries no `rel` index, so the only way to open one is
        // to enumerate birth-typed events (user story 16: legacy records stay readable).
        legacyTypes: typeTokens([...BIRTH_SUBTYPES])
    })
    for (const event of childEvents) {
        const subtype = birthSubtypeOf(event)
        if (!subtype) continue
        const provenance = await eventProvenance({ store, event })
        if (provenance.evidence) evidenceIds.push(provenance.evidence)
        const rows = await participations({ store, event })
        for (const row of rows) {
            personIds.push(row.agent)
            if (row.evidence) evidenceIds.push(row.evidence)
        }
        events.push({
            event,
            subtype,
            record: provenance.evidence ? { id: provenance.evidence, confidence: provenance.confidence } : null,
            participants: rows
        })
    }

    // Every assertion on the person, resolved with provenance, is the audit view.
    const grouped = view.assertions
    for (const property of Object.keys(grouped)) {
        const raw = grouped[property]
        for (const vo of Array.isArray(raw) ? raw : [raw]) {
            if (vo && vo.evidence) evidenceIds.push(vo.evidence)
            if (property === NV.hasParent && vo && vo.value) personIds.push(vo.value)
        }
    }

    const annos = await listAssertions({ store, target: personId })
    const legacy = annos.some(anno => typeof anno['@id'] === 'string' && anno['@id'].includes('#legacy-'))

    const [evidenceLabels, personLabels] = await Promise.all([
        resolveLabels(store, evidenceIds),
        resolveLabels(store, personIds)
    ])

    // Facts are evidenced by their Event (provenance chain: assertion -> event ->
    // Record). For display, alias each event id to the label of the source
    // document that evidences it, so every assertion row names its document.
    for (const event of events) {
        if (event.record && evidenceLabels[event.record.id]) {
            evidenceLabels[event.event['@id']] = evidenceLabels[event.record.id]
        }
    }

    return {
        personId,
        label: view.label,
        legacy,
        view,
        events,
        assertions: grouped,
        evidenceLabels,
        personLabels
    }
}

export default { saveBirth, loadBirth, PROPERTY_LABELS, ROLE_TOKENS }
