import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      'qguard/vitest': path.resolve(__dirname, 'src/integrations/vitest.ts'),
      'qguard/jest': path.resolve(__dirname, 'src/integrations/jest.ts'),
      qguard: path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['test/integration/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
