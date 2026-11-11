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
    personLabel,
    normalizeQuery,
    matchesQuery,
    listPersons,
    eventsForPerson,
    UNLABELED
} from '../../js/model/search.js'
import { participate } from '../../js/model/events.js'
import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { createFixtureStore } from '../../js/adapters/fixture-store.js'
import { resetDefaultStore } from '../../js/model/default-store.js'
import { NV, SCHEMA, TYPES } from '../../js/model/vocabulary.js'

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
        create: doc => inner.create(doc),
        update: doc => inner.update(doc),
        remove: id => inner.remove(id),
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

describe('personLabel', () => {
    test('names a person from assertions when the entity carries no identity', () => {
        // The detail-page shape: identity lives in annotations, not on the doc.
        expect(personLabel({
            entity: person('blank'),
            assertions: { [SCHEMA.givenName]: { value: 'Ada' }, [SCHEMA.familyName]: { value: 'Gordon' } }
        })).toBe('Ada Gordon')
    })

    test('uses an asserted full name when there is no label or name', () => {
        expect(personLabel({
            entity: person('blank'),
            assertions: { [SCHEMA.name]: { value: 'Ada Byron Gordon' } }
        })).toBe('Ada Byron Gordon')
    })

    test('the denormalized bare label still outranks an assertion', () => {
        // Lists cannot see annotations, so the bare label is the cache every
        // surface agrees on; a write that asserts a new name must refresh it.
        expect(personLabel({
            entity: person('ada', { label: 'Ada Gordon' }),
            assertions: { [SCHEMA.name]: { value: 'Ada Byron' } }
        })).toBe('Ada Gordon')
    })

    test('shows one of several conflicting assertions instead of joining them', () => {
        expect(personLabel({
            entity: person('blank'),
            assertions: {
                [SCHEMA.givenName]: [{ value: 'Ada' }, { value: 'Alice' }],
                [SCHEMA.familyName]: { value: 'Gordon' }
            }
        })).toBe('Ada Gordon')
    })

    test('an asserted name part beats a bare one on the entity', () => {
        expect(personLabel({
            entity: person('ada', { [SCHEMA.givenName]: 'Old', [SCHEMA.familyName]: 'Gordon' }),
            assertions: { [SCHEMA.givenName]: { value: 'New' } }
        })).toBe('New Gordon')
    })

    test('reads a legacy bare `label` annotation off a migrated person', () => {
        expect(personLabel({
            entity: person('blank'),
            assertions: { label: { value: 'Ada G.' } }
        })).toBe('Ada G.')
    })

    test('is UNLABELED when assertions exist but say nothing displayable', () => {
        expect(personLabel({ entity: person('blank'), assertions: {} })).toBe(UNLABELED)
        expect(personLabel({ entity: person('blank'), assertions: { [NV.Lacuna]: { value: '' } } }))
            .toBe(UNLABELED)
    })

    test('deriveLabel is personLabel with no assertions, so no surface diverges', () => {
        const entity = person('ada', {
            [SCHEMA.givenName]: 'Ada',
            [SCHEMA.additionalName]: 'Byron',
            [SCHEMA.familyName]: 'Gordon'
        })
        expect(deriveLabel(entity)).toBe(personLabel({ entity }))
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

    test('works against a store as strict as live devstore', async () => {
        // docs/devstore-query-contract.md: RerumStore.query() THROWS without a
        // target or a rel, because devstore cannot filter a dotted body path.
        // The index is held to more than that: it filters the bounded identity
        // read client-side, so it must not query or read per row AT ALL (story 1).
        // This fake therefore refuses every query()/read(), which is stricter
        // than the server and fails loudly if a future edit reaches for either.
        const strict = {
            listByType: () => [person('ada', { label: 'Ada Gordon' }), person('anne', { label: 'Anne Milbanke' })],
            query: () => { throw new TypeError('query() requires a target or a rel') },
            read: () => { throw new Error('the list must not read entities') }
        }

        await expect(listPersons({ store: strict })).resolves.toHaveLength(2)
        await expect(listPersons({ store: strict, query: 'gordon' })).resolves.toHaveLength(1)
        await expect(listPersons({ store: strict, query: 'nobody' })).resolves.toHaveLength(0)
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

describe('eventsForPerson legacyTypes (documents written before the rel index)', () => {
    const EVENT = 'https://devstore.rerum.io/v1/BIRTHEVENT'

    /**
     * A DEER v1 birth/death document and its `hasAgent` participation, exactly as
     * model/search sees them AFTER the legacy reader has exploded them: a bare
     * entity typed with the v1 name plus an annotation carrying NO top-level rel,
     * so the `rel: personId` lookup cannot find it (docs/devstore-query-contract.md).
     */
    async function seedUnindexedParticipation(store, personId, role = NV.child) {
        await store.create({ '@id': EVENT, '@type': 'Birth', label: 'Parish register' })
        await store.create({
            '@id': `${EVENT}#legacy-agent-0`,
            type: 'Annotation',
            target: EVENT,
            body: { [NV.participant]: { value: personId }, [NV.role]: { value: role } }
        })
        return EVENT
    }

    test('enumerates the named types when the rel index comes back empty', async () => {
        const store = createMemoryStore()
        const ada = person('ada', { label: 'Ada Byron' })
        await store.create(ada)
        await seedUnindexedParticipation(store, ada['@id'])

        const events = await eventsForPerson({
            store,
            personId: ada['@id'],
            role: NV.child,
            legacyTypes: ['Birth']
        })
        expect(events.map(event => event['@id'])).toEqual([EVENT])
    })

    test('the scan honours the role, so a witness is not a subject', async () => {
        const store = createMemoryStore()
        const ada = person('ada', { label: 'Ada Byron' })
        await store.create(ada)
        await seedUnindexedParticipation(store, ada['@id'], NV.mother)

        const events = await eventsForPerson({
            store,
            personId: ada['@id'],
            role: NV.child,
            legacyTypes: ['Birth']
        })
        expect(events).toEqual([])
    })

    test('an indexed participation is still a single query: no type is enumerated', async () => {
        const inner = createMemoryStore()
        const counted = countingStore(inner)
        const ada = person('ada', { label: 'Ada Byron' })
        await inner.create(ada)
        await inner.create({ '@id': EVENT, '@type': 'Birth', label: 'Parish register' })
        await participate({ store: counted, event: EVENT, agent: ada['@id'], role: NV.child })

        const events = await eventsForPerson({
            store: counted,
            personId: ada['@id'],
            role: NV.child,
            legacyTypes: ['Birth']
        })
        expect(events.map(event => event['@id'])).toEqual([EVENT])
        expect(counted.calls.listByType).toBe(0)
    })

    test('without legacyTypes an un-indexed event stays unreachable (no unbounded scan)', async () => {
        const inner = createMemoryStore()
        const counted = countingStore(inner)
        const ada = person('ada', { label: 'Ada Byron' })
        await inner.create(ada)
        await seedUnindexedParticipation(inner, ada['@id'])

        const events = await eventsForPerson({ store: counted, personId: ada['@id'], role: NV.child })
        expect(events).toEqual([])
        expect(counted.calls.listByType).toBe(0)
    })
})
