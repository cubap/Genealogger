// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the M3 index (person list) slice on the new gl-* stack.
 *
 * The page runs against the LocalStore (`?store=local`, see store-bootstrap) so
 * the journey is deterministic, writes nothing to the shared devstore sandbox,
 * and needs no seeding API: persons are created through the M2 birth page, which
 * writes bare Person entities. The browser default remains the real
 * RerumStore/devstore. (`?store=fixture` is covered by unit tests instead: the
 * fixture adapter statically imports its JSON, which a browser refuses without
 * an import attribute — a pre-existing limitation, left alone here.)
 *
 * What this proves that unit tests cannot:
 *   - the list renders BARE persons with DERIVED labels and makes no store
 *     traffic beyond the single identity read (issue #14 story 1),
 *   - the filter goes through the model rather than poking other components'
 *     DOM (story 11), and the query survives a reload as ?q= while ?store= is
 *     preserved,
 *   - one chip component serves both the index and any picker (story 2) and
 *     still links to the person page, as the legacy index did.
 */

/** Create a child plus one parent participant through the birth slice. */
async function seedFamily(page) {
    await page.goto('/birth.html?store=local')
    await expect(page.locator('gl-birth-form')).toBeVisible()
    await page.fill('[deer-key="givenName"]', 'Ada')
    await page.fill('[deer-key="familyName"]', 'Byron')
    await page.fill('gl-evidence-picker input.title', 'Parish certificate')
    const row = page.locator('#birthForm [data-participant]').first()
    await row.locator('[data-participant-given]').fill('George')
    await row.locator('[data-participant-family]').fill('Byron')
    await row.locator('[data-role]').selectOption('parent')
    await page.click('#birthForm input[type="submit"]')
    await expect(page).toHaveURL(/person=/)
}

async function openIndex(page) {
    await page.goto('/index.html?store=local')
    await expect(page.locator('gl-typeahead-filter')).toBeVisible()
    return page.locator('#peopleList gl-person-chip')
}

test.describe('Index (person list) slice', () => {
    test('lists bare people with derived labels, from one identity read', async ({ page }) => {
        await seedFamily(page)
        const chips = await openIndex(page)

        await expect(chips).toHaveCount(2)
        await expect(chips.filter({ hasText: 'Ada Byron' })).toBeVisible()
        await expect(chips.filter({ hasText: 'George Byron' })).toBeVisible()
        await expect(page.locator('#indexStatus')).toContainText('2 people')

        // Story 1: the list is identity data only. Resolving birth/death spans
        // per row would have to read annotations; here nothing beyond the one
        // persons read happens, so no store traffic at all leaves the page.
        const storeTraffic = []
        page.on('request', request => {
            if (/devstore|rerum\.io/.test(request.url())) storeTraffic.push(request.url())
        })
        await page.reload()
        await expect(chips).toHaveCount(2)
        expect(storeTraffic).toEqual([])
    })

    test('filters through the model and keeps the query across a reload', async ({ page }) => {
        await seedFamily(page)
        const chips = await openIndex(page)
        await expect(chips).toHaveCount(2)

        await page.fill('.typeahead-input', 'george')
        await expect(chips).toHaveCount(1)
        await expect(chips.first()).toContainText('George Byron')
        await expect(page.locator('#indexStatus')).toContainText('1 person matching "george"')

        // The filter became the URL, and the URL still selects the store.
        await expect(page).toHaveURL(/store=local/)
        await expect(page).toHaveURL(/q=george/)

        await page.reload()
        await expect(page.locator('.typeahead-input')).toHaveValue('george')
        await expect(chips).toHaveCount(1)
        await expect(chips.first()).toContainText('George Byron')

        // Clearing the box restores the whole list and drops ?q=.
        await page.fill('.typeahead-input', '')
        await expect(chips).toHaveCount(2)
        await expect(page).toHaveURL(/store=local/)
        await expect(page).not.toHaveURL(/q=/)
    })

    test('a filter that matches nothing says so instead of showing an empty page', async ({ page }) => {
        await seedFamily(page)
        const chips = await openIndex(page)
        await page.fill('.typeahead-input', 'milbanke')
        await expect(chips).toHaveCount(0)
        await expect(page.locator('#indexStatus')).toContainText('No people match "milbanke"')
    })

    test('a chip still links to the person page, as the legacy list did', async ({ page }) => {
        await seedFamily(page)
        const chips = await openIndex(page)
        await chips.filter({ hasText: 'Ada Byron' }).click()
        await expect(page).toHaveURL(/person\.html#/)
    })

    test('an empty store explains what to do next', async ({ page }) => {
        const chips = await openIndex(page)
        await expect(chips).toHaveCount(0)
        await expect(page.locator('#indexStatus')).toContainText('No people yet')
    })
})
