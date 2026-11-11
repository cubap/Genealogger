// @ts-check
const { defineConfig, test } = require('@playwright/test')

/**
 * Playwright configuration for Genealogger E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.js'],
  testIgnore: ['**/tests/unit/**'],
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' }
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' }
    }
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run serve',
    port: 8080,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  }
})
