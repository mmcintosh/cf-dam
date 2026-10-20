import { defineConfig } from 'vitest/config'

// The scale test: `npx vitest run --config scale/vitest.config.ts` (see scale/README.md). Kept out of
// the normal suite: it builds a catalog of over a million photos on disk and takes a while.
export default defineConfig({
  test: {
    include: ['scale/**/*.scale.ts'],
    testTimeout: 0,
    hookTimeout: 0,
    fsModuleCache: false,
    fileParallelism: false,
  },
})
