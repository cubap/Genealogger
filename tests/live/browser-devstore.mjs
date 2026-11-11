// Live browser smoke — the one path nothing else covers: a gl-* page, in a real
// browser, reading real devstore data through RerumStore. CI runs the journeys
// against `?store=local` (they must not touch shared data), and
// tests/live/smoke-devstore.mjs proves the adapter from Node. Neither proves the
// browser stack end to end: module loading from a plain static server, the
// devstore CORS shape, the annotation fan-out resolving into rendered rows.
//
//     node tests/live/browser-devstore.mjs
//
// It writes stamped records (devstore is the sandbox; the node smoke already
// does this) and then drives the pages with EVERY write request aborted at the
// network layer, so the browser leg cannot mutate the store even if a page
// regressed into saving on load. Records are left behind, like the node smoke's.
//
// Pages covered: index (list), birth, death, person (hub), parents, tree.
// Add a leg here when a page lands — it is the only proof that a page reads real
// devstore data, and it has already caught two browser-only adapter defects that
// no injected-fake test could see.
//
// Exits non-zero on the first broken expectation. If this fails but
// smoke-devstore.mjs passes, the defect is in the page/component layer or in how
// the browser reaches devstore — not in the adapter's HTTP shapes.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

import { createRerumStore } from '../../js/adapters/rerum-store.js'
import { setDefaultStore } from '../../js/model/default-store.js'
import { saveBirth } from '../../js/model/birth.js'
import { saveDeath } from '../../js/model/death.js'
import { saveParents } from '../../js/model/parents.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const stamp = new Date().toISOString()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

const failures = []
function check(label, ok, detail) {
    if (ok) {
        console.log(`  ok   ${label}`)
    } else {
        failures.push(label)
        console.error(`  FAIL ${label}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)}`}`)
    }
}

/** A static file server, so the page graph loads the same way `npm run serve` does. */
function serve() {
    return new Promise(resolve => {
        const server = createServer(async (req, res) => {
            const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
            const file = normalize(join(ROOT, path === '/' ? 'index.html' : path))
            if (!file.startsWith(ROOT)) {
                res.writeHead(403).end()
                return
            }
            try {
                const body = await readFile(file)
                res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
                res.end(body)
            } catch {
                res.writeHead(404).end('not found')
            }
        })
        server.listen(0, '127.0.0.1', () => resolve(server))
    })
}

// ── seed: two stamped records, written the way the app writes them ───────────
const store = createRerumStore()
setDefaultStore(store)

console.log(`writing stamped records to devstore (${stamp})`)
const birth = await saveBirth({
    name: { given: 'Browser', family: 'Probe' },
    birthDate: '1898-05-05',
    birthPlace: 'Readshire',
    evidence: { title: `browser smoke birth ${stamp}`, confidence: 0.9 }
})
const death = await saveDeath({
    name: { given: 'Died', family: 'Probe' },
    deathDate: '1962-11-11',
    deathPlace: 'Writshire',
    evidence: { title: `browser smoke death ${stamp}`, confidence: 0.8 },
    participants: [{ role: 'witness', name: { given: 'John', family: 'Halo' } }]
})
console.log(`  birth person ${birth.personId}\n  death person ${death.personId}`)

// Link the two probes into a family, so the pages that read relationships
// (person, parents, tree) are exercised against real cross-document data rather
// than a lonely person with nothing to point at.
const parentage = await saveParents({
    personId: death.personId,
    parents: [{ role: 'mother', agentId: birth.personId }],
    evidence: { title: `browser smoke certificate ${stamp}`, confidence: 0.85 }
})
console.log(`  parentage event ${parentage.eventId}`)

const server = await serve()
const origin = `http://127.0.0.1:${server.address().port}`

// ── the browser, with writes refused at the network layer ────────────────────
const browser = await chromium.launch()
const context = await browser.newContext()
const attemptedWrites = []
let queries = 0
await context.route('**/*', route => {
    const { pathname } = new URL(route.request().url())
    const method = route.request().method()
    if (pathname.endsWith('/query')) queries++
    if (method !== 'GET' && method !== 'HEAD' && !pathname.endsWith('/query')) {
        attemptedWrites.push(`${method} ${pathname}`)
        return route.abort()
    }
    return route.continue()
})

const pageErrors = []
const consoleErrors = []
const page = await context.newPage()
page.on('pageerror', err => pageErrors.push(String(err && err.message || err)))
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

async function open(url) {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    return res && res.status()
}

/** Waits for `fn` to be true in the page; reports the failure instead of throwing. */
async function settle(fn, timeout = 30000) {
    try {
        await page.waitForFunction(fn, null, { timeout })
        return true
    } catch {
        return false
    }
}

function text(selector) {
    return page.locator(selector).innerText().catch(() => '')
}

function inputValue(selector) {
    return page.locator(selector).inputValue().catch(() => null)
}

try {
    console.log('\nindex.html?store=rerum (real person list, one identity read)')
    check('the index loads', (await open(`${origin}/index.html?store=rerum`)) === 200)
    await settle(() => document.querySelectorAll('#peopleList gl-person-chip').length > 0
        || !/Loading/.test(document.getElementById('indexStatus').textContent))
    const status = await text('#indexStatus')
    const chips = await page.locator('#peopleList gl-person-chip').count()
    check('chips render from live devstore', chips > 0, `${chips} chips; status: ${status}`)
    check('the live list honours the documented 10-document ceiling', chips <= 10, chips)

    console.log('\ndeath.html?store=rerum (one page reading one real person)')
    check('the death page loads', (await open(`${origin}/death.html?person=${encodeURIComponent(death.personId)}&store=rerum`)) === 200)
    await settle(() => !document.getElementById('personBanner').classList.contains('hidden'))
    const deathBanner = await text('#personBanner')
    check('the banner names the deceased', /Death record for Died Probe/.test(deathBanner), deathBanner)
    check('the migrated record is read as new-shape, not legacy', !/Legacy/.test(deathBanner), deathBanner)
    check('deathDate renders into the form', (await inputValue('#deathDate')) === '1962-11-11', await inputValue('#deathDate'))
    const deathRows = await page.locator('#existingDeath gl-assertion').count()
    check('resolved assertions render as rows', deathRows >= 2, deathRows)
    // gl-assertion renders inside a shadow root, so host innerText is empty by
    // design; read the documented `row` input each page hands the component.
    const evidenceLabels = await page.$$eval('#existingDeath gl-assertion',
        els => els.map(el => el.row && el.row.evidenceLabel).filter(Boolean))
    check('every row carries the evidence document it rests on',
        evidenceLabels.length > 0 && evidenceLabels.every(label => label.includes(`browser smoke death ${stamp}`)),
        JSON.stringify(evidenceLabels))
    check('the witness is a participant with a role', /witness: John Halo/.test(await text('#existingParticipants')), await text('#existingParticipants'))

    console.log('\nbirth.html?store=rerum (the M2 reference page)')
    check('the birth page loads', (await open(`${origin}/birth.html?person=${encodeURIComponent(birth.personId)}&store=rerum`)) === 200)
    await settle(() => !document.getElementById('personBanner').classList.contains('hidden'))
    const birthBanner = await text('#personBanner')
    check('the banner names the newborn', /Birth record for Browser Probe/.test(birthBanner), birthBanner)
    check('birthDate renders into the form',
        (await inputValue('input[deer-key="birthDate"]')) === '1898-05-05', await inputValue('input[deer-key="birthDate"]'))
    check('the birth page resolved its assertions', (await page.locator('#existingBirth gl-assertion').count()) >= 1)

    console.log('\nperson.html?store=rerum (the hub: one label rule, relations)')
    check('the person page loads', (await open(`${origin}/person.html?person=${encodeURIComponent(death.personId)}&store=rerum`)) === 200)
    await settle(() => !document.getElementById('personBanner').classList.contains('hidden'))
    const hubBanner = await text('#personBanner')
    // personLabel() is the one rule (#31); a bare id or UNLABELED here means the
    // hub grew a second label path again.
    check('the hub labels the person by rule, not by id', hubBanner.trim() === 'Died Probe', hubBanner)
    check('the hub shows no legacy warning for a new-shape record', !/legacy/i.test(hubBanner), hubBanner)
    check('the hub resolved assertions into rows', (await page.locator('#existingAssertions gl-assertion').count()) >= 2)
    const relations = await text('#existingRelations')
    check('the derived parent link is visible on the hub', /Parent: Browser Probe/.test(relations), relations)

    console.log('\nparents.html?store=rerum (parentage derived from an event)')
    check('the parents page loads', (await open(`${origin}/parents.html?person=${encodeURIComponent(death.personId)}&store=rerum`)) === 200)
    await settle(() => !document.getElementById('personBanner').classList.contains('hidden'))
    const parentsBanner = await text('#personBanner')
    check('the banner names the child', /^Parents of Died Probe/.test(parentsBanner), parentsBanner)
    check('the record reads as new-shape, not legacy', !/DEER v1/.test(parentsBanner), parentsBanner)
    const parentRows = await page.$$eval('#existingParents gl-assertion',
        els => els.map(el => ({ value: el.row && el.row.value, evidence: el.row && el.row.evidenceLabel })))
    check('the mother claim is a row naming its evidence document',
        parentRows.some(row => row.value === 'Browser Probe' && String(row.evidence).includes(`browser smoke certificate ${stamp}`)),
        JSON.stringify(parentRows))
    check('the birth-family event lists participants by role',
        /mother: Browser Probe/.test(await text('#existingEvents')), await text('#existingEvents'))

    console.log('\ntree.html?store=rerum (edges derived from events)')
    check('the tree page loads', (await open(`${origin}/tree.html?person=${encodeURIComponent(death.personId)}&store=rerum&generations=2`)) === 200)
    await settle(() => !document.getElementById('personBanner').classList.contains('hidden'))
    const treeBanner = await text('#personBanner')
    check('the banner counts the real people in scope', /Died Probe — 2 people within 2 generations/.test(treeBanner), treeBanner)
    // gl-tree-view renders into a shadow root; Playwright's CSS engine pierces it.
    const nodeIds = await page.$$eval('gl-tree-view g[data-person-id]',
        els => els.map(el => el.getAttribute('data-person-id')))
    check('both family members are drawn as nodes',
        nodeIds.includes(death.personId) && nodeIds.includes(birth.personId), nodeIds)
    // SVG <text> has no innerText; read the rendered label text directly.
    const edgeLabels = await page.$$eval('gl-tree-view text.edge-label', els => els.map(el => el.textContent))
    check('the edge is labelled with its role', edgeLabels.some(label => /mother/i.test(label)), edgeLabels)

    console.log('\nthe network layer')
    check('the pages really queried devstore', queries > 0, queries)
    check('no page wrote to devstore', attemptedWrites.length === 0, attemptedWrites)
    check('no uncaught error on any page', pageErrors.length === 0, pageErrors)
    // A blocked write surfaces as a console error too; devstore 4xx/5xx noise from
    // an unrelated origin would be a false alarm, so report but do not fail on it.
    if (consoleErrors.length) console.log(`  note ${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(' | ')}`)
} finally {
    if (pageErrors.length) console.error(`  page errors: ${pageErrors.slice(0, 5).join(' | ')}`)
    if (consoleErrors.length) console.error(`  console errors: ${consoleErrors.slice(0, 5).join(' | ')}`)
    await browser.close()
    server.close()
}

console.log(`\nleft in devstore: birth ${birth.personId}`)
console.log(`                   death ${death.personId}`)
if (failures.length) {
    console.error(`\n${failures.length} live browser check(s) failed`)
    process.exit(1)
}
console.log('\nall live browser checks passed')
