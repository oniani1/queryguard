import { getConfig } from '../core/config.js'
import type { DetectionReport } from '../core/detector.js'
import type { NotificationContext, Notifier } from '../core/notify.js'
import { dispatchNotifications } from '../core/notify.js'
import { formatReport } from '../core/report.js'

export type { Notifier, NotificationContext } from '../core/notify.js'

export interface StructuredLogger {
  warn(obj: object, msg: string): void
}

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug'

export interface SentryLike {
  withScope(callback: (scope: SentryScope) => void): void
  captureMessage(message: string, level: SeverityLevel): void
}

interface SentryScope {
  setFingerprint(fingerprint: string[]): void
  setTag(key: string, value: string): void
  setContext(name: string, context: Record<string, unknown>): void
}

export function loggerNotifier(logger: StructuredLogger): Notifier {
  return (ctx: NotificationContext) => {
    for (const detection of ctx.report.detections) {
      logger.warn(
        {
          fingerprintHash: detection.fingerprintHash,
          normalizedSql: detection.normalizedSql,
          occurrences: detection.occurrences,
          totalDurationMs: detection.totalDurationMs,
          caller: detection.callerFrame
            ? `${detection.callerFrame.file}:${detection.callerFrame.line}`
            : undefined,
        },
        `N+1 query detected: ${detection.normalizedSql.slice(0, 80)}`,
      )
    }
  }
}

export function slackNotifier(
  webhookUrl: string | undefined,
  options?: { channel?: string },
): Notifier {
  return async (ctx: NotificationContext) => {
    if (!webhookUrl) return

    const lines: string[] = []

    const location =
      ctx.environment === 'middleware' && ctx.request
        ? `${ctx.request.method} ${ctx.request.url}`
        : ctx.environment === 'test' && ctx.test
          ? `${ctx.test.file}${ctx.test.name ? ` > ${ctx.test.name}` : ''}`
          : ctx.environment

    lines.push(`*N+1 detected* in ${location}`)

    for (const detection of ctx.report.detections) {
      const caller = detection.callerFrame
        ? `${detection.callerFrame.file}:${detection.callerFrame.line}`
        : 'unknown'
      lines.push(
        `\`${detection.normalizedSql.slice(0, 100)}\` (${detection.occurrences}x, ${detection.totalDurationMs}ms) at ${caller}`,
      )
    }

    const body: Record<string, unknown> = { text: lines.join('\n') }
    if (options?.channel) body.channel = options.channel

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}`)
    }
  }
}

export function sentryNotifier(sentry: SentryLike): Notifier {
  return (ctx: NotificationContext) => {
    for (const detection of ctx.report.detections) {
      sentry.withScope((scope) => {
        scope.setFingerprint(['qguard', detection.fingerprintHash])
        scope.setTag('qguard.occurrences', String(detection.occurrences))
        scope.setTag('qguard.environment', ctx.environment)
        if (ctx.request) {
          scope.setTag('qguard.url', ctx.request.url)
        }
        scope.setContext('qguard', {
          normalizedSql: detection.normalizedSql,
          occurrences: detection.occurrences,
          totalDurationMs: detection.totalDurationMs,
          callerFile: detection.callerFrame?.file,
          callerLine: detection.callerFrame?.line,
        })
        sentry.captureMessage(`N+1: ${detection.normalizedSql.slice(0, 80)}`, 'warning')
      })
    }
  }
}

export async function testNotifiers(): Promise<void> {
  const syntheticReport: DetectionReport = {
    detections: [
      {
        type: 'n-plus-one',
        fingerprintHash: 'test000000000000',
        normalizedSql: 'SELECT * FROM "qguard_test" WHERE "id" = ?',
        occurrences: 3,
        queries: [],
        callerFrame: { file: 'test/verify.ts', line: 1, column: 1, fn: undefined, raw: '' },
        totalDurationMs: 5,
      },
    ],
    totalQueries: 3,
    totalDurationMs: 5,
    contextDurationMs: 10,
  }

  await dispatchNotifications({
    report: syntheticReport,
    environment: 'test',
    test: { name: 'testNotifiers verification', file: 'qguard/notifiers' },
  })
}
