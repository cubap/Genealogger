// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E for the family tree view.
 *
 * Split out of core-journeys.spec.js so each M3 page slice owns its own spec
 * file. core-journeys is index-only now and goes away with the legacy suite.
 */

test.describe('Genealogger tree view', () => {
  test('should display family tree visualization', async ({ page }) => {
    await page.goto('/tree.html')
    await expect(page.locator('deer-tree')).toBeVisible()
  })
})
