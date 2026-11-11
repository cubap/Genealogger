// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E smoke tests for the index page.
 *
 * The per-page journeys live in their own spec files (person-, tree-,
 * timeline-, birth-, death-journey.spec.js) so that each M3 slice owns one file
 * and never has to edit a shared spec.
 */

test.describe('Genealogger Core User Journeys', () => {
  test.beforeEach(async ({ page }) => {
    // ?store=local keeps the index off the shared devstore sandbox: the landing
    // page is an empty list in a fresh context, which is what these smoke tests
    // are about. The index journey itself is tests/e2e/index-journey.spec.js.
    await page.goto('/index.html?store=local')
  })

  test('should load the main page and display person list', async ({ page }) => {
    // The list chrome renders without waiting on a backend: filter + status line.
    await expect(page.locator('gl-typeahead-filter')).toBeVisible()
    await expect(page.locator('#indexStatus')).toBeVisible()
    
    // Check that the page title is correct
    await expect(page).toHaveTitle(/Genealogger/)
  })

  test('should filter person list with typeahead', async ({ page }) => {
    // The filter is a model query now, so the page reports what it matched
    // instead of hiding <li> elements behind another component's back.
    await expect(page.locator('gl-typeahead-filter')).toBeVisible()
    
    // Type in the filter input
    await page.fill('.typeahead-input', 'test')
    
    // Wait for filtering to occur
    await expect(page.locator('#indexStatus')).toContainText('No people match "test"')
  })
})
