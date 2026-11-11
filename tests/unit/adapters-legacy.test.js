/**
 * Tests for the legacy devstore adapter: readDevstoreJson converts v1 shapes
 * (facts directly on the entity doc, Web-Annotation bodies keyed by bare
 * v1 property names) into the new model shapes.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { readDevstoreJson, convertLegacyEntity, convertLegacyAnnotation, loadLegacy } from '../../js/adapters/legacy.js'
import { assert as assertAnnotation } from '../../js/model/assertions.js'
import { eventsForPerson } from '../../js/model/search.js'
import { participations } from '../../js/model/events.js'
import { getPerson } from '../../js/model/person.js'
import { SCHEMA, NV, EVENT_SUBTYPES, typeTokens } from '../../js/model/vocabulary.js'

const LEGACY_ID = 'https://devstore.rerum.io/v1/abc123'
const LEGACY_EVIDENCE = 'https://devstore.rerum.io/v1/rec999'

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
    evidence: LEGACY_EVIDENCE,
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

const legacyBirthEventDoc = {
    '@id': 'https://devstore.rerum.io/v1/event1',
    '@type': 'Event',
    additionalType: 'Birth',
    label: 'Birth of Ada'
}

describe('readDevstoreJson', () => {
    test('splits a legacy entity into a bare entity plus ValueObject assertions', () => {
        const docs = readDevstoreJson([legacyPersonDoc])
        const [bare, ...annotations] = docs
        expect(bare['@id']).toBe(LEGACY_ID)
        expect(bare['@type']).toBe('Person')
        expect(bare.label).toBe('Ada Gordon')
        expect(bare.givenName).toBeUndefined()
        expect(bare.__rerum).toBeUndefined()
        const byProperty = {}
        for (const anno of annotations) {
            expect(anno.type).toBe('Annotation')
            expect(anno.target).toBe(LEGACY_ID)
            for (const [property, vo] of Object.entries(anno.body)) {
                byProperty[property] = vo
            }
        }
        expect(byProperty[SCHEMA.givenName].value).toBe('Ada')
        expect(byProperty[SCHEMA.birthDate].value).toBe('1815-12-10')
        expect(byProperty[SCHEMA.birthDate].evidence).toBe(LEGACY_EVIDENCE)
        expect(byProperty[NV.hasParent].value).toBe('https://devstore.rerum.io/v1/father1')
        expect(byProperty[NV.participant].value).toBe(LEGACY_ID)
        expect(byProperty[NV.role].value).toBe(NV.child)
    })

    test('converts a legacy annotation body to ValueObjects under mapped URIs', () => {
        const converted = convertLegacyAnnotation(legacyAnnotationDoc)
        expect(converted.target).toBe(LEGACY_ID)
        expect(converted.motivation).toBe('linking')
        expect(converted.creator).toBe('deer-form')
        const vo = converted.body[SCHEMA.birthPlace]
        expect(vo.value).toBe('London')
        expect(vo.source.citationNote).toBe('stated on certificate')
    })

    test('folds additionalType into an nv: Event subtype', () => {
        const [bare] = readDevstoreJson([legacyBirthEventDoc])
        expect(bare['@type']).toContain('Event')
        expect(bare['@type']).toContain(NV.hasParent.replace('hasParent', 'Birth'))
    })

    test('rejects non-array input', () => {
        expect(() => readDevstoreJson({})).toThrow(TypeError)
    })
})

describe('legacy data through the model layer', () => {
    test('converted legacy person loads into a store and assembles via getPerson', async () => {
        const store = createMemoryStore()
        for (const doc of readDevstoreJson([legacyPersonDoc, legacyAnnotationDoc])) {
            store.create(doc)
        }
        const view = await getPerson({ store, id: LEGACY_ID })
        expect(view).not.toBeNull()
        expect(view.label).toBe('Ada Gordon')
        expect(view.assertions[SCHEMA.birthDate].value).toBe('1815-12-10')
        expect(view.assertions[SCHEMA.birthDate].evidence).toBe(LEGACY_EVIDENCE)
        expect(view.assertions[SCHEMA.birthPlace].value).toBe('London')
        expect(view.assertions[NV.hasParent].value).toBe('https://devstore.rerum.io/v1/father1')
        // Legacy father link surfaces in derived parents.
        expect(view.parents.map(p => p.value)).toContain('https://devstore.rerum.io/v1/father1')
    })

    test('conflicting legacy + new assertions coexist after conversion', async () => {
        const store = createMemoryStore()
        for (const doc of readDevstoreJson([legacyPersonDoc])) {
            store.create(doc)
        }
        // Re-assert the same person's birthDate from new entry with different evidence
        await assertAnnotation({
            store,
            target: LEGACY_ID,
            property: SCHEMA.birthDate,
            value: '1816',
            evidence: 'https://example.org/other'
        })
        const view = await getPerson({ store, id: LEGACY_ID })
        const values = view.assertions[SCHEMA.birthDate].map(vo => vo.value)
        expect(values.sort()).toEqual(['1815-12-10', '1816'])
    })
})

describe('loadLegacy', () => {
    test('fetches each id through the injected fetch and converts', async () => {
        const seen = []
        const fakeFetch = url => {
            seen.push(url)
            return Promise.resolve({ json: () => Promise.resolve([legacyPersonDoc, legacyAnnotationDoc]) })
        }
        const docs = await loadLegacy([LEGACY_ID], { fetchImpl: fakeFetch })
        expect(seen[0]).toBe(LEGACY_ID)
        expect(docs.some(d => d['@type'] === 'Person')).toBe(true)
        expect(docs.some(d => d.type === 'Annotation')).toBe(true)
    })

    test('fails cleanly when the fetch implementation is not callable', async () => {
        await expect(loadLegacy(['x'], { fetchImpl: 'nope' }))
            .rejects.toThrow(TypeError)
    })
})
/**
 * A reverse lookup can only ask devstore for an '@type' it can match exactly.
 * New-shape documents store the full URI, migrated v1 documents store the bare
 * local name, so `typeTokens()` is what lets one search span both generations
 * -- see docs/devstore-query-contract.md.
 */
describe('typeTokens', () => {
    test('pairs each type URI with the bare v1 name', () => {
        expect(typeTokens(EVENT_SUBTYPES.Death)).toEqual([EVENT_SUBTYPES.Death, 'Death'])
    })

    test('accepts an array and de-duplicates', () => {
        const tokens = typeTokens([EVENT_SUBTYPES.Birth, EVENT_SUBTYPES.Baptism], EVENT_SUBTYPES.Birth)
        expect(tokens).toEqual([EVENT_SUBTYPES.Birth, 'Birth', EVENT_SUBTYPES.Baptism, 'Baptism'])
    })

    test('does not duplicate a bare name that was passed in', () => {
        expect(typeTokens('Birth', EVENT_SUBTYPES.Birth)).toEqual(['Birth', EVENT_SUBTYPES.Birth])
    })

    test('ignores empty values', () => {
        expect(typeTokens(undefined, null, '')).toEqual([])
    })
})
describe('convertLegacyEntity and the subtype mirror', () => {
    const DEATH = EVENT_SUBTYPES.Death

    it('folds a dcterms:type mirror into @type instead of asserting it', () => {
        // model/events.js writes this mirror on purpose, so a record the app just
        // saved must not fan out into a `#legacy-*` fact and mark itself legacy.
        const [bare, ...annos] = convertLegacyEntity({
            '@id': 'https://devstore.rerum.io/v1/id/evt',
            '@type': ['Event', DEATH],
            'http://purl.org/dc/terms/type': DEATH,
            label: 'Death of Ada Byron'
        })
        expect(annos).toEqual([])
        expect(bare['@type']).toEqual(['Event', DEATH])
        expect(bare.label).toBe('Death of Ada Byron')
    })

    it('still fans real facts on a document into legacy assertions', () => {
        const [bare, ...annos] = convertLegacyEntity({
            '@id': 'https://devstore.rerum.io/v1/id/p',
            '@type': 'Person',
            givenName: 'Ada'
        })
        expect(annos.length).toBe(1)
        expect(annos[0].body[SCHEMA.givenName].value).toBe('Ada')
        expect(bare['@type']).toBe('Person')
    })
})

/**
 * v1 also spelled reference-valued facts as embedded objects, and that is the
 * shape in which the per-agent role rode along:
 * `hasAgent: [{ '@id': '…/v1/p1', additionalType: 'mother' }]`. Left as the raw
 * object, `nv:participant` never matches a person id, so the whole event vanishes
 * from every derived read (birth, death, parents, tree, timeline).
 */
describe('convertLegacyEntity and object-shaped references', () => {
    const MOTHER = 'https://devstore.rerum.io/v1/id/mother1'
    const CHILD = 'https://devstore.rerum.io/v1/id/child1'
    const EVENT = 'https://devstore.rerum.io/v1/id/evt1'

    const legacyBirthEvent = {
        '@id': EVENT,
        '@type': 'Event',
        additionalType: 'Birth',
        label: 'Birth of Ada',
        hasAgent: [
            { '@id': MOTHER, additionalType: 'mother' },
            { '@id': CHILD, additionalType: 'child' },
            { '@id': 'https://devstore.rerum.io/v1/id/w1', additionalType: 'witness' },
            { '@id': 'https://devstore.rerum.io/v1/id/x1', additionalType: 'midwife' }
        ],
        evidence: LEGACY_EVIDENCE
    }

    it('unwraps embedded refs and lifts the per-agent role', () => {
        const annos = convertLegacyEntity(legacyBirthEvent).filter(d => d.type === 'Annotation')
        const rows = annos
            .filter(a => a.body[NV.participant])
            .map(a => ({ agent: a.body[NV.participant].value, role: a.body[NV.role].value }))
        expect(rows).toContainEqual({ agent: MOTHER, role: NV.mother })
        expect(rows).toContainEqual({ agent: CHILD, role: NV.child })
        expect(rows).toContainEqual({ agent: 'https://devstore.rerum.io/v1/id/w1', role: NV.witness })
        // An unfamiliar v1 role is kept verbatim rather than silently relabelled
        // as `child`, which would invent a parentage edge.
        expect(rows).toContainEqual({ agent: 'https://devstore.rerum.io/v1/id/x1', role: 'midwife' })
        for (const row of rows) expect(typeof row.agent).toBe('string')
    })

    it('keeps the document-level evidence on every converted participation', () => {
        const annos = convertLegacyEntity(legacyBirthEvent).filter(d => d.type === 'Annotation')
        for (const anno of annos.filter(a => a.body[NV.participant])) {
            expect(anno.body[NV.participant].evidence).toBe(LEGACY_EVIDENCE)
        }
    })

    it('unwraps an object-valued hasFather into the parent id', () => {
        const annos = convertLegacyEntity({
            '@id': CHILD,
            '@type': 'Person',
            hasFather: { '@id': 'https://devstore.rerum.io/v1/id/father9' }
        }).filter(d => d.type === 'Annotation')
        expect(annos.map(a => a.body[NV.hasParent].value)).toEqual(['https://devstore.rerum.io/v1/id/father9'])
    })

    it('lets a model read find the event through the legacy fallback scan', async () => {
        // The bug this pins: before unwrapping, `participations()` compared a
        // person id against an object and the event surfaced for nobody.
        const store = createMemoryStore()
        for (const doc of readDevstoreJson([
            { '@id': MOTHER, '@type': 'Person', givenName: 'Annabella' },
            legacyBirthEvent
        ])) {
            store.create(doc)
        }
        const birthEvents = await eventsForPerson({
            store,
            personId: MOTHER,
            role: NV.mother,
            legacyTypes: typeTokens(EVENT_SUBTYPES.Birth)
        })
        expect(birthEvents.map(e => e['@id'])).toEqual([EVENT])
        const rows = await participations({ store, event: birthEvents[0] })
        const seen = rows.map(r => `${r.agent} -> ${r.role}`).sort()
        expect(seen).toEqual([
            `${CHILD} -> ${NV.child}`,
            `${MOTHER} -> ${NV.mother}`,
            'https://devstore.rerum.io/v1/id/w1 -> ' + NV.witness,
            'https://devstore.rerum.io/v1/id/x1 -> midwife'
        ].sort())
    })
})
