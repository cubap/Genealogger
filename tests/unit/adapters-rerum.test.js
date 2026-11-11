/**
 * Tests for the RERUM store adapter using an injected fake fetch — no network.
 * Covers the Store contract surface, create/read round-trip, target queries, and
 * the lazy legacy migration that makes a DEER v1 entity open as new-shape
 * assertions (constraint #6). Endpoints here are the adapter's own request
 * shapes; they assert the adapter's logic, not devstore's live API.
 */

import { createRerumStore, RerumStore } from '../../js/adapters/rerum-store.js'
import config from '../../js/model/config.js'
import { assertStore, STORE_METHODS } from '../../js/adapters/store.js'
import { NV, SCHEMA, EVENT_SUBTYPES } from '../../js/model/vocabulary.js'
import { saveBirth, loadBirth } from '../../js/model/birth.js'

const BASE = 'https://fake.test/v1'

/**
 * Walk a dot-separated path. Splitting blindly on '.' is not a shortcut — it is
 * what the real service does, which is why a path segment that is itself a
 * dotted URL (`body.https://schema.org/x.value`) can never be matched. The fake
 * reproduces that limitation so no test can rely on a filter devstore cannot
 * answer.
 */
function resolvePath(doc, key) {
    return key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), doc)
}

/** One `key: clause` pair of a devstore query filter, Mongo-style. */
function matchesClause(doc, key, clause) {
    const actual = resolvePath(doc, key)
    if (clause && typeof clause === 'object' && !Array.isArray(clause)) {
        if (clause.$exists && (actual !== undefined) !== Boolean(clause.$exists)) return false
        if (clause.$size !== undefined && (!Array.isArray(actual) || actual.length !== clause.$size)) return false
        return true
    }
    if (actual === clause) return true
    // Mongo matches a scalar against any element of an array field.
    return Array.isArray(actual) && actual.includes(clause)
}

function makeFakeFetch() {
    const docs = new Map()
    let counter = 0
    const reply = body => ({ ok: true, status: 200, json: async () => body })
    const fetchImpl = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase()
        const path = url.replace(/^https?:\/\/[^/]+/, '')
        if (method === 'POST' && path.endsWith('/create')) {
            const doc = JSON.parse(init.body)
            // The real service ignores a client-sent '@id', mints its own, and
            // stamps RERUM versioning metadata on what it stores.
            const id = `${BASE}/id/gen-${++counter}`
            const stored = { ...doc, '@id': id, __rerum: { history: { next: [], previous: '', prime: id } } }
            docs.set(id, stored)
            return reply(stored)
        }
        if (method === 'PUT' && path.endsWith('/update')) {
            // Mirrors the real service: the body carries the doc, the answer is
            // a NEW version under a fresh id, and the old version links forward.
            const doc = JSON.parse(init.body)
            const previous = docs.get(doc['@id'])
            const id = `${BASE}/id/gen-${++counter}`
            const stored = { ...doc, '@id': id, __rerum: { history: { next: [], previous: doc['@id'], prime: previous?.__rerum?.history?.prime || doc['@id'] } } }
            if (previous?.__rerum?.history) previous.__rerum.history.next = [id]
            docs.set(id, stored)
            return reply(stored)
        }
        if (method === 'POST' && path.endsWith('/query')) {
            const filter = JSON.parse(init.body)
            const rows = [...docs.values()].filter(doc =>
                Object.entries(filter).every(([key, clause]) => matchesClause(doc, key, clause)))
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

describe('RerumStore write contract', () => {
    // These endpoints were confirmed against the live services: devstore only
    // serves GETs, tinydev serves create/query/update. An earlier cut of the
    // adapter posted to devstore and every browser save 404'd.
    test('config splits the document host from the write/query service', () => {
        expect(config.URLS.API_BASE).toBe('https://tinydev.rerum.io')
        expect(config.URLS.BASE_URI).toBe('https://devstore.rerum.io/v1')
    })

    test('defaults send writes and queries to API_BASE, reads to the document bases', () => {
        const store = createRerumStore({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })
        expect(store.writeBase).toBe(config.URLS.API_BASE)
        expect(store.queryBase).toBe(config.URLS.API_BASE)
        expect(store.readBases).toEqual(config.URLS.READ_BASE_URIS)
    })

    test('create returns the server-minted id, not a client-supplied one', async () => {
        const { store } = storeWith()
        const created = await store.create({ '@id': 'https://elsewhere.test/id/mine', '@type': ['Person'], label: 'X' })
        expect(created['@id']).not.toBe('https://elsewhere.test/id/mine')
        expect(created['@id']).toMatch(/\/id\/gen-/)
    })

    test('update PUTs /update with no id in the path and yields a new version', async () => {
        const { store, fake } = storeWith()
        const first = await store.create({ '@type': ['Person'], label: 'Before' })
        const second = await store.update({ ...first, label: 'After' })
        expect(second['@id']).not.toBe(first['@id'])
        expect(second.label).toBe('After')
        expect(fake.docs.get(first['@id']).__rerum.history.next).toEqual([second['@id']])
    })
})

describe('store-bootstrap selection', () => {
    // The browser default is a spec decision (user story 15 of #12): a saved
    // birth record must be real devstore data, as the legacy page did.
    test('browser default is the real RerumStore, not a local sketch', async () => {
        const { resolveStore } = await import('../../js/adapters/store-bootstrap.js')
        expect(await resolveStore({ search: '' })).toBeInstanceOf(RerumStore)
    })

    test('?store=local opts into localStorage for deterministic E2E', async () => {
        const { resolveStore } = await import('../../js/adapters/store-bootstrap.js')
        const { LocalStore } = await import('../../js/adapters/local-store.js')
        expect(await resolveStore({ search: '?store=local' })).toBeInstanceOf(LocalStore)
    })

    test('the resolved store becomes the model layer default', async () => {
        const { resolveStore } = await import('../../js/adapters/store-bootstrap.js')
        const { getDefaultStore } = await import('../../js/model/default-store.js')
        const store = await resolveStore({ search: '?store=memory' })
        expect(getDefaultStore()).toBe(store)
    })

    test('unknown kinds fail loudly instead of silently picking a store', async () => {
        const { createStore } = await import('../../js/adapters/store-bootstrap.js')
        await expect(createStore('postgres')).rejects.toThrow(/unknown store kind/)
    })
})

describe('RerumStore against a devstore-shaped service', () => {
    // The model layer is store-agnostic, so memory-backed tests cannot catch a
    // shape the REAL service imposes. These run the whole birth vertical
    // against a fake that mints ids, stamps __rerum metadata, drops superseded
    // versions, and refuses dotted-path filters, exactly like devstore.
    test('a new-shape annotation is not mistaken for legacy on read', async () => {
        const { store } = storeWith()
        const person = await store.create({ '@type': 'Person', label: 'Ada' })
        const property = 'https://schema.org/birthDate'
        await store.create({
            type: 'Annotation',
            target: person['@id'],
            body: { [property]: { value: '1815-12-10' } }
        })
        const annos = await store.query({ target: person['@id'] })
        expect(annos).toHaveLength(1)
        expect(annos[0]['@id']).not.toContain('#legacy-')
        expect(annos[0].body[property].value).toBe('1815-12-10')
    })

    test('rel is answered server-side; a body URI never is', async () => {
        const { store, fake } = storeWith()
        const person = await store.create({ '@type': 'Person', label: 'Ada' })
        await store.create({
            type: 'Annotation',
            target: `${BASE}/id/some-event`,
            rel: [person['@id']],
            body: { [NV.participant]: { value: person['@id'] }, [NV.role]: { value: NV.child } }
        })
        const posts = []
        const spy = createRerumStore({
            fetchImpl: async (url, init) => {
                if (init && String(init.method).toUpperCase() === 'POST' && url.endsWith('/query')) {
                    posts.push(JSON.parse(init.body))
                }
                return fake.fetchImpl(url, init)
            },
            writeBase: BASE,
            queryBase: BASE,
            readBases: [BASE]
        })
        const hits = await spy.query({ rel: person['@id'], type: NV.participant })
        expect(hits).toHaveLength(1)
        expect(hits[0].target).toBe(`${BASE}/id/some-event`)
        expect(posts[0].rel).toBe(person['@id'])
        // Proof the shortcut is not just dead weight: the same lookup expressed
        // as a body path finds nothing, because the URI contains dots.
        expect(await spy.query({ rel: 'no-such-id' })).toHaveLength(0)
    })

    test('a query that could only be answered by scanning the collection fails loudly', async () => {
        const { store } = storeWith()
        await expect(store.query({ type: NV.participant, value: `${BASE}/id/x` }))
            .rejects.toThrow(/requires a target or a rel/)
    })

    test('saveBirth/loadBirth round-trips the event, participants and evidence', async () => {
        const { store, fake } = storeWith()
        const saved = await saveBirth({
            store,
            name: { given: 'Ada', family: 'Byron' },
            gender: 'female',
            birthDate: '1815-12-10',
            birthPlace: 'London',
            evidence: { title: 'Parish register' },
            confidences: { birthDate: 0.6 },
            participants: [{ role: 'mother', name: { given: 'Anne', family: 'Byron' } }]
        })
        const loaded = await loadBirth({ store, personId: saved.personId })

        // The event is reached through the participation's rel index.
        expect(loaded.events).toHaveLength(1)
        expect(loaded.events[0].event['@id']).toBe(saved.eventId)
        expect(loaded.events[0].subtype).toBe(EVENT_SUBTYPES.Birth)
        expect(loaded.events[0].participants.map(p => p.role)).toContain(NV.child)

        // Roles are canonical URIs, never the bare token the form passed in,
        // and a sexed role still derives nv:hasParent on the child.
        const mother = loaded.events[0].participants.find(p => p.role !== NV.child)
        expect(mother.role).toBe(NV.mother)
        const derived = loaded.assertions[NV.hasParent]
        expect(derived).toBeTruthy()
        expect((Array.isArray(derived) ? derived : [derived])[0].value).toBe(mother.agent)
        expect(loaded.personLabels[mother.agent]).toBe('Anne Byron')

        // Facts come back as their own assertions, per-field confidence intact,
        // nothing mangled into legacy pseudo-annotations by the migration layer.
        expect(loaded.assertions['https://schema.org/birthDate'].value).toBe('1815-12-10')
        expect(loaded.assertions['https://schema.org/birthDate'][NV.confidence]).toBe(0.6)
        expect(Object.keys(loaded.assertions)).not.toContain('type')
        expect(Object.keys(loaded.assertions)).not.toContain('target')
        expect(loaded.legacy).toBe(false)
        expect(loaded.evidenceLabels[saved.eventId]).toBe('Parish register')

        const participations = [...fake.docs.values()].filter(doc => doc.rel && doc.body && doc.body[NV.participant])
        expect(participations.length).toBeGreaterThan(0)
        // Every participation is reachable from BOTH ends: its agent and its event.
        expect(participations.every(doc => doc.rel.includes(saved.eventId))).toBe(true)
        expect(participations.some(doc => doc.rel.includes(saved.personId))).toBe(true)
        expect(participations.some(doc => !doc.rel.includes(saved.personId))).toBe(true)
    })
})

