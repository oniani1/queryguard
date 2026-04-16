import { getConfig } from './config.js'
import type { StackFrame } from './stack.js'
import type { RecordedQuery, TrackingContext } from './tracker.js'

export interface Detection {
  type: 'n-plus-one' | 'concurrent-duplicates'
  fingerprintHash: string
  normalizedSql: string
  occurrences: number
  queries: ReadonlyArray<RecordedQuery>
  callerFrame: StackFrame | undefined
  totalDurationMs: number
}

export interface DetectionReport {
  detections: ReadonlyArray<Detection>
  totalQueries: number
  totalDurationMs: number
  contextDurationMs: number
}

export function detect(ctx: TrackingContext): DetectionReport {
  const config = getConfig()
  const allDetections: Detection[] = []

  for (const [hash, count] of ctx.fingerprintCounts) {
    if (count < config.threshold) continue

    const queries = ctx.queries.filter((q) => q.fingerprintHash === hash)
    const first = queries[0]
    if (!first) continue

    if (!config.detectInsideTransactions && queries.every((q) => q.inTransaction)) {
      continue
    }

    const allSameTick = queries.every((q) => q.tick === first.tick)
    const type: Detection['type'] =
      allSameTick && !config.concurrentDuplicatesAreNPlusOne
        ? 'concurrent-duplicates'
        : 'n-plus-one'

    const callerFrame = first.callerFrame ?? ctx.callerStack?.[0]

    const totalDurationMs = queries.reduce((sum, q) => sum + q.durationMs, 0)

    allDetections.push({
      type,
      fingerprintHash: hash,
      normalizedSql: first.normalizedSql,
      occurrences: queries.length,
      queries,
      callerFrame,
      totalDurationMs,
    })
  }

  const totalQueries = ctx.queries.length
  const totalDurationMs = ctx.queries.reduce((sum, q) => sum + q.durationMs, 0)
  const contextDurationMs = Date.now() - ctx.startTime

  return {
    detections: allDetections.filter((d) => d.type === 'n-plus-one'),
    totalQueries,
    totalDurationMs,
    contextDurationMs,
  }
}
