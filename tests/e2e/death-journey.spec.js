// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the M3 death vertical slice on the new gl-* stack — the death twin of
 * birth-journey.spec.js (issue #14 user story 6: a death journey mirroring the
 * birth journey, event + participants + evidence).
 *
 * The page runs against the LocalStore (`?store=local`, see store-bootstrap) so it
 * persists across a reload with no network and no writes to the shared devstore
 * sandbox; the browser default remains the real RerumStore/devstore. This is the
 * death journey migrated off the legacy DEER v1 page, which loaded js/deer.js.
 */

/** Fill and submit the death form. */
async function submitDeath(page, fields) {
    await page.fill('[deer-key="givenName"]', fields.given)
    await page.fill('[deer-key="familyName"]', fields.family)
    if (fields.place) await page.fill('[deer-key="deathPlace"]', fields.place)
    if (fields.date) await page.fill('[deer-key="deathDate"]', fields.date)
    if (fields.dateConfidence) {
        await page.selectOption('[data-confidence-for="deathDate"]', fields.dateConfidence)
    }
    // The evidence document is named separately from the facts it supports.
    await page.fill('gl-evidence-picker input.title', fields.evidence)
    await page.click('#deathForm input[type="submit"]')
    await expect(page).toHaveURL(/person=/)
}

test.describe('Death vertical slice', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/death.html?store=local')
        await expect(page.locator('gl-death-form')).toBeVisible()
    })

    test('no legacy DEER v1 script is loaded', async ({ page }) => {
        const legacy = await page.evaluate(() =>
            Array.from(document.querySelectorAll('script')).map(s => s.getAttribute('src')).filter(Boolean)
        )
        expect(legacy).toEqual(['js/pages/death.js'])
        expect(await page.locator('form[deer-type]').count()).toBe(0)
    })

    test('creates a person and shows the death assertions with evidence and confidence', async ({ page }) => {
        await submitDeath(page, {
            given: 'Ada',
            family: 'Byron',
            place: 'London',
            date: '1852-01-01',
            dateConfidence: 'high',
            evidence: 'Death certificate'
        })

        // The asserted date row shows its value, its source document, and its confidence.
        await expect(page.locator('gl-assertion .value', { hasText: '1852-01-01' })).toBeVisible()
        const dateRow = page.locator('gl-assertion').filter({ hasText: 'Date of death' }).first()
        await expect(dateRow).toContainText('Death certificate')
        await expect(dateRow).toContainText('90%')
        const placeRow = page.locator('gl-assertion').filter({ hasText: 'Place of death' }).first()
        await expect(placeRow).toContainText('Death certificate')

        // The sibling-page cross-link now carries the real person id.
        await expect(page.locator('#birthLink')).toHaveAttribute('href', /birth\.html\?person=https/)
    })

    test('assertions survive a reload (persistence)', async ({ page }) => {
        await submitDeath(page, {
            given: 'Ada',
            family: 'Byron',
            date: '1852-01-01',
            evidence: 'Death certificate'
        })
        await page.reload()
        // ?store=local survives the reload, so the record is still readable.
        await expect(page).toHaveURL(/store=local/)
        await expect(page.locator('#existingDeath gl-assertion').first()).toBeVisible()
        await expect(page.locator('#personBanner')).toContainText('Ada Byron')
    })

    test('two disagreeing sources coexist as separate assertions', async ({ page }) => {
        await submitDeath(page, {
            given: 'Ada',
            family: 'Byron',
            date: '1852-01-01',
            evidence: 'Death certificate'
        })
        // A second source that disagrees: change the date and name a new document.
        await page.fill('[deer-key="deathDate"]', '1852-01-02')
        await page.fill('gl-evidence-picker input.title', 'Family bible')
        await page.click('#deathForm input[type="submit"]')

        const dateValues = page.locator('gl-assertion .value')
        await expect(page.locator('gl-assertion', { hasText: '1852-01-01' })).toBeVisible()
        await expect(page.locator('gl-assertion', { hasText: '1852-01-02' })).toBeVisible()
        // Neither source silently overwrote the other.
        expect(await dateValues.count()).toBeGreaterThanOrEqual(2)
    })

    test('witnesses and attendants are recorded as participants with roles', async ({ page }) => {
        await page.fill('[deer-key="givenName"]', 'Ada')
        await page.fill('[deer-key="familyName"]', 'Byron')
        await page.fill('gl-evidence-picker input.title', 'Death register')
        const witness = page.locator('#deathForm [data-participant]').first()
        await witness.locator('[data-participant-given]').fill('John')
        await witness.locator('[data-participant-family]').fill('Halo')
        await witness.locator('[data-role]').selectOption('witness')
        await page.click('#deathForm [data-add-participant]')
        const attendant = page.locator('#deathForm [data-participant]').nth(1)
        await attendant.locator('[data-participant-given]').fill('Nurse')
        await attendant.locator('[data-participant-family]').fill('Ellis')
        await attendant.locator('[data-role]').selectOption('attendant')
        await attendant.locator('[data-confidence]').selectOption('medium')
        await page.click('#deathForm input[type="submit"]')
        await expect(page).toHaveURL(/person=/)

        const rows = page.locator('#existingParticipants .participant')
        await expect(rows.filter({ hasText: 'witness' })).toBeVisible()
        await expect(rows.filter({ hasText: 'attendant' })).toBeVisible()
        await expect(rows.filter({ hasText: 'John Halo' })).toBeVisible()
        await expect(rows.filter({ hasText: 'attendant: Nurse Ellis — 50%' })).toBeVisible()
        // The deceased is the event's subject, shown in the banner, not as a row.
        await expect(rows.filter({ hasText: 'child' })).toHaveCount(0)
    })
})
