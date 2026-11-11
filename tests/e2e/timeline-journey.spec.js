// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the ancestor timeline view.
 *
 * Split out of core-journeys.spec.js so each M3 page slice owns its own spec
 * file. core-journeys is index-only now and goes away with the legacy suite.
 */

test.describe('Genealogger ancestor timeline', () => {
  test('should display ancestor timeline', async ({ page }) => {
    await page.goto('/timeline.html')
    await expect(page.locator('deer-ancestor-timeline')).toBeVisible()
  })
})
