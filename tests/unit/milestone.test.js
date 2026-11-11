/**
 * M1 milestone acceptance test (issue #12).
 *
 * End-to-end THROUGH THE PUBLIC MODEL API ONLY: create a Person, record a
 * Birth Event evidenced by a certificate Record, participate the child and
 * two parents, derive nv:hasParent assertions on the child, read the
 * COMPUTED nv:hasChild inverse on a parent, and prove conflicting evidence
 * coexists (a baptism naming a different father).
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { createEntity, createPerson } from '../../js/model/entities.js'
import { assert } from '../../js/model/assertions.js'
import { createEvent, participate, assertOutcome, deriveParentAssertions } from '../../js/model/events.js'
import { getPerson } from '../../js/model/person.js'
import { markLacuna } from '../../js/model/lacunae.js'
import { childrenOf, eventsForPerson, personsByAnnotationType } from '../../js/model/search.js'
import { NV, SCHEMA, TYPES } from '../../js/model/vocabulary.js'

describe('M1 acceptance: Eventities end to end', () => {
    test('person + evidenced birth event + derived links + conflicting evidence', async () => {
        const store = createMemoryStore()

        // 1. The certificate is a Record; the people are bare Persons.
        const certificate = await createEntity({
            store, '@type': TYPES.Record, label: 'Parish baptism certificate, 1815'
        })
        const ada = await createPerson({
            store, label: 'Ada Gordon', evidence: certificate['@id'], confidence: 0.95
        })
        const anne = await createPerson({ store, label: 'Anne Milbanke', evidence: certificate['@id'] })
        const george = await createPerson({ store, label: 'George Gordon', evidence: certificate['@id'] })

        // 2. A Birth Event with its OWN evidence annotation (the certificate).
        const birth = await createEvent({
            store,
            subtype: 'Birth',
            label: 'Birth of Ada Gordon',
            evidence: certificate['@id'],
            confidence: 0.95
        })
        expect(birth['@type']).toContain('Event')

        // 3. Participation triples (event, agent, role).
        await participate({ store, event: birth, agent: ada['@id'], role: NV.child, evidence: certificate['@id'] })
        await participate({ store, event: birth, agent: anne['@id'], role: NV.parent, evidence: certificate['@id'] })
        await participate({ store, event: birth, agent: george['@id'], role: NV.parent, evidence: certificate['@id'] })

        // 4. The event yields MULTIPLE outcome assertions on the child.
        await assertOutcome({ store, event: birth, target: ada['@id'], property: SCHEMA.name, value: 'Ada Gordon' })
        await assertOutcome({ store, event: birth, target: ada['@id'], property: SCHEMA.birthDate, value: '1815-12-10' })
        await assertOutcome({ store, event: birth, target: ada['@id'], property: SCHEMA.sex, value: 'female' })

        // 5. Derive parentage on the child from the participations.
        const derived = await deriveParentAssertions({ store, event: birth })
        expect(derived).toHaveLength(2)

        // 6. Assembled child view: facts, outcomes, parents, all evidenced.
        const adaView = await getPerson({ store, id: ada['@id'] })
        expect(adaView.label).toBe('Ada Gordon')
        expect(adaView.assertions[SCHEMA.birthDate].value).toBe('1815-12-10')
        expect(adaView.assertions[SCHEMA.birthDate].evidence).toBe(birth['@id'])
        expect(adaView.parents.map(p => p.value).sort()).toEqual([anne['@id'], george['@id']].sort())
        expect(adaView.parents.every(p => p.evidence === birth['@id'] && p[NV.confidence] === 0.95)).toBe(true)
        expect(adaView.children).toEqual([])

        // 7. nv:hasChild is COMPUTED for the parent, never stored.
        const anneView = await getPerson({ store, id: anne['@id'] })
        expect(anneView.children.map(c => c.target)).toEqual([ada['@id']])
        const viaSearch = await childrenOf({ store, personId: anne['@id'] })
        expect(viaSearch[0].target).toBe(ada['@id'])
        expect(store.all().some(doc => JSON.stringify(doc).includes(NV.hasChild))).toBe(false)

        // 8. CONFLICTING EVIDENCE COEXISTS: a baptism register names a
        // different father; both father claims survive side by side.
        const register = await createEntity({
            store, '@type': TYPES.Record, label: 'Baptism register, 1816'
        })
        const byron = await createPerson({ store, label: 'Reverend Byron', evidence: register['@id'] })
        const baptism = await createEvent({
            store, subtype: 'Christening', evidence: register['@id'], confidence: 0.6
        })
        await participate({ store, event: baptism, agent: ada['@id'], role: NV.child })
        await participate({ store, event: baptism, agent: byron['@id'], role: NV.parent })
        await deriveParentAssertions({ store, event: baptism })

        const conflicted = await getPerson({ store, id: ada['@id'] })
        const claims = conflicted.assertions[NV.hasParent]
        expect(Array.isArray(claims)).toBe(true)
        expect(claims).toHaveLength(3) // anne + george + byron
        const byValue = Object.fromEntries(claims.map(c => [c.value, c]))
        expect(byValue[byron['@id']][NV.confidence]).toBe(0.6)
        expect(byValue[byron['@id']].evidence).toBe(baptism['@id'])
        expect(byValue[anne['@id']][NV.confidence]).toBe(0.95)

        // 9. Lacuna + search helpers round out the public surface.
        await markLacuna({
            store, target: ada['@id'], value: 'grandmother never named in any record', about: NV.hasParent
        })
        const withGaps = await getPerson({ store, id: ada['@id'] })
        expect(withGaps.lacunae).toHaveLength(1)
        const parented = await personsByAnnotationType({ store, type: NV.hasParent })
        expect(parented.map(p => p['@id'])).toContain(ada['@id'])
        const adaEvents = await eventsForPerson({ store, personId: ada['@id'], role: NV.child })
        expect(adaEvents).toHaveLength(2)
        // A stray direct assert still coexists with event-derived ones.
        await assert({
            store, target: ada['@id'], property: SCHEMA.birthDate, value: '1817', evidence: register['@id'], confidence: 0.3
        })
        const finalView = await getPerson({ store, id: ada['@id'] })
        expect(finalView.assertions[SCHEMA.birthDate].map(v => v.value).sort()).toEqual(['1815-12-10', '1817'])
    })
})
