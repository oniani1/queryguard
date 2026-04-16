import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      thresholds: {
        'src/core/**': { lines: 85, functions: 85, branches: 75, statements: 85 },
        'src/drivers/**': { lines: 75, functions: 75, branches: 60, statements: 75 },
        'src/notifiers/**': { lines: 70, functions: 70, branches: 60, statements: 70 },
      },
    },
  },
})
