/**
 * @module model/parents
 * @description The parents vertical slice's use-case layer (issue #14 story 7):
 * the two operations parents.html performs — loadParents() and saveParents() —
 * composed from the generic Eventities primitives so that ALL data-shape
 * knowledge lives here and NEVER in a component or the page.
 *
 * Parentage is never a column on a Person. It is a Birth-type Event whose
 * participants are the child (nv:child) and the parents (nv:mother / nv:father /
 * nv:parent), each participation carrying its own evidence and nv:confidence.
 * `nv:hasParent` on the child is DERIVED from those roles, and the inverse
 * `nv:hasChild` is never stored at all — it is computed at read time by
 * search.childrenOf(). This module upholds those invariants (mirrors
 * docs/page-model-adapter.md items 8 and 10):
 *   - saveParents() writes an Event + (event, agent, role) participations +
 *     derived nv:hasParent assertions. It never writes `hasFather`/`hasMother`
 *     onto the Person, and never writes nv:hasChild.
 *   - Roles are canonical nv: URIs (nv:mother/nv:father/nv:parent), not blanks
 *     named "father"/"mother" on the record.
 *   - Conflicting claims coexist. A second source naming a different mother is
 *     a second Event resting on a second Record, and both derived assertions
 *     stay visible; nothing here merges or overwrites them.
 *
 * Re-saving the same claim must not multiply it: a page whose form is prefilled
 * from the store writes each (event, agent, role) participation and each derived
 * nv:hasParent claim at most once. That dedup is deliberately keyed on the
 * EVENT as well as the pair, so disagreement from another source is never
 * swallowed — see deriveMissingParentAssertions().
 *
 * Legacy reading: DEER v1 parents.html wrote `hasFather`/`hasMother`/`homeLocation`
 * DIRECTLY onto the Person document. adapters/legacy.js turns those into
 * nv:hasParent / schema:homeLocation assertions on read (ids carrying
 * `#legacy-`), so a v1 person opens here showing the claims with no event behind
 * them, flagged `migrated`. The first save from this page writes only the new
 * shape (lazy migration).
 */

import { NV, SCHEMA, TYPES, EVENT_SUBTYPES, CANONICAL_ROLES, typeTokens } from './vocabulary.js'
import { createEntity, createPerson, readEntity } from './entities.js'
import { createEvent, participate, participations, assertOutcome, eventProvenance } from './events.js'
import { assert as assertAnnotation, list as listAssertions } from './assertions.js'
import { getPerson } from './person.js'
import { eventsForPerson, parentsOf, childrenOf, valuesOf, deriveLabel, UNLABELED } from './search.js'
import { getDefaultStore } from './default-store.js'

/**
 * Parent-position role tokens. Every one is a canonical vocabulary role -- this
 * slice mints nothing -- and the child's own role is included so a caller can
 * never accidentally record the child as one of its parents.
 */
export const ROLE_TOKENS = {
    child: CANONICAL_ROLES.child,
    parent: CANONICAL_ROLES.parent,
    mother: CANONICAL_ROLES.mother,
    father: CANONICAL_ROLES.father
}

/** Display label per parent role; the audit rows are labelled by role. */
const ROLE_LABELS = {
    [NV.mother]: 'Mother',
    [NV.father]: 'Father',
    [NV.parent]: 'Parent'
}

/** Roles on a participation that make their agent a parent of the child. */
const PARENT_ROLES = new Set([NV.parent, NV.mother, NV.father])

/** Birth-ish event subtypes that can carry parentage. */
const BIRTH_SUBTYPES = new Set([EVENT_SUBTYPES.Birth, EVENT_SUBTYPES.Christening, EVENT_SUBTYPES.Baptism])

/**
 * Bare local name -> canonical subtype URI. A migrated DEER v1 document stores
 * '@type: "Birth"' where a new-shape document stores the full URI.
 */
const BIRTH_SUBTYPE_BY_NAME = new Map([...BIRTH_SUBTYPES].map(uri => [uri.split(/[#/]/).pop(), uri]))

/** Every '@type' token a birth-family event can be stored under, v1 included. */
const BIRTH_TYPE_TOKENS = typeTokens([...BIRTH_SUBTYPES])

const LEGACY_ID_MARKER = '#legacy-'

/** Stable display order for the parent panel: mother, father, then generic. */
const ROLE_ORDER = [NV.mother, NV.father, NV.parent]

function isLegacyAnnotation(anno) {
    return typeof anno['@id'] === 'string' && anno['@id'].includes(LEGACY_ID_MARKER)
}

/**
 * The canonical birth subtype URI of an event, or null for other event kinds.
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

function isEventEntity(entity) {
    const types = Array.isArray(entity?.['@type']) ? entity['@type'] : [entity?.['@type']]
    return types.includes(TYPES.Event) || birthSubtypeOf(entity) !== null
}

function localName(uri) {
    return String(uri ?? '').split(/[#/]/).pop() || ''
}

async function resolveLabels(store, ids) {
    const labels = {}
    for (const id of new Set(ids.filter(Boolean))) {
        if (labels[id]) continue
        const entity = await readEntity({ store, id })
        // Rows name people the way every other surface does (the one label rule in
        // docs/page-model-adapter.md): identity data only, no annotation read, so a
        // v1 parent stored under `name` still gets a name instead of a URI. An
        // unlabeled document falls back to its id, which is what a source Record
        // without a title needs.
        const named = entity ? deriveLabel(entity) : ''
        labels[id] = named && named !== UNLABELED ? named : id
    }
    return labels
}

/**
 * Read one Event document into the shape the parents page renders: its subtype,
 * the Record it rests on, and every (agent, role) participation.
 * @param {Object} store
 * @param {Object} event bare Event entity
 * @returns {Promise<Object>} view entry
 */
async function describeEvent(store, event) {
    const provenance = await eventProvenance({ store, event })
    return {
        id: event['@id'],
        event,
        label: event.label || `${localName(birthSubtypeOf(event)) || 'Event'}`,
        subtype: birthSubtypeOf(event),
        recordId: provenance.evidence || null,
        confidence: provenance.confidence,
        participants: await participations({ store, event })
    }
}

/**
 * The birth-family events this person appears in as the CHILD — the child-side
 * view user story 7 calls primary. `legacyTypes` lets a DEER v1 record (written
 * before the store's `rel` reverse index existed) open too.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Array<Object>>} event view entries
 */
export async function birthEventsOfChild(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('birthEventsOfChild() requires a personId')
    const found = await eventsForPerson({
        store,
        personId,
        role: NV.child,
        legacyTypes: BIRTH_TYPE_TOKENS
    })
    const events = []
    for (const event of found) {
        if (birthSubtypeOf(event)) events.push(await describeEvent(store, event))
    }
    return events
}

/**
 * Which parent role does this derived claim report? Answered from the event the
 * claim was derived from (its `evidence`), falling back to any birth event of
 * this child that names the same person in a parent position. A claim with no
 * event behind it — a DEER v1 `hasFather` — reports the generic nv:parent role,
 * because the legacy shape really does lose the mother/father distinction.
 */
function roleOfClaim(claim, events, eventsById) {
    const fromEvidence = claim.evidence && eventsById[claim.evidence]
    const candidates = fromEvidence ? [fromEvidence] : events
    for (const entry of candidates) {
        const row = entry.participants.find(p => p.agent === claim.value && PARENT_ROLES.has(p.role))
        if (row) return { role: row.role, confidence: row.confidence, eventId: entry.id }
    }
    return { role: NV.parent, confidence: undefined, eventId: fromEvidence ? fromEvidence.id : undefined }
}

/**
 * Load a person's parentage view for parents.html.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId the CHILD whose parents this page shows
 * @returns {Promise<Object|null>} assembled view, or null when the id is not a
 * Person. Shape:
 * `{ personId, label, legacy, view, events, parents, children, residence,
 *    evidenceLabels, personLabels }`
 * where `parents` is one row per derived claim (so two disagreeing sources for
 * the same mother are two rows), each naming the event, record, role and
 * confidence behind it.
 */
export async function loadParents(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('loadParents() requires a personId')
    const view = await getPerson({ store, id: personId })
    if (!view) return null

    const events = await birthEventsOfChild({ store, personId })
    /** Event id -> view entry, for events on BOTH sides of the relation. */
    const eventsById = {}
    for (const entry of events) eventsById[entry.id] = entry

    const claims = await parentsOf({ store, personId })
    const childClaims = await childrenOf({ store, personId })
    const residenceValues = await valuesOf({ store, targetId: personId, type: SCHEMA.homeLocation })

    const annos = await listAssertions({ store, target: personId })
    const legacy = annos.some(isLegacyAnnotation)

    // A claim's `evidence` is normally the Event it was derived from, but that
    // event may be one of a CHILD's births rather than this person's. Read every
    // referenced document once so each row can name its source.
    const referenced = new Set()
    for (const vo of [...claims, ...childClaims, ...residenceValues]) {
        if (vo && vo.evidence) referenced.add(vo.evidence)
    }
    for (const id of referenced) {
        if (eventsById[id]) continue
        const entity = await readEntity({ store, id })
        if (entity && isEventEntity(entity)) eventsById[id] = await describeEvent(store, entity)
    }

    const personIds = [personId]
    const evidenceIds = []
    for (const entry of Object.values(eventsById)) {
        if (entry.recordId) evidenceIds.push(entry.recordId)
        for (const row of entry.participants) personIds.push(row.agent)
    }
    for (const vo of claims) personIds.push(vo.value)
    for (const vo of childClaims) personIds.push(vo.target)
    // Anything referenced that is NOT an event is a source document; events are
    // labelled by the Record they rest on instead, in the alias pass below.
    for (const id of referenced) {
        if (!eventsById[id]) evidenceIds.push(id)
    }

    const [evidenceLabels, personLabels] = await Promise.all([
        resolveLabels(store, evidenceIds),
        resolveLabels(store, personIds)
    ])

    // Provenance chain: assertion -> Event -> Record. For display, alias each
    // event id to the label of the document evidencing it, so every row names a
    // source document rather than an opaque event id.
    for (const entry of Object.values(eventsById)) {
        if (!evidenceLabels[entry.id]) {
            evidenceLabels[entry.id] = (entry.recordId && evidenceLabels[entry.recordId]) || entry.label
        }
    }

    const parents = claims
        .map(vo => {
            const claim = { value: vo.value, evidence: vo.evidence }
            const role = roleOfClaim(claim, events, eventsById)
            const eventId = role.eventId || (eventsById[vo.evidence] ? vo.evidence : undefined)
            return {
                agentId: vo.value,
                label: personLabels[vo.value] || vo.value,
                role: role.role,
                roleLabel: ROLE_LABELS[role.role] || localName(role.role),
                eventId,
                eventLabel: eventId ? (eventsById[eventId] || {}).label : undefined,
                subtype: eventId ? (eventsById[eventId] || {}).subtype : undefined,
                confidence: vo[NV.confidence] ?? role.confidence ?? (eventId ? (eventsById[eventId] || {}).confidence : undefined),
                recordId: eventId ? (eventsById[eventId] || {}).recordId : undefined,
                recordLabel: vo.evidence ? (evidenceLabels[vo.evidence] || vo.evidence) : undefined,
                // A DEER v1 `hasFather` arrives as a migrated assertion with no
                // event behind it; say so instead of pretending it is derived.
                migrated: !eventsById[vo.evidence]
            }
        })
        .sort((a, b) => (ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
            || String(a.label).localeCompare(String(b.label)))

    const children = childClaims
        .map(vo => ({
            childId: vo.target,
            label: personLabels[vo.target] || vo.target,
            eventId: vo.evidence && eventsById[vo.evidence] ? vo.evidence : undefined,
            confidence: vo[NV.confidence],
            recordLabel: vo.evidence ? (evidenceLabels[vo.evidence] || vo.evidence) : undefined,
            migrated: !eventsById[vo.evidence]
        }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)))

    const residence = residenceValues.map(vo => ({
        value: vo.value,
        confidence: vo[NV.confidence],
        recordLabel: vo.evidence ? (evidenceLabels[vo.evidence] || vo.evidence) : undefined,
        migrated: !vo.evidence || !eventsById[vo.evidence]
    }))

    return {
        personId,
        label: view.label,
        legacy,
        view,
        events,
        parents,
        children,
        residence,
        evidenceLabels,
        personLabels
    }
}

/**
 * Derive nv:hasParent on the child for every parent participation on the event
 * that does not already carry the claim. Byte-for-byte the shape
 * events.deriveParentAssertions() writes (evidence = event id, rel =
 * [child, parent], confidence inherited from the participation or the event's
 * own provenance) — but scoped to the MISSING pairs, so re-saving a prefilled
 * form does not stack a third identical row under the first two.
 * @param {Object} options
 * @param {Object} options.store
 * @param {string} options.childId
 * @param {Array<Object>} options.rows participations of the event
 * @param {Array<Object>} options.existing current nv:hasParent ValueObjects
 * @param {string} options.eventId
 * @param {number} [options.confidence] fallback when a row carries none
 * @returns {Promise<Array<Object>>} the annotations created
 */
async function deriveMissingParentAssertions(options = {}) {
    const { store, childId, eventId, rows, existing, confidence } = options
    const created = []
    const seen = new Set(existing.map(vo => `${vo.value}|${vo.evidence}`))
    for (const row of rows) {
        if (!PARENT_ROLES.has(row.role)) continue
        const key = `${row.agent}|${eventId}`
        if (seen.has(key)) continue
        seen.add(key)
        created.push(await assertAnnotation({
            store,
            target: childId,
            property: NV.hasParent,
            value: row.agent,
            evidence: eventId,
            // Findable from the parent's side too: that is how childrenOf() and
            // the ancestor timeline answer "who are this person's children?".
            rel: [childId, row.agent],
            confidence: row.confidence ?? confidence
        }))
    }
    return created
}

/**
 * Save a person's parents: name the evidence Record, find the birth-family Event
 * that Record already evidences (or create one), record the child and each parent
 * as participants with canonical roles, then derive nv:hasParent on the child.
 * Nothing is written onto the Person document itself, and nv:hasChild is never
 * stored. Everything flows through the injected store; no fetching, no DOM.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId the existing CHILD
 * @param {Array<Object>} [options.parents] `{ role, agentId?|name?, confidence? }`
 *   one entry per parent claim; blank rows are ignored
 * @param {Object} options.evidence `{ title, id?, confidence? }` the Record
 *   naming the source of this claim
 * @param {string} [options.residence] schema:homeLocation asserted by the same source
 * @param {number} [options.confidence] default nv:confidence
 * @param {string} [options.subtype] event subtype token/URI; 'Birth' by default
 * @returns {Promise<{ personId: string, eventId: string, recordId: string,
 *   participants: Array<Object>, derived: Array<Object> }>}
 */
export async function saveParents(options = {}) {
    const { store = getDefaultStore(), parents = [], evidence = {}, residence } = options
    const personId = options.personId
    if (!personId) {
        throw new TypeError('saveParents() requires a personId: parentage is recorded about an existing child')
    }
    if (!evidence.title && !evidence.id) {
        throw new TypeError('saveParents() requires evidence: name the evidence document (Record) separately from the facts')
    }
    const defaultConfidence = evidence.confidence ?? options.confidence

    // 1. The evidence document, named separately from the claims it supports.
    const recordId = evidence.id
        || (await createEntity({ store, '@type': TYPES.Record, label: evidence.title }))['@id']

    // 2. Annotate the birth event THIS record already evidences, so a second
    //    parent on the same certificate lands on the same event. A different
    //    record is a different source's claim, so it gets its own event and the
    //    disagreement stays visible.
    const events = await birthEventsOfChild({ store, personId })
    const childLabel = (await readEntity({ store, id: personId }))?.label || 'the child'
    let event = null
    for (const entry of events) {
        if (entry.recordId === recordId) {
            event = entry.event
            break
        }
    }
    if (!event) {
        event = await createEvent({
            store,
            subtype: options.subtype || 'Birth',
            label: `Birth of ${childLabel}`,
            evidence: recordId,
            confidence: defaultConfidence
        })
        // The child is the subject of its own birth event; without this row
        // deriveParentAssertions() has no nv:child to hang parentage on.
        await participate({ store, event, agent: personId, role: NV.child, evidence: recordId, confidence: defaultConfidence })
    }

    // 3. Mothers, fathers and generic parents are participants with roles.
    const rows = await participations({ store, event })
    const participants = []
    for (const entry of parents) {
        if (!entry) continue
        const role = ROLE_TOKENS[entry.role] || entry.role
        if (!role || role === NV.child) continue
        let agentId = entry.agentId
        if (!agentId) {
            const label = entry.name || entry.label
            if (!label) continue
            agentId = (await createPerson({
                store,
                label,
                evidence: recordId,
                confidence: entry.confidence ?? defaultConfidence
            }))['@id']
        }
        if (rows.some(row => row.agent === agentId && row.role === role)) continue
        const written = await participate({
            store,
            event,
            agent: agentId,
            role,
            evidence: recordId,
            confidence: entry.confidence ?? defaultConfidence
        })
        rows.push({ agent: agentId, role, evidence: recordId, confidence: entry.confidence ?? defaultConfidence })
        participants.push({ agentId, role, id: written['@id'] })
    }

    // 4. Derive the child-side assertion for every parent claim now on the event.
    const existing = await parentsOf({ store, personId })
    const derived = await deriveMissingParentAssertions({
        store,
        childId: personId,
        eventId: event['@id'],
        rows,
        existing,
        confidence: defaultConfidence
    })

    // 5. The v1 page also kept a residence on the person. Keep the field, but
    //    assert it the new way: a fact evidenced by the event that states it.
    if (residence) {
        const known = await valuesOf({ store, targetId: personId, type: SCHEMA.homeLocation })
        if (!known.some(vo => vo.value === residence && vo.evidence === event['@id'])) {
            await assertOutcome({
                store,
                event,
                target: personId,
                property: SCHEMA.homeLocation,
                value: residence,
                confidence: defaultConfidence
            })
        }
    }

    return { personId, eventId: event['@id'], recordId, participants, derived }
}

export default { loadParents, saveParents, birthEventsOfChild, ROLE_TOKENS }
