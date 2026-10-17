import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Integration tests run real D1/KV through workerd and hash passwords with 100k-round PBKDF2,
    // so a single test can take seconds when several files run at once.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
