// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the M3 parents vertical slice (issue #14 user story 7).
 *
 * Everything runs against the localStorage-backed store (`?store=local`), so the
 * journey needs no network and writes NOTHING to the shared devstore sandbox —
 * every test asserts that no devstore/rerum.io request was ever attempted.
 *
 * The slice's promise is that parentage is EVENT-DERIVED: the page records a
 * birth-family Event whose participants carry nv:mother / nv:father roles, and
 * the parent rows it displays are derived from that event. So these tests look at
 * both ends of the round trip — what the browser shows, and the documents the
 * browser actually persisted. Vocabulary URIs are read from the app's own modules
 * inside the page, because these specs run in CommonJS Node.
 */

const OFF_LIMITS = /devstore|rerum\.io/
const STORAGE_KEY = 'genealogger.localstore.v1'
const CHILD = 'https://devstore.rerum.io/v1/V1CHILD1'
const V1FATHER = 'https://devstore.rerum.io/v1/V1FATHER1'
const V1MOTHER = 'https://devstore.rerum.io/v1/V1MOTHER1'

/**
 * Fails the test if the page reaches for the real store at any point. Only the
 * host counts: local documents carry devstore-shaped ids, which show up in URLs.
 */
function watchForNetwork(page) {
    const offenders = []
    page.on('request', request => {
        if (OFF_LIMITS.test(new URL(request.url()).hostname)) offenders.push(request.url())
    })
    return offenders
}

/** Create a child through the birth page: the cheapest way to get a real event. */
async function createChild(page, { given, family, evidence }) {
    await page.goto('/birth.html?store=local')
    await page.fill('[deer-key="givenName"]', given)
    await page.fill('[deer-key="familyName"]', family)
    await page.fill('gl-evidence-picker input.title', evidence)
    await page.click('#birthForm input[type="submit"]')
    await expect(page).toHaveURL(/person=/)
    return new URL(page.url()).searchParams.get('person')
}

async function openParents(page, personId) {
    await page.goto(`/parents.html?store=local&person=${encodeURIComponent(personId)}`)
    await expect(page.locator('gl-parents-form')).toBeVisible()
    await expect(page.locator('#personBanner')).toBeVisible()
}

/** Record parentage through the retained DEER v1 surface vocabulary. */
async function submitParents(page, { father, mother, evidence, residence } = {}) {
    if (father !== undefined) await page.fill('[deer-key="hasFather"]', father)
    if (mother !== undefined) await page.fill('[deer-key="hasMother"]', mother)
    if (evidence !== undefined) {
        // The picker prefers a chosen existing document over typed text, so naming
        // a new source means going back to "— new document —" first.
        const existing = page.locator('gl-evidence-picker select.existing')
        if (await existing.count()) await existing.selectOption('')
        await page.fill('gl-evidence-picker input.title', evidence)
    }
    if (residence !== undefined) await page.fill('[deer-key="homeLocation"]', residence)
    await page.click('#parentsForm input[type="submit"]')
    await expect(page.locator('#saveStatus')).toContainText('Saved as a birth event')
}

/** The documents the page persisted, read out of the store's own storage. */
async function storedDocs(page) {
    const raw = await page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
}

/** The app's own term URIs, evaluated in the page rather than duplicated here. */
function vocabulary(page) {
    return page.evaluate(async () => {
        const { NV, EVENT_SUBTYPES } = await import('/js/model/vocabulary.js')
        return { NV, EVENT_SUBTYPES }
    })
}

/**
 * Seed documents the way the DEER v1 read fallback hands them over, using the
 * app's own converter so this fixture cannot drift from the adapter's behaviour.
 */
async function seedLegacy(page, entities) {
    const docs = await page.evaluate(async input => {
        const { convertLegacyEntity } = await import('/js/adapters/legacy.js')
        return input.flatMap(entity => convertLegacyEntity(entity))
    }, entities)
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)),
        [STORAGE_KEY, docs])
}

test.describe('Parents vertical slice', () => {
    test('records parents as a birth event and shows them derived, across a reload', async ({ page }) => {
        const offenders = watchForNetwork(page)
        const personId = await createChild(page, { given: 'Ada', family: 'Byron', evidence: 'Parish certificate' })
        await openParents(page, personId)
        await expect(page.locator('#existingParents')).toContainText('No parents recorded')

        await submitParents(page, {
            father: 'William Byron',
            mother: 'Anne Milbanke',
            evidence: 'Baptism register',
            residence: 'London'
        })

        // Read side: one row per claim, each naming the document behind it.
        await expect(page.locator('#existingParents gl-assertion')).toHaveCount(2)
        const motherRow = page.locator('gl-assertion').filter({ hasText: 'Anne Milbanke' }).first()
        await expect(motherRow).toContainText('Mother')
        await expect(motherRow).toContainText('Baptism register')
        await expect(page.locator('gl-assertion').filter({ hasText: 'William Byron' }).first()).toContainText('Father')
        await expect(page.locator('#existingResidence gl-assertion').first()).toContainText('London')

        // Which event says so: the participants, in their canonical roles.
        const roles = page.locator('#existingEvents .participant')
        await expect(roles.filter({ hasText: /^mother: Anne Milbanke/ })).toBeVisible()
        await expect(roles.filter({ hasText: /^father: William Byron/ })).toBeVisible()
        // The child is not listed as one of its own parents.
        await expect(roles.filter({ hasText: /^child:/ })).toHaveCount(0)

        // Write side: the Person document gained no v1 property, and the
        // parent -> child direction was never stored at all.
        const { NV } = await vocabulary(page)
        const docs = await storedDocs(page)
        const child = docs.find(doc => doc['@id'] === personId)
        expect(child.hasFather).toBeUndefined()
        expect(child.hasMother).toBeUndefined()
        expect(child.homeLocation).toBeUndefined()
        expect(child[NV.hasParent]).toBeUndefined()
        expect(child[NV.hasChild]).toBeUndefined()
        const derived = docs.filter(doc => doc.body && doc.body[NV.hasParent])
        expect(derived.length).toBeGreaterThanOrEqual(2)
        for (const anno of derived) expect(anno.body[NV.hasParent].evidence).toBeTruthy()

        // Survives reload — and ?store= survives with it, so the reload stays local.
        await page.reload()
        await expect(page).toHaveURL(/store=local/)
        await expect(page.locator('#existingParents gl-assertion')).toHaveCount(2)
        await expect(page.locator('#personBanner')).toContainText('Ada Byron')
        await expect(page.locator('#existingChildren')).toContainText('No children derived')

        // The other side of the same events: the mother's page derives the child,
        // which is why nv:hasChild never has to be written.
        const motherDoc = docs.find(doc => doc.label === 'Anne Milbanke')
        await openParents(page, motherDoc['@id'])
        await expect(page.locator('#personBanner')).toContainText('Anne Milbanke')
        await expect(page.locator('#existingChildren gl-assertion').filter({ hasText: 'Ada Byron' })).toBeVisible()
        await expect(page.locator('#existingParents')).toContainText('No parents recorded')

        expect(offenders).toEqual([])
    })

    test('two disagreeing sources for the same mother stay two visible rows', async ({ page }) => {
        const offenders = watchForNetwork(page)
        const personId = await createChild(page, { given: 'Ada', family: 'Byron', evidence: 'Parish certificate' })
        await openParents(page, personId)
        // No document named: the claim joins the birth event the birth page filed.
        await submitParents(page, { mother: 'Anne Milbanke', father: 'William Byron' })

        // A second source naming a different mother: recorded beside, not over.
        await submitParents(page, { mother: 'Isabella Milbanke', evidence: 'Family bible' })

        await expect(page.locator('#existingParents gl-assertion').filter({ hasText: 'Anne Milbanke' }).first())
            .toContainText('Parish certificate')
        await expect(page.locator('#existingParents gl-assertion').filter({ hasText: 'Isabella Milbanke' }).first())
            .toContainText('Family bible')
        const mothers = page.locator('#existingParents gl-assertion').filter({ hasText: 'Mother' })
        await expect(mothers).toHaveCount(2)
        await expect(page.locator('#existingParents .hint')
            .filter({ hasText: /sources disagree about this person's mother/ })).toBeVisible()
        // Two sources means two events: nothing merged them into one "truth".
        await expect(page.locator('#existingEvents fieldset')).toHaveCount(2)
        // A father resubmitted under the second document is corroboration, not a
        // contest, so the page must not cry disagreement about an agreement.
        await expect(page.locator('#existingParents .hint').filter({ hasText: /father/ })).toHaveCount(0)

        await page.reload()
        await expect(mothers).toHaveCount(2)
        expect(offenders).toEqual([])
    })

    test('a person whose parents only exist in the DEER v1 shape still opens', async ({ page }) => {
        const offenders = watchForNetwork(page)
        // v1 parents.html wrote hasFather/hasMother straight onto the Person; the
        // shared read fallback delivers them as nv:hasParent claims with no event
        // behind them, which is exactly what a migrating reader must survive.
        await page.goto('/parents.html?store=local')
        await seedLegacy(page, [
            { '@id': CHILD, '@type': 'Person', name: 'Ada Byron', hasFather: V1FATHER, hasMother: V1MOTHER, homeLocation: 'London' },
            { '@id': V1FATHER, '@type': 'Person', name: 'William Byron' },
            { '@id': V1MOTHER, '@type': 'Person', name: 'Anne Milbanke' }
        ])

        await openParents(page, CHILD)
        await expect(page.locator('#personBanner')).toContainText('DEER v1')
        await expect(page.locator('#existingParents gl-assertion')).toHaveCount(2)
        await expect(page.locator('#existingParents gl-assertion').filter({ hasText: 'William Byron' }))
            .toContainText('from v1 record')
        await expect(page.locator('#existingResidence gl-assertion').first()).toContainText('London')
        // There is no event to attribute the legacy claims to.
        await expect(page.locator('#existingEvents fieldset')).toHaveCount(0)

        // The v1 shape lost which parent was which, so the reader says so here and
        // the first save from this page writes ONLY the new shape.
        // The rows arrive name-filled and pointing at the v1 person ids, so the
        // migrating save reuses those people instead of inventing duplicates.
        const added = page.locator('#parentsForm [data-participant]:not([data-parent-role])')
        await expect(added).toHaveCount(2)
        await expect(added.nth(0).locator('[data-participant-name]')).toHaveValue('Anne Milbanke')
        await added.nth(0).locator('[data-role]').selectOption('mother')
        await expect(added.nth(1).locator('[data-participant-name]')).toHaveValue('William Byron')
        await added.nth(1).locator('[data-role]').selectOption('father')
        await submitParents(page, { evidence: 'Reconciled from the v1 card' })

        const { NV, EVENT_SUBTYPES } = await vocabulary(page)
        const saved = await storedDocs(page)
        expect(saved.some(doc => (doc['@type'] || []).includes(EVENT_SUBTYPES.Birth))).toBe(true)
        const parentRoles = saved
            .filter(doc => doc.body && doc.body[NV.role])
            .map(doc => doc.body[NV.role].value)
            .filter(role => [NV.mother, NV.father].includes(role))
        expect(new Set(parentRoles).size).toBe(2)
        const person = saved.find(doc => doc['@id'] === CHILD)
        expect(person.hasFather).toBeUndefined()
        expect(person.hasMother).toBeUndefined()
        // Both claims now have an event behind them; the v1 rows are still shown.
        await expect(page.locator('#existingParents gl-assertion').filter({ hasText: 'William Byron' })).toHaveCount(2)
        await expect(page.locator('#existingEvents fieldset')).toHaveCount(1)
        expect(offenders).toEqual([])
    })

    test('picks the child from the person list when the URL names nobody', async ({ page }) => {
        const offenders = watchForNetwork(page)
        const personId = await createChild(page, { given: 'Ada', family: 'Byron', evidence: 'Parish certificate' })
        await openParents(page, personId)
        await submitParents(page, { mother: 'Anne Milbanke', evidence: 'Parish certificate' })

        await page.goto('/parents.html?store=local')
        await expect(page.locator('#personPicker')).toBeVisible()
        await page.fill('#childFilter input', 'Ada')
        await expect(page.locator('#pickerStatus')).toContainText('Pick the child')
        await page.locator('#childList gl-person-chip').first().click()

        // Deep-link contract kept: ?person= names the child, and ?store= survives.
        await expect(page).toHaveURL(/person=/)
        expect(new URL(page.url()).searchParams.get('person')).toBe(personId)
        await expect(page).toHaveURL(/store=local/)
        await expect(page.locator('#personBanner')).toContainText('Ada Byron')
        await expect(page.locator('#existingParents gl-assertion').filter({ hasText: 'Anne Milbanke' })).toBeVisible()
        await expect(page.locator('#personPicker')).toBeHidden()

        expect(offenders).toEqual([])
    })

    test('the evidence document is a separate thing from the claim it supports', async ({ page }) => {
        const offenders = watchForNetwork(page)
        const personId = await createChild(page, { given: 'Ada', family: 'Byron', evidence: 'Parish certificate' })
        await openParents(page, personId)

        // Blank the prefilled document, then try to file a claim with no named source.
        await page.fill('[deer-key="hasMother"]', 'Anne Milbanke')
        await page.selectOption('gl-evidence-picker select.existing', '')
        await page.fill('gl-evidence-picker input.title', '')
        await page.click('#parentsForm input[type="submit"]')
        await expect(page.locator('#saveStatus')).toContainText('requires evidence')
        await expect(page.locator('#existingParents gl-assertion')).toHaveCount(0)

        await page.fill('gl-evidence-picker input.title', 'Census, 1821')
        await page.click('#parentsForm input[type="submit"]')
        await expect(page.locator('#existingParents gl-assertion').filter({ hasText: 'Anne Milbanke' }))
            .toContainText('Census, 1821')

        // Choosing the document that already evidences an event joins that event
        // instead of starting a duplicate.
        await page.selectOption('gl-evidence-picker select.existing', { label: 'Census, 1821' })
        await page.fill('[deer-key="hasFather"]', 'William Byron')
        await page.click('#parentsForm input[type="submit"]')
        const census = page.locator('#existingEvents fieldset').filter({ hasText: 'Census, 1821' })
        await expect(census.locator('.participant')).toHaveCount(2)
        await expect(page.locator('#existingParents gl-assertion')).toHaveCount(2)

        expect(offenders).toEqual([])
    })
})
