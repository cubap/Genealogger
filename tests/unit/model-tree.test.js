/**
 * Tests for the tree read use-case (issue #14 story 10): the whole point is
 * that EVERY edge comes from a derived read — parentsOf assertions and the
 * childrenOf inverse through the rel index — and never from a stored
 * nv:hasChild. Covered here: a three-generation chain yields the expected
 * edges/nodes/depths, contested parentage keeps BOTH competing edges and
 * flags the person (including two sources agreeing on one parent), the walk
 * is bounded by maxGenerations, edge labels name the evidence Record and the
 * mother/father role from its participants, and a DEER v1 person with direct
 * hasFather/hasMother still gets a tree.
 */

import { createMemoryStore } from '../../js/adapters/memory-store.js'
import { saveBirth } from '../../js/model/birth.js'
import { loadTree, DEFAULT_MAX_GENERATIONS } from '../../js/model/tree.js'
import { convertLegacyEntity } from '../../js/adapters/legacy.js'
import { NV, TYPES } from '../../js/model/vocabulary.js'

const HAS_CHILD = 'https://cubap.github.io/Genealogger/nv#hasChild'
const DEV = 'https://devstore.rerum.io/v1/'

function edgeTo(tree, childId) {
    return tree.edges.filter(edge => edge.to === childId)
}

function node(tree, id) {
    return tree.nodes.find(candidate => candidate.id === id)
}

/**
 * Three generations: Augustus + Maria -> George + Annabella -> Ada -> Harriet.
 * Annabella and Harriet are seeded through the birth form so the chain runs
 * through exactly the writes the app makes.
 */
async function seedFamily() {
    const store = createMemoryStore()
    const augustus = await saveBirth({ store, name: { given: 'Augustus', family: 'Byron' }, evidence: { title: 'Augustus register' } })
    const maria = await saveBirth({ store, name: { given: 'Maria', family: 'Byron' }, evidence: { title: 'Maria register' } })
    const george = await saveBirth({
        store,
        name: { given: 'George', family: 'Byron' },
        evidence: { title: 'George certificate' },
        participants: [
            { role: 'father', agentId: augustus.personId },
            { role: 'mother', agentId: maria.personId }
        ]
    })
    const ada = await saveBirth({
        store,
        name: { given: 'Ada', family: 'Byron' },
        evidence: { title: 'Parish certificate' },
        participants: [
            { role: 'father', agentId: george.personId },
            { role: 'mother', name: { given: 'Annabella', family: 'Milbanke' } }
        ]
    })
    const harriet = await saveBirth({
        store,
        name: { given: 'Harriet', family: 'Byron' },
        evidence: { title: 'Harriet certificate' },
        participants: [{ role: 'mother', agentId: ada.personId }]
    })
    return { store, augustus, maria, george, ada, harriet }
}

describe('loadTree derived reads', () => {
    test('three-generation chain yields the expected nodes from derived reads only', async () => {
        const { store, ada, george, harriet } = await seedFamily()
        const tree = await loadTree({ store, rootId: ada.personId })

        expect(tree.rootId).toBe(ada.personId)
        expect(tree.rootLabel).toBe('Ada Byron')
        expect(tree.maxGenerations).toBe(DEFAULT_MAX_GENERATIONS)
        expect(tree.nodes).toHaveLength(6)
        expect(node(tree, ada.personId).gen).toBe(0)
        expect(node(tree, george.personId).gen).toBe(-1)
        expect(node(tree, harriet.personId).gen).toBe(1)
        // Grandparents sit two generations up; nothing beyond the bound exists.
        expect(tree.nodes.filter(n => n.gen === -2).map(n => n.label).sort())
            .toEqual(['Augustus Byron', 'Maria Byron'])

        // Downward edge (Ada -> Harriet) came from childrenOf, i.e. the
        // COMPUTED inverse — the same single assertion, never a second edge.
        const down = edgeTo(tree, harriet.personId)
        expect(down).toHaveLength(1)
        expect(down[0].from).toBe(ada.personId)
        expect(down[0].role).toBe('mother')
        expect(down[0].evidenceLabel).toBe('Harriet certificate')

        // Invariant (checklist item 8): no document on the wire stores hasChild.
        for (const doc of store.all()) {
            if (!doc.body) continue
            expect(Object.keys(doc.body)).not.toContain(HAS_CHILD)
        }
    })

    test('edges name their evidence Record and the mother/father role', async () => {
        const { store, ada, george } = await seedFamily()
        const tree = await loadTree({ store, rootId: ada.personId })
        const parents = edgeTo(tree, ada.personId)
        expect(parents).toHaveLength(2)
        const father = parents.find(edge => edge.from === george.personId)
        expect(father.role).toBe('father')
        expect(father.evidence).toBe(ada.eventId)
        expect(father.evidenceLabel).toBe('Parish certificate')
        const mother = parents.find(edge => edge.role === 'mother')
        expect(mother.evidenceLabel).toBe('Parish certificate')
    })

    test('rooting on a parent finds children through the rel inverse', async () => {
        const { store, ada, george, harriet } = await seedFamily()
        const tree = await loadTree({ store, rootId: george.personId })
        expect(node(tree, ada.personId).gen).toBe(1)
        // Harriet is a grandchild: edge Ada -> Harriet appears, reached via
        // childrenOf on Ada, with no stored parent->child duplicate.
        expect(node(tree, harriet.personId).gen).toBe(2)
        expect(edgeTo(tree, ada.personId).some(edge => edge.from === george.personId)).toBe(true)
    })

    test('depth is bounded by maxGenerations in both directions', async () => {
        const { store, ada, augustus, george, harriet } = await seedFamily()
        const one = await loadTree({ store, rootId: ada.personId, maxGenerations: 1 })
        expect(one.nodes).toHaveLength(4)
        expect(one.nodes.map(n => Math.abs(n.gen)).every(gen => gen <= 1)).toBe(true)
        // George's edges still render (he is in range) but his parents do not.
        expect(node(one, george.personId)).toBeTruthy()
        expect(one.nodes.some(n => n.label === 'Augustus Byron')).toBe(false)
        // George is in range and appears as a parent; his OWN parents' edges
        // (augustus/maria -> george) were never fetched at this depth.
        expect(one.edges.some(edge => edge.from === george.personId)).toBe(true)
        expect(one.edges.filter(edge => edge.from === augustus.personId)).toHaveLength(0)
        // Edge metadata rides on the assertion itself, so even a window-edge
        // child (Harriet) gets her evidence named without expanding her.
        expect(edgeTo(one, harriet.personId)[0].evidenceLabel).toBe('Harriet certificate')

        const zero = await loadTree({ store, rootId: ada.personId, maxGenerations: 0 })
        expect(zero.nodes).toHaveLength(1)
        expect(zero.nodes[0].id).toBe(ada.personId)
        expect(zero.edges).toHaveLength(0)
    })

    test('the walk stays bounded: no unbounded fan-out per person', async () => {
        const { store, ada } = await seedFamily()
        const calls = { query: 0, read: 0, listByType: 0 }
        const counted = {
            create: doc => store.create(doc),
            update: doc => store.update(doc),
            remove: id => store.remove(id),
            listByType: type => {
                calls.listByType++
                return store.listByType(type)
            },
            query: filter => {
                calls.query++
                return store.query(filter)
            },
            read: id => {
                calls.read++
                return store.read(id)
            }
        }
        const tree = await loadTree({ store: counted, rootId: ada.personId })
        expect(tree.nodes).toHaveLength(6)
        // New-shape people answer parentsOf directly, so the legacy birth
        // enumeration runs only for parent-less persons (here: Annabella),
        // and even then only once per birth-type token.
        expect(calls.listByType).toBeLessThanOrEqual(6)
        expect(calls.query).toBeLessThan(30)
        expect(calls.read).toBeLessThan(30)
    })
})

describe('loadTree contested parentage', () => {
    test('two different fathers from two records render as two edges', async () => {
        const store = createMemoryStore()
        const will = await saveBirth({
            store,
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Will transcript' },
            participants: [{ role: 'father', name: { given: 'William', family: 'Ashley' } }]
        })
        await saveBirth({
            store,
            personId: will.personId,
            evidence: { title: 'Parish certificate' },
            participants: [{ role: 'father', name: { given: 'George', family: 'Byron' } }]
        })
        const tree = await loadTree({ store, rootId: will.personId })
        const root = node(tree, will.personId)
        expect(root.contested).toBe(true)
        const fathers = edgeTo(tree, will.personId)
        expect(fathers).toHaveLength(2)
        expect(fathers.every(edge => edge.role === 'father')).toBe(true)
        expect(fathers.every(edge => edge.contested)).toBe(true)
        expect(fathers.map(edge => edge.evidenceLabel).sort())
            .toEqual(['Parish certificate', 'Will transcript'])
        expect(tree.nodes.filter(n => n.gen === -1)).toHaveLength(2)
    })

    test('two sources agreeing on ONE parent still flag the disagreement', async () => {
        const store = createMemoryStore()
        const george = await saveBirth({ store, name: { given: 'George', family: 'Byron' }, evidence: { title: 'George certificate' } })
        const first = await saveBirth({
            store,
            name: { given: 'Ada', family: 'Byron' },
            evidence: { title: 'Will transcript' },
            participants: [{ role: 'father', agentId: george.personId }]
        })
        await saveBirth({
            store,
            personId: first.personId,
            evidence: { title: 'Parish certificate' },
            participants: [{ role: 'father', agentId: george.personId }]
        })
        const tree = await loadTree({ store, rootId: first.personId })
        expect(node(tree, first.personId).contested).toBe(true)
        // One edge per DISTINCT parent pair — the duplicate claim is visible as
        // contested, not as two identical lines.
        expect(edgeTo(tree, first.personId)).toHaveLength(1)
    })

    test('mother + father from one record is NOT contested', async () => {
        const { store, ada } = await seedFamily()
        const tree = await loadTree({ store, rootId: ada.personId })
        expect(node(tree, ada.personId).contested).toBe(false)
        expect(tree.nodes.every(n => !n.contested)).toBe(true)
    })
})

describe('loadTree legacy (DEER v1)', () => {
    test('a v1 person with direct hasFather/hasMother still gets a tree', async () => {
        const store = createMemoryStore()
        const father = await store.create({ '@type': TYPES.Person, label: 'George Gordon' })
        const mother = await store.create({ '@type': TYPES.Person, label: 'Annabella Milbanke' })
        const v1 = {
            '@id': `${DEV}ADA1`,
            '@type': 'Person',
            name: 'Ada Byron',
            hasFather: father['@id'],
            hasMother: mother['@id']
        }
        for (const doc of convertLegacyEntity(v1)) await store.create(doc)

        const tree = await loadTree({ store, rootId: v1['@id'] })
        expect(tree.rootLabel).toBe('Ada Byron')
        expect(tree.nodes).toHaveLength(3)
        const parents = edgeTo(tree, v1['@id'])
        expect(parents).toHaveLength(2)
        expect(parents.map(edge => edge.from).sort()).toEqual([father['@id'], mother['@id']].sort())
        // No role/evidence claim was stored, and one shared source is not a
        // disagreement: render the tree, do not flag it contested.
        expect(node(tree, v1['@id']).contested).toBe(false)
        expect(parents.every(edge => edge.role === undefined)).toBe(true)
    })

    test('parentage asserted on a legacy Birth EVENT is recovered', async () => {
        const store = createMemoryStore()
        const father = await store.create({ '@type': TYPES.Person, label: 'George Gordon' })
        const child = await store.create({ '@type': TYPES.Person, label: 'Ada Byron' })
        const v1Event = {
            '@id': `${DEV}EVT1`,
            '@type': 'Birth',
            label: 'Birth of Ada',
            hasAgent: child['@id'],
            hasFather: father['@id'],
            evidence: `${DEV}REC1`
        }
        for (const doc of convertLegacyEntity(v1Event)) await store.create(doc)

        const tree = await loadTree({ store, rootId: child['@id'] })
        const parents = edgeTo(tree, child['@id'])
        expect(parents).toHaveLength(1)
        expect(parents[0].from).toBe(father['@id'])
        // The converter lifts the v1 doc's evidence into the hasParent VO, so
        // the edge names the Record; it lives outside the store, so the raw id
        // is all the model can honestly show.
        expect(parents[0].evidenceLabel).toBe(`${DEV}REC1`)
        expect(node(tree, father['@id']).gen).toBe(-1)
    })
})

describe('loadTree guard rails', () => {
    test('unknown root id returns null', async () => {
        const { store } = await seedFamily()
        expect(await loadTree({ store, rootId: `${DEV}nope` })).toBeNull()
    })

    test('missing rootId throws', async () => {
        const { store } = await seedFamily()
        await expect(loadTree({ store })).rejects.toThrow(TypeError)
    })

    test('legacy hasParent annotations targeting the child surface as edges', async () => {
        // v1 stored parentage as annotations on the CHILD too (the
        // deer-children-list shape); convertLegacyEntity maps the bare
        // hasParent key, so the derived read finds it with no extra code.
        const store = createMemoryStore()
        const father = await store.create({ '@type': TYPES.Person, label: 'George Gordon' })
        await store.create({
            '@id': `${DEV}ANNO1`,
            type: 'Annotation',
            target: `${DEV}ADA2`,
            body: { [NV.hasParent]: { value: father['@id'] } }
        })
        await store.create({ '@id': `${DEV}ADA2`, '@type': TYPES.Person, name: 'Ada Byron' })
        const tree = await loadTree({ store, rootId: `${DEV}ADA2` })
        expect(edgeTo(tree, `${DEV}ADA2`)).toHaveLength(1)
        expect(edgeTo(tree, `${DEV}ADA2`)[0].from).toBe(father['@id'])
    })
})
