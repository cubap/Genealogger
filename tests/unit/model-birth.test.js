/**
 * Tests for the birth use-case layer: the orchestration that turns form data into
 * a Person + Birth Event + evidence-backed assertions, records parents as
 * participants-with-roles, derives nv:hasParent, keeps conflicting sources as
 * separate assertions, and honours the nv:hasChild-computed-never-stored rule.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { saveBirth, loadBirth } from '../../js/model/birth.js'
import { childrenOf } from '../../js/model/search.js'
import { NV, SCHEMA } from '../../js/model/vocabulary.js'

const HAS_CHILD = 'https://cubap.github.io/Genealogger/nv#hasChild'

async function seed(options) {
    const store = createMemoryStore()
    const result = await saveBirth({ store, ...options })
    return { store, result }
}

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
})
