/**
 * @module model/death
 * @description The death vertical slice's use-case layer: the same composition the
 * birth slice established (model/birth.js), pointed at Death/Burial events. It
 * turns form data into a Person + Event + evidence-backed assertions so that ALL
 * data-shape knowledge (property URIs, participation triples, derivation of
 * parentage) lives here and NEVER in a component or the page.
 *
 * Invariants this module is responsible for upholding (mirrors the model tests):
 *   - the deceased PARTICIPATES in the event (role nv:child, the v1 `hasAgent`
 *     position) and witnesses/attendants/informants participate with their own
 *     roles; there are no "witness" columns on the record. When a death record
 *     names a parent, nv:hasParent is DERIVED from those roles, exactly as a birth
 *     certificate does.
 *   - the evidence document (Record) is named separately from the facts it
 *     asserts; each fact is its own annotation with evidence = the Death Event id
 *     and a per-assertion nv:confidence.
 *   - conflicting sources coexist: saveDeath never dedupes or overwrites.
 *   - nv:hasChild is NEVER written; it is computed at read time elsewhere.
 *
 * Legacy reading: the v1 death form posted its facts ONTO the Event document
 * (`deer-type="Death"` with `deer-key="deathDate"`), so the legacy reader asserts
 * deathDate/deathPlace against the event rather than the person. loadDeath()
 * back-fills those two properties from the event when the person carries none,
 * which keeps records already in devstore readable (user story 16). Those
 * documents also predate the top-level `rel` index the store contract now
 * requires for a person -> events lookup, so loadDeath() falls back to
 * enumerating death-typed events (legacySubjectEvents) when the index is empty.
 */

import { NV, SCHEMA, TYPES, EVENT_SUBTYPES, term } from './vocabulary.js'
import { createEntity, createPerson, readEntity } from './entities.js'
import { createEvent, participate, participations, assertOutcome, eventProvenance, deriveParentAssertions } from './events.js'
import { list as listAssertions, valueObjectsFor } from './assertions.js'
import { getPerson } from './person.js'
import { eventsForPerson } from './search.js'
import { getDefaultStore } from './default-store.js'

/**
 * Death-participant roles. `witness`/`attendant` have no token in the shared
 * vocabulary yet, so this slice mints them from the nv namespace with the public
 * term() helper — events.participate() accepts any role URI. Hoisting them into
 * vocabulary.CANONICAL_ROLES is a later tidy-up; keeping it here stops the
 * parallel M3 page slices from colliding on vocabulary.js.
 */
const NV_WITNESS = term('nv', 'witness')
const NV_ATTENDANT = term('nv', 'attendant')

export const ROLE_TOKENS = {
    child: NV.child,
    parent: NV.parent,
    witness: NV_WITNESS,
    attendant: NV_ATTENDANT,
    informant: NV.informant
}

/** Human labels for the properties the death page surfaces (read view). */
export const PROPERTY_LABELS = {
    [SCHEMA.name]: 'Full name',
    [SCHEMA.givenName]: 'Given name',
    [SCHEMA.familyName]: 'Family name',
    [SCHEMA.additionalName]: 'Middle name(s)',
    [SCHEMA.alternateName]: 'Alternate name(s)',
    [SCHEMA.deathDate]: 'Date of death',
    [SCHEMA.deathPlace]: 'Place of death',
    [SCHEMA.gender]: 'Gender',
    [SCHEMA.sex]: 'Sex',
    [NV.hasParent]: 'Parent',
    label: 'Label'
}

/** Death-family event subtypes this slice recognises for the read view. */
const DEATH_SUBTYPES = new Set([EVENT_SUBTYPES.Death, EVENT_SUBTYPES.Burial])

/** Bare v1 type strings ("Death") the legacy reader preserves on old documents. */
const LEGACY_SUBTYPE_NAMES = new Set(['Death', 'Burial'])

/** Facts a v1 Event document carries on itself. */
const EVENT_OWNED_FACTS = [SCHEMA.deathDate, SCHEMA.deathPlace]

const LEGACY_ID_MARKER = '#legacy-'

function fullName(name = {}) {
    if (name.full) return name.full
    return [name.given, name.additional, name.family].filter(Boolean).join(' ').trim()
}

/** Map human field names to the property URI asserted for a death outcome. */
const FACT_FIELDS = [
    ['name.given', SCHEMA.givenName],
    ['name.family', SCHEMA.familyName],
    ['name.additional', SCHEMA.additionalName],
    ['name.alternate', SCHEMA.alternateName],
    ['name.full', SCHEMA.name],
    ['gender', SCHEMA.gender],
    ['deathDate', SCHEMA.deathDate],
    ['deathPlace', SCHEMA.deathPlace]
]

/**
 * The death-family subtype URI of an event, normalised from either shape: the new
 * layer types events `[schema:Event, nv:Death]`, while a v1 document carries the
 * bare `@type: "Death"` its DEER form's deer-type attribute wrote.
 * @param {Object} event
 * @returns {string|undefined} subtype URI, or undefined for other event kinds
 */
function subtypeOf(event) {
    const types = Array.isArray(event['@type']) ? event['@type'] : [event && event['@type']]
    for (const type of types) {
        if (DEATH_SUBTYPES.has(type)) return type
        if (typeof type === 'string' && LEGACY_SUBTYPE_NAMES.has(type)) return EVENT_SUBTYPES[type]
    }
    return undefined
}

function isDeathEvent(event) {
    return subtypeOf(event) !== undefined
}

function isLegacyAnnotation(anno) {
    return typeof anno['@id'] === 'string' && anno['@id'].includes(LEGACY_ID_MARKER)
}

/**
 * A v1 death document links the deceased from the Event's own body (`hasAgent`),
 * and the legacy reader mints no top-level `rel`, so the rel-indexed
 * eventsForPerson() lookup cannot see those records (docs/devstore-query-contract.md).
 * Enumerate the death-typed events instead and keep the ones this person is the
 * subject of: `listByType()` plus per-event `target` queries are the two shapes
 * devstore can answer, and it is the same bounded pattern
 * model/search.personsByAnnotationType() uses. Only reached when the index
 * lookup finds nothing, so new-shape reads stay single-query.
 * @param {Object} params
 * @param {Object} params.store
 * @param {string} params.personId
 * @returns {Promise<Array<Object>>} death-family event documents
 */
async function legacySubjectEvents({ store, personId }) {
    const tokens = ['Death', 'Burial', EVENT_SUBTYPES.Death, EVENT_SUBTYPES.Burial]
    const found = []
    for (const token of tokens) {
        const candidates = await store.listByType(token)
        for (const event of candidates) {
            if (!event || !event['@id'] || !isDeathEvent(event)) continue
            if (found.some(other => other['@id'] === event['@id'])) continue
            const rows = await participations({ store, event })
            if (rows.some(row => row.agent === personId && row.role === NV.child)) {
                found.push(event)
            }
        }
    }
    return found
}

async function resolveLabels(store, ids) {
    const labels = {}
    for (const id of new Set(ids.filter(Boolean))) {
        if (labels[id]) continue
        const entity = await readEntity({ store, id })
        labels[id] = (entity && entity.label) || id
    }
    return labels
}

/**
 * Save a death: create/find the deceased Person, name the evidence Record, create
 * a Death (or Burial) Event evidenced by it, record the participants with their
 * roles, assert each fact with its own confidence, and derive parentage when the
 * record names parents. Everything flows through the injected store; nothing here
 * fetches or touches the DOM.
 * @param {Object} [options]
 * @param {Object} [options.store] Store (defaults to the model's configured one)
 * @param {string} [options.personId] existing deceased; omit to create a Person
 * @param {Object} [options.name] `{ given, family, additional, alternate, full }`
 * @param {string} [options.gender]
 * @param {string} [options.deathDate]
 * @param {string} [options.deathPlace]
 * @param {Object} options.evidence `{ title, id?, confidence? }` the Record naming the source
 * @param {Object} [options.confidences] per-field nv:confidence overrides, keyed by field name
 * @param {number} [options.confidence] default nv:confidence for facts without an override
 * @param {Array<Object>} [options.participants] `{ role, agentId?|name?, confidence? }`
 * @param {string} [options.subtype] event subtype token/URI; 'Death' by default
 * @returns {Promise<{ personId: string, eventId: string, recordId: string }>}
 */
export async function saveDeath(options = {}) {
    const { store = getDefaultStore(), name = {}, evidence = {}, confidences = {}, participants = [] } = options
    if (!evidence.title && !evidence.id) {
        throw new TypeError('saveDeath() requires evidence: name the evidence document (Record) separately from the facts')
    }

    // 1. The evidence document, named separately from the facts it supports.
    const recordId = evidence.id
        || (await createEntity({ store, '@type': TYPES.Record, label: evidence.title }))['@id']

    // 2. The deceased Person (existing id, or created from the entered name).
    const personLabel = fullName(name) || 'Unnamed person'
    const personId = options.personId
        || (await createPerson({
            store, label: personLabel, evidence: recordId, confidence: evidence.confidence ?? options.confidence
        }))['@id']

    // 3. The Death Event, evidenced by the record (its own provenance annotation).
    const event = await createEvent({
        store,
        subtype: options.subtype || 'Death',
        label: `Death of ${personLabel}`,
        evidence: recordId,
        confidence: evidence.confidence ?? options.confidence
    })

    // 4. The deceased is the subject of the event. adapters/legacy.js maps the v1
    //    `hasAgent` position onto this same role, so legacy deaths stay reachable.
    await participate({ store, event, agent: personId, role: NV.child, evidence: recordId })

    // 5. Witnesses, attendants, informants and parents are participants with roles.
    for (const participant of participants) {
        if (!participant) continue
        const role = ROLE_TOKENS[participant.role] || participant.role || NV_WITNESS
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
        deathDate: options.deathDate,
        deathPlace: options.deathPlace
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

    // 7. Derive nv:hasParent on the deceased from the participation roles.
    await deriveParentAssertions({ store, event })

    return { personId, eventId: event['@id'], recordId }
}

/**
 * Load an existing person's death view for the page: every assertion with its
 * evidence and confidence, the death events with their participants and roles,
 * the evidence/related-person labels resolved for display, and a `legacy` flag
 * used to render the read-only "migrated view" until first edit.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Object|null>} assembled death view, or null when the id is
 * not a Person. Shape:
 * `{ personId, label, legacy, view, events, assertions, evidenceLabels, personLabels }`
 */
export async function loadDeath(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('loadDeath() requires a personId')
    const view = await getPerson({ store, id: personId })
    if (!view) return null

    const events = []
    const evidenceIds = []
    const personIds = []

    let subjectEvents = await eventsForPerson({ store, personId, role: NV.child })
    if (!subjectEvents.length) {
        // v1 migrations (and any document written before the rel index existed)
        // are reachable only by enumerating the events themselves.
        subjectEvents = await legacySubjectEvents({ store, personId })
    }
    for (const event of subjectEvents.filter(isDeathEvent)) {
        const provenance = await eventProvenance({ store, event })
        if (provenance.evidence) evidenceIds.push(provenance.evidence)
        const rows = await participations({ store, event })
        for (const row of rows) {
            personIds.push(row.agent)
            if (row.evidence) evidenceIds.push(row.evidence)
        }
        events.push({
            event,
            subtype: subtypeOf(event) || EVENT_SUBTYPES.Death,
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
    let legacy = annos.some(isLegacyAnnotation)

    // v1 posted the death facts onto the Event document, so read them off the event
    // for the properties the person itself does not carry. Their evidence stays the
    // event id, which aliases to the source document's label below.
    for (const event of events) {
        const eventId = event.event['@id']
        const eventAnnos = await listAssertions({ store, target: eventId })
        if (!legacy) legacy = eventAnnos.some(isLegacyAnnotation)
        for (const property of EVENT_OWNED_FACTS) {
            if (grouped[property]) continue
            const vos = eventAnnos.flatMap(anno => valueObjectsFor(anno, property))
            if (!vos.length) continue
            for (const vo of vos) {
                if (!vo.evidence) vo.evidence = eventId
                evidenceIds.push(vo.evidence)
            }
            grouped[property] = vos.length === 1 ? vos[0] : vos
        }
    }

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

export default { saveDeath, loadDeath, PROPERTY_LABELS, ROLE_TOKENS }
