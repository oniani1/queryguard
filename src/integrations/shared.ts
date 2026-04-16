import { configure, getConfig } from '../core/config.js'
import type { QueryGuardConfig } from '../core/config.js'
import { detect } from '../core/detector.js'
import type { DetectionReport } from '../core/detector.js'
import { dispatchNotifications } from '../core/notify.js'
import { formatReport } from '../core/report.js'
import type { StackFrame } from '../core/stack.js'
import { captureCallerFrame, captureFullStack } from '../core/stack.js'
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
      await dispatchNotifications({
        report,
        environment: 'test',
      })
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
      onDetection: savedConfig.onDetection,
      notifyOnce: savedConfig.notifyOnce,
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

export interface ScalingDetection {
  fingerprintHash: string
  normalizedSql: string
  countsPerFactor: Map<number, number>
  callerFrame: StackFrame | undefined
}

export interface ScalingReport {
  scalingDetections: ScalingDetection[]
  constantFingerprints: number
  factors: number[]
}

export class ScalingError extends Error {
  scalingReport: ScalingReport

  constructor(scalingReport: ScalingReport) {
    super(formatScalingReport(scalingReport))
    this.name = 'ScalingError'
    this.scalingReport = scalingReport
  }
}

export interface AssertScalingOptions {
  setup: (n: number) => void | Promise<void>
  run: () => void | Promise<void>
  teardown?: () => void | Promise<void>
  factors?: number[]
  warmup?: boolean
}

function formatScalingReport(report: ScalingReport): string {
  const lines: string[] = ['Query count is not constant across data sizes:', '']

  for (const detection of report.scalingDetections) {
    lines.push(`  ${detection.normalizedSql}`)
    for (const factor of report.factors) {
      const count = detection.countsPerFactor.get(factor) ?? 0
      lines.push(`    N=${factor}: ${count} ${count === 1 ? 'query' : 'queries'}`)
    }
    if (detection.callerFrame) {
      lines.push(`  at ${detection.callerFrame.file}:${detection.callerFrame.line}`)
    }
    lines.push(`  fingerprint: ${detection.fingerprintHash.slice(0, 8)}`)
    lines.push('')
  }

  return lines.join('\n')
}

async function collectFingerprints(run: () => void | Promise<void>): Promise<{
  counts: Map<string, number>
  sqlMap: Map<string, string>
  callerMap: Map<string, StackFrame | undefined>
}> {
  await install()
  const ctx = createContext()
  await runInContext(ctx, run)

  const counts = new Map<string, number>()
  const sqlMap = new Map<string, string>()
  const callerMap = new Map<string, StackFrame | undefined>()

  for (const [hash, count] of ctx.fingerprintCounts) {
    counts.set(hash, count)
  }
  for (const query of ctx.queries) {
    if (!sqlMap.has(query.fingerprintHash)) {
      sqlMap.set(query.fingerprintHash, query.normalizedSql)
      callerMap.set(query.fingerprintHash, query.callerFrame)
    }
  }

  return { counts, sqlMap, callerMap }
}

export async function runAssertScaling(options: AssertScalingOptions): Promise<void> {
  const factors = options.factors ?? [2, 3]
  const warmup = options.warmup !== false

  if (factors.length < 2) {
    throw new Error('assertScaling requires at least 2 scale factors')
  }

  if (new Set(factors).size < 2) {
    throw new Error('assertScaling requires at least 2 distinct scale factors')
  }

  // Warmup run: prime connections and caches
  const firstFactor = factors[0]
  if (firstFactor === undefined) {
    throw new Error('assertScaling requires at least one factor')
  }
  if (warmup) {
    await options.setup(firstFactor)
    await collectFingerprints(options.run)
  }

  // Measured runs
  const runs: Array<{
    factor: number
    counts: Map<string, number>
    sqlMap: Map<string, string>
    callerMap: Map<string, StackFrame | undefined>
  }> = []

  try {
    for (let i = 0; i < factors.length; i++) {
      const factor = factors[i]
      if (factor === undefined) continue
      if (i > 0 || warmup) {
        if (options.teardown) await options.teardown()
      }
      await options.setup(factor)
      const result = await collectFingerprints(options.run)
      runs.push({ factor, ...result })
    }
  } finally {
    if (options.teardown) await options.teardown()
  }

  // Compare: collect all fingerprint hashes across runs
  const allHashes = new Set<string>()
  for (const run of runs) {
    for (const hash of run.counts.keys()) {
      allHashes.add(hash)
    }
  }

  const scalingDetections: ScalingDetection[] = []
  let constantCount = 0

  for (const hash of allHashes) {
    const countsPerFactor = new Map<number, number>()
    let normalizedSql = ''
    let callerFrame: StackFrame | undefined

    for (const run of runs) {
      countsPerFactor.set(run.factor, run.counts.get(hash) ?? 0)
      if (!normalizedSql && run.sqlMap.has(hash)) {
        normalizedSql = run.sqlMap.get(hash) ?? ''
      }
      if (!callerFrame && run.callerMap.has(hash)) {
        callerFrame = run.callerMap.get(hash)
      }
    }

    const values = [...countsPerFactor.values()]
    const isConstant = values.every((v) => v === values[0])

    if (isConstant) {
      constantCount++
    } else {
      scalingDetections.push({ fingerprintHash: hash, normalizedSql, countsPerFactor, callerFrame })
    }
  }

  if (scalingDetections.length > 0) {
    const report: ScalingReport = {
      scalingDetections,
      constantFingerprints: constantCount,
      factors,
    }
    throw new ScalingError(report)
  }
}
