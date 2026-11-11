/**
 * Tests for the store adapters: memory-store CRUD + query semantics and the
 * fixture-store's shipped sample-family fixture.
 */

import { createMemoryStore, MemoryStore } from '../../js/adapters/memory-store.js'
import { createFixtureStore } from '../../js/adapters/fixture-store.js'
import { STORE_METHODS, assertStore } from '../../js/adapters/store.js'
import { SCHEMA, NV } from '../../js/model/vocabulary.js'

const ADA = 'https://devstore.rerum.io/v1/id/fixture-person-ada'
const BIRTH_DATE = SCHEMA.birthDate

describe('MemoryStore contract', () => {
    test('exposes every documented store method', () => {
        const store = createMemoryStore()
        for (const method of STORE_METHODS) {
            expect(typeof store[method]).toBe('function')
        }
        expect(store).toBeInstanceOf(MemoryStore)
    })

    test('assertStore rejects incomplete implementations', () => {
        expect(() => assertStore({ create() {} })).toThrow(TypeError)
        expect(() => assertStore(null)).toThrow(TypeError)
    })
})

describe('MemoryStore CRUD', () => {
    test('create mints an @id when absent', () => {
        const store = createMemoryStore()
        const doc = store.create({ '@type': 'Person', label: 'X' })
        expect(doc['@id']).toMatch(/^https:\/\/devstore\.rerum\.io\/v1\/id\/[0-9a-f-]+$/)
    })

    test('create preserves a supplied @id and rejects duplicates', () => {
        const store = createMemoryStore()
        store.create({ '@id': 'https://example.org/a', '@type': 'Person' })
        expect(() => store.create({ '@id': 'https://example.org/a' })).toThrow(/already exists/)
    })

    test('read returns null for unknown ids and copies, not references', () => {
        const store = createMemoryStore()
        expect(store.read('https://example.org/missing')).toBeNull()
        const created = store.create({ '@type': 'Person', label: 'X' })
        const again = store.read(created['@id'])
        again.label = 'mutated'
        expect(store.read(created['@id']).label).toBe('X')
    })

    test('update replaces a document and refuses unknown ids', () => {
        const store = createMemoryStore()
        const created = store.create({ '@type': 'Person', label: 'X' })
        store.update({ ...created, label: 'Y' })
        expect(store.read(created['@id']).label).toBe('Y')
        expect(() => store.update({ '@id': 'https://example.org/nope' })).toThrow(/existing/)
    })

    test('remove deletes and reports whether anything went away', () => {
        const store = createMemoryStore()
        const created = store.create({ '@type': 'Person', label: 'X' })
        expect(store.remove(created['@id'])).toBe(true)
        expect(store.remove(created['@id'])).toBe(false)
    })
})

describe('MemoryStore queries', () => {
    test('listByType matches plain and array @type values', () => {
        const store = createMemoryStore()
        store.create({ '@type': 'Person', label: 'p' })
        store.create({ '@type': ['Event', NV.hasParent.replace('hasParent', 'Birth')], label: 'e' })
        store.create({ type: 'Annotation', target: 't', body: {} })
        expect(store.listByType('Person')).toHaveLength(1)
        expect(store.listByType('Event')).toHaveLength(1)
    })

    test('query filters annotations by target, property type, and value', () => {
        const store = createMemoryStore()
        store.create({
            type: 'Annotation',
            target: 'https://example.org/p1',
            body: { [BIRTH_DATE]: { value: '1815-12-10' } }
        })
        store.create({
            type: 'Annotation',
            target: 'https://example.org/p2',
            body: { [BIRTH_DATE]: { value: '1817' } }
        })
        expect(store.query({ target: 'https://example.org/p1' })).toHaveLength(1)
        expect(store.query({ type: BIRTH_DATE })).toHaveLength(2)
        expect(store.query({ type: BIRTH_DATE, value: '1817' })).toHaveLength(1)
        expect(store.query({ target: 'https://example.org/p2', value: '1817' })).toHaveLength(1)
        expect(store.query({ target: 'https://example.org/p2', value: '1815-12-10' })).toHaveLength(0)
        expect(store.query({})).toHaveLength(2)
    })

    test('queries skip entity documents', () => {
        const store = createMemoryStore()
        store.create({ '@type': 'Person', label: 'not an annotation' })
        expect(store.query({})).toHaveLength(0)
    })
})

describe('FixtureStore', () => {
    test('loads the shipped sample-family fixture by default', () => {
        const store = createFixtureStore()
        const people = store.listByType('Person')
        expect(people.map(p => p['@id'])).toContain(ADA)
    })

    test('the fixture encodes a conflicting-evidence scenario that coexists', () => {
        const store = createFixtureStore()
        const dates = store.query({ target: ADA, type: BIRTH_DATE })
            .flatMap(a => [a.body[BIRTH_DATE]])
            .map(vo => vo.value)
        expect(dates.sort()).toEqual(['1815-12-10', '1817'])
    })

    test('accepts a custom document array', () => {
        const store = createFixtureStore([{ '@id': 'https://example.org/only', '@type': 'Person' }])
        expect(store.read('https://example.org/only')).not.toBeNull()
        expect(store.listByType('Person')).toHaveLength(1)
    })
})
