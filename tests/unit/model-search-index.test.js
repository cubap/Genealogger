/**
 * Tests for the index/picker read path added for issue #14 (stories 1, 2, 11):
 * label DERIVATION from bare identity data, the query-building/matching rules,
 * and `listPersons()`.
 *
 * The load-bearing invariant is user story 1: a long list must render from ONE
 * identity read. The "counts queries" test asserts `listPersons()` never calls
 * `query()` or `read()`, which is what keeps a thousand people cheap.
 */

import {
    deriveLabel,
    normalizeQuery,
    matchesQuery,
    listPersons,
    UNLABELED
} from '../../js/model/search.js'
import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { createFixtureStore } from '../../js/adapters/fixture-store.js'
import { resetDefaultStore } from '../../js/model/default-store.js'
import { SCHEMA, TYPES } from '../../js/model/vocabulary.js'

const ID = 'https://devstore.rerum.io/v1/id/person-'

function person(id, extra = {}) {
    return { '@id': ID + id, '@type': TYPES.Person, ...extra }
}

/**
 * Wraps a store and counts every method call, so a test can prove the list read
 * stays a single `listByType` and resolves no annotation.
 */
function countingStore(inner) {
    const calls = { listByType: 0, query: 0, read: 0 }
    return {
        calls,
        listByType: type => {
            calls.listByType++
            return inner.listByType(type)
        },
        query: filter => {
            calls.query++
            return inner.query(filter)
        },
        read: id => {
            calls.read++
            return inner.read(id)
        }
    }
}

describe('deriveLabel', () => {
    test('uses the bare label the store already carries', () => {
        expect(deriveLabel(person('ada', { label: 'Ada Gordon' }))).toBe('Ada Gordon')
    })

    test('falls back to name when no label is present', () => {
        expect(deriveLabel(person('ada', { name: 'Ada Byron' }))).toBe('Ada Byron')
    })

    test('joins schema.org name parts when there is no label or name', () => {
        const entity = person('ada', {
            [SCHEMA.givenName]: 'Ada',
            [SCHEMA.additionalName]: 'Byron',
            [SCHEMA.familyName]: 'Gordon'
        })
        expect(deriveLabel(entity)).toBe('Ada Byron Gordon')
    })

    test('reads bare DEER v1 name keys on migrated documents', () => {
        expect(deriveLabel(person('ada', { givenName: 'Ada', familyName: 'Gordon' })))
            .toBe('Ada Gordon')
    })

    test('unwraps ValueObject-shaped and array identity data', () => {
        expect(deriveLabel(person('ada', { label: { value: 'Ada Gordon' } }))).toBe('Ada Gordon')
        expect(deriveLabel(person('ada', { [SCHEMA.givenName]: ['Ada', 'Alice'] }))).toBe('Ada Alice')
    })

    test('has a stable placeholder for a person with nothing displayable', () => {
        expect(deriveLabel(person('blank'))).toBe(UNLABELED)
        expect(deriveLabel(person('blank', { label: '   ' }))).toBe(UNLABELED)
        expect(deriveLabel(null)).toBe(UNLABELED)
        expect(deriveLabel(undefined)).toBe(UNLABELED)
    })

    test('never resolves an annotation — extra keys are ignored', () => {
        const entity = person('ada', { label: 'Ada Gordon', body: { [SCHEMA.birthDate]: 'ignored' } })
        expect(deriveLabel(entity)).toBe('Ada Gordon')
    })
})

describe('normalizeQuery', () => {
    test('lowercases, trims and splits on whitespace', () => {
        expect(normalizeQuery('  ADA   Gordon ')).toEqual(['ada', 'gordon'])
    })

    test('empty input yields no tokens', () => {
        expect(normalizeQuery('')).toEqual([])
        expect(normalizeQuery('   ')).toEqual([])
        expect(normalizeQuery(null)).toEqual([])
        expect(normalizeQuery(undefined)).toEqual([])
    })
})

describe('matchesQuery', () => {
    test('an empty query matches everything, including blank labels', () => {
        expect(matchesQuery('Ada Gordon', '')).toBe(true)
        expect(matchesQuery('', '')).toBe(true)
        expect(matchesQuery('Ada Gordon', [])).toBe(true)
    })

    test('matching is case-insensitive and substring-based', () => {
        expect(matchesQuery('Ada Gordon', 'gord')).toBe(true)
        expect(matchesQuery('Ada Gordon', 'GORDON')).toBe(true)
        expect(matchesQuery('Ada Gordon', 'byron')).toBe(false)
    })

    test('every token must match, in any order', () => {
        expect(matchesQuery('Ada Gordon', 'gordon ada')).toBe(true)
        expect(matchesQuery('Ada Gordon', 'gordon byron')).toBe(false)
    })

    test('accepts pre-normalized tokens', () => {
        expect(matchesQuery('Ada Gordon', ['ada', 'gor'])).toBe(true)
    })
})

describe('listPersons', () => {
    test('one identity read, and nothing else', async () => {
        const inner = createMemoryStore()
        inner.create(person('ada', { label: 'Ada Gordon' }))
        inner.create(person('george', { label: 'George Gordon' }))
        const counted = countingStore(inner)

        const rows = await listPersons({ store: counted })

        expect(rows).toHaveLength(2)
        expect(counted.calls).toEqual({ listByType: 1, query: 0, read: 0 })
    })

    test('returns id + derived label + the bare entity per row', async () => {
        const store = createMemoryStore()
        const created = store.create(person('ada', { label: 'Ada Gordon' }))
        const rows = await listPersons({ store })
        expect(rows).toEqual([
            { id: created['@id'], label: 'Ada Gordon', entity: expect.objectContaining({ '@id': created['@id'] }) }
        ])
    })

    test('sorts by label so a long list is deterministic', async () => {
        const store = createMemoryStore()
        for (const label of ['Zoe Smith', 'ada Gordon', 'Anne Milbanke']) {
            store.create(person(label, { label }))
        }
        const rows = await listPersons({ store })
        expect(rows.map(row => row.label)).toEqual(['ada Gordon', 'Anne Milbanke', 'Zoe Smith'])
    })

    test('keeps insertion order when sorting is declined', async () => {
        const store = createMemoryStore()
        store.create(person('zoe', { label: 'Zoe Smith' }))
        store.create(person('ada', { label: 'Ada Gordon' }))
        const rows = await listPersons({ store, sort: false })
        expect(rows.map(row => row.label)).toEqual(['Zoe Smith', 'Ada Gordon'])
    })

    test('filters through the model, not the DOM', async () => {
        const store = createMemoryStore()
        for (const label of ['Ada Gordon', 'George Gordon', 'Anne Milbanke']) {
            store.create(person(label, { label }))
        }
        const rows = await listPersons({ store, query: 'gordon' })
        expect(rows.map(row => row.label).sort()).toEqual(['Ada Gordon', 'George Gordon'])
        expect(await listPersons({ store, query: 'nobody here' })).toEqual([])
    })

    test('lists only Persons, ignoring events and records', async () => {
        const store = createMemoryStore()
        store.create(person('ada', { label: 'Ada Gordon' }))
        store.create({ '@id': ID + 'event', '@type': 'Event', label: 'Birth of Ada' })
        store.create({ '@id': ID + 'rec', '@type': TYPES.Record, label: 'Parish certificate' })
        const rows = await listPersons({ store })
        expect(rows.map(row => row.label)).toEqual(['Ada Gordon'])
    })

    test('derives labels for identity-only people and placeholders for bare ones', async () => {
        const store = createMemoryStore()
        store.create(person('parts', { [SCHEMA.givenName]: 'Ada', [SCHEMA.familyName]: 'Byron' }))
        store.create(person('bare'))
        const rows = await listPersons({ store })
        expect(rows.map(row => row.label)).toEqual([UNLABELED, 'Ada Byron'])
    })

    test('falls back to the default store when none is passed', async () => {
        const store = createMemoryStore()
        store.create(person('ada', { label: 'Ada Gordon' }))
        resetDefaultStore(store)
        try {
            const rows = await listPersons()
            expect(rows.map(row => row.label)).toEqual(['Ada Gordon'])
        } finally {
            resetDefaultStore()
        }
    })

    test('reads the shipped fixture family', async () => {
        const rows = await listPersons({ store: createFixtureStore() })
        expect(rows.map(row => row.label)).toEqual(['Ada Gordon', 'Anne Milbanke', 'George Gordon'])
    })
})
