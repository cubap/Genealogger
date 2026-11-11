/**
 * Tests for the death use-case layer: the orchestration that turns form data into
 * a Person + Death Event + evidence-backed assertions, records witnesses and
 * attendants as participants-with-roles, derives nv:hasParent when a death record
 * names parents, keeps conflicting sources as separate assertions, honours the
 * nv:hasChild-computed-never-stored rule, and can still READ the legacy DEER v1
 * shape (facts asserted on the Event document itself).
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { saveDeath, loadDeath, ROLE_TOKENS } from '../../js/model/death.js'
import { createPerson } from '../../js/model/entities.js'
import { createEvent, participate } from '../../js/model/events.js'
import { childrenOf } from '../../js/model/search.js'
import { NV, SCHEMA, EVENT_SUBTYPES } from '../../js/model/vocabulary.js'

const HAS_CHILD = 'https://cubap.github.io/Genealogger/nv#hasChild'
const DCTERMS_SOURCE = 'http://purl.org/dc/terms/source'

async function seed(options) {
    const store = createMemoryStore()
    const result = await saveDeath({ store, ...options })
    return { store, result }
}

describe('saveDeath', () => {
    test('requires the evidence document to be named separately', async () => {
        const store = createMemoryStore()
        await expect(saveDeath({ store, name: { given: 'Ada' } })).rejects.toThrow(TypeError)
    })

    test('creates a person, death event and evidence record', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Death certificate' },
            deathDate: '1852-01-01',
            deathPlace: 'London'
        })
        expect(result.personId).toBeTruthy()
        expect(result.eventId).toBeTruthy()
        expect(result.recordId).toBeTruthy()

        const death = await loadDeath({ store, personId: result.personId })
        expect(death.label).toBe('Ada Byron')
        expect(death.legacy).toBe(false)
        expect(death.events).toHaveLength(1)
        expect(death.events[0].subtype).toBe(EVENT_SUBTYPES.Death)
        expect(death.events[0].record.id).toBe(result.recordId)
    })

    test('asserts facts with evidence and per-assertion confidence', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Death certificate' },
            deathDate: '1852-01-01',
            deathPlace: 'London',
            confidences: { deathDate: 0.9, deathPlace: 0.4 }
        })
        const death = await loadDeath({ store, personId: result.personId })
        const date = [death.assertions[SCHEMA.deathDate]].flat()
        const place = [death.assertions[SCHEMA.deathPlace]].flat()
        expect(date[0].value).toBe('1852-01-01')
        expect(date[0][NV.confidence]).toBe(0.9)
        // Facts are evidenced by their Event; the read view aliases that event id
        // to the source document's label.
        expect(date[0].evidence).toBe(result.eventId)
        expect(death.evidenceLabels[result.eventId]).toBe('Death certificate')
        expect(place[0][NV.confidence]).toBe(0.4)
    })

    test('records witnesses and attendants as participants with roles, not columns', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Death register' },
            participants: [
                { role: 'witness', name: { given: 'John', family: 'Halo' } },
                { role: 'attendant', name: { given: 'Nurse', family: 'Ellis' }, confidence: 0.6 }
            ]
        })
        const death = await loadDeath({ store, personId: result.personId })
        const rows = death.events[0].participants
        const roles = rows.map(p => p.role)
        expect(roles).toContain(ROLE_TOKENS.witness)
        expect(roles).toContain(ROLE_TOKENS.attendant)
        // The deceased participates too, as the subject of the event.
        expect(roles).toContain(NV.child)
        // Roles are minted URIs, never bare column names on a record.
        for (const role of roles) expect(role).toMatch(/#/)
        const attendant = rows.find(p => p.role === ROLE_TOKENS.attendant)
        expect(attendant.confidence).toBe(0.6)

        // Nothing is stored as a witness/attendant/hasAgent column anywhere.
        for (const doc of store.all()) {
            const keys = Object.keys(doc.body || doc)
            expect(keys).not.toContain('witness')
            expect(keys).not.toContain('attendant')
            expect(keys).not.toContain('hasAgent')
        }
    })

    test('derives nv:hasParent when a death record names a parent', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Death certificate' },
            participants: [{ role: 'parent', name: { given: 'George', family: 'Byron' } }]
        })
        const death = await loadDeath({ store, personId: result.personId })
        const parents = [death.assertions[NV.hasParent]].flat()
        expect(parents.length).toBeGreaterThanOrEqual(1)

        const children = await childrenOf({ store, personId: parents[0].value })
        expect(children.map(c => c.target)).toContain(result.personId)

        // Invariant: nothing on the wire stores hasChild.
        for (const doc of store.all()) {
            if (!doc.body) continue
            expect(Object.keys(doc.body)).not.toContain(HAS_CHILD)
        }
    })

    test('recognises Burial events alongside Death', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Sexton book' },
            subtype: 'Burial'
        })
        const death = await loadDeath({ store, personId: result.personId })
        expect(death.events).toHaveLength(1)
        expect(death.events[0].subtype).toBe(EVENT_SUBTYPES.Burial)
    })

    test('ignores events that are not death-family', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada Byron' })
        const birth = await createEvent({ store, subtype: 'Birth', label: 'Birth of Ada Byron' })
        await participate({ store, event: birth, agent: person['@id'], role: NV.child })
        const death = await loadDeath({ store, personId: person['@id'] })
        expect(death.events).toHaveLength(0)
    })
})

describe('saveDeath conflicting evidence', () => {
    test('two sources that disagree coexist as separate assertions', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Death certificate' },
            deathDate: '1852-01-01'
        })
        await saveDeath({
            store,
            personId: result.personId,
            evidence: { title: 'Family bible' },
            deathDate: '1852-01-02'
        })
        const death = await loadDeath({ store, personId: result.personId })
        const dates = [death.assertions[SCHEMA.deathDate]].flat()
        expect(dates).toHaveLength(2)
        expect(dates.map(d => d.value).sort()).toEqual(['1852-01-01', '1852-01-02'])
        expect(new Set(dates.map(d => d.evidence)).size).toBe(2)
    })
})

describe('loadDeath legacy (DEER v1) reading', () => {
    /**
     * The v1 death form posted its facts ONTO the Event document and named the
     * deceased with `hasAgent`, so the legacy reader produces a bare
     * `@type: "Death"` entity whose deathDate/deathPlace assertions target the
     * event, plus an agent annotation whose role is nv:child.
     */
    async function seedLegacy(store, personId) {
        const eventId = 'https://devstore.rerum.io/v1/EVENT1'
        const recordId = 'https://devstore.rerum.io/v1/RECORD1'
        await store.create({ '@id': recordId, '@type': 'Record', label: 'Graveyard transcript' })
        await store.create({ '@id': eventId, '@type': 'Death', label: 'Death of Ada Byron' })
        await store.create({
            '@id': `${eventId}#legacy-agent-0`,
            type: 'Annotation',
            target: eventId,
            body: { [NV.participant]: { value: personId }, [NV.role]: { value: NV.child } }
        })
        await store.create({
            '@id': `${eventId}#legacy-${DCTERMS_SOURCE.replace(/[^a-zA-Z0-9]/g, '-')}-1`,
            type: 'Annotation',
            target: eventId,
            body: { [DCTERMS_SOURCE]: { value: recordId } }
        })
        await store.create({
            '@id': `${eventId}#legacy-deadDate-2`,
            type: 'Annotation',
            target: eventId,
            body: { [SCHEMA.deathDate]: { value: '1852-01-01' } }
        })
        await store.create({
            '@id': `${eventId}#legacy-deathPlace-3`,
            type: 'Annotation',
            target: eventId,
            body: { [SCHEMA.deathPlace]: { value: 'London' } }
        })
        return { eventId, recordId }
    }

    test('reads facts that sit on the legacy Event document', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada Byron' })
        const { eventId, recordId } = await seedLegacy(store, person['@id'])

        const death = await loadDeath({ store, personId: person['@id'] })
        expect(death.legacy).toBe(true)
        expect(death.events).toHaveLength(1)
        expect(death.events[0].subtype).toBe(EVENT_SUBTYPES.Death)
        expect(death.events[0].record.id).toBe(recordId)
        expect([death.assertions[SCHEMA.deathDate]].flat()[0].value).toBe('1852-01-01')
        expect([death.assertions[SCHEMA.deathPlace]].flat()[0].value).toBe('London')
        // The back-filled rows name their source document, not a bare event id.
        expect([death.assertions[SCHEMA.deathDate]].flat()[0].evidence).toBe(eventId)
        expect(death.evidenceLabels[eventId]).toBe('Graveyard transcript')
    })

    test('new-shape facts on the person win over the event copy', async () => {
        const store = createMemoryStore()
        const saved = await saveDeath({
            store,
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Death certificate' },
            deathDate: '1852-01-01'
        })
        await seedLegacy(store, saved.personId)

        const death = await loadDeath({ store, personId: saved.personId })
        const dates = [death.assertions[SCHEMA.deathDate]].flat()
        expect(dates).toHaveLength(1)
        expect(dates[0].value).toBe('1852-01-01')
        expect(dates[0].evidence).toBe(saved.eventId)
    })

    test('the legacy fallback never returns somebody else\'s death', async () => {
        const store = createMemoryStore()
        const ada = await createPerson({ store, label: 'Ada Byron' })
        const { eventId } = await seedLegacy(store, ada['@id'])
        const halo = await createPerson({ store, label: 'John Halo' })
        const haloDeath = `${eventId}-halo`
        await store.create({ '@id': haloDeath, '@type': 'Death', label: 'Death of John Halo' })
        await store.create({
            '@id': `${haloDeath}#legacy-agent-0`,
            type: 'Annotation',
            target: haloDeath,
            body: { [NV.participant]: { value: halo['@id'] }, [NV.role]: { value: NV.child } }
        })

        const death = await loadDeath({ store, personId: halo['@id'] })
        expect(death.events.map(row => row.event['@id'])).toEqual([haloDeath])
    })

    test('a legacy witness is not treated as the deceased', async () => {
        const store = createMemoryStore()
        const ada = await createPerson({ store, label: 'Ada Byron' })
        const witness = await createPerson({ store, label: 'John Halo' })
        const { eventId } = await seedLegacy(store, ada['@id'])
        await store.create({
            '@id': `${eventId}#legacy-agent-1`,
            type: 'Annotation',
            target: eventId,
            body: { [NV.participant]: { value: witness['@id'] }, [NV.role]: { value: ROLE_TOKENS.witness } }
        })

        const death = await loadDeath({ store, personId: witness['@id'] })
        expect(death.events).toHaveLength(0)
    })

    test('new-shape records are found through the rel index without scanning types', async () => {
        const store = createMemoryStore()
        const saved = await saveDeath({
            store,
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Death certificate' },
            deathDate: '1852-01-01'
        })
        const scan = vi.spyOn(store, 'listByType')
        const death = await loadDeath({ store, personId: saved.personId })
        expect(death.events).toHaveLength(1)
        expect(scan).not.toHaveBeenCalled()
    })

    test('returns null for an unknown id', async () => {
        const store = createMemoryStore()
        const death = await loadDeath({ store, personId: 'https://example.org/nope' })
        expect(death).toBeNull()
    })
})
