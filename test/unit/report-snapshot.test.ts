import { beforeEach, describe, expect, it } from 'vitest'
import { configure, resetConfig } from '../../src/core/config.js'
import type { Detection, DetectionReport } from '../../src/core/detector.js'
import { formatDetection, formatReport } from '../../src/core/report.js'

beforeEach(() => {
  resetConfig()
})

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    type: 'n-plus-one',
    fingerprintHash: 'abc123def4567890',
    normalizedSql: 'select * from posts where user_id = ?',
    occurrences: 3,
    queries: [],
    callerFrame: {
      file: 'src/handler.ts',
      line: 42,
      column: 5,
      fn: 'listPosts',
      raw: 'at listPosts (src/handler.ts:42:5)',
    },
    totalDurationMs: 15,
    ...overrides,
  }
}

describe('formatDetection snapshot', () => {
  it('formats a single detection with a caller frame', () => {
    expect(formatDetection(makeDetection())).toMatchInlineSnapshot(`
      "N+1 query detected

        Repeated query executed 3 times:
          select * from posts where user_id = ?

        Called from:
          src/handler.ts:42

        Total queries: 3 (1 expected + 2 duplicates)
        Time spent in duplicates: 15ms

        Fingerprint: abc123de
        Full stack: run with QUERYGUARD_VERBOSE=1"
    `)
  })

  it('omits the "Called from" block when callerFrame is undefined', () => {
    expect(formatDetection(makeDetection({ callerFrame: undefined }))).toMatchInlineSnapshot(`
      "N+1 query detected

        Repeated query executed 3 times:
          select * from posts where user_id = ?

        Total queries: 3 (1 expected + 2 duplicates)
        Time spent in duplicates: 15ms

        Fingerprint: abc123de
        Full stack: run with QUERYGUARD_VERBOSE=1"
    `)
  })

  it('in verbose mode with a captured stack, prints frames', () => {
    configure({ verbose: true })
    const detection = makeDetection({
      queries: [
        {
          sql: 'select * from posts where user_id = 1',
          normalizedSql: 'select * from posts where user_id = ?',
          fingerprintHash: 'abc123def4567890',
          timestamp: 0,
          durationMs: 5,
          inTransaction: false,
          callerFrame: undefined,
          fullStack: [
            { file: 'src/handler.ts', line: 42, column: 5, fn: 'listPosts', raw: '' },
            { file: 'src/router.ts', line: 10, column: 3, fn: 'dispatch', raw: '' },
          ],
          tick: 0,
        },
      ],
    })
    const out = formatDetection(detection)
    expect(out).toContain('Full stack:')
    expect(out).toContain('listPosts (src/handler.ts:42:5)')
    expect(out).toContain('dispatch (src/router.ts:10:3)')
    expect(out).not.toContain('no stack captured')
    expect(out).not.toContain('run with QUERYGUARD_VERBOSE=1')
  })

  it('in verbose mode with queries that lack a full stack, prints "no stack captured"', () => {
    configure({ verbose: true })
    const detection = makeDetection({
      queries: [
        {
          sql: 'select * from posts where user_id = 1',
          normalizedSql: 'select * from posts where user_id = ?',
          fingerprintHash: 'abc123def4567890',
          timestamp: 0,
          durationMs: 5,
          inTransaction: false,
          callerFrame: undefined,
          fullStack: undefined,
          tick: 0,
        },
      ],
    })
    expect(formatDetection(detection)).toMatchInlineSnapshot(`
      "N+1 query detected

        Repeated query executed 3 times:
          select * from posts where user_id = ?

        Called from:
          src/handler.ts:42

        Total queries: 3 (1 expected + 2 duplicates)
        Time spent in duplicates: 15ms

        Fingerprint: abc123de
        Full stack: no stack captured"
    `)
  })
})

describe('formatReport snapshot', () => {
  it('formats a multi-detection report with numbered sections', () => {
    const report: DetectionReport = {
      detections: [
        makeDetection({ fingerprintHash: '11111111aaaaaaaa', occurrences: 2 }),
        makeDetection({
          fingerprintHash: '22222222bbbbbbbb',
          normalizedSql: 'select * from comments where post_id = ?',
          occurrences: 5,
          totalDurationMs: 42,
        }),
      ],
      totalQueries: 7,
      totalDurationMs: 57,
      contextDurationMs: 100,
    }

    expect(formatReport(report)).toMatchInlineSnapshot(`
      "[1/2] N+1 query detected

        Repeated query executed 2 times:
          select * from posts where user_id = ?

        Called from:
          src/handler.ts:42

        Total queries: 2 (1 expected + 1 duplicates)
        Time spent in duplicates: 15ms

        Fingerprint: 11111111
        Full stack: run with QUERYGUARD_VERBOSE=1

      [2/2] N+1 query detected

        Repeated query executed 5 times:
          select * from comments where post_id = ?

        Called from:
          src/handler.ts:42

        Total queries: 5 (1 expected + 4 duplicates)
        Time spent in duplicates: 42ms

        Fingerprint: 22222222
        Full stack: run with QUERYGUARD_VERBOSE=1"
    `)
  })

  it('returns empty string for report with no detections', () => {
    const report: DetectionReport = {
      detections: [],
      totalQueries: 0,
      totalDurationMs: 0,
      contextDurationMs: 0,
    }
    expect(formatReport(report)).toBe('')
  })

  it('single-detection report omits the [1/N] prefix', () => {
    const report: DetectionReport = {
      detections: [makeDetection({ fingerprintHash: 'solo111122223333' })],
      totalQueries: 3,
      totalDurationMs: 15,
      contextDurationMs: 100,
    }
    const out = formatReport(report)
    expect(out).not.toMatch(/^\[\d+\/\d+\]/)
    expect(out).toContain('N+1 query detected')
  })
})
