// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the person page.
 *
 * Split out of core-journeys.spec.js so each M3 page slice owns its own spec
 * file. The person slice is expected to grow this file: person.html is reached
 * as `person.html#<id>` from gl-person-chip (PERSON_HREF) and as a bare
 * `person.html` from the index "New Person" link, and both contracts hold.
 */

test.describe('Genealogger person page', () => {
  test('should navigate to person creation page', async ({ page }) => {
    await page.goto('/index.html?store=local')
    await page.click('.add-person-btn')
    await expect(page).toHaveURL(/person\.html/)
  })
})
