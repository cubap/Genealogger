// Live devstore smoke test — the one path CI cannot cover: the RERUM adapter's
// real HTTP shapes against the running services. Writes a throwaway person to
// the DEV store and reads it back. Run manually:
//
//     node tests/live/smoke-devstore.mjs
//
// Exits non-zero on the first broken expectation. If this fails but the unit
// suite passes, the test double in tests/unit/adapters-rerum.test.js has drifted
// from the server — fix the double first, then the code.
import { saveBirth, loadBirth } from '../../js/model/birth.js'
import { createRerumStore } from '../../js/adapters/rerum-store.js'
import { setDefaultStore } from '../../js/model/default-store.js'
import { NV, EVENT_SUBTYPES, SCHEMA } from '../../js/model/vocabulary.js'

const stamp = new Date().toISOString()
setDefaultStore(createRerumStore())

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

if (failures.length) {
    console.error(`\n${failures.length} live check(s) failed`)
    process.exit(1)
}
console.log('\nall live devstore checks passed')
