/**
 * Tests for the RERUM store adapter using an injected fake fetch — no network.
 * Covers the Store contract surface, create/read round-trip, target queries, and
 * the lazy legacy migration that makes a DEER v1 entity open as new-shape
 * assertions (constraint #6). Endpoints here are the adapter's own request
 * shapes; they assert the adapter's logic, not devstore's live API.
 */

import { createRerumStore } from '../../js/adapters/rerum-store.js'
import { assertStore, STORE_METHODS } from '../../js/adapters/store.js'
import { NV, SCHEMA } from '../../js/model/vocabulary.js'

const BASE = 'https://fake.test/v1'

function makeFakeFetch() {
    const docs = new Map()
    let counter = 0
    const reply = body => ({ ok: true, status: 200, json: async () => body })
    const fetchImpl = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase()
        const path = url.replace(/^https?:\/\/[^/]+/, '')
        if (method === 'POST' && path.endsWith('/create')) {
            const doc = JSON.parse(init.body)
            const id = doc['@id'] || `${BASE}/id/gen-${++counter}`
            const stored = { ...doc, '@id': id }
            docs.set(id, stored)
            return reply(stored)
        }
        if (method === 'POST' && path.endsWith('/query')) {
            const filter = JSON.parse(init.body)
            const rows = [...docs.values()].filter(doc => {
                if (filter.target !== undefined && doc.target !== filter.target) return false
                if (filter.type === 'Annotation' && doc.type !== 'Annotation') return false
                return true
            })
            return reply(rows)
        }
        if (method === 'GET') {
            const doc = docs.get(url)
            return doc ? reply(doc) : { ok: false, status: 404, json: async () => null }
        }
        return { ok: false, status: 400, json: async () => null }
    }
    return { fetchImpl, docs }
}

function storeWith(docs) {
    const fake = makeFakeFetch()
    if (docs) for (const [id, doc] of docs) fake.docs.set(id, doc)
    const store = createRerumStore({
        fetchImpl: fake.fetchImpl,
        writeBase: BASE,
        queryBase: BASE,
        readBases: [BASE]
    })
    return { store, fake }
}

describe('RerumStore contract', () => {
    test('implements every documented store method', () => {
        const { store } = storeWith()
        for (const method of STORE_METHODS) expect(typeof store[method]).toBe('function')
        expect(() => assertStore(store)).not.toThrow()
    })
})

describe('RerumStore round-trip', () => {
    test('create mints an id and read returns a new-shape entity', async () => {
        const { store } = storeWith()
        const created = await store.create({ '@type': 'Person', label: 'Ada' })
        expect(created['@id']).toMatch(/^https:\/\/fake\.test\/v1\/id\//)
        const read = await store.read(created['@id'])
        expect(read).toMatchObject({ '@id': created['@id'], '@type': 'Person', label: 'Ada' })
    })

    test('query returns annotations targeting an id', async () => {
        const { store } = storeWith()
        const person = await store.create({ '@type': 'Person', label: 'Ada' })
        await store.create({ type: 'Annotation', target: person['@id'], body: { [SCHEMA.birthDate]: { value: '1815-12-10' } } })
        await store.create({ type: 'Annotation', target: 'other', body: { [SCHEMA.name]: { value: 'x' } } })
        const annos = await store.query({ target: person['@id'] })
        expect(annos).toHaveLength(1)
        expect(annos[0].body[SCHEMA.birthDate].value).toBe('1815-12-10')
    })

    test('remove is a soft no-op (append-only store)', async () => {
        const { store } = storeWith()
        expect(await store.remove('anything')).toBe(false)
    })
})

describe('RerumStore lazy legacy migration', () => {
    const legacyId = `${BASE}/id/legacy-1`
    const legacyEntity = {
        '@id': legacyId,
        '@type': 'Person',
        name: 'Ada Byron',
        givenName: 'Ada',
        birthDate: '1815-12-10',
        evidence: `${BASE}/id/rec-legacy`,
        __rerum: { history: { next: [] } }
    }

    test('reads a legacy entity as a bare new-shape entity', async () => {
        const { store } = storeWith([[legacyId, legacyEntity]])
        const read = await store.read(legacyId)
        expect(read).toMatchObject({ '@id': legacyId, '@type': 'Person', label: 'Ada Byron' })
        expect(read.birthDate).toBeUndefined()
    })

    test('surfaces legacy facts as migrated assertions on a target query', async () => {
        const { store } = storeWith([[legacyId, legacyEntity]])
        const annos = await store.query({ target: legacyId })
        expect(annos.length).toBeGreaterThan(0)
        expect(annos.some(a => a['@id'].includes('#legacy-'))).toBe(true)
        const dates = annos.flatMap(a => Object.entries(a.body))
            .filter(([prop]) => prop === SCHEMA.birthDate)
            .map(([, vo]) => (Array.isArray(vo) ? vo[0].value : vo.value))
        expect(dates).toContain('1815-12-10')
    })

    test('new-shape entities pass through migration unchanged', async () => {
        const { store } = storeWith()
        const created = await store.create({ '@type': 'Person', label: 'Ada' })
        const annos = await store.query({ target: created['@id'] })
        expect(annos).toHaveLength(0)
    })

    test('hasParent derived value survives a round-trip read', async () => {
        const id = `${BASE}/id/legacy-parent`
        const entity = { '@id': id, '@type': 'Person', name: 'George', hasFather: `${BASE}/id/grand`, __rerum: {} }
        const { store } = storeWith([[id, entity]])
        const annos = await store.query({ target: id })
        const parent = annos.flatMap(a => Object.keys(a.body)).includes(NV.hasParent)
        expect(parent).toBe(true)
    })
})
