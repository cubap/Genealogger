// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the M2 birth vertical slice on the new gl-* stack.
 *
 * The page runs against the LocalStore (browser default, see store-bootstrap) so
 * it persists across a reload with no network and no writes to the shared
 * devstore sandbox. This is the birth journey migrated off the legacy DEER v1
 * page; the old page is gone, so this is the only birth E2E.
 */

/** Fill and submit the birth form. */
async function submitBirth(page, fields) {
    await page.fill('[deer-key="givenName"]', fields.given)
    await page.fill('[deer-key="familyName"]', fields.family)
    if (fields.place) await page.fill('[deer-key="birthPlace"]', fields.place)
    if (fields.date) await page.fill('[deer-key="birthDate"]', fields.date)
    if (fields.dateConfidence) {
        await page.selectOption('[data-confidence-for="birthDate"]', fields.dateConfidence)
    }
    // The evidence document is named separately from the facts it supports.
    await page.fill('gl-evidence-picker input.title', fields.evidence)
    await page.click('#birthForm input[type="submit"]')
    await expect(page).toHaveURL(/person=/)
}

test.describe('Birth vertical slice', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/birth.html')
        await expect(page.locator('gl-birth-form')).toBeVisible()
    })

    test('creates a person and shows the birth assertions with evidence and confidence', async ({ page }) => {
        await submitBirth(page, {
            given: 'Ada',
            family: 'Byron',
            place: 'London',
            date: '1815-12-10',
            dateConfidence: 'high',
            evidence: 'Parish certificate'
        })

        // The asserted date row shows its value, its source document, and its confidence.
        await expect(page.locator('gl-assertion .value', { hasText: '1815-12-10' })).toBeVisible()
        const dateRow = page.locator('gl-assertion').filter({ hasText: 'Date of birth' }).first()
        await expect(dateRow).toContainText('Parish certificate')
        await expect(dateRow).toContainText('90%')
    })

    test('assertions survive a reload (persistence)', async ({ page }) => {
        await submitBirth(page, {
            given: 'Ada',
            family: 'Byron',
            date: '1815-12-10',
            evidence: 'Parish certificate'
        })
        await page.reload()
        await expect(page.locator('#existingBirth gl-assertion').first()).toBeVisible()
        await expect(page.locator('#personBanner')).toContainText('Ada Byron')
    })

    test('two disagreeing sources coexist as separate assertions', async ({ page }) => {
        await submitBirth(page, {
            given: 'Ada',
            family: 'Byron',
            date: '1815-12-10',
            evidence: 'Parish certificate'
        })
        // A second source that disagrees: change the date and name a new document.
        await page.fill('[deer-key="birthDate"]', '1815-12-11')
        await page.fill('gl-evidence-picker input.title', 'Family bible')
        await page.click('#birthForm input[type="submit"]')

        const dateValues = page.locator('gl-assertion .value')
        await expect(page.locator('gl-assertion', { hasText: '1815-12-10' })).toBeVisible()
        await expect(page.locator('gl-assertion', { hasText: '1815-12-11' })).toBeVisible()
        // Neither source silently overwrote the other.
        expect(await dateValues.count()).toBeGreaterThanOrEqual(2)
    })

    test('mother and father are recorded as participants with roles', async ({ page }) => {
        await page.fill('[deer-key="givenName"]', 'Ada')
        await page.fill('[deer-key="familyName"]', 'Byron')
        await page.fill('gl-evidence-picker input.title', 'Parish certificate')
        const row = page.locator('#birthForm [data-participant]').first()
        await row.locator('[data-participant-given]').fill('George')
        await row.locator('[data-participant-family]').fill('Byron')
        await row.locator('[data-role]').selectOption('parent')
        await page.click('#birthForm input[type="submit"]')
        await expect(page).toHaveURL(/person=/)
        await expect(page.locator('#existingParticipants .participant', { hasText: 'parent' })).toBeVisible()
    })
})
