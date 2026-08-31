import { fileURLToPath } from 'node:url'

export type {
  AssertOptions,
  AssertScalingOptions,
  ScalingReport,
  ScalingDetection,
} from './shared.js'
export { QueryGuardError, ScalingError } from './shared.js'
export { runAssertNoNPlusOne as assertNoNPlusOne } from './shared.js'
export { runQueryBudget as queryBudget } from './shared.js'
export { runAssertScaling as assertScaling } from './shared.js'

/** Absolute path for Vitest's `test.setupFiles` configuration. */
export const qguardSetup = fileURLToPath(new URL('./vitest-setup.js', import.meta.url))
