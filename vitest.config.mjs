import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    dir: 'tests',
    include: ['unit/**/*.test.js'],
    exclude: ['e2e/**'],
    coverage: {
      include: ['js/utils/**/*.js']
    }
  }
})
