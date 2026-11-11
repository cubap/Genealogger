/**
 * Tests for the birth use-case layer: the orchestration that turns form data into
 * a Person + Birth Event + evidence-backed assertions, records parents as
 * participants-with-roles, derives nv:hasParent, keeps conflicting sources as
 * separate assertions, and honours the nv:hasChild-computed-never-stored rule.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { saveBirth, loadBirth } from '../../js/model/birth.js'
import { createPerson } from '../../js/model/entities.js'
import { childrenOf } from '../../js/model/search.js'
import { NV, SCHEMA, EVENT_SUBTYPES } from '../../js/model/vocabulary.js'

const HAS_CHILD = 'https://cubap.github.io/Genealogger/nv#hasChild'

async function seed(options) {
    const store = createMemoryStore()
    const result = await saveBirth({ store, ...options })
    return { store, result }
}

describe('loadBirth legacy (DEER v1) reading', () => {
    const EVENT_ID = 'https://devstore.rerum.io/v1/BIRTHEVENT'

    /**
     * What the legacy reader hands the model for a v1 birth: a bare entity typed
     * with the v1 name, plus a `#legacy-agent-*` annotation naming the child and
     * carrying no top-level `rel`. Before eventsForPerson() could enumerate the
     * event types, loadBirth() saw none of these and a real devstore birth opened
     * empty -- the bug that made this page useless over migrated data.
     */
    async function seedLegacyBirth(store, personId) {
        await store.create({ '@id': EVENT_ID, '@type': 'Birth', label: 'Parish register' })
        await store.create({
            '@id': `${EVENT_ID}#legacy-agent-0`,
            type: 'Annotation',
            target: EVENT_ID,
            body: { [NV.participant]: { value: personId }, [NV.role]: { value: NV.child } }
        })
        return EVENT_ID
    }

    test('opens a DEER v1 birth that has no rel index', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada Byron' })
        const eventId = await seedLegacyBirth(store, person['@id'])

        const birth = await loadBirth({ store, personId: person['@id'] })
        expect(birth.events.map(row => row.event['@id'])).toEqual([eventId])
        expect(birth.events[0].subtype).toBe(EVENT_SUBTYPES.Birth)
        expect(birth.events[0].participants.map(row => row.agent)).toEqual([person['@id']])
    })

    test('a new-shape birth is found through the rel index without scanning types', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Parish certificate' },
            birthDate: '1815-12-10'
        })
        const scan = vi.spyOn(store, 'listByType')
        const birth = await loadBirth({ store, personId: result.personId })
        expect(birth.events).toHaveLength(1)
        expect(scan).not.toHaveBeenCalled()
    })
})

describe('saveBirth', () => {
    test('requires the evidence document to be named separately', async () => {
        const store = createMemoryStore()
        await expect(saveBirth({ store, name: { given: 'Ada' } })).rejects.toThrow(TypeError)
    })

    test('creates a person, birth event and evidence record', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Parish certificate' },
            birthDate: '1815-12-10',
            birthPlace: 'London'
        })
        expect(result.personId).toBeTruthy()
        expect(result.eventId).toBeTruthy()
        expect(result.recordId).toBeTruthy()

        const birth = await loadBirth({ store, personId: result.personId })
        expect(birth.label).toBe('Ada Byron')
        expect(birth.legacy).toBe(false)
        expect(birth.events).toHaveLength(1)
        expect(birth.events[0].record.id).toBe(result.recordId)
    })

    test('asserts facts with evidence and per-assertion confidence', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Parish certificate' },
            birthDate: '1815-12-10',
            birthPlace: 'London',
            confidences: { birthDate: 0.9, birthPlace: 0.4 }
        })
        const birth = await loadBirth({ store, personId: result.personId })
        const date = birth.assertions[SCHEMA.birthDate]
        const place = birth.assertions[SCHEMA.birthPlace]
        expect([date].flat()[0].value).toBe('1815-12-10')
        expect([date].flat()[0][NV.confidence]).toBe(0.9)
        // Facts are evidenced by their Event; the read view aliases that event id
        // to the source document's label.
        expect([date].flat()[0].evidence).toBe(result.eventId)
        expect(birth.evidenceLabels[result.eventId]).toBe('Parish certificate')
        expect([place].flat()[0][NV.confidence]).toBe(0.4)
    })

    test('records parents as participants with roles and derives nv:hasParent', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Parish certificate' },
            participants: [{ role: 'parent', name: { given: 'George', family: 'Byron' } }]
        })
        const birth = await loadBirth({ store, personId: result.personId })
        const roles = birth.events[0].participants.map(p => p.role)
        expect(roles).toContain(NV.parent)
        const parents = [birth.assertions[NV.hasParent]].flat()
        expect(parents.length).toBeGreaterThanOrEqual(1)
    })

    test('computes nv:hasChild from the parent side but never stores it', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Parish certificate' },
            participants: [{ role: 'parent', name: { given: 'George', family: 'Byron' } }]
        })
        const birth = await loadBirth({ store, personId: result.personId })
        const parentRow = [birth.assertions[NV.hasParent]].flat()[0]
        const children = await childrenOf({ store, personId: parentRow.value })
        expect(children.map(c => c.target)).toContain(result.personId)

        // Invariant: nothing on the wire stores hasChild.
        for (const doc of store.all()) {
            if (!doc.body) continue
            expect(Object.keys(doc.body)).not.toContain(HAS_CHILD)
        }
    })
})

describe('saveBirth conflicting evidence', () => {
    test('two sources that disagree coexist as separate assertions', async () => {
        const { store, result } = await seed({
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Parish certificate' },
            birthDate: '1815-12-10'
        })
        await saveBirth({
            store,
            personId: result.personId,
            evidence: { title: 'Family bible' },
            birthDate: '1815-12-11'
        })
        const birth = await loadBirth({ store, personId: result.personId })
        const dates = [birth.assertions[SCHEMA.birthDate]].flat()
        expect(dates).toHaveLength(2)
        expect(dates.map(d => d.value).sort()).toEqual(['1815-12-10', '1815-12-11'])
        expect(new Set(dates.map(d => d.evidence)).size).toBe(2)
    })
})

describe('loadBirth', () => {
    test('returns null for an unknown id', async () => {
        const store = createMemoryStore()
        const birth = await loadBirth({ store, personId: 'https://example.org/nope' })
        expect(birth).toBeNull()
    })

    test('names parents whose identity has no bare `label` and falls back to the id when nothing is displayable', async () => {
        const store = createMemoryStore()
        // Same shared label rule (#31) as the death page: a DEER v1 person may
        // carry only givenName/familyName, which `entity.label` alone missed.
        const mother = 'https://example.org/mother'
        await store.create({ '@id': mother, '@type': 'Person', givenName: 'Ada', familyName: 'Gordon' })
        const father = 'https://example.org/father'
        await store.create({ '@id': father, '@type': 'Person' })

        const saved = await saveBirth({
            store,
            name: { given: 'Born', family: 'Probe' },
            evidence: { title: 'Parish register' },
            participants: [
                { role: 'mother', agentId: mother },
                { role: 'father', agentId: father }
            ]
        })

        const birth = await loadBirth({ store, personId: saved.personId })
        expect(birth.personLabels[mother]).toBe('Ada Gordon')
        // A form row must stay selectable, so the id replaces `[ unlabeled ]`.
        expect(birth.personLabels[father]).toBe(father)
    })
})
