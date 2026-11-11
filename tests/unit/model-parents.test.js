/**
 * Tests for the parents use-case layer: the orchestration that turns form data
 * into a birth-family Event + nv:mother/nv:father/nv:parent PARTICIPATIONS and
 * the nv:hasParent assertions derived from them — never direct hasFather /
 * hasMother properties on the Person, and never a stored nv:hasChild. Also
 * covers the two honesty rules the M3 migration lives or dies by: conflicting
 * sources stay two visible rows, and a DEER v1 person whose parents were written
 * onto the Person document still opens.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { convertLegacyEntity } from '../../js/adapters/legacy.js'
import { saveParents, loadParents, birthEventsOfChild, ROLE_TOKENS } from '../../js/model/parents.js'
import { createPerson } from '../../js/model/entities.js'
import { participate, createEvent } from '../../js/model/events.js'
import { childrenOf, parentsOf } from '../../js/model/search.js'
import { NV, SCHEMA, EVENT_SUBTYPES } from '../../js/model/vocabulary.js'

const MOTHER = 'Anne Milbanke'
const FATHER = 'William Byron'

async function seedChild(label = 'Ada Byron') {
    const store = createMemoryStore()
    const person = await createPerson({ store, label })
    return { store, personId: person['@id'] }
}

/** The claim shape gl-parents-form reports. */
function twoParents(confidence = 0.9) {
    return [
        { role: 'mother', name: MOTHER, confidence },
        { role: 'father', name: FATHER, confidence }
    ]
}

describe('saveParents', () => {
    test('requires an existing child and a named evidence document', async () => {
        const { store } = await seedChild()
        await expect(saveParents({ store, parents: twoParents() })).rejects.toThrow(TypeError)
        const { store: store2, personId } = await seedChild()
        await expect(saveParents({ store: store2, personId })).rejects.toThrow(TypeError)
    })

    test('records parentage as roles on a birth event, not on the person', async () => {
        const { store, personId } = await seedChild()
        const saved = await saveParents({
            store,
            personId,
            evidence: { title: 'Parish baptism certificate, 1815' },
            parents: twoParents()
        })
        expect(saved.eventId).toBeTruthy()
        expect(saved.recordId).toBeTruthy()
        expect(saved.participants).toHaveLength(2)

        const events = await store.listByType(EVENT_SUBTYPES.Birth)
        expect(events.map(event => event['@id'])).toContain(saved.eventId)

        // The Person document keeps only identity: no hasFather, no hasMother,
        // no homeLocation, no parentage of any kind written onto it.
        const person = await store.read(personId)
        expect(person.hasFather).toBeUndefined()
        expect(person.hasMother).toBeUndefined()
        expect(person[NV.hasParent]).toBeUndefined()
        expect(person[NV.hasChild]).toBeUndefined()

        // Each parent is a participation of the event, carrying its own evidence.
        const rows = await store.query({ target: saved.eventId, type: NV.participant })
        expect(rows).toHaveLength(3)
        const roles = rows.map(anno => anno.body[NV.role].value).sort()
        expect(roles).toEqual([NV.child, NV.father, NV.mother].sort())
        for (const anno of rows) {
            expect(anno.rel).toEqual(expect.arrayContaining([saved.eventId]))
            expect(anno.body[NV.participant].evidence).toBe(saved.recordId)
        }
        // Roles are canonical URIs, never bare column names.
        for (const role of roles) expect(role).toMatch(/#/)
    })

    test('creates the named parents as persons and derives nv:hasParent on the child', async () => {
        const { store, personId } = await seedChild()
        const saved = await saveParents({
            store,
            personId,
            evidence: { title: 'Parish certificate' },
            parents: twoParents(0.8)
        })
        const claims = await parentsOf({ store, personId })
        expect(claims).toHaveLength(2)
        for (const vo of claims) {
            expect(vo.evidence).toBe(saved.eventId)
            expect(vo[NV.confidence]).toBe(0.8)
            const person = await store.read(vo.value)
            expect(person).toBeTruthy()
        }
        // The parent->child edge is computed, so it is never stored as a document.
        for (const doc of store.all()) {
            expect(doc.body && doc.body[NV.hasChild]).toBeUndefined()
        }
        const mother = saved.participants.find(p => p.role === NV.mother)
        expect(await childrenOf({ store, personId: mother.agentId })).toHaveLength(1)
    })

    test('asserts residence as a fact evidenced by the event', async () => {
        const { store, personId } = await seedChild()
        const saved = await saveParents({
            store,
            personId,
            evidence: { title: 'Parish certificate' },
            parents: twoParents(),
            residence: 'London'
        })
        const facts = await parentsOf({ store, personId })
        expect(facts).toHaveLength(2)
        const home = await store.query({ target: personId, type: SCHEMA.homeLocation })
        expect(home).toHaveLength(1)
        expect(home[0].body[SCHEMA.homeLocation].value).toBe('London')
        expect(home[0].body[SCHEMA.homeLocation].evidence).toBe(saved.eventId)
    })

    test('re-saving the same claim does not multiply it', async () => {
        const { store, personId } = await seedChild()
        const evidence = { title: 'Parish certificate' }
        await saveParents({ store, personId, evidence, parents: twoParents(), residence: 'London' })
        const before = store.all().length

        // Exactly what the page sends when the form was prefilled from the store.
        const loaded = await loadParents({ store, personId })
        await saveParents({
            store,
            personId,
            evidence: { id: loaded.events[0].recordId, title: 'Parish certificate' },
            residence: 'London',
            parents: loaded.parents.map(row => ({
                role: row.role.split(/[#/]/).pop(),
                agentId: row.agentId,
                confidence: row.confidence
            }))
        })
        expect(store.all().length).toBe(before)
        expect((await loadParents({ store, personId })).parents).toHaveLength(2)
    })
})

describe('loadParents', () => {
    test('shows each parent with the event, document and confidence behind it', async () => {
        const { store, personId } = await seedChild()
        await saveParents({
            store,
            personId,
            evidence: { title: 'Parish certificate' },
            parents: [{ role: 'mother', name: MOTHER, confidence: 0.9 }]
        })
        const loaded = await loadParents({ store, personId })
        expect(loaded.label).toBe('Ada Byron')
        expect(loaded.legacy).toBe(false)
        expect(loaded.parents).toHaveLength(1)
        const [mother] = loaded.parents
        expect(mother.role).toBe(NV.mother)
        expect(mother.roleLabel).toBe('Mother')
        expect(mother.label).toBe(MOTHER)
        expect(mother.confidence).toBe(0.9)
        expect(mother.migrated).toBe(false)
        // Provenance chain: claim -> event -> source document, named readably.
        expect(mother.eventId).toBeTruthy()
        expect(mother.recordLabel).toBe('Parish certificate')
        expect(loaded.evidenceLabels[mother.eventId]).toBe('Parish certificate')
        expect(loaded.events[0].subtype).toBe(EVENT_SUBTYPES.Birth)
        expect(loaded.events[0].participants.map(p => p.role)).toContain(NV.child)
    })

    test('keeps two disagreeing sources for the same mother as two rows', async () => {
        const { store, personId } = await seedChild()
        await saveParents({
            store,
            personId,
            evidence: { title: 'Parish certificate' },
            parents: [{ role: 'mother', name: MOTHER, confidence: 1 }]
        })
        await saveParents({
            store,
            personId,
            evidence: { title: 'Family bible' },
            parents: [{ role: 'mother', name: 'Isabella Milbanke', confidence: 0.5 }]
        })
        const loaded = await loadParents({ store, personId })
        const mothers = loaded.parents.filter(row => row.role === NV.mother)
        expect(mothers).toHaveLength(2)
        expect(mothers.map(row => row.label).sort()).toEqual([MOTHER, 'Isabella Milbanke'].sort())
        expect(mothers.map(row => row.recordLabel).sort()).toEqual(['Family bible', 'Parish certificate'])
        // Two sources means two events: the disagreement is structural, not merged.
        expect(loaded.events).toHaveLength(2)
        expect(new Set(mothers.map(row => row.eventId)).size).toBe(2)
    })

    test('a second parent from the same document joins the same event', async () => {
        const { store, personId } = await seedChild()
        const first = await saveParents({
            store,
            personId,
            evidence: { title: 'Parish certificate' },
            parents: [{ role: 'mother', name: MOTHER }]
        })
        const second = await saveParents({
            store,
            personId,
            evidence: { id: first.recordId, title: 'Parish certificate' },
            parents: [{ role: 'father', name: FATHER }]
        })
        expect(second.eventId).toBe(first.eventId)
        const loaded = await loadParents({ store, personId })
        expect(loaded.events).toHaveLength(1)
        expect(loaded.parents.map(row => row.roleLabel)).toEqual(['Mother', 'Father'])
    })

    test('reads a step-relationship as a second parent, not a replacement', async () => {
        const { store, personId } = await seedChild()
        const saved = await saveParents({
            store,
            personId,
            evidence: { title: 'Census, 1821' },
            parents: [
                { role: 'mother', name: MOTHER },
                { role: 'parent', name: 'George Byron', confidence: 0.25 }
            ]
        })
        expect(saved.participants).toHaveLength(2)
        const loaded = await loadParents({ store, personId })
        expect(loaded.parents.map(row => row.roleLabel)).toEqual(['Mother', 'Parent'])
        expect(loaded.parents.every(row => row.roleLabel !== 'Father' || row.label === FATHER)).toBe(true)
    })

    test('derives the children direction without storing it', async () => {
        const store = createMemoryStore()
        const child = await createPerson({ store, label: 'Ada Byron' })
        await saveParents({
            store,
            personId: child['@id'],
            evidence: { title: 'Parish certificate' },
            parents: [{ role: 'mother', name: MOTHER }]
        })
        const loaded = await loadParents({ store, personId: child['@id'] })
        expect(loaded.children).toHaveLength(0)

        const mother = (await parentsOf({ store, personId: child['@id'] }))[0]
        const asMother = await loadParents({ store, personId: mother.value })
        expect(asMother.parents).toHaveLength(0)
        expect(asMother.children).toHaveLength(1)
        expect(asMother.children[0].label).toBe('Ada Byron')
        expect(asMother.children[0].migrated).toBe(false)
        expect(asMother.children[0].recordLabel).toBe('Parish certificate')
    })

    test('reads a person whose parents only exist in the DEER v1 shape', async () => {
        const store = createMemoryStore()
        const docs = convertLegacyEntity({
            '@id': 'https://devstore.rerum.io/v1/PERSON1',
            '@type': 'Person',
            name: 'Ada Byron',
            hasFather: 'https://devstore.rerum.io/v1/FATHER1',
            hasMother: 'https://devstore.rerum.io/v1/MOTHER1',
            homeLocation: 'London'
        })
        for (const doc of docs) await store.create(doc)

        const loaded = await loadParents({ store, personId: 'https://devstore.rerum.io/v1/PERSON1' })
        expect(loaded).toBeTruthy()
        expect(loaded.legacy).toBe(true)
        expect(loaded.events).toHaveLength(0)
        expect(loaded.parents).toHaveLength(2)
        for (const claim of loaded.parents) {
            // v1 stored a bare property, so there is no event and no role to show.
            expect(claim.migrated).toBe(true)
            expect(claim.role).toBe(NV.parent)
            expect(claim.eventId).toBeUndefined()
        }
        expect(loaded.residence).toEqual([expect.objectContaining({ value: 'London' })])
    })

    test('the first save from a v1 person writes only the new shape', async () => {
        const store = createMemoryStore()
        const personId = 'https://devstore.rerum.io/v1/PERSON1'
        for (const doc of convertLegacyEntity({
            '@id': personId,
            '@type': 'Person',
            name: 'Ada Byron',
            hasMother: 'https://devstore.rerum.io/v1/MOTHER1'
        })) await store.create(doc)

        const saved = await saveParents({
            store,
            personId,
            evidence: { title: 'Reconstructed from the v1 card' },
            parents: [{ role: 'mother', agentId: 'https://devstore.rerum.io/v1/MOTHER1' }]
        })
        const loaded = await loadParents({ store, personId })
        expect(loaded.events).toHaveLength(1)
        // The v1 claim and the new one name the same person, so two rows are
        // expected: the migrated one and the freshly derived one.
        const fresh = loaded.parents.filter(row => !row.migrated)
        expect(fresh).toHaveLength(1)
        expect(fresh[0].agentId).toBe('https://devstore.rerum.io/v1/MOTHER1')
        expect(fresh[0].eventId).toBe(saved.eventId)
        expect(fresh[0].recordLabel).toBe('Reconstructed from the v1 card')
        const person = await store.read(personId)
        expect(person.hasMother).toBeUndefined()
    })

    test('returns null for an unknown id', async () => {
        const { store } = await seedChild()
        expect(await loadParents({ store, personId: 'https://example.org/nope' })).toBeNull()
    })
})

describe('birthEventsOfChild', () => {
    test('finds a christening recorded in the legacy v1 shape', async () => {
        const store = createMemoryStore()
        const child = await createPerson({ store, label: 'Ada Byron' })
        // v1 wrote '@type: "Christening"' on the event and named the child with a
        // participant annotation that carries no `rel` reverse index.
        const event = await createEvent({ store, subtype: 'Christening', label: 'Christening of Ada Byron' })
        await store.create({
            '@id': `${event['@id']}#legacy-agent-0`,
            type: 'Annotation',
            target: event['@id'],
            body: { [NV.participant]: { value: child['@id'] }, [NV.role]: { value: NV.child } }
        })
        const mother = await createPerson({ store, label: MOTHER })
        await participate({ store, event, agent: mother['@id'], role: ROLE_TOKENS.mother })

        const events = await birthEventsOfChild({ store, personId: child['@id'] })
        expect(events).toHaveLength(1)
        expect(events[0].subtype).toBe(EVENT_SUBTYPES.Christening)
        expect(events[0].participants.map(row => row.role)).toContain(NV.mother)

        const loaded = await loadParents({ store, personId: child['@id'] })
        expect(loaded.events).toHaveLength(1)
        // The mother was never asserted on the child, so nothing claims her yet.
        expect(loaded.parents).toHaveLength(0)
    })
})
