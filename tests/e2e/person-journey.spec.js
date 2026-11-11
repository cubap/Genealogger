// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the person page (issue #14 stories 3, 4, 5) against ?store=local, the
 * in-memory/localStorage store. Nothing here may touch the shared devstore.
 *
 * Deep-link contracts covered: `person.html#<id>` is how gl-person-chip links
 * (PERSON_HREF), a bare `person.html` is the index "New Person" target and must
 * create the person from the first name recorded, and `?store=` survives every
 * in-page id change and reload.
 */

/** Requests that would mean the page left the local store, or loaded DEER v1. */
function watchNetwork(page) {
  const offsite = []
  const legacy = []
  page.on('request', request => {
    const url = request.url()
    if (/devstore|rerum\.io/.test(url)) offsite.push(url)
    if (/js\/deer\.js|components\/deer-/.test(url)) legacy.push(url)
  })
  return { offsite, legacy }
}

/** Fill the "Record a name" form and save it. */
async function saveName(page, { name, kind = 'full', usedAs = '', from = '', to = '', confidence = '', evidence }) {
  await page.fill('input[deer-key="name"]', name)
  await page.selectOption('select[deer-key="nameProperty"]', kind)
  if (usedAs) await page.selectOption('select[deer-key="nameType"]', usedAs)
  if (from) await page.fill('input[deer-key="activeFrom"]', from)
  if (to) await page.fill('input[deer-key="activeTo"]', to)
  if (confidence) await page.selectOption('select[data-confidence-for="name"]', confidence)
  await page.fill('gl-evidence-picker input.title', evidence)
  await page.click('#nameDetail input[type="submit"]')
  await expect(page.locator('#nameStatus')).toContainText('Saved')
}

const assertionRows = page => page.locator('#existingAssertions gl-assertion')

test.describe('Genealogger person page', () => {
  test('should navigate to person creation page', async ({ page }) => {
    await page.goto('/index.html?store=local')
    await page.click('.add-person-btn')
    await expect(page).toHaveURL(/person\.html/)
  })

  test('record a name, keep its evidence and range, reload, and survive it', async ({ page }) => {
    const net = watchNetwork(page)
    await page.goto('/person.html?store=local')

    // A bare person.html is the New Person target: no id, nothing assembled yet.
    await expect(page.locator('#personBanner')).toBeHidden()
    await expect(page.locator('#personActions')).toBeHidden()

    await saveName(page, {
      name: 'Margaret Sarah Doyle', usedAs: 'married name',
      from: '1880-01-01', to: '1901-12-31', confidence: 'high', evidence: 'Census of 1881'
    })

    // The page canonicalises the URL to the deep-link form the rest of the app uses.
    const personId = new URL(page.url()).hash.slice(1)
    expect(personId).toMatch(/\/id\//)
    expect(page.url()).toContain('store=local')
    await expect(page.locator('#personBanner')).toHaveText('Margaret Sarah Doyle')

    // Audit view: the row names the assertion type, the value, the document that
    // says so, the confidence, and the qualifiers that belong to this claim.
    const row = page.locator('gl-assertion', { hasText: 'type: married name' }).first()
    await expect(row).toContainText('Full name')
    await expect(row).toContainText('Margaret Sarah Doyle')
    await expect(row).toContainText('Census of 1881')
    await expect(row).toContainText('90%')
    await expect(row).toContainText('from: 1880-01-01')
    await expect(row).toContainText('to: 1901-12-31')

    // Add a second name from a second source: disagreement is kept, not merged.
    await saveName(page, { name: 'Maggie Doyle-Smith', usedAs: 'married name', evidence: 'Parish register' })
    await expect(assertionRows(page)).toHaveCount(3)
    await expect(page.locator('#existingAssertions h4', { hasText: 'Full name — 2 sources disagree' })).toBeVisible()
    await expect(page.locator('gl-assertion .conflict').first()).toBeVisible()

    // The hub links out carry the person id.
    await expect(page.locator('a.person-detail[href^="birth.html?person="]'))
      .toHaveAttribute('href', new RegExp(`^birth\\.html\\?person=${personId}`))
    await expect(page.locator('a.person-detail[href^="timeline.html#"]'))
      .toHaveAttribute('href', new RegExp(`^timeline\\.html#${personId}`))

    await page.reload()
    await expect(page.locator('#personBanner')).toHaveText('Maggie Doyle-Smith')
    await expect(assertionRows(page)).toHaveCount(3)
    await expect(row).toContainText('Census of 1881')

    // The other deep-link contract: arriving straight at #<id>, as gl-person-chip does.
    await page.goto(`/person.html?store=local#${personId}`)
    await expect(assertionRows(page)).toHaveCount(3)

    expect(net.offsite).toEqual([])
    expect(net.legacy).toEqual([])
  })

  test('a name the sources cannot support is refused, not written', async ({ page }) => {
    const net = watchNetwork(page)
    await page.goto('/person.html?store=local')
    await page.fill('input[deer-key="name"]', 'Ada')
    await page.fill('input[deer-key="activeFrom"]', '1901-01-01')
    await page.fill('input[deer-key="activeTo"]', '1900-01-01')
    await page.fill('gl-evidence-picker input.title', 'Family bible')
    await page.click('#nameDetail input[type="submit"]')
    await expect(page.locator('#nameStatus')).toContainText('ends after it starts')
    await expect(assertionRows(page)).toHaveCount(0)
    expect(net.offsite).toEqual([])
  })

  test('an unknown person id says so instead of silently showing an empty page', async ({ page }) => {
    await page.goto('/person.html?store=local#https://devstore.rerum.io/v1/id/nobody')
    await expect(page.locator('#personBanner')).toContainText('No such person')
  })
})
