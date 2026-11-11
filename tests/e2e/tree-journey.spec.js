// @ts-check
/**
 * E2E for the family tree view (issue #14 user story 10), rebuilt on the
 * gl-* stack: `gl-tree-view` draws edges derived ONLY from parentsOf /
 * childrenOf reads — nothing stores nv:hasChild — labels each edge with the
 * evidence Record behind the birth, flags contested parentage in the shape
 * of the tree, and re-roots when a node is clicked.
 *
 * The family is seeded through the real birth page (`?store=local`), so the
 * tree is exercised over exactly what the write path produces. LocalStore
 * persists to localStorage: no network, no shared-devstore writes. Person
 * ids are captured from the `?person=` URL each submit lands on; an existing
 * person is linked as a participant via the form row's `data-agent-id`.
 */

const { test, expect } = require('@playwright/test')

const LOCAL_BIRTH = '/birth.html?store=local'

/** Submit one birth for a (new) child, optionally linking existing parents. */
async function submitBirth(page, child, evidence, parents = []) {
    await page.goto(LOCAL_BIRTH)
    await expect(page.locator('gl-birth-form')).toBeVisible()
    await page.fill('[deer-key="givenName"]', child.given)
    await page.fill('[deer-key="familyName"]', child.family)
    await page.fill('gl-evidence-picker input.title', evidence)
    for (let i = 0; i < parents.length; i++) {
        if (i > 0) await page.click('#birthForm [data-add-participant]')
        const row = page.locator('#birthForm [data-participant]').nth(i)
        const { agentId, role, given, family } = parents[i]
        await row.locator('[data-participant-given]').fill(given)
        await row.locator('[data-participant-family]').fill(family)
        await row.locator('[data-role]').selectOption(role)
        if (agentId) {
            await row.evaluate((el, id) => el.setAttribute('data-agent-id', id), agentId)
        }
    }
    await page.click('#birthForm input[type="submit"]')
    await expect(page).toHaveURL(/person=/)
    return new URL(page.url()).searchParams.get('person')
}

/** Seed a three-generation family; returns the person ids. */
async function seedFamily(page) {
    const george = await submitBirth(page, { given: 'George', family: 'Byron' }, 'George parish book')
    const annabella = await submitBirth(page, { given: 'Annabella', family: 'Milbanke' }, 'Annabella parish book')
    const ada = await submitBirth(
        page,
        { given: 'Ada', family: 'Byron' },
        'Ada certificate',
        [
            { agentId: george, role: 'father', given: 'George', family: 'Byron' },
            { agentId: annabella, role: 'mother', given: 'Annabella', family: 'Milbanke' }
        ]
    )
    const harriet = await submitBirth(
        page,
        { given: 'Harriet', family: 'Byron' },
        'Harriet almanac',
        [{ agentId: ada, role: 'mother', given: 'Ada', family: 'Byron' }]
    )
    return { george, annabella, ada, harriet }
}

/** Collect real network calls leaving the page (devstore/rerum.io or any origin hop). */
function watchExternalRequests(page, sink) {
    page.on('request', request => {
        const url = request.url()
        if (!/^https?:/i.test(url)) return
        const host = new URL(url).hostname
        if (host !== 'localhost' && host !== '127.0.0.1') sink.push(url)
    })
}

test.describe('Genealogger tree view', () => {
    test('no legacy DEER v1 script is loaded', async ({ page }) => {
        await page.goto('/tree.html?store=local')
        const scripts = await page.evaluate(() =>
            Array.from(document.querySelectorAll('script')).map(s => s.getAttribute('src')).filter(Boolean)
        )
        expect(scripts).toEqual(['js/pages/tree.js'])
        expect(await page.locator('deer-tree').count()).toBe(0)
    })

    test('asks for a person when none is selected', async ({ page }) => {
        await page.goto('/tree.html?store=local')
        await expect(page.locator('#personBanner')).toContainText(/person/i)
        expect(await page.locator('gl-tree-view .node').count()).toBe(0)
    })

    test('renders the seeded family from derived reads and survives a reload', async ({ page }) => {
        const { george, annabella, ada, harriet } = await seedFamily(page)
        const external = []
        watchExternalRequests(page, external)

        await page.goto(`/tree.html?store=local&person=${encodeURIComponent(ada)}`)
        await expect(page.locator('gl-tree-view .node')).toHaveCount(4)
        await expect(page.locator(`gl-tree-view .node[data-person-id="${ada}"]`)).toHaveClass(/\broot\b/)
        await expect(page.locator(`gl-tree-view .node[data-person-id="${george}"]`)).toContainText('George Byron')
        await expect(page.locator(`gl-tree-view .node[data-person-id="${annabella}"]`)).toContainText('Annabella Milbanke')
        await expect(page.locator(`gl-tree-view .node[data-person-id="${harriet}"]`)).toContainText('Harriet Byron')

        // Every edge names its evidence Record: the visualization is sourced.
        const labels = page.locator('gl-tree-view .edge-label')
        await expect(labels.filter({ hasText: 'father · Ada certificate' })).toHaveCount(1)
        await expect(labels.filter({ hasText: 'mother · Ada certificate' })).toHaveCount(1)
        await expect(labels.filter({ hasText: 'mother · Harriet almanac' })).toHaveCount(1)

        // One agreed source per child: nothing is flagged contested.
        expect(await page.locator('gl-tree-view .node.contested').count()).toBe(0)

        // Deep link contract: ?person= round-trips through a reload, offline.
        await page.reload()
        await expect(page.locator('gl-tree-view .node')).toHaveCount(4)
        expect(external).toEqual([])
    })

    test('legacy #<id> hash deep link still roots the tree', async ({ page }) => {
        const { ada } = await seedFamily(page)
        await page.goto(`/tree.html?store=local#${encodeURIComponent(ada)}`)
        await expect(page.locator(`gl-tree-view .node[data-person-id="${ada}"].root`)).toBeVisible()
        await expect(page.locator('gl-tree-view .node')).toHaveCount(4)
    })

    test('clicking a node re-roots the tree and keeps a person-page link', async ({ page }) => {
        const { george, ada } = await seedFamily(page)
        await page.goto(`/tree.html?store=local&person=${encodeURIComponent(ada)}`)
        await expect(page.locator('gl-tree-view .node')).toHaveCount(4)

        // The ↗ control hands off to the person page; the node itself re-roots.
        await expect(page.locator(`gl-tree-view .node[data-person-id="${george}"] a.person-link`))
            .toHaveAttribute('href', `person.html#${george}`)

        await page.locator(`gl-tree-view .node[data-person-id="${george}"]`).click()
        await expect(page.locator(`gl-tree-view .node[data-person-id="${george}"]`)).toHaveClass(/\broot\b/)
        // Ada is now George's daughter in the re-rooted view, Harriet still in range.
        await expect(page.locator(`gl-tree-view .node[data-person-id="${ada}"]`)).toBeVisible()
        await expect(page.locator(`gl-tree-view .node[data-person-id="${george}"]`)).toContainText('George Byron')
        const rooted = await page.evaluate(() => new URLSearchParams(window.location.search).get('person'))
        expect(rooted).toBe(george)
    })

    test('contested parentage is visible in the shape of the tree', async ({ page }) => {
        const george = await submitBirth(page, { given: 'George', family: 'Byron' }, 'George parish book')
        const william = await submitBirth(page, { given: 'William', family: 'Ashley' }, 'Will of Lady Byron')
        const child = await submitBirth(
            page,
            { given: 'Augustus', family: 'Gordon' },
            'Deed of 1816',
            [{ agentId: george, role: 'father', given: 'George', family: 'Byron' }]
        )
        // Stay on the freshly submitted form (reloading it would reuse the
        // existing evidence Record) and assert a DIFFERENT father from a
        // second, disagreeing source. The picker comes prefilled with the
        // existing Record selected; switch it back to "new document" so the
        // typed title creates a separate source.
        await page.selectOption('gl-evidence-picker select.existing', '')
        await page.fill('gl-evidence-picker input.title', 'Gossip letter')
        await page.click('#birthForm [data-add-participant]')
        const row = page.locator('#birthForm [data-participant]').last()
        await row.locator('[data-participant-given]').fill('William')
        await row.locator('[data-participant-family]').fill('Ashley')
        await row.locator('[data-role]').selectOption('father')
        await row.evaluate((el, id) => el.setAttribute('data-agent-id', id), william)
        await page.click('#birthForm input[type="submit"]')

        await page.goto(`/tree.html?store=local&person=${encodeURIComponent(child)}`)
        const contested = page.locator('gl-tree-view .node.contested')
        await expect(contested).toHaveCount(1)
        await expect(contested).toContainText('Augustus Gordon')
        await expect(contested).toContainText('contested parentage')
        // Both claims survive as separate visible edges, each naming its source.
        const labels = page.locator('gl-tree-view .edge-label')
        await expect(labels.filter({ hasText: 'father · Deed of 1816' })).toHaveCount(1)
        await expect(labels.filter({ hasText: 'father · Gossip letter' })).toHaveCount(1)
        await expect(page.locator('gl-tree-view path.edge.contested')).toHaveCount(2)
        await expect(page.locator(`gl-tree-view .node[data-person-id="${william}"]`)).toBeVisible()
    })
})
