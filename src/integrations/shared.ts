import { configure, getConfig } from '../core/config.js'
import type { QueryGuardConfig } from '../core/config.js'
import { detect } from '../core/detector.js'
import type { DetectionReport } from '../core/detector.js'
import { formatReport } from '../core/report.js'
import { captureFullStack } from '../core/stack.js'
import { createContext, runInContext } from '../core/tracker.js'
import { install } from '../drivers/install.js'

export class QueryGuardError extends Error {
  report: DetectionReport

  constructor(report: DetectionReport) {
    super(formatReport(report))
    this.name = 'QueryGuardError'
    this.report = report
  }
}

export interface AssertOptions {
  threshold?: number
  ignore?: Array<string | RegExp>
  detectInsideTransactions?: boolean
}

export async function trackQueries<T>(fn: () => T | Promise<T>): Promise<{
  result: T
  report: DetectionReport
}> {
  await install()
  const callerStack = captureFullStack()
  const ctx = createContext(callerStack)
  const result = await runInContext(ctx, fn)
  const report = detect(ctx)
  return { result, report }
}

export async function runAssertNoNPlusOne<T>(
  fn: () => T | Promise<T>,
  options?: AssertOptions,
): Promise<T> {
  const savedConfig = { ...getConfig() }

  try {
    if (options) {
      const overrides: Partial<
        Pick<QueryGuardConfig, 'threshold' | 'ignore' | 'detectInsideTransactions'>
      > = {}
      if (options.threshold !== undefined) overrides.threshold = options.threshold
      if (options.ignore !== undefined) overrides.ignore = options.ignore
      if (options.detectInsideTransactions !== undefined) {
        overrides.detectInsideTransactions = options.detectInsideTransactions
      }
      configure(overrides)
    }

    const { result, report } = await trackQueries(fn)

    if (report.detections.length > 0) {
      throw new QueryGuardError(report)
    }

    return result
  } finally {
    configure({
      threshold: savedConfig.threshold,
      ignore: [...savedConfig.ignore],
      mode: savedConfig.mode,
      detectInsideTransactions: savedConfig.detectInsideTransactions,
      concurrentDuplicatesAreNPlusOne: savedConfig.concurrentDuplicatesAreNPlusOne,
      verbose: savedConfig.verbose,
    })
  }
}

export async function runQueryBudget<T>(maxQueries: number, fn: () => T | Promise<T>): Promise<T> {
  const { result, report } = await trackQueries(fn)

  if (report.totalQueries > maxQueries) {
    throw new QueryGuardError(report)
  }

  return result
}
