// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the M3 label slice on the new gl-* stack — the "give this Person a
 * display name" page, migrated off the orphaned DEER v1 label.html.
 *
 * The pages run against the LocalStore (`?store=local`, see store-bootstrap) so
 * the journey is deterministic, survives a reload, and writes nothing to the
 * shared devstore sandbox; the browser default remains the real
 * RerumStore/devstore. The person is seeded through the M2 birth page, exactly as
 * the other journeys do.
 *
 * What this proves that unit tests cannot:
 *   - the naming rule of docs/page-model-adapter.md holds across PAGES: recording a
 *     name here refreshes the Person's denormalized bare `label`, so the index —
 *     which reads identities only and cannot see annotations — shows the same
 *     string the label page shows,
 *   - a name is asserted as an evidenced fact, so two disagreeing sources coexist
 *     as two rows rather than one overwriting the other,
 *   - the legacy `label.html#<id>` URL still opens a person and is normalised to
 *     the `?person=<id>` deep-link contract the other pages use, without losing
 *     `?store=`,
 *   - no request ever leaves the page for devstore/rerum.io.
 */

/** Create one person through the birth slice and return its id. */
async function seedPerson(page, given = 'Ada', family = 'Byron') {
    await page.goto('/birth.html?store=local')
    await expect(page.locator('gl-birth-form')).toBeVisible()
    await page.fill('[deer-key="givenName"]', given)
    await page.fill('[deer-key="familyName"]', family)
    await page.fill('gl-evidence-picker input.title', 'Parish certificate')
    await page.click('#birthForm input[type="submit"]')
    await expect(page).toHaveURL(/person=/)
    return new URL(page.url()).searchParams.get('person')
}

/** Claim a display name on the label page. */
async function submitLabel(page, { name, evidence, confidence }) {
    await page.fill('[deer-key="name"]', name)
    await page.fill('gl-evidence-picker input.title', evidence)
    if (confidence) {
        await page.selectOption('#labelForm [data-confidence]', confidence)
    }
    await page.click('#labelForm input[type="submit"]')
    await expect(page.locator('#status')).toBeVisible()
}

async function openLabel(page, personId) {
    await page.goto(`/label.html?person=${encodeURIComponent(personId)}&store=local`)
    await expect(page.locator('gl-label-form')).toBeVisible()
}

test.describe('Label (display name) slice', () => {
    test('no legacy DEER v1 plumbing is left on the page', async ({ page }) => {
        const personId = await seedPerson(page)
        await openLabel(page, personId)

        const scripts = await page.evaluate(() =>
            Array.from(document.querySelectorAll('script')).map(s => s.getAttribute('src')).filter(Boolean)
        )
        expect(scripts).toEqual(['js/pages/label.js'])
        expect(await page.locator('form[deer-type]').count()).toBe(0)
        // The hidden targetCollection/creator inputs were legacy plumbing; the model
        // layer works out provenance itself.
        expect(await page.locator('#labelForm input[type="hidden"]').count()).toBe(0)
        // The dead "add a fact" links (no href at all) are gone; the live ones stay.
        expect(await page.locator('#adding a:not([href])').count()).toBe(0)
        for (const id of ['profileLink', 'birthLink', 'childLink', 'deathLink']) {
            await expect(page.locator(`#${id}`)).toHaveAttribute('href', /html/)
        }
    })

    test('a new display name reaches the index, which can only read the cache', async ({ page }) => {
        const personId = await seedPerson(page)
        await openLabel(page, personId)

        // The starting point: both pages already agree on the derived label.
        await expect(page.locator('#personBanner')).toContainText('Ada Byron')
        await expect(page.locator('#currentLabel')).toHaveText('Ada Byron')
        await expect(page.locator('#cacheNote')).toBeHidden()

        await submitLabel(page, { name: 'Ada King', evidence: 'Family bible', confidence: 'high' })
        await expect(page.locator('#currentLabel')).toHaveText('Ada King')
        await expect(page.locator('#status')).toContainText('refreshed the cached label')

        // The claim itself is an evidenced fact with a confidence, not just a string.
        const row = page.locator('#existingNames gl-assertion', { hasText: 'Ada King' }).first()
        await expect(row).toContainText('Family bible')
        await expect(row).toContainText('90%')

        // The invariant: a list cannot see annotations, so it must be reading the
        // refreshed bare label. Without the write path this still says "Ada Byron".
        await expect(page.locator('#birthLink')).toHaveAttribute('href', /birth\.html\?person=https/)
        await page.goto('/index.html?store=local')
        const chips = page.locator('#peopleList gl-person-chip')
        await expect(chips.filter({ hasText: 'Ada King' })).toBeVisible()
        await expect(chips.filter({ hasText: 'Ada Byron' })).toHaveCount(0)
    })

    test('a recorded name survives a reload and keeps ?store=local', async ({ page }) => {
        const personId = await seedPerson(page)
        await openLabel(page, personId)
        await submitLabel(page, { name: 'Ada King', evidence: 'Family bible' })

        await page.reload()
        await expect(page).toHaveURL(/store=local/)
        expect(await page.evaluate(() => new URLSearchParams(location.search).get('person'))).toBeTruthy()
        await expect(page.locator('#currentLabel')).toHaveText('Ada King')
        // Three audited claims: the birth page's full name, createPerson()'s label
        // claim, and this page's. None of them overwrote another.
        await expect(page.locator('#existingNames gl-assertion')).toHaveCount(3)
        // The document the name came from was created once and is offered again,
        // so a second fact can cite the same source instead of duplicating it.
        await expect(page.locator('gl-evidence-picker select.existing option', { hasText: 'Family bible' })).toHaveCount(1)
    })

    test('two disagreeing sources coexist as separate assertions', async ({ page }) => {
        const personId = await seedPerson(page)
        await openLabel(page, personId)

        await submitLabel(page, { name: 'Ada King', evidence: 'Family bible' })
        await submitLabel(page, { name: 'Ada, Countess of Lovelace', evidence: 'Parish register' })

        await expect(page.locator('#existingNames gl-assertion', { hasText: 'Ada King' })).toBeVisible()
        await expect(page.locator('#existingNames gl-assertion', { hasText: 'Ada, Countess of Lovelace' })).toBeVisible()
        // Both claims plus the two the birth page made (its full name and its label
        // claim): a disagreeing source adds a row, it never replaces one.
        await expect(page.locator('#existingNames gl-assertion')).toHaveCount(4)
        // The display name is the last thing recorded; nothing was merged.
        await expect(page.locator('#currentLabel')).toHaveText('Ada, Countess of Lovelace')
    })

    test('the legacy #<id> fragment still opens the person and is normalised', async ({ page }) => {
        const personId = await seedPerson(page)
        const traffic = []
        page.on('request', request => {
            if (/devstore|rerum\.io/.test(request.url())) traffic.push(request.url())
        })

        await page.goto(`/label.html?store=local#${personId}`)
        await expect(page.locator('gl-label-form')).toBeVisible()
        await expect(page.locator('#currentLabel')).toHaveText('Ada Byron')
        // The fragment became the canonical query parameter; ?store= was untouched.
        await expect(page).toHaveURL(/store=local&person=https/)
        expect(await page.evaluate(() => window.location.hash)).toBe('')

        await submitLabel(page, { name: 'Ada King', evidence: 'Family bible' })
        await expect(page.locator('#currentLabel')).toHaveText('Ada King')
        expect(traffic).toEqual([])
    })

    test('an unknown person says so instead of failing silently', async ({ page }) => {
        await page.goto('/label.html?person=https%3A%2F%2Fexample.org%2Fnope&store=local')
        await expect(page.locator('gl-label-form')).toBeVisible()
        await expect(page.locator('#personBanner')).toContainText('No such person')
        await expect(page.locator('#currentLabel')).toHaveText('')

        // A name claimed for nobody is refused by the model, not half-written.
        await page.fill('[deer-key="name"]', 'Nobody Atall')
        await page.fill('gl-evidence-picker input.title', 'A letter')
        await page.click('#labelForm input[type="submit"]')
        await expect(page.locator('#status')).toContainText(/no Person/i)
        await page.goto('/index.html?store=local')
        await expect(page.locator('#peopleList gl-person-chip')).toHaveCount(0)
    })
})
