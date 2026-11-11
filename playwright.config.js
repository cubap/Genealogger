// @ts-check
const path = require('node:path')
const { defineConfig, test } = require('@playwright/test')

/**
 * FNV-ish string hash, so a checkout always gets the same port.
 * @param {string} str
 */
function hash(str) {
  let h = 0
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

/**
 * One machine hosts many worktree sessions. When two checkouts both serve on
 * 8080, `reuseExistingServer` makes Playwright run its tests against whichever
 * tree grabbed the port first — and the failures look like real regressions in
 * the page you just rewrote. Derive a stable port per checkout; `GL_PORT`
 * overrides it. `npm run serve` stays on 8080 for humans.
 */
const port = Number(process.env.GL_PORT) || 8080 + (hash(path.basename(__dirname)) % 500)

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
    baseURL: `http://localhost:${port}`,
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

  /* Serve this checkout, on this checkout's port. */
  webServer: {
    command: `npx http-server -p ${port}`,
    port,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  }
})
