import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConfig } from '../../src/core/config.js'
import type { DetectionReport } from '../../src/core/detector.js'
import { loggerNotifier, sentryNotifier, slackNotifier } from '../../src/notifiers/index.js'

beforeEach(() => {
  resetConfig()
})

function reportWith(detections: DetectionReport['detections']): DetectionReport {
  const totalQueries = detections.reduce((sum, d) => sum + d.occurrences, 0)
  const totalDurationMs = detections.reduce((sum, d) => sum + d.totalDurationMs, 0)
  return { detections, totalQueries, totalDurationMs, contextDurationMs: 100 }
}

function detection(hash: string, sql: string, occurrences = 3) {
  return {
    type: 'n-plus-one' as const,
    fingerprintHash: hash,
    normalizedSql: sql,
    occurrences,
    queries: [],
    callerFrame: { file: 'src/handler.ts', line: 10, column: 1, fn: undefined, raw: '' },
    totalDurationMs: 5,
  }
}

describe('loggerNotifier', () => {
  it('fires once per detection in a multi-detection report', async () => {
    const logs: Array<{ obj: object; msg: string }> = []
    const logger = { warn(obj: object, msg: string) { logs.push({ obj, msg }) } }
    await loggerNotifier(logger)({
      report: reportWith([
        detection('a', 'SELECT * FROM a WHERE id = ?'),
        detection('b', 'SELECT * FROM b WHERE id = ?'),
        detection('c', 'SELECT * FROM c WHERE id = ?'),
      ]),
      environment: 'test',
    })
    expect(logs).toHaveLength(3)
    expect((logs[0].obj as Record<string, unknown>).fingerprintHash).toBe('a')
    expect((logs[1].obj as Record<string, unknown>).fingerprintHash).toBe('b')
    expect((logs[2].obj as Record<string, unknown>).fingerprintHash).toBe('c')
  })

  it('populates every documented obj field', async () => {
    const logs: Array<{ obj: object; msg: string }> = []
    const logger = { warn(obj: object, msg: string) { logs.push({ obj, msg }) } }
    await loggerNotifier(logger)({
      report: reportWith([detection('hash1', 'SELECT 1')]),
      environment: 'test',
    })
    const obj = logs[0].obj as Record<string, unknown>
    expect(obj.fingerprintHash).toBe('hash1')
    expect(obj.normalizedSql).toBe('SELECT 1')
    expect(obj.occurrences).toBe(3)
    expect(obj.totalDurationMs).toBe(5)
    expect(obj.caller).toBe('src/handler.ts:10')
  })

  it('produces caller=undefined when callerFrame is missing', async () => {
    const logs: Array<{ obj: object; msg: string }> = []
    const logger = { warn(obj: object, msg: string) { logs.push({ obj, msg }) } }
    const d = { ...detection('h', 'SELECT 1'), callerFrame: undefined }
    await loggerNotifier(logger)({ report: reportWith([d]), environment: 'test' })
    expect((logs[0].obj as Record<string, unknown>).caller).toBeUndefined()
  })

  it('does nothing when detections is empty', async () => {
    const warnSpy = vi.fn()
    await loggerNotifier({ warn: warnSpy })({
      report: { detections: [], totalQueries: 0, totalDurationMs: 0, contextDurationMs: 0 },
      environment: 'test',
    })
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('slackNotifier', () => {
  it('no-ops when webhookUrl is undefined (no fetch call, no throw)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await slackNotifier(undefined)({
      report: reportWith([detection('a', 'SELECT 1')]),
      environment: 'test',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('formats location as ${method} ${url} for middleware environment with request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await slackNotifier('https://hooks.slack.com/test')({
      report: reportWith([detection('a', 'SELECT 1')]),
      environment: 'middleware',
      request: { method: 'POST', url: '/api/users/42' },
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.text).toContain('POST /api/users/42')
    fetchSpy.mockRestore()
  })

  it('includes channel option in the POST body when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await slackNotifier('https://hooks.slack.com/test', { channel: '#alerts' })({
      report: reportWith([detection('a', 'SELECT * FROM users')]),
      environment: 'test',
    })
    const init = fetchSpy.mock.calls[0][1]
    const body = JSON.parse(init?.body as string)
    expect(body.channel).toBe('#alerts')
    fetchSpy.mockRestore()
  })

  it('throws when the webhook returns non-ok status', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('server error', { status: 500 }))
    await expect(
      slackNotifier('https://hooks.slack.com/test')({
        report: reportWith([detection('a', 'SELECT 1')]),
        environment: 'test',
      }),
    ).rejects.toThrow('Slack webhook returned 500')
    fetchSpy.mockRestore()
  })

  it('formats the location as file > name for test environment', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await slackNotifier('https://hooks.slack.com/test')({
      report: reportWith([detection('a', 'SELECT 1')]),
      environment: 'test',
      test: { name: 'no N+1 on list', file: 'test/users.test.ts' },
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.text).toContain('test/users.test.ts > no N+1 on list')
    fetchSpy.mockRestore()
  })

  it('emits one body line per detection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await slackNotifier('https://hooks.slack.com/test')({
      report: reportWith([
        detection('a', 'SELECT * FROM a'),
        detection('b', 'SELECT * FROM b'),
      ]),
      environment: 'test',
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    const lines = (body.text as string).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('N+1 detected')
    expect(lines[1]).toContain('SELECT * FROM a')
    expect(lines[2]).toContain('SELECT * FROM b')
    fetchSpy.mockRestore()
  })

  it('falls back to environment when no test or request context is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await slackNotifier('https://hooks.slack.com/test')({
      report: reportWith([detection('a', 'SELECT 1')]),
      environment: 'test',
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.text).toMatch(/in test$/m)
    fetchSpy.mockRestore()
  })
})

describe('sentryNotifier', () => {
  function mockSentry() {
    const captured: Array<{
      message: string
      level: string
      fingerprint: string[]
      tags: Record<string, string>
      context: Record<string, unknown>
    }> = []
    const sentry = {
      withScope(cb: (scope: unknown) => void) {
        const state = {
          fingerprint: [] as string[],
          tags: {} as Record<string, string>,
          context: {} as Record<string, unknown>,
        }
        cb({
          setFingerprint(fp: string[]) { state.fingerprint = fp },
          setTag(k: string, v: string) { state.tags[k] = v },
          setContext(_name: string, c: Record<string, unknown>) { state.context = c },
        })
        const entry = captured[captured.length - 1]
        if (entry) {
          entry.fingerprint = state.fingerprint
          entry.tags = state.tags
          entry.context = state.context
        }
      },
      captureMessage(message: string, level: string) {
        captured.push({ message, level, fingerprint: [], tags: {}, context: {} })
      },
    }
    return { sentry, captured }
  }

  it('does not set qguard.url when no request context is present', async () => {
    const { sentry, captured } = mockSentry()
    await sentryNotifier(sentry)({
      report: reportWith([detection('a', 'SELECT 1')]),
      environment: 'test',
    })
    expect(captured[0].tags['qguard.url']).toBeUndefined()
  })

  it('sets qguard.url tag when request is present', async () => {
    const { sentry, captured } = mockSentry()
    await sentryNotifier(sentry)({
      report: reportWith([detection('a', 'SELECT 1')]),
      environment: 'middleware',
      request: { method: 'GET', url: '/api/posts' },
    })
    expect(captured[0].tags['qguard.url']).toBe('/api/posts')
  })

  it('fires withScope once per detection', async () => {
    const { sentry, captured } = mockSentry()
    await sentryNotifier(sentry)({
      report: reportWith([
        detection('a', 'SELECT 1'),
        detection('b', 'SELECT 2'),
        detection('c', 'SELECT 3'),
      ]),
      environment: 'test',
    })
    expect(captured).toHaveLength(3)
    expect(captured.map((c) => c.fingerprint[1])).toEqual(['a', 'b', 'c'])
  })
})

describe('dispatchNotifications error isolation', () => {
  it('continues past a notifier that rejects asynchronously', async () => {
    const { dispatchNotifications } = await import('../../src/core/notify.js')
    const calls: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchNotifications(
      {
        report: reportWith([detection('a', 'SELECT 1')]),
        environment: 'test',
      },
      [
        () => Promise.reject(new Error('async boom')),
        () => { calls.push('second') },
      ],
    )

    expect(calls).toEqual(['second'])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('async boom'))
    warnSpy.mockRestore()
  })

  it('continues past a notifier that throws synchronously', async () => {
    const { dispatchNotifications } = await import('../../src/core/notify.js')
    const calls: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchNotifications(
      {
        report: reportWith([detection('a', 'SELECT 1')]),
        environment: 'test',
      },
      [
        () => { throw new Error('sync boom') },
        () => { calls.push('second') },
      ],
    )

    expect(calls).toEqual(['second'])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sync boom'))
    warnSpy.mockRestore()
  })
})
