// Live devstore smoke test — the one path CI cannot cover: the RERUM adapter's
// real HTTP shapes against the running services. Writes a throwaway person to
// the DEV store and reads it back, then makes a read-only pass over the DEER v1
// data that store also holds. Run manually:
//
//     node tests/live/smoke-devstore.mjs
//
// Exits non-zero on the first broken expectation. If this fails but the unit
// suite passes, the test double in tests/unit/adapters-rerum.test.js has drifted
// from the server — fix the double first, then the code.
import { saveBirth, loadBirth } from '../../js/model/birth.js'
import { createRerumStore } from '../../js/adapters/rerum-store.js'
import { setDefaultStore } from '../../js/model/default-store.js'
import { NV, EVENT_SUBTYPES, SCHEMA, typeTokens } from '../../js/model/vocabulary.js'
import { participations } from '../../js/model/events.js'
import { eventsForPerson, assertionsOn } from '../../js/model/search.js'

const stamp = new Date().toISOString()
const store = createRerumStore()
setDefaultStore(store)

const failures = []
function check(label, ok, detail) {
    if (ok) {
        console.log(`  ok   ${label}`)
    } else {
        failures.push(label)
        console.error(`  FAIL ${label}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)}`}`)
    }
}

console.log(`saving a throwaway birth record to devstore (${stamp})`)
const saved = await saveBirth({
    name: { given: 'Smoke', family: 'Probe' },
    gender: 'unknown',
    birthDate: '1899-01-01',
    birthPlace: 'Testland',
    evidence: { title: `devstore smoke ${stamp}`, confidence: 0.9 },
    confidences: { birthDate: 0.6 },
    participants: [{ role: 'mother', name: { given: 'Anne', family: 'Probe' }, confidence: 0.9 }]
})
console.log(`  person ${saved.personId}\n  event  ${saved.eventId}`)

const loaded = await loadBirth({ personId: saved.personId })

check('person reads back as new-shape (no legacy pseudo-annotations)', loaded.legacy === false, loaded.legacy)
check('the event is reachable from the person via the rel index', loaded.events.length === 1, loaded.events.length)
check('the event is a Birth', loaded.events[0]?.subtype === EVENT_SUBTYPES.Birth, loaded.events[0]?.subtype)

const roles = (loaded.events[0]?.participants ?? []).map(p => p.role)
check('participations carry canonical role URIs', roles.includes(NV.child) && roles.includes(NV.mother), roles)

const birthDate = loaded.assertions[SCHEMA.birthDate]
check('birthDate round-trips', birthDate?.value === '1899-01-01', birthDate)
check('per-field confidence survives the round trip', birthDate?.[NV.confidence] === 0.6, birthDate?.[NV.confidence])
check('the source record is stored, not every annotation', !('type' in loaded.assertions) && !('target' in loaded.assertions), Object.keys(loaded.assertions))

const hasParent = loaded.assertions[NV.hasParent]
const parentVo = Array.isArray(hasParent) ? hasParent[0] : hasParent
check('nv:hasParent is derived from the nv:mother participation', Boolean(parentVo?.value), hasParent)
check('the derived parent resolves to a person label', Boolean(parentVo?.value && loaded.personLabels[parentVo.value]), loaded.personLabels)
check('assertion provenance names the source document', loaded.evidenceLabels[saved.eventId] === `devstore smoke ${stamp}`, loaded.evidenceLabels)

// ── read-only legacy leg ─────────────────────────────────────────────────────
// Nothing below writes. Two facts about the real store can only be learned from
// the real store, and the whole legacy read path depends on them:
//   1. A DEER v1 event is stored as '@type: "Birth"' while a new-shape event is
//      '@type: ["Event", "…/nv#Birth"]', so each generation is only findable
//      under its own token. That is what typeTokens() buys.
//   2. DEER v1 documents carry no `rel`, so the reverse index can never find
//      them and only the bounded enumeration in search.js can.
console.log('\nDEER v1 documents already in devstore (read-only)')
try {
    const v1 = await store.listByType('Birth')
    const v2 = await store.listByType(EVENT_SUBTYPES.Birth)
    check('listByType finds DEER v1 events under the bare type name', v1.length > 0, v1.length)
    check('listByType finds new-shape events under the subtype URI', v2.length > 0, v2.length)
    check('the two generations are disjoint — one token cannot find both',
        !v1.some(event => v2.some(fresh => fresh['@id'] === event['@id'])),
        v1.map(event => event['@id']).slice(0, 3))
    const annos = await assertionsOn({ store, targetId: v1[0]['@id'] })
    check('a v1 event migrates its own properties into readable legacy annotations',
        annos.some(anno => String(anno['@id']).includes('#legacy-')), annos.length)
    // Limitation worth printing rather than asserting: the 2023 v1 demo corpus
    // stores event facts as bare `date` / `location`, which mapKey() passes
    // through unchanged, so they arrive under a non-URI property and no model
    // page reads them yet. A one-time migration (or a LEGACY_KEY_MAP entry) owns
    // that; until then the fields show as lacunae, not as wrong data.
    const bare = annos.filter(anno => Object.keys(anno.body ?? {}).some(k => !k.includes('/') && !k.includes('#')))
    if (bare.length) console.log(`  note ${bare.length} v1 annotation(s) use unmapped bare property names (date/location) and are not read by any page yet`)
    console.log(`  note ${v1.length} v1 + ${v2.length} new-shape births listed; /query has no paging (10-row ceiling), so both are floors`)

    const sample = v1.find(event => event['@id'])
    const rows = sample ? await participations({ store, event: sample }) : []
    const child = rows.find(row => row.role === NV.child)?.agent
    if (child) {
        const found = await eventsForPerson({
            store,
            personId: child,
            role: NV.child,
            legacyTypes: typeTokens(EVENT_SUBTYPES.Birth)
        })
        check('eventsForPerson reaches an un-indexed v1 event through the bounded scan',
            found.some(event => event['@id'] === sample['@id']), found.length)
    } else {
        // The v1 corpus in devstore is the 2023 mm-prototype demo: events with
        // date and location but no agent link to any person, so there is no
        // legacy reverse lookup to prove here. Assert the honest weaker claim:
        // the scan runs against real data and comes back empty instead of
        // throwing or scanning the whole collection.
        console.log(`  skip no v1 Birth in devstore names a person (checked ${v1.length}); proving the scan stays empty instead`)
        const found = await eventsForPerson({
            store,
            personId: sample?.['@id'] ?? 'https://devstore.rerum.io/v1/id/000000000000000000000000',
            role: NV.child,
            legacyTypes: typeTokens(EVENT_SUBTYPES.Birth)
        })
        check('the bounded scan returns nothing for an unlinked person rather than throwing', found.length === 0, found.length)
    }
} catch (err) {
    check('the read-only legacy leg completes', false, String(err?.message ?? err))
}

if (failures.length) {
    console.error(`\n${failures.length} live check(s) failed`)
    process.exit(1)
}
console.log('\nall live devstore checks passed')
