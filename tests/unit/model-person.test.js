/**
 * Tests for the bare Person entity + assembled Person view (js/model).
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { readDevstoreJson } from '../../js/adapters/legacy.js'
import { createPerson, readEntity } from '../../js/model/entities.js'
import { getPerson, loadPerson, assertPersonName } from '../../js/model/person.js'
import { assert as assertAnnotation } from '../../js/model/assertions.js'
import { deriveLabel, UNLABELED } from '../../js/model/search.js'
import { SCHEMA, NV, NV_NAME_TYPE, NV_ACTIVE_FROM, NV_ACTIVE_TO } from '../../js/model/vocabulary.js'
import config from '../../js/model/config.js'

// A DEER v1 Person: facts written directly on the entity document. Feeding the
// real adapter (readDevstoreJson) keeps this fixture honest about the shape.
const LEGACY_ID = 'https://devstore.rerum.io/v1/abc123'

const legacyPersonDoc = {
    '@context': 'https://devstore.rerum.io/v1/context.json',
    '@id': LEGACY_ID,
    '@type': 'Person',
    name: 'Ada Gordon',
    givenName: 'Ada',
    familyName: 'Gordon',
    birthDate: '1815-12-10',
    gender: 'female',
    hasFather: 'https://devstore.rerum.io/v1/father1',
    hasAgent: LEGACY_ID,
    evidence: 'https://devstore.rerum.io/v1/rec999',
    __rerum: { modified: '2023-01-01T00:00:00Z', target: null }
}

const legacyAnnotationDoc = {
    '@id': 'https://devstore.rerum.io/v1/anno1',
    type: 'Annotation',
    target: LEGACY_ID,
    body: { birthPlace: { value: 'London', name: 'stated on certificate' } },
    creator: 'deer-form',
    motivation: 'linking'
}

describe('createPerson', () => {
    test('mints a bare Person with @id, @type, and label', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada Gordon' })
        expect(person['@id']).toMatch(/^https:\/\/devstore\.rerum\.io\/v1\/id\//)
        expect(person['@id'].startsWith(config.ID_BASE)).toBe(true)
        expect(person['@type']).toBe('Person')
        expect(person.label).toBe('Ada Gordon')
    })

    test('rejects a person without a label', async () => {
        const store = createMemoryStore()
        await expect(createPerson({ store })).rejects.toThrow(TypeError)
    })

    test('readEntity resolves the stored bare document', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada Gordon' })
        const again = await readEntity({ store, id: person['@id'] })
        expect(again).toEqual(person)
    })
})

describe('getPerson assembled view', () => {
    test('includes the label assertion as a ValueObject with evidence', async () => {
        const store = createMemoryStore()
        const person = await createPerson({
            store,
            label: 'Ada Gordon',
            evidence: 'https://devstore.rerum.io/v1/id/cert-1',
            confidence: 0.9
        })
        const view = await getPerson({ store, id: person['@id'] })
        expect(view).not.toBeNull()
        expect(view.label).toBe('Ada Gordon')
        expect(view.assertions.label.value).toBe('Ada Gordon')
        expect(view.assertions.label.evidence).toBe('https://devstore.rerum.io/v1/id/cert-1')
        expect(view.assertions.label['https://cubap.github.io/Genealogger/nv#confidence']).toBe(0.9)
    })

    test('groups added assertions by property and keeps derived link arrays', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        await assertAnnotation({
            store,
            target: person['@id'],
            property: SCHEMA.birthDate,
            value: '1815-12-10',
            evidence: 'https://devstore.rerum.io/v1/id/cert-1'
        })
        const view = await getPerson({ store, id: person['@id'] })
        expect(view.assertions[SCHEMA.birthDate].value).toBe('1815-12-10')
        expect(view.parents).toEqual([])
        expect(view.children).toEqual([])
        expect(view.lacunae).toEqual([])
    })

    test('returns null for unknown ids and non-Person types', async () => {
        const store = createMemoryStore()
        expect(await getPerson({ store, id: 'https://nowhere/1' })).toBeNull()
        const event = await store.create({ '@type': 'Event', label: 'Just an event' })
        expect(await getPerson({ store, id: event['@id'] })).toBeNull()
    })
})

describe('one label rule (search.personLabel)', () => {
    test('name-part assertions label the page while a list still sees the person as unlabeled', async () => {
        const store = createMemoryStore()
        // No bare `label` at all: identity only, as the model requires.
        const person = await store.create({ '@id': `${config.ID_BASE}id/parts-1`, '@type': 'Person' })
        await assertAnnotation({ store, target: person['@id'], property: SCHEMA.givenName, value: 'Ada' })
        await assertAnnotation({ store, target: person['@id'], property: SCHEMA.familyName, value: 'Gordon' })

        const view = await getPerson({ store, id: person['@id'] })
        expect(view.label).toBe('Ada Gordon')
        // The same entity through the list's view of the rule: a list cannot read
        // annotations, so it must not claim a name the page had to work for.
        expect(deriveLabel(view.entity)).toBe(UNLABELED)
    })

    test('asserting a full name refreshes the bare label a list reads', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        await assertPersonName({
            store,
            personId: person['@id'],
            value: 'Ada Gordon',
            evidence: { title: 'Parish register' }
        })
        const again = await readEntity({ store, id: person['@id'] })
        expect(again.label).toBe('Ada Gordon')
        expect(deriveLabel(again)).toBe('Ada Gordon')
    })

    test('asserting a name part does not overwrite the summary label', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada Gordon' })
        await assertPersonName({
            store,
            personId: person['@id'],
            value: 'Byron',
            property: SCHEMA.familyName,
            evidence: { title: 'Marriage licence' }
        })
        const again = await readEntity({ store, id: person['@id'] })
        expect(again.label).toBe('Ada Gordon')
    })

    test('asserting a name onto a DEER v1 person never rewrites its document', async () => {
        const inner = createMemoryStore()
        const updates = []
        const store = {
            create: doc => inner.create(doc),
            read: id => inner.read(id),
            update: doc => { updates.push(doc); return inner.update(doc) },
            remove: id => inner.remove(id),
            listByType: type => inner.listByType(type),
            all: () => inner.all(),
            query: filter => inner.query(filter)
        }
        for (const doc of readDevstoreJson([legacyPersonDoc, legacyAnnotationDoc])) {
            await store.create(doc)
        }
        await assertPersonName({
            store,
            personId: LEGACY_ID,
            value: 'Ada Byron',
            evidence: { title: 'Family bible' }
        })
        // The v1 facts may live inside the v1 document itself, and lazy migration
        // is the owning page's job, so a name write only ever ADDS an annotation.
        expect(updates).toEqual([])
        const page = await loadPerson({ store, personId: LEGACY_ID })
        expect(page.legacy).toBe(true)
        // The v1 `name` folds into the bare label; the new claim stands beside it.
        expect(page.assertions[SCHEMA.name].value).toBe('Ada Byron')
        expect(page.label).toBe('Ada Gordon')
    })
})

describe('assertPersonName: add any name as an annotated assertion', () => {
    test('a name with a type and an active range round-trips through the memory store', async () => {
        const store = createMemoryStore()
        const { personId, recordId } = await assertPersonName({
            store,
            value: 'Margaret Doyle',
            nameType: 'married name',
            activeFrom: '1880-01-01',
            activeTo: '1901-12-31',
            confidence: 0.8,
            evidence: { title: 'Census of 1881' }
        })
        const page = await loadPerson({ store, personId })
        const vo = page.assertions[SCHEMA.name]
        expect(vo.value).toBe('Margaret Doyle')
        expect(vo[NV_NAME_TYPE].value).toBe('married name')
        expect(vo[NV_ACTIVE_FROM].value).toBe('1880-01-01')
        expect(vo[NV_ACTIVE_TO].value).toBe('1901-12-31')
        expect(vo.evidence).toBe(recordId)
        expect(page.evidenceLabels[recordId]).toBe('Census of 1881')
        expect(page.label).toBe('Margaret Doyle')
    })

    test('with no person id the page is the New Person target: a Person is minted', async () => {
        const store = createMemoryStore()
        const { personId } = await assertPersonName({
            store,
            value: 'Ada Gordon',
            evidence: { title: 'Birth certificate' }
        })
        const page = await loadPerson({ store, personId })
        expect(page.view.entity['@type']).toBe('Person')
        expect(page.legacy).toBe(false)
    })

    test('a second source that disagrees adds a second assertion instead of merging', async () => {
        const store = createMemoryStore()
        const first = await assertPersonName({ store, value: 'Margaret Doyle', evidence: { title: 'Birth register' } })
        const second = await assertPersonName({
            store,
            personId: first.personId,
            value: 'Maggie Doyle-Smith',
            nameType: 'married name',
            evidence: { title: 'Marriage register' }
        })
        const page = await loadPerson({ store, personId: first.personId })
        const names = page.assertions[SCHEMA.name]
        expect(names).toHaveLength(2)
        expect(names.map(vo => vo.value)).toEqual(['Margaret Doyle', 'Maggie Doyle-Smith'])
        expect(new Set(names.map(vo => vo.evidence)).size).toBe(2)
        expect(second.annotationId).toBeTruthy()
    })

    test('rejects an empty name, unnamed evidence, an unnameable property and a reversed range', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        const before = await store.query({ target: person['@id'] })
        const base = { store, personId: person['@id'], evidence: { title: 'Record' } }
        await expect(assertPersonName({ ...base, value: '   ' })).rejects.toThrow(TypeError)
        await expect(assertPersonName({ ...base, value: 'Ada', evidence: {} })).rejects.toThrow(TypeError)
        await expect(assertPersonName({ ...base, value: 'Ada', property: SCHEMA.birthDate })).rejects.toThrow(TypeError)
        await expect(assertPersonName({
            ...base, value: 'Ada', activeFrom: '1901-01-01', activeTo: '1900-01-01'
        })).rejects.toThrow(RangeError)
        // A rejected write leaves nothing half-written behind.
        expect(await store.query({ target: person['@id'] })).toHaveLength(before.length)
    })
})

describe('loadPerson: the audit view without a per-row fan-out', () => {
    test('a DEER v1 person opens, flagged legacy, with its facts readable', async () => {
        const store = createMemoryStore()
        for (const doc of readDevstoreJson([legacyPersonDoc, legacyAnnotationDoc])) {
            await store.create(doc)
        }
        const page = await loadPerson({ store, personId: LEGACY_ID })
        expect(page.legacy).toBe(true)
        expect(page.label).toBe('Ada Gordon')
        expect(page.assertions[SCHEMA.birthDate].value).toBe('1815-12-10')
        expect(page.assertions[SCHEMA.givenName].value).toBe('Ada')
        // The v1 `hasFather` link survives as an assertion whose target document
        // is not in this store; the row still names the id it points at.
        expect(page.parents).toHaveLength(1)
        expect(page.personLabels['https://devstore.rerum.io/v1/father1']).toBe('https://devstore.rerum.io/v1/father1')
    })

    test('one read per distinct id, not one per assertion row, and no untargeted query', async () => {
        const inner = createMemoryStore()
        const reads = []
        const queries = []
        const store = {
            create: doc => inner.create(doc),
            read: id => { reads.push(id); return inner.read(id) },
            update: doc => inner.update(doc),
            remove: id => inner.remove(id),
            listByType: type => inner.listByType(type),
            all: () => inner.all(),
            query: filter => {
                queries.push(filter)
                if (!filter.target && !filter.rel) {
                    throw new TypeError('query() without target or rel scans every document')
                }
                return inner.query(filter)
            }
        }
        const person = await createPerson({ store, label: 'Ada' })
        const parent = await createPerson({ store, label: 'William' })
        const record = await store.create({ '@id': `${config.ID_BASE}id/one-record`, '@type': 'Record', label: 'Parish register' })
        for (const [property, value] of [
            [SCHEMA.givenName, 'Ada'], [SCHEMA.familyName, 'Gordon'],
            [SCHEMA.birthDate, '1815-12-10'], [SCHEMA.birthPlace, 'London']
        ]) {
            await assertAnnotation({ store, target: person['@id'], property, value, evidence: record['@id'] })
        }
        await assertAnnotation({ store, target: person['@id'], property: NV.hasParent, value: parent['@id'], evidence: record['@id'] })

        const page = await loadPerson({ store, personId: person['@id'] })
        // Six assertion rows (createPerson's own label claim included), but the
        // person + the shared record + the parent: one read per distinct id.
        expect(Object.keys(page.assertions)).toHaveLength(6)
        expect([...new Set(reads)].sort()).toEqual([parent['@id'], person['@id'], record['@id']].sort())
        expect(reads).toHaveLength(3)
        expect(queries.length).toBeGreaterThan(0)
    })
})
