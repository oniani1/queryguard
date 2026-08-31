import { defineConfig } from 'vitest/config'
import { qguardSetup } from '../../../src/integrations/vitest.js'

export default defineConfig({
  test: {
    include: ['test/fixtures/vitest-auto-setup/*.fixture.ts'],
    setupFiles: [qguardSetup],
  },
})
