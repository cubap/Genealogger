/**
 * Tests for the bare Person entity + assembled Person view (js/model).
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { createPerson, readEntity } from '../../js/model/entities.js'
import { getPerson } from '../../js/model/person.js'
import { assert as assertAnnotation } from '../../js/model/assertions.js'
import { SCHEMA } from '../../js/model/vocabulary.js'
import config from '../../js/model/config.js'

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
