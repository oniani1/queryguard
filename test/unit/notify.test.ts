import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetConfig, configure } from '../../src/core/config.js'
import { recordQuery } from '../../src/core/tracker.js'
import { trackQueries, runAssertNoNPlusOne, QueryGuardError } from '../../src/integrations/shared.js'
import { dispatchNotifications, resetNotifiedFingerprints } from '../../src/core/notify.js'
import type { NotificationContext, Notifier } from '../../src/core/notify.js'
import { loggerNotifier, slackNotifier, sentryNotifier } from '../../src/notifiers/index.js'

beforeEach(() => {
  resetConfig()
})

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe('dispatchNotifications', () => {
  it('calls global onDetection notifiers', async () => {
    const calls: NotificationContext[] = []
    configure({
      onDetection: [(ctx) => { calls.push(ctx) }],
    })

    try {
      await runAssertNoNPlusOne(async () => {
        recordQuery('SELECT * FROM "User"', 1)
        await tick()
        recordQuery('SELECT * FROM "User"', 1)
      })
    } catch {
      // expected
    }

    expect(calls.length).toBe(1)
    expect(calls[0].environment).toBe('test')
    expect(calls[0].report.detections.length).toBe(1)
  })

  it('does not call notifiers when no detections', async () => {
    const calls: NotificationContext[] = []
    configure({
      onDetection: [(ctx) => { calls.push(ctx) }],
    })

    await runAssertNoNPlusOne(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      return 'ok'
    })

    expect(calls.length).toBe(0)
  })

  it('deduplicates by fingerprint with notifyOnce', async () => {
    const calls: NotificationContext[] = []
    configure({
      onDetection: [(ctx) => { calls.push(ctx) }],
      notifyOnce: true,
    })

    // First detection
    try {
      await runAssertNoNPlusOne(async () => {
        recordQuery('SELECT * FROM "User"', 1)
        await tick()
        recordQuery('SELECT * FROM "User"', 1)
      })
    } catch {
      // expected
    }

    // Same fingerprint again
    try {
      await runAssertNoNPlusOne(async () => {
        recordQuery('SELECT * FROM "User"', 1)
        await tick()
        recordQuery('SELECT * FROM "User"', 1)
      })
    } catch {
      // expected
    }

    expect(calls.length).toBe(1)
  })

  it('notifies again after resetConfig clears dedup set', async () => {
    const calls: NotificationContext[] = []
    const notifier: Notifier = (ctx) => { calls.push(ctx) }

    configure({ onDetection: [notifier], notifyOnce: true })

    try {
      await runAssertNoNPlusOne(async () => {
        recordQuery('SELECT * FROM "User"', 1)
        await tick()
        recordQuery('SELECT * FROM "User"', 1)
      })
    } catch {
      // expected
    }

    expect(calls.length).toBe(1)

    resetConfig()
    configure({ onDetection: [notifier], notifyOnce: true })

    try {
      await runAssertNoNPlusOne(async () => {
        recordQuery('SELECT * FROM "User"', 1)
        await tick()
        recordQuery('SELECT * FROM "User"', 1)
      })
    } catch {
      // expected
    }

    expect(calls.length).toBe(2)
  })

  it('catches notifier errors without breaking', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    configure({
      onDetection: [() => { throw new Error('notifier boom') }],
    })

    await expect(runAssertNoNPlusOne(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
    })).rejects.toThrow(QueryGuardError)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('notifier failed: notifier boom'),
    )

    warnSpy.mockRestore()
  })

  it('skipGlobal prevents global notifiers from firing', async () => {
    const calls: string[] = []

    await dispatchNotifications(
      {
        report: {
          detections: [{
            type: 'n-plus-one',
            fingerprintHash: 'skip-test-hash',
            normalizedSql: 'SELECT 1',
            occurrences: 2,
            queries: [],
            callerFrame: undefined,
            totalDurationMs: 0,
          }],
          totalQueries: 2,
          totalDurationMs: 0,
          contextDurationMs: 0,
        },
        environment: 'middleware',
      },
      [() => { calls.push('extra') }],
      { skipGlobal: true },
    )

    expect(calls).toEqual(['extra'])
  })
})

describe('loggerNotifier', () => {
  it('calls logger.warn with structured data', async () => {
    const logged: Array<{ obj: object; msg: string }> = []
    const logger = {
      warn(obj: object, msg: string) {
        logged.push({ obj, msg })
      },
    }

    const notifier = loggerNotifier(logger)
    await notifier({
      report: {
        detections: [{
          type: 'n-plus-one',
          fingerprintHash: 'abc123',
          normalizedSql: 'SELECT * FROM "posts" WHERE "id" = ?',
          occurrences: 5,
          queries: [],
          callerFrame: { file: 'src/test.ts', line: 10, column: 1, raw: '' },
          totalDurationMs: 42,
        }],
        totalQueries: 5,
        totalDurationMs: 42,
        contextDurationMs: 100,
      },
      environment: 'test',
    })

    expect(logged.length).toBe(1)
    expect(logged[0].msg).toContain('N+1 query detected')
    expect((logged[0].obj as Record<string, unknown>).occurrences).toBe(5)
    expect((logged[0].obj as Record<string, unknown>).caller).toBe('src/test.ts:10')
  })
})

describe('slackNotifier', () => {
  it('is a no-op when URL is falsy', async () => {
    const notifier = slackNotifier(undefined)
    // Should not throw
    await notifier({
      report: {
        detections: [{
          type: 'n-plus-one',
          fingerprintHash: 'x',
          normalizedSql: 'SELECT 1',
          occurrences: 2,
          queries: [],
          callerFrame: undefined,
          totalDurationMs: 0,
        }],
        totalQueries: 2,
        totalDurationMs: 0,
        contextDurationMs: 0,
      },
      environment: 'test',
    })
  })

  it('calls fetch with correct payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    const notifier = slackNotifier('https://hooks.slack.com/test')
    await notifier({
      report: {
        detections: [{
          type: 'n-plus-one',
          fingerprintHash: 'abc',
          normalizedSql: 'SELECT * FROM "users"',
          occurrences: 3,
          queries: [],
          callerFrame: { file: 'src/app.ts', line: 5, column: 1, raw: '' },
          totalDurationMs: 10,
        }],
        totalQueries: 3,
        totalDurationMs: 10,
        contextDurationMs: 50,
      },
      environment: 'middleware',
      request: { method: 'GET', url: '/api/users' },
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://hooks.slack.com/test')
    expect(init?.method).toBe('POST')

    const body = JSON.parse(init?.body as string)
    expect(body.text).toContain('N+1 detected')
    expect(body.text).toContain('GET /api/users')

    fetchSpy.mockRestore()
  })
})

describe('sentryNotifier', () => {
  it('calls captureMessage with custom fingerprint and scope tags', async () => {
    const captured: Array<{
      message: string
      level: string
      fingerprint: string[]
      tags: Record<string, string>
      context: Record<string, unknown>
    }> = []

    const mockSentry = {
      withScope(callback: (scope: Record<string, unknown>) => void) {
        const state = {
          fingerprint: [] as string[],
          tags: {} as Record<string, string>,
          ctx: {} as Record<string, unknown>,
        }
        const scope = {
          setFingerprint(fp: string[]) { state.fingerprint = fp },
          setTag(k: string, v: string) { state.tags[k] = v },
          setContext(_name: string, c: Record<string, unknown>) { state.ctx = c },
          _state: state,
        }
        callback(scope)
        // Capture the accumulated state after callback runs
        captured[captured.length - 1].fingerprint = state.fingerprint
        captured[captured.length - 1].tags = state.tags
        captured[captured.length - 1].context = state.ctx
      },
      captureMessage(message: string, level: string) {
        captured.push({ message, level, fingerprint: [], tags: {}, context: {} })
      },
    }

    const notifier = sentryNotifier(mockSentry)
    await notifier({
      report: {
        detections: [{
          type: 'n-plus-one',
          fingerprintHash: 'sentry-hash-123',
          normalizedSql: 'SELECT * FROM "orders"',
          occurrences: 4,
          queries: [],
          callerFrame: { file: 'src/orders.ts', line: 20, column: 1, fn: undefined, raw: '' },
          totalDurationMs: 15,
        }],
        totalQueries: 4,
        totalDurationMs: 15,
        contextDurationMs: 30,
      },
      environment: 'middleware',
      request: { method: 'POST', url: '/api/orders' },
    })

    expect(captured.length).toBe(1)
    expect(captured[0].message).toContain('N+1')
    expect(captured[0].message).toContain('orders')
    expect(captured[0].level).toBe('warning')
    expect(captured[0].fingerprint).toEqual(['qguard', 'sentry-hash-123'])
    expect(captured[0].tags['qguard.occurrences']).toBe('4')
    expect(captured[0].tags['qguard.environment']).toBe('middleware')
    expect(captured[0].tags['qguard.url']).toBe('/api/orders')
    expect(captured[0].context).toMatchObject({
      normalizedSql: 'SELECT * FROM "orders"',
      occurrences: 4,
      callerFile: 'src/orders.ts',
      callerLine: 20,
    })
  })
})
