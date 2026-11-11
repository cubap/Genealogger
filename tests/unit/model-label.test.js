/**
 * Tests for the label use-case layer — the write side of the naming rule in
 * docs/page-model-adapter.md § "Naming a person". The behaviour under test is
 * observable: what the store holds afterwards (the Person's bare `label` cache
 * and the evidenced name assertions) and what the display/read paths say about
 * that person afterwards. Nothing here pokes at internals.
 *
 * The point of the slice, restated as an assertion: after saveLabel(), a list
 * read (search.deriveLabel of the stored document) and a detail read
 * (search.personLabel, annotations included) must give the SAME string.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { saveLabel, loadLabel, PROPERTY_LABELS } from '../../js/model/label.js'
import { createPerson, LABEL_PROPERTY, FULL_NAME_PROPERTY } from '../../js/model/entities.js'
import { deriveLabel } from '../../js/model/search.js'
import { NV, SCHEMA, TYPES } from '../../js/model/vocabulary.js'

const DCTERMS_SOURCE = 'http://purl.org/dc/terms/source'

/** Flat list of the values asserted for one property, oldest first. */
function claimsOf(loaded, property) {
    const raw = loaded.names[property]
    if (!raw) return []
    return (Array.isArray(raw) ? raw : [raw]).map(vo => vo.value)
}

/** Name annotations the store is holding for a person. */
function nameAssertions(store, personId) {
    return store.query({ target: personId }).filter(anno => anno.body && anno.body[FULL_NAME_PROPERTY])
}

async function seedPerson(label = 'Ada Byron') {
    const store = createMemoryStore()
    const person = await createPerson({ store, label })
    return { store, personId: person['@id'] }
}

describe('saveLabel', () => {
    test('refuses a name with no person, a blank name, or no source', async () => {
        const { store, personId } = await seedPerson()
        await expect(saveLabel({ store, name: 'X', evidence: { title: 'T' } })).rejects.toThrow(TypeError)
        await expect(saveLabel({ store, personId, evidence: { title: 'T' } })).rejects.toThrow(TypeError)
        await expect(saveLabel({ store, personId, name: '   ' })).rejects.toThrow(TypeError)
        await expect(saveLabel({ store, personId, name: 'X', evidence: { id: '', title: '' } })).rejects.toThrow(TypeError)
        // Every rejected call wrote nothing.
        expect(nameAssertions(store, personId)).toHaveLength(0)
    })

    test('reports an unknown person instead of inventing one', async () => {
        const store = createMemoryStore()
        await expect(
            saveLabel({ store, personId: 'https://example.org/nope', name: 'X', evidence: { title: 'T' } })
        ).rejects.toThrow(/no Person/i)
    })

    test('asserts the name AND refreshes the bare label cache', async () => {
        const { store, personId } = await seedPerson()
        const result = await saveLabel({
            store,
            personId,
            name: 'Ada King, Countess of Lovelace',
            evidence: { title: 'Family bible' },
            confidence: 0.9
        })

        expect(result.cacheUpdated).toBe(true)
        expect(result.label).toBe('Ada King, Countess of Lovelace')
        expect(store.read(personId).label).toBe('Ada King, Countess of Lovelace')

        const loaded = await loadLabel({ store, personId: result.personId })
        // The detail string and the list string agree: the invariant this page exists for.
        expect(loaded.label).toBe('Ada King, Countess of Lovelace')
        expect(loaded.listLabel).toBe(loaded.label)
        expect(loaded.cacheStale).toBe(false)
        // ...and the cache did not become the only record: the name is a fact with provenance.
        expect(claimsOf(loaded, FULL_NAME_PROPERTY)).toEqual(['Ada King, Countess of Lovelace'])
        const [claim] = [loaded.names[FULL_NAME_PROPERTY]].flat()
        expect(claim[NV.confidence]).toBe(0.9)
        expect(claim.evidence).toBe(result.recordId)
        expect(loaded.evidenceLabels[claim.evidence]).toBe('Family bible')
    })

    test('skips the cache write when the cache already holds that name', async () => {
        const { store, personId } = await seedPerson()
        const update = vi.spyOn(store, 'update')
        const result = await saveLabel({ store, personId, name: 'Ada Byron', evidence: { title: 'Parish register' } })
        // A no-op PUT would cost a new document version on devstore for nothing.
        expect(result.cacheUpdated).toBe(false)
        expect(result.cacheSkipped).toBe('unchanged')
        expect(update).not.toHaveBeenCalled()
        // The claim is still recorded, because a new source said it.
        expect(claimsOf(await loadLabel({ store, personId }), FULL_NAME_PROPERTY)).toEqual(['Ada Byron'])
    })

    test('re-asserting a name an older source claimed repairs a drifted cache', async () => {
        const { store, personId } = await seedPerson('Ada Byron')
        await saveLabel({ store, personId, name: 'Ada Lovelace', evidence: { title: 'Census 1841' } })
        // The cache now holds one name; a second source repeats the other.
        const result = await saveLabel({ store, personId, name: 'Ada Byron', evidence: { title: 'Wedding register' } })

        // Last recorded name wins, so lists and the detail page show one string.
        expect(result.cacheUpdated).toBe(true)
        const loaded = await loadLabel({ store, personId: result.personId })
        expect(loaded.label).toBe('Ada Byron')
        expect(deriveLabel(store.read(personId))).toBe(loaded.label)
        // Ranking the "best evidenced" name inside a write path is the merging
        // personLabel forbids, so both claims survive rather than one being deleted.
        expect(claimsOf(loaded, FULL_NAME_PROPERTY)).toEqual(['Ada Lovelace', 'Ada Byron'])
    })

    test('two disagreeing sources coexist as two assertions', async () => {
        const { store, personId } = await seedPerson()
        await saveLabel({ store, personId, name: 'Ada Byron', evidence: { title: 'Birth certificate' } })
        await saveLabel({ store, personId, name: 'Ada King', evidence: { title: 'Death certificate' } })

        const loaded = await loadLabel({ store, personId })
        expect(claimsOf(loaded, FULL_NAME_PROPERTY)).toEqual(['Ada Byron', 'Ada King'])
        const evidences = [loaded.names[FULL_NAME_PROPERTY]].flat().map(vo => vo.evidence)
        expect(new Set(evidences).size).toBe(2)
        // Nothing was overwritten in the store either.
        expect(nameAssertions(store, personId)).toHaveLength(2)
    })

    test('reuses the named evidence document instead of duplicating it', async () => {
        const { store, personId } = await seedPerson()
        const record = await store.create({ '@type': TYPES.Record, label: 'Memoir' })
        const result = await saveLabel({ store, personId, name: 'Ada Lovelace', evidence: { id: record['@id'] } })

        expect(result.recordId).toBe(record['@id'])
        expect(store.listByType(TYPES.Record)).toHaveLength(1)
        const asserted = nameAssertions(store, personId)[0].body[FULL_NAME_PROPERTY]
        expect([asserted].flat()[0].evidence).toBe(record['@id'])
    })

    test('adopts the id the store answers an update with', async () => {
        // RerumStore PUTs /update and the live service answers with a NEW document
        // under a NEW @id. So the cache is written BEFORE the assertion and the
        // returned id adopted: the surviving document holds cache and fact together.
        const { store, personId } = await seedPerson()
        let version = 0
        const versioning = Object.create(store)
        versioning.update = async doc => {
            version += 1
            return store.create({ ...doc, '@id': `${doc['@id']}#v${version}` })
        }

        const result = await saveLabel({
            store: versioning,
            personId,
            name: 'Ada Lovelace',
            evidence: { title: 'Memoir' }
        })

        expect(result.personId).toBe(`${personId}#v1`)
        expect(result.cacheUpdated).toBe(true)
        expect(store.read(result.personId).label).toBe('Ada Lovelace')
        // The fact targets the document that now carries the cache, not the superseded one.
        const loaded = await loadLabel({ store: versioning, personId: result.personId })
        expect(claimsOf(loaded, FULL_NAME_PROPERTY)).toEqual(['Ada Lovelace'])
        expect(loaded.label).toBe('Ada Lovelace')
    })

    test('records the name for a DEER v1 person without PUTting its document away', async () => {
        // A person the legacy reader still serves inline: `#legacy-` annotations prove
        // it, and on devstore read() hands back a reduced document, so a PUT would drop
        // the v1 facts. Assert the name; leave that document untouched.
        const store = createMemoryStore()
        const personId = 'https://devstore.rerum.io/v1/PERSON1'
        await store.create({ '@id': personId, '@type': TYPES.Person, name: 'Ada Byron', birthPlace: 'London' })
        await store.create({
            '@id': `${personId}#legacy-birthDate-1`,
            type: 'Annotation',
            target: personId,
            body: { [SCHEMA.birthDate]: { value: '1815-12-10' } }
        })

        const before = await loadLabel({ store, personId })
        expect(before.legacy).toBe(true)
        // A v1 bare `name` is displayable without migration, through personLabel's chain.
        expect(before.label).toBe('Ada Byron')

        const result = await saveLabel({ store, personId, name: 'Ada Lovelace', evidence: { title: 'Memoir' } })
        expect(result.cacheUpdated).toBe(false)
        expect(result.cacheSkipped).toBe('legacy')
        expect(result.personId).toBe(personId)
        expect(store.read(personId)).toMatchObject({ name: 'Ada Byron', birthPlace: 'London' })

        const after = await loadLabel({ store, personId })
        expect(claimsOf(after, FULL_NAME_PROPERTY)).toEqual(['Ada Lovelace'])
        // The v1 name still shows, on this page and in lists alike: nothing has
        // silently drifted. What the user gets instead is saveLabel's
        // cacheSkipped reason, which the page states out loud.
        expect(after.cacheStale).toBe(false)
        expect(after.label).toBe('Ada Byron')
    })

    test('never queries without a target or rel', async () => {
        // docs/devstore-query-contract.md: the live service silently answers [] for
        // such a query, so the adapters now throw. Both paths must stay anchored.
        const { store, personId } = await seedPerson()
        const anchored = Object.create(store)
        anchored.query = filter => {
            if (!filter || (!filter.target && !filter.rel)) {
                throw new Error(`query without target or rel: ${JSON.stringify(filter)}`)
            }
            return store.query(filter)
        }
        await loadLabel({ store: anchored, personId })
        const result = await saveLabel({ store: anchored, personId, name: 'Ada Lovelace', evidence: { title: 'Memoir' } })
        expect(result.cacheUpdated).toBe(true)
    })
})

describe('loadLabel', () => {
    test('requires a personId and answers null for anything that is not a Person', async () => {
        const store = createMemoryStore()
        await expect(loadLabel({ store })).rejects.toThrow(TypeError)
        expect(await loadLabel({ store, personId: 'https://example.org/nope' })).toBeNull()
        const record = await store.create({ '@type': TYPES.Record, label: 'R' })
        expect(await loadLabel({ store, personId: record['@id'] })).toBeNull()
    })

    test('reports a stale cache when only the assertions can name the person', async () => {
        const store = createMemoryStore()
        const person = await store.create({ '@type': TYPES.Person })
        await store.create({
            type: 'Annotation',
            target: person['@id'],
            body: { [FULL_NAME_PROPERTY]: { value: 'Ada Lovelace', evidence: 'https://example.org/record' } },
            [DCTERMS_SOURCE]: 'https://example.org/record'
        })

        const loaded = await loadLabel({ store, personId: person['@id'] })
        expect(loaded.label).toBe('Ada Lovelace')
        // A list cannot see annotations, so it calls this person "[ unlabeled ]".
        expect(loaded.listLabel).toBe('[ unlabeled ]')
        expect(loaded.cacheStale).toBe(true)
        // Until the Record is in the store there is no title to show, so the id stands in.
        expect(loaded.evidenceLabels['https://example.org/record']).toBe('https://example.org/record')

        await store.create({ '@id': 'https://example.org/record', '@type': TYPES.Record, label: 'Parish register' })
        // Recording the display name again is what repairs it.
        const result = await saveLabel({
            store,
            personId: person['@id'],
            name: loaded.label,
            evidence: { id: 'https://example.org/record' }
        })
        expect(result.cacheUpdated).toBe(true)
        const repaired = await loadLabel({ store, personId: person['@id'] })
        expect(repaired.cacheStale).toBe(false)
        expect(repaired.listLabel).toBe('Ada Lovelace')
        expect(repaired.evidenceLabels['https://example.org/record']).toBe('Parish register')
    })

    test('names an evidence Record by the one label rule, not only by its bare `label`', async () => {
        // An evidence document can reach the page from anywhere — a v1 import read
        // without migration, a Record another agent wrote. The audit row must call it
        // what every other surface calls it, so the alias goes through deriveLabel().
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada Byron' })
        const records = await Promise.all([
            store.create({ '@type': TYPES.Record, label: 'By label' }),
            store.create({ '@type': TYPES.Record, name: 'By bare v1 name' }),
            store.create({ '@type': TYPES.Record, [SCHEMA.givenName]: 'Parish', [SCHEMA.familyName]: 'register' }),
            store.create({ '@type': TYPES.Record })
        ])
        const titles = ['By label', 'By bare v1 name', 'Parish register']
        for (const [index, record] of records.entries()) {
            await store.create({
                type: 'Annotation',
                target: person['@id'],
                body: { [FULL_NAME_PROPERTY]: { value: `Name ${index}`, evidence: record['@id'] } },
                [DCTERMS_SOURCE]: record['@id']
            })
        }

        const loaded = await loadLabel({ store, personId: person['@id'] })
        expect(loaded.evidenceLabels[records[0]['@id']]).toBe('By label')
        expect(loaded.evidenceLabels[records[1]['@id']]).toBe('By bare v1 name')
        expect(loaded.evidenceLabels[records[2]['@id']]).toBe('Parish register')
        // Nothing displayable: the id stands in, because an audit row needs some text.
        expect(loaded.evidenceLabels[records[3]['@id']]).toBe(records[3]['@id'])
        // The row strings come from the documents, not from the claims they evidence.
        expect(Object.values(loaded.evidenceLabels).slice(0, 3)).toEqual(titles)
    })

    test('audits the full-name claims and the creating label claim', async () => {
        const { store, personId } = await seedPerson('Ada Byron')
        const created = await loadLabel({ store, personId })
        // createPerson claims the label; it has not been given a schema:name yet.
        expect(claimsOf(created, LABEL_PROPERTY)).toEqual(['Ada Byron'])
        expect(claimsOf(created, FULL_NAME_PROPERTY)).toEqual([])
        expect(created.legacy).toBe(false)

        await saveLabel({ store, personId, name: 'Ada King', evidence: { title: 'Death certificate' } })
        const after = await loadLabel({ store, personId })
        expect(Object.keys(after.names).sort()).toEqual([FULL_NAME_PROPERTY, LABEL_PROPERTY].sort())
        // The labels the page hands to gl-assertion for the audit rows.
        expect(PROPERTY_LABELS[FULL_NAME_PROPERTY]).toBe('Full name')
        expect(PROPERTY_LABELS[LABEL_PROPERTY]).toBe('Label')
    })
})
