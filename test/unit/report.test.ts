import { describe, it, expect, beforeEach } from 'vitest'
import { resetConfig, configure } from '../../src/core/config.js'
import { formatReport, formatDetection } from '../../src/core/report.js'
import type { Detection, DetectionReport } from '../../src/core/detector.js'
import type { RecordedQuery } from '../../src/core/tracker.js'
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
    fingerprintHash: 'abc12345deadbeef',
    timestamp: Date.now(),
    durationMs: 5,
    inTransaction: false,
    callerFrame: makeFrame(),
    fullStack: undefined,
    tick: 0,
    ...overrides,
  }
}

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    type: 'n-plus-one',
    fingerprintHash: 'abc12345deadbeef',
    normalizedSql: 'select * from "User" where id = ?',
    occurrences: 3,
    queries: [makeQuery(), makeQuery(), makeQuery()],
    callerFrame: makeFrame(),
    totalDurationMs: 15,
    ...overrides,
  }
}

describe('formatDetection', () => {
  it('single detection formats correctly', () => {
    const detection = makeDetection()
    const output = formatDetection(detection)

    expect(output).toContain('N+1 query detected')
    expect(output).toContain('Repeated query executed 3 times')
    expect(output).toContain('select * from "User" where id = ?')
    expect(output).toContain('Called from:')
    expect(output).toContain('app.ts:10')
    expect(output).toContain('Total queries: 3 (1 expected + 2 duplicates)')
    expect(output).toContain('Time spent in duplicates: 15ms')
    expect(output).toContain('Fingerprint: abc12345')
    expect(output).toContain('Full stack: run with QUERYGUARD_VERBOSE=1')
  })

  it('detection with no callerFrame omits Called from section', () => {
    const detection = makeDetection({ callerFrame: undefined })
    const output = formatDetection(detection)

    expect(output).not.toContain('Called from:')
    expect(output).toContain('N+1 query detected')
  })

  it('verbose mode shows stack frames instead of hint', () => {
    configure({ verbose: true })

    const stack: StackFrame[] = [
      { file: 'src/routes/users.ts', line: 42, column: 5, fn: 'getUsers', raw: 'at getUsers (src/routes/users.ts:42:5)' },
      { file: 'src/server.ts', line: 10, column: 3, fn: 'handleRequest', raw: 'at handleRequest (src/server.ts:10:3)' },
    ]

    const queries = [
      makeQuery({ fullStack: stack }),
      makeQuery(),
      makeQuery(),
    ]
    const detection = makeDetection({ queries })
    const output = formatDetection(detection)

    expect(output).not.toContain('run with QUERYGUARD_VERBOSE=1')
    expect(output).toContain('Full stack:')
    expect(output).toContain('getUsers')
    expect(output).toContain('src/routes/users.ts:42')
  })
})

describe('formatReport', () => {
  it('returns empty string for no detections', () => {
    const report: DetectionReport = {
      detections: [],
      totalQueries: 0,
      totalDurationMs: 0,
      contextDurationMs: 0,
    }
    expect(formatReport(report)).toBe('')
  })

  it('single detection is not numbered', () => {
    const report: DetectionReport = {
      detections: [makeDetection()],
      totalQueries: 3,
      totalDurationMs: 15,
      contextDurationMs: 100,
    }
    const output = formatReport(report)
    expect(output).not.toContain('[1/')
    expect(output).toContain('N+1 query detected')
  })

  it('multiple detections are numbered', () => {
    const d1 = makeDetection({ fingerprintHash: 'aaaa1111bbbb2222' })
    const d2 = makeDetection({ fingerprintHash: 'cccc3333dddd4444', normalizedSql: 'select * from "Post"' })
    const report: DetectionReport = {
      detections: [d1, d2],
      totalQueries: 6,
      totalDurationMs: 30,
      contextDurationMs: 200,
    }
    const output = formatReport(report)
    expect(output).toContain('[1/2]')
    expect(output).toContain('[2/2]')
  })
})
