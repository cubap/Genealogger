/**
 * @module model/timeline
 * @description Use-case reads for the ancestor timeline (issue #14 story 9):
 * take a person, walk the ANCESTOR chain with the existing derived reads
 * (`parentsOf` for parentage, `eventsForPerson` for event participation --
 * never a stored duplicate of either), and return plain rows the timeline
 * component draws.
 *
 * Every row names its ROLE ('child', 'mother', ...) and its EVIDENCE (the
 * Record, or the Record documenting an Event), so chronology reads as a
 * sequence of sourced assertions. Estimated/qualified dates carry an
 * `estimated` flag; DISPUTES ARE PRESERVED -- two sources asserting different
 * dates for the same person produce two rows, never a merged winner.
 *
 * Date assertions are found the way the three write paths store them:
 *  1. asserted ON the event document (the DEER v1 shape: `birthDate` sits on
 *     the event itself);
 *  2. asserted on the PERSON with `evidence` = the event id (`assertOutcome`)
 *     -- each such fact belongs to exactly that event and is tied there;
 *  3. a person date fact evidenced only by a Record (or by nothing) is tied
 *     to that person's first same-kind event by SUBTYPE AFFINITY -- a
 *     birthDate fact speaks to a Birth/Baptism/Christening -- consumed by at
 *     most one event so it is not drawn twice;
 *  4. leftover person facts that no event claimed still get a row: a sourced
 *     assertion is never dropped for want of an Event.
 *
 * The ancestor walk here is NOT yet a shared helper: no other page needs a
 * multi-generation traversal today. FLAGGED FOR HOISTING into model/search.js
 * once the family-tree page needs the same walk.
 */

import { getPerson } from './person.js'
import { parentsOf, eventsForPerson, deriveLabel } from './search.js'
import { participations, eventProvenance } from './events.js'
import { list as listAssertions, valueObjectsFor } from './assertions.js'
import { readEntity } from './entities.js'
import { NV, EVENT_SUBTYPES, typeTokens } from './vocabulary.js'

/** Generations above the subject to walk (subject's parents are generation 1). */
export const DEFAULT_MAX_GENERATION = 4

/** Bare property tokens that carry a timeline-relevant date. */
const PERSON_DATE_TOKENS = new Set(['birthDate', 'deathDate'])
const DOC_DATE_TOKENS = new Set(['birthDate', 'deathDate', 'burialDate', 'date', 'inXSDDate'])

/** Which date fact each event subtype speaks to. */
const EVENT_KIND = {
    Birth: 'birthDate',
    Baptism: 'birthDate',
    Christening: 'birthDate',
    Death: 'deathDate',
    Burial: 'deathDate'
}

/** A Baptism/Christening stands in for an unrecorded birth date. */
const BAPTISM_SUBTYPES = new Set(['Baptism', 'Christening'])

const EVENT_LEGACY_TYPES = typeTokens(Object.values(EVENT_SUBTYPES))

/** Hedges that mark an asserted date as estimated rather than recorded. */
const ESTIMATE_PREFIX = /^(circa|c\.|ca\.?|abt\.?|about|approx\.?|est\.?|estimated|assumed|calc\.?|calculated)[\s.]*\s*/i

function bare(token) {
    return String(token ?? '').split(/[#/]/).pop()
}

function toArray(value) {
    return Array.isArray(value) ? value : [value]
}

/**
 * Classify one raw asserted date value into a plottable point. Pure.
 * Returns null when the value carries no year at all; the caller then keeps
 * the assertion in the undated list -- disagreement means surviving visibly,
 * not being silently dropped by a parser.
 * @param {*} raw asserted value (usually a string)
 * @returns {{display: string, year: number|null, precision: string, span: Array<number>|null, estimated: boolean}|null}
 */
export function classifyDate(raw) {
    if (raw === null || raw === undefined) return null
    const display = String(raw).trim()
    if (!display) return null
    const estimated = ESTIMATE_PREFIX.test(display)
    const stripped = display.replace(ESTIMATE_PREFIX, '')
    const full = stripped.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (full) {
        return { display, year: Number(full[1]), precision: 'day', span: null, estimated }
    }
    const range = stripped.match(/^(\d{4})\s*[-/]\s*(\d{4})$/)
    if (range) {
        const from = Number(range[1])
        const to = Number(range[2])
        return { display, year: Math.round((from + to) / 2), precision: 'range', span: [from, to], estimated }
    }
    const loose = stripped.match(/\d{3,4}/)
    if (!loose) return null
    const precision = /^\d{4}-\d{2}$/.test(stripped) ? 'month' : /^\d{4}$/.test(stripped) ? 'year' : 'approximate'
    return { display, year: Number(loose[0]), precision, span: null, estimated }
}

function eventSubtype(entity) {
    const types = toArray(entity?.['@type']).filter(t => typeof t === 'string')
    // New-shape events carry the nv:Birth URI, DEER v1 docs the bare 'Birth'.
    const subtype = types.find(t => EVENT_SUBTYPES[bare(t)])
    return subtype ? bare(subtype) : 'Event'
}

/**
 * Collect `{ vo, property }` date assertions on one target, in store order,
 * remembering the annotation ids seen (the legacy converter stamps '#legacy-'
 * into every annotation it derives from a DEER v1 document).
 */
async function dateAssertions({ store, target, tokens, annotationIds }) {
    const rows = []
    for (const anno of await listAssertions({ store, target })) {
        if (anno['@id']) annotationIds.push(anno['@id'])
        for (const property of Object.keys(anno.body || {})) {
            if (!tokens.has(bare(property))) continue
            for (const vo of valueObjectsFor(anno, property)) rows.push({ vo, property })
        }
    }
    return rows
}

/**
 * Load the ancestor timeline for one person.
 * @param {Object} [options]
 * @param {Object} [options.store] Store implementation (defaults to bootstrap)
 * @param {string} options.personId subject Person id
 * @param {number} [options.maxGeneration] generations of ancestors to walk
 * @returns {Promise<{ personId: string, label: string, people: Array<Object>,
 *   items: Array<Object>, undated: Array<Object>, legacy: boolean }>} plain
 *   rows: `people` is the chain (`{id, label, generation, subject}`), `items`
 *   one dated assertion each, `undated` events/facts without a parseable year.
 */
export async function loadAncestorTimeline(options = {}) {
    const { store, personId, maxGeneration = DEFAULT_MAX_GENERATION } = options
    if (!personId) throw new TypeError('loadAncestorTimeline() requires a personId')

    // 1. BFS the ancestor chain through the derived parent read.
    const people = []
    const seen = new Set()
    const queue = [{ id: personId, generation: 0 }]
    while (queue.length) {
        const { id, generation } = queue.shift()
        if (seen.has(id) || generation > maxGeneration) continue
        seen.add(id)
        const view = await getPerson({ store, id })
        if (!view) continue
        people.push({
            id,
            label: view.label || deriveLabel(view.entity),
            generation,
            subject: generation === 0
        })
        for (const vo of await parentsOf({ store, personId: id })) {
            const parentId = typeof vo.value === 'string' ? vo.value : vo.value?.['@id'] || vo.value?.id
            if (parentId && !seen.has(parentId)) queue.push({ id: parentId, generation: generation + 1 })
        }
    }

    // 2. Events per chain member, DEER v1 spellings included.
    const eventsByPerson = new Map()
    const eventsById = new Map()
    for (const person of people) {
        const events = await eventsForPerson({ store, personId: person.id, legacyTypes: EVENT_LEGACY_TYPES })
        eventsByPerson.set(person.id, events)
        for (const event of events) eventsById.set(event['@id'], event)
    }

    // 3. Event context: participation, provenance, event-level date assertions.
    const annotationIds = []
    const partsByEvent = new Map()
    const provenanceByEvent = new Map()
    const docDatesByEvent = new Map()
    for (const eventId of eventsById.keys()) {
        partsByEvent.set(eventId, await participations({ store, event: eventId }))
        provenanceByEvent.set(eventId, await eventProvenance({ store, event: eventId }))
        docDatesByEvent.set(eventId, await dateAssertions({ store, target: eventId, tokens: DOC_DATE_TOKENS, annotationIds }))
    }
    // An Event documented by a Record IS evidenced by that Record.
    const recordOfEvent = new Map()
    for (const [eventId, provenance] of provenanceByEvent) {
        if (provenance.evidence) recordOfEvent.set(eventId, provenance.evidence)
    }

    const labels = new Map()
    async function labelFor(id) {
        if (!id) return ''
        if (labels.has(id)) return labels.get(id)
        const aliased = recordOfEvent.get(id)
        if (aliased) return await labelFor(aliased)
        let label = id
        try {
            const entity = await readEntity({ store, id })
            if (entity) label = entity.label || deriveLabel(entity) || id
        } catch {
            // An unresolvable evidence id is still shown verbatim.
        }
        labels.set(id, label)
        return label
    }

    // 4. Assemble rows: one per (person, event, date assertion). Conflicting
    //    assertions stay separate rows; the layout draws them side by side.
    const items = []
    const undated = []
    const undatedByEvent = new Map()
    let row = 0
    // Pass A: gather each member's own date facts and tie them to events.
    // Tying is global-first (strict `evidence` = event id, then subtype
    // affinity against the first same-kind event) so a fact is drawn exactly
    // once -- and so one participant can borrow another's event dates below.
    const plans = new Map()
    for (const person of people) {
        const personDates = (await dateAssertions({
            store, target: person.id, tokens: PERSON_DATE_TOKENS, annotationIds
        })).map(fact => ({ ...fact, consumed: false }))
        const events = eventsByPerson.get(person.id) || []
        const tiedByEvent = new Map(events.map(event => [event['@id'], []]))
        for (const fact of personDates) {
            if (fact.vo.evidence && tiedByEvent.has(fact.vo.evidence)) {
                fact.consumed = true
                tiedByEvent.get(fact.vo.evidence).push(fact)
            }
        }
        for (const fact of personDates) {
            if (fact.consumed) continue
            const match = events.find(event => EVENT_KIND[eventSubtype(event)] === bare(fact.property))
            if (match) {
                fact.consumed = true
                tiedByEvent.get(match['@id']).push(fact)
            }
        }
        plans.set(person.id, { personDates, tiedByEvent })
    }

    // Pass B: one marker row per (person, event, date assertion). Conflicting
    // assertions stay separate rows; the layout draws them side by side.
    for (const person of people) {
        const events = eventsByPerson.get(person.id) || []
        const { personDates, tiedByEvent } = plans.get(person.id)
        const hasOwnBirthFact = personDates.some(fact => bare(fact.property) === 'birthDate')
        for (const event of events) {
            const eventId = event['@id']
            const subtype = eventSubtype(event)
            const provenance = provenanceByEvent.get(eventId) || {}
            const myPart = (partsByEvent.get(eventId) || []).find(part => part.agent === person.id)
            const dates = []
            const add = (vo, property) => {
                if (!dates.some(existing => existing.vo.value === vo.value && existing.property === property)) {
                    dates.push({ vo, property })
                }
            }
            const own = tiedByEvent.get(eventId) || []
            for (const fact of own) add(fact.vo, fact.property)
            for (const { vo, property } of docDatesByEvent.get(eventId) || []) add(vo, property)
            if (!own.length && !dates.length) {
                // The participant carried no date of their own, but the EVENT
                // is dated by a co-participant's sourced assertion (a mother is
                // evidenced at her child's Birth just the same): show this
                // person's role at that date rather than hiding the row.
                for (const other of plans.values()) {
                    if (other === plans.get(person.id)) continue
                    for (const fact of other.tiedByEvent.get(eventId) || []) add(fact.vo, fact.property)
                }
            }

            if (!dates.length) {
                if (!undatedByEvent.has(eventId)) {
                    undatedByEvent.set(eventId, {
                        id: `tl-u${row++}`,
                        eventId,
                        display: '',
                        eventLabel: event.label || subtype,
                        eventSubtype: subtype,
                        evidenceId: provenance.evidence || '',
                        persons: []
                    })
                }
                undatedByEvent.get(eventId).persons.push({
                    personId: person.id,
                    label: person.label,
                    generation: person.generation,
                    roleLabel: bare(myPart?.role) || 'participant'
                })
                continue
            }
            // A Baptism/Christening of a person with no recorded birth date
            // anywhere stands in for it: the date is real, the birth year it
            // implies is estimated. Only for the CHILD the event is about --
            // a mother named in it is not having her birth estimated.
            const isPrimary = !myPart || bare(myPart.role) === 'child'
            const estimatesBirth = isPrimary && BAPTISM_SUBTYPES.has(subtype) && !hasOwnBirthFact
            for (const { vo, property } of dates) {
                const classified = classifyDate(vo.value)
                const evidenceId = vo.evidence || provenance.evidence || ''
                const base = {
                    id: `tl-${row++}`,
                    personId: person.id,
                    label: person.label,
                    generation: person.generation,
                    eventId,
                    eventLabel: event.label || subtype,
                    eventSubtype: subtype,
                    role: myPart?.role || null,
                    roleLabel: bare(myPart?.role) || (person.subject ? 'subject' : 'participant'),
                    property,
                    display: classified ? classified.display : String(vo.value ?? '').trim(),
                    year: classified ? classified.year : null,
                    precision: classified ? classified.precision : 'unknown',
                    span: classified ? classified.span : null,
                    estimated: (classified ? classified.estimated : false) || estimatesBirth,
                    estimatedNote: classified && classified.estimated
                        ? 'Asserted with an estimate hedge'
                        : (estimatesBirth ? 'Birth year estimated from the Baptism record' : ''),
                    confidence: vo[NV.confidence] ?? provenance.confidence,
                    evidenceId
                }
                if (base.year === null) {
                    undated.push({
                        ...base,
                        persons: [{ personId: person.id, label: person.label, generation: person.generation, roleLabel: base.roleLabel }]
                    })
                } else {
                    items.push(base)
                }
            }
        }
        for (const fact of personDates) {
            if (fact.consumed) continue
            const classified = classifyDate(fact.vo.value)
            const item = {
                id: `tl-${row++}`,
                personId: person.id,
                label: person.label,
                generation: person.generation,
                eventId: null,
                eventLabel: `${bare(fact.property)} (no Event)`,
                eventSubtype: null,
                role: null,
                roleLabel: 'assertion',
                property: fact.property,
                display: classified ? classified.display : String(fact.vo.value ?? '').trim(),
                year: classified ? classified.year : null,
                precision: classified ? classified.precision : 'unknown',
                span: classified ? classified.span : null,
                estimated: classified ? classified.estimated : false,
                estimatedNote: classified && classified.estimated ? 'Asserted with an estimate hedge' : '',
                confidence: fact.vo[NV.confidence],
                evidenceId: fact.vo.evidence || ''
            }
            if (item.year === null) {
                undated.push({ ...item, persons: [{ personId: person.id, label: person.label, generation: person.generation, roleLabel: 'assertion' }] })
            } else {
                items.push(item)
            }
        }
    }
    undated.push(...undatedByEvent.values())

    // 5. Evidence labels last, once every referenced id is known.
    for (const entry of [...items, ...undated]) {
        entry.evidenceLabel = await labelFor(entry.evidenceId)
    }

    return {
        personId,
        label: people.find(p => p.subject)?.label
            || deriveLabel((await readEntity({ store, id: personId })) || {}),
        people,
        items,
        undated,
        legacy: annotationIds.some(id => String(id).includes('#legacy-'))
    }
}
