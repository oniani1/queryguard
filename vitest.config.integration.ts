import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      'queryguard/vitest': path.resolve(__dirname, 'src/integrations/vitest.ts'),
      'queryguard/jest': path.resolve(__dirname, 'src/integrations/jest.ts'),
      queryguard: path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
