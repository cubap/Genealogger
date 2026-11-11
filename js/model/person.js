/**
 * @module model/person
 * @description The assembled Person view. Given an id, returns the bare
 * entity plus every assertion grouped by property, the derived parents
 * (stored nv:hasParent assertions) and the COMPUTED children (inverse,
 * never stored). This read is the model layer's highest test seam: no UI or
 * network is reachable past it.
 *
 * On top of that read, `loadPerson()` assembles what the person PAGE shows:
 * every assertion with its evidence label resolved (an Event's evidence is
 * aliased to the Record behind it, so a row always names a document), the
 * people reached through parentage labelled, and a `legacy` flag that tells the
 * page to render the read-only migrated view until the first save.
 *
 * `assertPersonName()` is the write path for user story 5 of #14: ANY name a
 * person was known by, with its type and active date range, recorded as one
 * evidence-backed annotation. Qualifiers ride INSIDE the ValueObject, so two
 * disagreeing name claims keep their own type/range instead of being merged.
 */

import { NV, SCHEMA, TYPES, DCTERMS, NV_NAME_TYPE, NV_ACTIVE_FROM, NV_ACTIVE_TO, NAME_PROPERTY_TOKENS } from './vocabulary.js'
import { resolve as resolveAssertions, list as listAssertions, valueObject } from './assertions.js'
import { createEntity, createPerson, readEntity } from './entities.js'
import { eventProvenance } from './events.js'
import { parentsOf, childrenOf, valuesOf, personLabel, deriveLabel, UNLABELED } from './search.js'
import { getDefaultStore } from './default-store.js'

/**
 * Assemble the full Person view: bare entity + assertions grouped by type +
 * derived parent/child links + lacunae. `label` comes from search.personLabel(),
 * THE one label rule, fed the assertions this read already resolved.
 * @param {Object} [options]
 * @param {Object} [options.store] Store implementation (defaults to memory)
 * @param {string} options.id Person entity id
 * @returns {Promise<Object|null>} assembled view:
 * `{ entity, label, assertions, parents, children, lacunae }` or null when
 * the id does not name a Person.
 */
export async function getPerson(options = {}) {
    const { store = getDefaultStore(), id } = options
    if (!id) throw new TypeError('getPerson() requires an id')
    const entity = await readEntity({ store, id })
    if (!entity) return null
    const type = entity['@type']
    const isPerson = Array.isArray(type) ? type.includes(TYPES.Person) : type === TYPES.Person
    if (!isPerson) return null
    const [assertions, parents, children, lacunae] = await Promise.all([
        resolveAssertions({ store, target: id }),
        parentsOf({ store, personId: id }),
        childrenOf({ store, personId: id }),
        valuesOf({ store, targetId: id, type: NV.Lacuna })
    ])
    // One label rule for every surface (docs/page-model-adapter.md): the page has
    // assertions resolved, so it passes them; deriveLabel() is the same function
    // without them, which is why a list row and this page cannot disagree.
    const label = personLabel({ entity, assertions })
    return { entity, label, assertions, parents, children, lacunae }
}

/** Human labels for the properties the person page surfaces (read view). */
export const PROPERTY_LABELS = {
    label: 'Label',
    [SCHEMA.name]: 'Full name',
    [SCHEMA.givenName]: 'Given name',
    [SCHEMA.additionalName]: 'Middle name(s)',
    [SCHEMA.familyName]: 'Family name',
    [SCHEMA.alternateName]: 'Alternate name',
    [SCHEMA.birthDate]: 'Date of birth',
    [SCHEMA.birthPlace]: 'Place of birth',
    [SCHEMA.deathDate]: 'Date of death',
    [SCHEMA.deathPlace]: 'Place of death',
    [SCHEMA.sex]: 'Sex',
    [SCHEMA.gender]: 'Gender',
    [SCHEMA.homeLocation]: 'Residence',
    [NV.hasParent]: 'Parent'
}

/** Audit-view order: names, then the vital facts, then parentage. */
export const ASSERTION_ORDER = Object.keys(PROPERTY_LABELS)

const LEGACY_ID_MARKER = '#legacy-'

const asArray = value => {
    if (value === undefined || value === null) return []
    return Array.isArray(value) ? value : [value]
}

function isLegacyAnnotation(anno) {
    return typeof anno['@id'] === 'string' && anno['@id'].includes(LEGACY_ID_MARKER)
}

function isEventEntity(entity) {
    return asArray(entity && entity['@type']).includes(TYPES.Event)
}

/**
 * Read each distinct id ONCE and return the documents. Evidence/related-person
 * labels are the only per-id reads the assembled view needs; a store wrapper in
 * the unit tests asserts this stays one read per id rather than one per row.
 * @param {Object} store
 * @param {Array<string>} ids
 * @returns {Promise<Object<string,Object|null>>} id -> entity
 */
async function resolveEntities(store, ids) {
    const entities = {}
    for (const id of new Set(ids.filter(Boolean))) {
        entities[id] = await readEntity({ store, id })
    }
    return entities
}

/**
 * Label for a Document (a Record, or an Event standing in for one). Documents
 * have no naming rule of their own beyond the bare label cache, so this is
 * deriveLabel() -- the identity-only half of the one label rule -- falling back
 * to the id, which is more useful on screen than `[ unlabeled ]`.
 */
function documentLabel(entity, id) {
    const label = entity ? deriveLabel(entity) : UNLABELED
    return label === UNLABELED ? id : label
}

/**
 * Labels for Documents (Records, Events) that evidence an assertion.
 */
function labelsOf(entities) {
    const labels = {}
    for (const [id, entity] of Object.entries(entities)) {
        labels[id] = documentLabel(entity, id)
    }
    return labels
}

/**
 * Labels for linked People. These go through deriveLabel(), the same rule the
 * index uses, so a parent named here is named the same way in the list. Resolving
 * each linked person's assertions instead would be a read per row.
 */
function personLabelsOf(entities) {
    const labels = {}
    for (const [id, entity] of Object.entries(entities)) {
        labels[id] = entity ? deriveLabel(entity) : id
    }
    return labels
}

/**
 * Record one of a person's names as an annotated assertion: the value, the
 * property it is asserted under, its type and active range as ValueObject
 * qualifiers, and the document that says so. Creating a person is the same
 * operation without a `personId` — a bare Person is minted with the name as its
 * label, which is what the index "New Person" link needs from a bare
 * `person.html`.
 *
 * Nothing here dedupes or overwrites: asserting the same name from a second
 * document adds a second annotation, so disagreement survives (constraint:
 * conflicts are a feature).
 * @param {Object} [options]
 * @param {Object} [options.store] Store (defaults to the model's configured one)
 * @param {string} [options.personId] existing Person; omit to create one
 * @param {string} options.value the name as written in the source
 * @param {string} [options.property] name property URI; `schema:name` by default
 * @param {string} [options.nameType] e.g. 'married name'
 * @param {string} [options.activeFrom] ISO date the name starts being used
 * @param {string} [options.activeTo] ISO date it stops being used
 * @param {Object} options.evidence `{ title, id? }` — the Record naming the source
 * @param {number} [options.confidence] nv:confidence 0-1
 * @param {string} [options.comment] note kept in the ValueObject's `source`
 * @returns {Promise<{ personId: string, recordId: string, annotationId: string }>}
 */
export async function assertPersonName(options = {}) {
    const { store = getDefaultStore(), evidence = {}, value, property, nameType, activeFrom, activeTo, confidence, comment } = options
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new TypeError('assertPersonName() requires a name value')
    if (!evidence.title && !evidence.id) {
        throw new TypeError('assertPersonName() requires evidence: name the evidence document (Record) separately from the facts')
    }
    const nameProperty = property || SCHEMA.name
    if (!Object.values(NAME_PROPERTY_TOKENS).includes(nameProperty)) {
        throw new TypeError(`assertPersonName() cannot assert a name under '${nameProperty}'`)
    }
    if (activeFrom && activeTo && activeFrom > activeTo) {
        throw new RangeError('assertPersonName() requires an active range that ends after it starts')
    }

    // 1. The evidence document, named separately from the fact it supports.
    const recordId = evidence.id
        || (await createEntity({ store, '@type': TYPES.Record, label: evidence.title }))['@id']

    // 2. The person, minted from this name when the page has no id yet.
    const personId = options.personId
        || (await createPerson({ store, label: name, evidence: recordId, confidence }))['@id']

    // 3. One annotation whose ValueObject carries the qualifiers that belong to
    //    THIS claim. assert() cannot express that (it builds one property per
    //    call, which would detach a name's type/range from the name itself), so
    //    the model writes the annotation in exactly assert()'s plumbing.
    const vo = valueObject(name, { source: { comment }, evidence: recordId, confidence })
    if (nameType) vo[NV_NAME_TYPE] = { value: nameType }
    if (activeFrom) vo[NV_ACTIVE_FROM] = { value: activeFrom }
    if (activeTo) vo[NV_ACTIVE_TO] = { value: activeTo }
    const annotation = await store.create({
        type: 'Annotation',
        target: personId,
        body: { [nameProperty]: vo },
        [DCTERMS.source]: recordId
    })

    // A person minted here already carries this name as its bare label; an
    // existing one has to have its cache refreshed.
    if (options.personId) await refreshLabelCache(store, personId, { nameProperty, name })

    return { personId, recordId, annotationId: annotation['@id'] }
}

/**
 * WRITE-SIDE INVARIANT from docs/page-model-adapter.md ("Naming a person"): the
 * bare `label` is a denormalized cache of the name, and a list read cannot see an
 * assertion, so asserting a name refreshes the cache too. A full-name write sets
 * it; a part write only fills an absent cache, and does it through personLabel —
 * the same single rule the reads use, never a second standard.
 *
 * A person still holding DEER v1 facts is left alone: those facts live INSIDE the
 * v1 document (the adapter only converts them on the way in), so rewriting that
 * document would destroy the record. Lazy migration happens when the owning page
 * re-saves it in the new shape.
 */
async function refreshLabelCache(store, personId, { nameProperty, name }) {
    const annos = await listAssertions({ store, target: personId })
    if (annos.some(isLegacyAnnotation)) return
    const entity = await readEntity({ store, id: personId })
    if (!entity) return
    const summarisesName = nameProperty === SCHEMA.name
    if (!summarisesName && entity.label && entity.label !== UNLABELED) return
    const assertions = await resolveAssertions({ store, target: personId })
    const next = summarisesName ? name : personLabel({ entity, assertions })
    if (!next || next === UNLABELED || next === entity.label) return
    await store.update({ ...entity, label: next })
}

/**
 * Load an existing person's page view: every assertion with its evidence and
 * confidence (the audit view the page groups by assertion type), the parentage
 * edges with both sides labelled, the lacunae, and the `legacy` flag.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Object|null>} assembled view, or null when the id is not a
 * Person. Shape:
 * `{ personId, label, legacy, view, assertions, evidenceLabels, personLabels, parents, children, lacunae }`
 */
export async function loadPerson(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('loadPerson() requires a personId')
    const view = await getPerson({ store, id: personId })
    if (!view) return null

    const evidenceIds = []
    const personIds = []
    for (const property of Object.keys(view.assertions)) {
        for (const vo of asArray(view.assertions[property])) {
            if (vo && vo.evidence) evidenceIds.push(vo.evidence)
            if (property === NV.hasParent && vo && vo.value) personIds.push(vo.value)
        }
    }
    for (const child of view.children) {
        if (child.target) personIds.push(child.target)
        if (child.evidence) evidenceIds.push(child.evidence)
    }

    const annos = await listAssertions({ store, target: personId })
    const evidenceEntities = await resolveEntities(store, evidenceIds)
    const personEntities = await resolveEntities(store, personIds)
    const evidenceLabels = labelsOf(evidenceEntities)
    const personLabels = personLabelsOf(personEntities)

    // Facts asserted by an Event carry the event as their evidence. For display,
    // alias each event id to the label of the Record that evidences the event, so
    // every assertion row names the document a reader can go and check.
    for (const [id, entity] of Object.entries(evidenceEntities)) {
        if (!isEventEntity(entity)) continue
        const provenance = await eventProvenance({ store, event: id })
        if (!provenance.evidence) continue
        const record = await readEntity({ store, id: provenance.evidence })
        evidenceLabels[id] = (record ? documentLabel(record, id) : '') || evidenceLabels[provenance.evidence] || provenance.evidence
    }

    return {
        personId,
        label: view.label,
        legacy: annos.some(isLegacyAnnotation),
        view,
        assertions: view.assertions,
        evidenceLabels,
        personLabels,
        parents: view.parents,
        children: view.children,
        lacunae: view.lacunae
    }
}
