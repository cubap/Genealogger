/**
 * Tests for assertions: ValueObject payloads, confidence validation, and the
 * core promise that conflicting evidence COEXISTS (never merged, never
 * overwritten).
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { createPerson } from '../../js/model/entities.js'
import { assert as assertAnnotation, resolve, list, valueObject, valueObjectsFor } from '../../js/model/assertions.js'
import { SCHEMA, NV } from '../../js/model/vocabulary.js'

const CERT = 'https://devstore.rerum.io/v1/id/certificate'
const CENSUS = 'https://devstore.rerum.io/v1/id/census'

describe('valueObject', () => {
    test('builds the DEER v2 ValueObject shape', () => {
        const vo = valueObject('1815-12-10', {
            source: { citationSource: 'Parish certificate' },
            evidence: CERT,
            confidence: 0.95
        })
        expect(vo.value).toBe('1815-12-10')
        expect(vo.source.citationSource).toBe('Parish certificate')
        expect(vo.evidence).toBe(CERT)
        expect(vo[NV.confidence]).toBe(0.95)
    })

    test('rejects confidence outside 0-1', () => {
        expect(() => valueObject('x', { confidence: 2 })).toThrow(RangeError)
        expect(() => valueObject('x', { confidence: -0.1 })).toThrow(RangeError)
    })
})

describe('conflicting assertions coexist', () => {
    test('two evidence sources asserting different birth dates both survive', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        await assertAnnotation({
            store,
            target: person['@id'],
            property: SCHEMA.birthDate,
            value: '1815-12-10',
            source: { citationSource: 'certificate' },
            evidence: CERT,
            confidence: 0.95
        })
        await assertAnnotation({
            store,
            target: person['@id'],
            property: SCHEMA.birthDate,
            value: '1817',
            source: { citationSource: 'census', comment: 'lied age suspected' },
            evidence: CENSUS,
            confidence: 0.3
        })

        const annotations = await list({ store, target: person['@id'], property: SCHEMA.birthDate })
        expect(annotations).toHaveLength(2)

        const resolved = await resolve({ store, target: person['@id'] })
        const values = resolved[SCHEMA.birthDate]
        expect(Array.isArray(values)).toBe(true)
        expect(values).toHaveLength(2)
        // Resolution returns ValueObjects, not merged values.
        expect(values.map(vo => vo.value).sort()).toEqual(['1815-12-10', '1817'])
        expect(values[0].evidence).toBe(CERT)
        expect(values[0][NV.confidence]).toBe(0.95)
        expect(values[1].evidence).toBe(CENSUS)
        expect(values[1][NV.confidence]).toBe(0.3)
        expect(values[1].source.comment).toBe('lied age suspected')
    })

    test('a lone assertion resolves to a single ValueObject', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        await assertAnnotation({
            store, target: person['@id'], property: SCHEMA.sex, value: 'female', evidence: CERT
        })
        const resolved = await resolve({ store, target: person['@id'] })
        expect(Array.isArray(resolved[SCHEMA.sex])).toBe(false)
        expect(resolved[SCHEMA.sex].value).toBe('female')
    })

    test('valueObjectsFor extracts payloads from an annotation body', async () => {
        const store = createMemoryStore()
        const person = await createPerson({ store, label: 'Ada' })
        const anno = await assertAnnotation({
            store, target: person['@id'], property: SCHEMA.name, value: 'Ada Gordon'
        })
        expect(valueObjectsFor(anno, SCHEMA.name)[0].value).toBe('Ada Gordon')
        expect(valueObjectsFor(anno, SCHEMA.birthDate)).toEqual([])
    })
})
