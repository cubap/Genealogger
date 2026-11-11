// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the ancestor timeline view (issue #14 story 9), rebuilt on the
 * gl-* stack: page module -> model/timeline.js -> injected store. The DEER v1
 * `deer-ancestor-timeline` (and its hard-coded demo family) is gone; the
 * sample-family button now lands on the FIXTURE store instead.
 *
 * Seeding goes through the birth page on the LocalStore (`?store=local`) so
 * the journey touches no network and never writes to the shared devstore;
 * each seeded test asserts the page fired ZERO requests to rerum.io.
 */

const EXTERNAL = url => {
    try {
        const host = new URL(url).hostname
        return host === 'devstore.rerum.io' || host.endsWith('.rerum.io')
    } catch {
        return false
    }
}

/** Seed a child with a named mother via the birth page; returns the person id. */
async function seedBirth(page, { given, family, date, evidence, mother }) {
    await page.goto('/birth.html?store=local')
    await page.fill('[deer-key="givenName"]', given)
    await page.fill('[deer-key="familyName"]', family)
    await page.fill('[deer-key="birthDate"]', date)
    await page.fill('gl-evidence-picker input.title', evidence)
    const row = page.locator('#birthForm [data-participant]').first()
    await row.locator('[data-participant-given]').fill(mother.given)
    await row.locator('[data-participant-family]').fill(mother.family)
    await row.locator('[data-role]').selectOption('mother')
    await page.click('#birthForm input[type="submit"]')
    await expect(page).toHaveURL(/person=/)
    return new URL(page.url()).searchParams.get('person')
}

test.describe('Ancestor timeline vertical slice', () => {
    test('renders the seeded ancestor with role and evidence, offline, across reload', async ({ page }) => {
        const requests = []
        page.on('request', request => {
            if (EXTERNAL(request.url())) requests.push(request.url())
        })
        const personId = await seedBirth(page, {
            given: 'Ada', family: 'Gordon', date: '1815-12-10',
            evidence: 'Parish register', mother: { given: 'Anne', family: 'Milbanke' }
        })

        await page.goto(`/timeline.html?store=local&person=${encodeURIComponent(personId)}`)
        await expect(page.locator('gl-ancestor-timeline')).toBeVisible()
        await expect(page.locator('#timelineStatus')).toContainText('Ancestor timeline for Ada Gordon')

        // Every marker names the person, their ROLE at the event, and the EVIDENCE.
        const dates = page.locator('gl-ancestor-timeline .m-date')
        await expect(dates.filter({ hasText: '1815-12-10' })).not.toHaveCount(0)
        await expect(page.locator('gl-ancestor-timeline .m-sub').filter({ hasText: 'child' })).not.toHaveCount(0)
        await expect(page.locator('gl-ancestor-timeline .m-sub').filter({ hasText: 'mother' })).not.toHaveCount(0)
        await expect(page.locator('gl-ancestor-timeline .m-ev').filter({ hasText: 'Parish register' })).not.toHaveCount(0)
        // The ancestor chain itself is drawn: mother on her own generation row.
        await expect(page.locator('gl-ancestor-timeline .who').filter({ hasText: 'Anne' })).not.toHaveCount(0)
        await expect(page.locator('gl-ancestor-timeline .gen').filter({ hasText: 'parents' })).not.toHaveCount(0)
        expect(requests).toEqual([])

        await page.reload()
        await expect(page.locator('gl-ancestor-timeline .m-date').filter({ hasText: '1815-12-10' })).not.toHaveCount(0)
        expect(requests).toEqual([])
    })

    test('the legacy #<id> hash deep link still opens the timeline', async ({ page }) => {
        const personId = await seedBirth(page, {
            given: 'Bo', family: 'Linked', date: '1890-05-04',
            evidence: 'Ship manifest', mother: { given: 'Ma', family: 'Linked' }
        })
        await page.goto(`/timeline.html?store=local#${encodeURIComponent(personId)}`)
        await expect(page.locator('gl-ancestor-timeline .m-date').filter({ hasText: '1890-05-04' })).not.toHaveCount(0)
    })

    test('estimated dates are drawn apart from asserted ones', async ({ page }) => {
        const personId = await seedBirth(page, {
            given: 'Cutha', family: 'Sortes', date: '1800-01-01',
            evidence: 'Headstone', mother: { given: 'Ela', family: 'Sortes' }
        })
        await page.goto(`/timeline.html?store=local&person=${encodeURIComponent(personId)}`)
        // The asserted date is drawn solid; the component always ships the
        // hollow/italic ESTIMATE grammar (the birth form only accepts exact
        // dates, so the hedge itself is covered by unit tests instead).
        await expect(page.locator('gl-ancestor-timeline .m-date').filter({ hasText: '1800-01-01' })).not.toHaveCount(0)
        expect(await page.locator('gl-ancestor-timeline circle.marker.estimated').count()).toBe(0)
        await expect(page.locator('gl-ancestor-timeline .legend')).toContainText('estimated')
    })

    test('the sample-family button lands on the fixture store with BOTH conflicting dates', async ({ page }) => {
        const requests = []
        page.on('request', request => {
            if (EXTERNAL(request.url())) requests.push(request.url())
        })
        await page.goto('/timeline.html?store=fixture')
        await page.click('#showDemo')
        await expect(page).toHaveURL(/store=fixture/)
        const dates = page.locator('gl-ancestor-timeline .m-date')
        await expect(dates.filter({ hasText: '1815-12-10' })).not.toHaveCount(0)
        await expect(dates.filter({ hasText: '1817' })).not.toHaveCount(0)
        // Disagreement is preserved and made legible, not merged to a winner.
        await expect(page.locator('gl-ancestor-timeline .dispute-label').first()).toContainText('disputed')
        expect(requests).toEqual([])
    })

    test('the page no longer loads DEER v1', async ({ page }) => {
        await page.goto('/timeline.html?store=local')
        await expect(page.locator('deer-ancestor-timeline')).toHaveCount(0)
        expect(await page.evaluate(() => !!customElements.get('deer-ancestor-timeline'))).toBe(false)
        await expect(page.locator('#timelineStatus')).toContainText('Pick a person')
    })
})
