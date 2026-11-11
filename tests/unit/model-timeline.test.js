/**
 * Tests for the ancestor-timeline use-case layer (issue #14 story 9): the
 * ancestor chain is assembled from the DERIVED reads (parentsOf/eventsForPerson),
 * every row names a role and its evidence, estimated dates are distinguishable
 * from asserted ones, conflicting sources BOTH survive as separate rows, a
 * DEER v1 person whose only parentage is hasFather/hasMother still gets a
 * timeline, and events with no usable year are surfaced rather than dropped.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { saveBirth } from '../../js/model/birth.js'
import { assert } from '../../js/model/assertions.js'
import { createEvent, participate } from '../../js/model/events.js'
import { loadAncestorTimeline, classifyDate } from '../../js/model/timeline.js'
import { NV, SCHEMA } from '../../js/model/vocabulary.js'
import { convertLegacyEntity } from '../../js/adapters/legacy.js'

const BASE = 'https://devstore.rerum.io/v1/id/'

async function seedBirth(options = {}) {
    const store = createMemoryStore()
    const result = await saveBirth({
        store,
        name: { given: 'Ada', family: 'Gordon' },
        birthDate: '1815-12-10',
        evidence: { title: 'Parish register' },
        participants: [{ role: 'mother', name: { given: 'Anne' } }],
        ...options
    })
    return { store, result }
}

describe('classifyDate', () => {
    test('a full recorded date is asserted, not estimated', () => {
        expect(classifyDate('1815-12-10')).toMatchObject({ year: 1815, precision: 'day', estimated: false })
    })

    test('estimate hedges are recognised and keep the raw display text', () => {
        for (const value of ['c. 1798', 'circa 1798', 'abt 1798', 'about 1798', 'approx. 1798']) {
            const classified = classifyDate(value)
            expect(classified, value).toMatchObject({ year: 1798, estimated: true, display: value })
        }
    })

    test('a year range plots at its midpoint and keeps its span', () => {
        expect(classifyDate('1780-1790')).toMatchObject({ year: 1785, precision: 'range', span: [1780, 1790] })
    })

    test('a value with no year is null so the caller can keep it visibly undated', () => {
        expect(classifyDate('East Indies')).toBeNull()
        expect(classifyDate('')).toBeNull()
        expect(classifyDate(null)).toBeNull()
    })
})

describe('loadAncestorTimeline', () => {
    test('walks the ancestor chain and names role + evidence on every row', async () => {
        const { store, result } = await seedBirth()
        const timeline = await loadAncestorTimeline({ store, personId: result.personId })

        expect(timeline.label).toBe('Ada Gordon')
        expect(timeline.legacy).toBe(false)
        expect(timeline.people).toEqual([
            expect.objectContaining({ id: result.personId, label: 'Ada Gordon', generation: 0, subject: true }),
            expect.objectContaining({ label: 'Anne', generation: 1 })
        ])

        const ada = timeline.items.filter(item => item.personId === result.personId)
        expect(ada).toHaveLength(1)
        expect(ada[0]).toMatchObject({
            display: '1815-12-10',
            year: 1815,
            estimated: false,
            eventId: result.eventId,
            eventSubtype: 'Birth',
            role: NV.child,
            roleLabel: 'child',
            evidenceLabel: 'Parish register'
        })
        // The mother is evidenced at the same Birth event even though the date
        // fact is not hers: her row shows HER role at that sourced assertion.
        const anne = timeline.items.filter(item => item.generation === 1)
        expect(anne).toHaveLength(1)
        expect(anne[0]).toMatchObject({ roleLabel: 'mother', display: '1815-12-10', evidenceLabel: 'Parish register' })
    })

    test('an estimated date is distinguishable from an asserted one', async () => {
        const { store, result } = await seedBirth()
        await store.create({ '@id': `${BASE}bible`, '@type': 'Record', label: 'Family bible' })
        await assert({
            store, target: result.personId, property: SCHEMA.birthDate,
            value: 'c. 1815', evidence: `${BASE}bible`, confidence: 0.4
        })
        const timeline = await loadAncestorTimeline({ store, personId: result.personId })
        const adaItems = timeline.items.filter(item => item.personId === result.personId)
        const asserted = adaItems.find(item => item.display === '1815-12-10')
        const estimated = adaItems.find(item => item.display === 'c. 1815')
        expect(asserted.estimated).toBe(false)
        expect(estimated.estimated).toBe(true)
        expect(estimated.estimatedNote).toMatch(/hedge/)
        expect(estimated.evidenceLabel).toBe('Family bible')
    })

    test('two conflicting dates BOTH survive as separate rows', async () => {
        const { store, result } = await seedBirth()
        await store.create({ '@id': `${BASE}census`, '@type': 'Record', label: 'Census return' })
        await assert({
            store, target: result.personId, property: SCHEMA.birthDate,
            value: '1817', evidence: `${BASE}census`, confidence: 0.3
        })
        const timeline = await loadAncestorTimeline({ store, personId: result.personId })
        const dates = timeline.items
            .filter(item => item.personId === result.personId && item.eventId === result.eventId)
            .map(item => `${item.display}|${item.evidenceLabel}`)
        expect(dates).toContain('1815-12-10|Parish register')
        expect(dates).toContain('1817|Census return')
    })

    test('a Baptism with no recorded birth date estimates the birth year', async () => {
        const store = createMemoryStore()
        await store.create({ '@id': `${BASE}reg`, '@type': 'Record', label: 'Baptism register' })
        const event = await createEvent({ store, subtype: 'Baptism', evidence: `${BASE}reg` })
        await store.create({ '@id': `${BASE}child`, '@type': 'Person', label: 'Baptised Child' })
        await participate({ store, event: event['@id'], agent: `${BASE}child`, role: NV.child })
        await assert({ store, target: event['@id'], property: SCHEMA.birthDate, value: '1801-02-03' })
        const timeline = await loadAncestorTimeline({ store, personId: `${BASE}child` })
        const item = timeline.items.find(row => row.eventSubtype === 'Baptism')
        expect(item).toBeTruthy()
        expect(item.estimated).toBe(true)
        expect(item.estimatedNote).toMatch(/Baptism/)
    })

    test('a DEER v1 person with only hasFather/hasMother still gets a timeline', async () => {
        const store = createMemoryStore()
        const v1docs = [
            { '@id': `${BASE}p1`, '@type': 'Person', name: 'Old Person', hasFather: `${BASE}fa`, hasMother: `${BASE}mo` },
            { '@id': `${BASE}fa`, '@type': 'Person', name: 'Old Father' },
            { '@id': `${BASE}mo`, '@type': 'Person', name: 'Old Mother' },
            { '@id': `${BASE}rec`, '@type': 'Record', label: 'Old parish register' },
            { '@id': `${BASE}ev`, '@type': 'Birth', hasAgent: `${BASE}p1`, birthDate: '1801-03-04', evidence: `${BASE}rec` }
        ]
        for (const doc of v1docs) {
            for (const converted of convertLegacyEntity(doc)) await store.create(converted)
        }
        const timeline = await loadAncestorTimeline({ store, personId: `${BASE}p1` })
        expect(timeline.legacy).toBe(true)
        expect(timeline.people.map(person => person.label)).toEqual(
            expect.arrayContaining(['Old Person', 'Old Father', 'Old Mother']))
        expect(timeline.people.find(p => p.label === 'Old Father').generation).toBe(1)
        const item = timeline.items.find(row => row.personId === `${BASE}p1`)
        expect(item).toMatchObject({ display: '1801-03-04', year: 1801, roleLabel: 'child', evidenceLabel: 'Old parish register' })
    })

    test('events without a usable year are listed, not silently dropped', async () => {
        const { store, result } = await seedBirth()
        await store.create({ '@id': `${BASE}mig`, '@type': ['Event', 'https://cubap.github.io/Genealogger/nv#Census'], label: 'Emigration' })
        await participate({ store, event: `${BASE}mig`, agent: result.personId, role: NV.child })
        await assert({ store, target: `${BASE}mig`, property: SCHEMA.birthDate, value: 'not recorded' })
        const timeline = await loadAncestorTimeline({ store, personId: result.personId })
        const entry = timeline.undated.find(row => row.eventId === `${BASE}mig`)
        expect(entry).toBeTruthy()
        expect(entry.display).toBe('not recorded')
    })

    test('requires a personId', async () => {
        await expect(loadAncestorTimeline({ store: createMemoryStore() })).rejects.toThrow(TypeError)
    })
})
