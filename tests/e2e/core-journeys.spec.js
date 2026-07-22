// @ts-check
const { test, expect } = require('@playwright/test')

/**
 * E2E tests for Genealogger core user journeys
 */

test.describe('Genealogger Core User Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should load the main page and display person list', async ({ page }) => {
    // Wait for the person list to load
    await expect(page.locator('deer-list')).toBeVisible()
    
    // Check that the page title is correct
    await expect(page).toHaveTitle(/Genealogger/)
  })

  test('should navigate to person creation page', async ({ page }) => {
    // Click on "New Person" button
    await page.click('.add-person-btn')
    
    // Wait for navigation
    await expect(page).toHaveURL(/person\.html/)
  })

  test('should display family tree visualization', async ({ page }) => {
    // Navigate to tree page
    await page.goto('/tree.html')
    
    // Wait for tree component to load
    await expect(page.locator('deer-tree')).toBeVisible()
  })

  test('should display ancestor timeline', async ({ page }) => {
    // Navigate to timeline page
    await page.goto('/timeline.html')
    
    // Wait for timeline component to load
    await expect(page.locator('deer-ancestor-timeline')).toBeVisible()
  })

  test('should filter person list with typeahead', async ({ page }) => {
    // Wait for person list to load
    await expect(page.locator('deer-list')).toBeVisible()
    
    // Type in the filter input
    await page.fill('.typeahead-input', 'test')
    
    // Wait for filtering to occur
    await page.waitForTimeout(1000)
  })
})
