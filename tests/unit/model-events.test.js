/**
 * Tests for first-class Events: own evidence, participation triples, outcome
 * assertions, derived nv:hasParent, computed nv:hasChild, and conflicting
 * paternity across two events.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { createPerson } from '../../js/model/entities.js'
import { createEvent, participate, participations, assertOutcome, deriveParentAssertions, eventProvenance, resolveSubtype } from '../../js/model/events.js'
import { getPerson } from '../../js/model/person.js'
import { eventsForPerson, childrenOf } from '../../js/model/search.js'
import { NV, SCHEMA, EVENT_SUBTYPES } from '../../js/model/vocabulary.js'

const CERT = 'https://devstore.rerum.io/v1/id/birth-certificate'
const REG = 'https://devstore.rerum.io/v1/id/baptism-register'

async function fixtureWithCertificate() {
    const store = createMemoryStore()
    const child = await createPerson({ store, label: 'Ada' })
    const mother = await createPerson({ store, label: 'Anne' })
    const father = await createPerson({ store, label: 'George' })
    const event = await createEvent({
        store, subtype: 'Birth', label: 'Birth of Ada', evidence: CERT, confidence: 0.95
    })
    await participate({ store, event, agent: child['@id'], role: NV.child, evidence: CERT })
    await participate({ store, event, agent: mother['@id'], role: NV.parent, evidence: CERT })
    await participate({ store, event, agent: father['@id'], role: NV.parent, evidence: CERT })
    return { store, child, mother, father, event }
}

describe('Event entities', () => {
    test('createEvent yields @type Event plus the nv: subtype URI', async () => {
        const store = createMemoryStore()
        const event = await createEvent({ store, subtype: 'Christening', evidence: REG })
        expect(event['@type']).toContain('Event')
        expect(event['@type']).toContain(EVENT_SUBTYPES.Christening)
        const prov = await eventProvenance({ store, event })
        expect(prov.evidence).toBe(REG)
    })

    test('resolveSubtype accepts bare names, nv: shorthand, and URIs', () => {
        expect(resolveSubtype('Birth')).toBe(EVENT_SUBTYPES.Birth)
        expect(resolveSubtype('nv:Birth')).toBe(EVENT_SUBTYPES.Birth)
        expect(resolveSubtype('https://example.org/Custom')).toBe('https://example.org/Custom')
        expect(() => resolveSubtype('')).toThrow(TypeError)
    })

    test('participation triples are readable back as (event, agent, role)', async () => {
        const { store, event, child, mother } = await fixtureWithCertificate()
        const rows = await participations({ store, event })
        expect(rows).toHaveLength(3)
        const agents = rows.map(r => r.agent)
        expect(agents).toContain(child['@id'])
        expect(agents).toContain(mother['@id'])
        expect(rows.every(r => r.role === NV.child || r.role === NV.parent)).toBe(true)
    })
})

describe('event outcomes and derived parentage', () => {
    test('a birth certificate asserts name, birthDate, and sex on the child with the event as evidence', async () => {
        const { store, event, child } = await fixtureWithCertificate()
        await assertOutcome({ store, event, target: child['@id'], property: SCHEMA.name, value: 'Ada Gordon' })
        await assertOutcome({ store, event, target: child['@id'], property: SCHEMA.birthDate, value: '1815-12-10' })
        await assertOutcome({ store, event, target: child['@id'], property: SCHEMA.sex, value: 'female' })

        const view = await getPerson({ store, id: child['@id'] })
        expect(view.assertions[SCHEMA.name].value).toBe('Ada Gordon')
        expect(view.assertions[SCHEMA.birthDate].value).toBe('1815-12-10')
        expect(view.assertions[SCHEMA.name].evidence).toBe(event['@id'])
        // Confidence inherits the event's evidence confidence.
        expect(view.assertions[SCHEMA.name][NV.confidence]).toBe(0.95)
    })

    test('deriveParentAssertions writes nv:hasParent on the child, evidenced by the event', async () => {
        const { store, event, child, mother, father } = await fixtureWithCertificate()
        const derived = await deriveParentAssertions({ store, event })
        expect(derived).toHaveLength(2)
        const view = await getPerson({ store, id: child['@id'] })
        const parents = view.parents.map(p => p.value)
        expect(parents).toContain(mother['@id'])
        expect(parents).toContain(father['@id'])
        expect(view.parents.every(p => p.evidence === event['@id'])).toBe(true)
        expect(view.parents.every(p => p[NV.confidence] === 0.95)).toBe(true)
    })

    test('nv:hasChild is computed at read time, never stored', async () => {
        const { store, event, child, mother } = await fixtureWithCertificate()
        await deriveParentAssertions({ store, event })
        const view = await getPerson({ store, id: mother['@id'] })
        expect(view.children).toHaveLength(1)
        expect(view.children[0].target).toBe(child['@id'])
        // And nothing named nv:hasChild was ever persisted.
        const stored = store.all().filter(doc => JSON.stringify(doc).includes(NV.hasChild))
        expect(stored).toEqual([])
        const viaSearch = await childrenOf({ store, personId: mother['@id'] })
        expect(viaSearch[0].value).toBe(mother['@id'])
    })

    test('conflicting father across baptism vs certificate coexists as two assertions', async () => {
        const { store, event, child, father } = await fixtureWithCertificate()
        await deriveParentAssertions({ store, event })
        // A baptism register names a different man as father.
        const rival = await createPerson({ store, label: 'Reverend Byron' })
        const baptism = await createEvent({ store, subtype: 'Christening', evidence: REG, confidence: 0.6 })
        await participate({ store, event: baptism, agent: child['@id'], role: NV.child })
        await participate({ store, event: baptism, agent: rival['@id'], role: NV.parent })
        await deriveParentAssertions({ store, event: baptism })

        const view = await getPerson({ store, id: child['@id'] })
        const parentAssertions = view.assertions[NV.hasParent]
        expect(Array.isArray(parentAssertions)).toBe(true)
        expect(parentAssertions).toHaveLength(3) // mother + father + rival
        const byEvidence = Object.fromEntries(parentAssertions.map(p => [p.evidence, p[NV.confidence]]))
        expect(byEvidence[event['@id']]).toBe(0.95)
        expect(byEvidence[baptism['@id']]).toBe(0.6)
        expect(parentAssertions.map(p => p.value)).toContain(rival['@id'])
        expect(parentAssertions.map(p => p.value)).toContain(father['@id'])
        // Derived confidence can be overridden per derivation.
        const override = await deriveParentAssertions({ store, event: baptism, confidence: 0.1 })
        expect(override[0].body[NV.hasParent][NV.confidence]).toBe(0.1)
    })

    test('eventsForPerson finds events a person participated in', async () => {
        const { store, event, child } = await fixtureWithCertificate()
        const events = await eventsForPerson({ store, personId: child['@id'] })
        expect(events).toHaveLength(1)
        expect(events[0]['@id']).toBe(event['@id'])
        const asChild = await eventsForPerson({ store, personId: child['@id'], role: NV.child })
        expect(asChild).toHaveLength(1)
    })
})
