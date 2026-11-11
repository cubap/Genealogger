/**
 * Tests for Lacunae: expected-but-unrecorded slots marked as nv:Lacuna
 * annotations that resolve like any other assertion.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { createPerson } from '../../js/model/entities.js'
import { markLacuna, lacunaeOn } from '../../js/model/lacunae.js'
import { getPerson } from '../../js/model/person.js'
import { NV } from '../../js/model/vocabulary.js'

const CERT = 'https://devstore.rerum.io/v1/id/certificate'

describe('lacunae', () => {
    test('mark and read back a Lacuna on a person', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        await markLacuna({
            store,
            target: person['@id'],
            value: 'birth mother unknown',
            about: NV.hasParent,
            evidence: CERT,
            confidence: 1
        })
        const gaps = await lacunaeOn({ store, target: person['@id'] })
        expect(gaps).toHaveLength(1)
        expect(gaps[0].value).toBe('birth mother unknown')
        expect(gaps[0].about).toBe(NV.hasParent)
        expect(gaps[0].evidence).toBe(CERT)
        expect(gaps[0][NV.confidence]).toBe(1)
    })

    test('lacunae surface in the assembled Person view', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        await markLacuna({ store, target: person['@id'], value: 'father never recorded' })
        const view = await getPerson({ store, id: person['@id'] })
        expect(view.lacunae).toHaveLength(1)
        expect(view.lacunae[0].value).toBe('father never recorded')
        // The Lacuna also groups under its property in the assertion map.
        expect(view.assertions[NV.Lacuna].value).toBe('father never recorded')
    })

    test('requires a value describing the gap', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        await expect(markLacuna({ store, target: person['@id'] })).rejects.toThrow(TypeError)
    })
})
