import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The end-to-end test runs the API in-process with wrangler's platform proxy, like the API's own tests.
    fsModuleCache: false,
  },
})
