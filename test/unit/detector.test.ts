import { describe, it, expect, beforeEach } from 'vitest'
import { resetConfig, configure } from '../../src/core/config.js'
import { detect } from '../../src/core/detector.js'
import type { TrackingContext, RecordedQuery } from '../../src/core/tracker.js'
import type { StackFrame } from '../../src/core/stack.js'

beforeEach(() => {
  resetConfig()
})

function makeFrame(file = 'app.ts', line = 10): StackFrame {
  return { file, line, column: 1, fn: 'testFn', raw: `at testFn (${file}:${line}:1)` }
}

function makeQuery(overrides: Partial<RecordedQuery> = {}): RecordedQuery {
  return {
    sql: 'SELECT * FROM "User" WHERE id = ?',
    normalizedSql: 'select * from "User" where id = ?',
    fingerprintHash: 'abc123',
    timestamp: Date.now(),
    durationMs: 5,
    inTransaction: false,
    callerFrame: makeFrame(),
    fullStack: undefined,
    tick: 0,
    ...overrides,
  }
}

function makeContext(
  queries: RecordedQuery[],
  fingerprintCounts?: Map<string, number>,
): TrackingContext {
  const counts = fingerprintCounts ?? new Map<string, number>()
  if (!fingerprintCounts) {
    for (const q of queries) {
      counts.set(q.fingerprintHash, (counts.get(q.fingerprintHash) ?? 0) + 1)
    }
  }
  return {
    queries,
    fingerprintCounts: counts,
    fingerprintFirstIndex: new Map(),
    transactionState: { depth: 0, savepointNames: [] },
    callerStack: undefined,
    startTime: Date.now() - 100,
    currentTick: 0,
    tickScheduled: false,
  }
}

describe('detector', () => {
  it('rule 1 - fingerprint at threshold is detected as n-plus-one', () => {
    const queries = [
      makeQuery({ tick: 0 }),
      makeQuery({ tick: 1 }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(1)
    expect(report.detections[0].type).toBe('n-plus-one')
    expect(report.detections[0].occurrences).toBe(2)
    expect(report.detections[0].fingerprintHash).toBe('abc123')
  })

  it('rule 1 - fingerprint below threshold is not detected', () => {
    const queries = [makeQuery({ tick: 0 })]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(0)
  })

  it('rule 2 - same tick queries are concurrent-duplicates, filtered from detections', () => {
    const queries = [
      makeQuery({ tick: 0 }),
      makeQuery({ tick: 0 }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(0)
  })

  it('rule 2 - concurrentDuplicatesAreNPlusOne treats same-tick as n-plus-one', () => {
    configure({ concurrentDuplicatesAreNPlusOne: true })
    const queries = [
      makeQuery({ tick: 0 }),
      makeQuery({ tick: 0 }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(1)
    expect(report.detections[0].type).toBe('n-plus-one')
  })

  it('rule 3 - all queries in transaction are excluded', () => {
    const queries = [
      makeQuery({ tick: 0, inTransaction: true }),
      makeQuery({ tick: 1, inTransaction: true }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(0)
  })

  it('rule 3 - mixed transaction queries are still detected', () => {
    const queries = [
      makeQuery({ tick: 0, inTransaction: true }),
      makeQuery({ tick: 1, inTransaction: false }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(1)
    expect(report.detections[0].type).toBe('n-plus-one')
  })

  it('rule 3 - detectInsideTransactions includes transaction queries', () => {
    configure({ detectInsideTransactions: true })
    const queries = [
      makeQuery({ tick: 0, inTransaction: true }),
      makeQuery({ tick: 1, inTransaction: true }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(1)
    expect(report.detections[0].type).toBe('n-plus-one')
  })

  it('multiple fingerprints both above threshold produce 2 detections', () => {
    const queries = [
      makeQuery({ fingerprintHash: 'aaa', normalizedSql: 'select from a', tick: 0 }),
      makeQuery({ fingerprintHash: 'aaa', normalizedSql: 'select from a', tick: 1 }),
      makeQuery({ fingerprintHash: 'bbb', normalizedSql: 'select from b', tick: 2 }),
      makeQuery({ fingerprintHash: 'bbb', normalizedSql: 'select from b', tick: 3 }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.detections).toHaveLength(2)
    expect(report.detections.map((d) => d.fingerprintHash).sort()).toEqual(['aaa', 'bbb'])
  })

  it('report metadata has correct totalQueries and totalDurationMs', () => {
    const queries = [
      makeQuery({ durationMs: 10, tick: 0 }),
      makeQuery({ durationMs: 20, tick: 1 }),
      makeQuery({ fingerprintHash: 'other', durationMs: 5, tick: 2 }),
    ]
    const ctx = makeContext(queries)
    const report = detect(ctx)
    expect(report.totalQueries).toBe(3)
    expect(report.totalDurationMs).toBe(35)
  })
})
