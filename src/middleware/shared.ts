import { getConfig } from '../core/config.js'
import type { DetectionReport } from '../core/detector.js'
import { dispatchNotifications } from '../core/notify.js'
import { formatReport } from '../core/report.js'

export type MiddlewareMode = 'warn' | 'throw' | 'silent'

export interface QueryGuardMiddlewareOptions {
  mode?: MiddlewareMode
  onDetection?: (report: DetectionReport, req: unknown) => void
  skipGlobalNotifiers?: boolean
}

let warnedDisabled = false

export function isDisabled(): boolean {
  const disabled = !getConfig().enabled
  if (disabled && !warnedDisabled) {
    warnedDisabled = true
    console.warn('[queryguard] disabled in production. Set QUERYGUARD_FORCE=1 to override.')
  }
  return disabled
}

export function resetWarnedFlag(): void {
  warnedDisabled = false
}

export function handleReport(
  report: DetectionReport,
  mode: MiddlewareMode,
  req: unknown,
  onDetection?: (report: DetectionReport, req: unknown) => void,
  options?: { skipGlobalNotifiers?: boolean },
): string | null {
  if (report.detections.length === 0) return null

  const formatted = formatReport(report)

  // Always call onDetection if provided, regardless of mode
  onDetection?.(report, req)

  // Dispatch global notifiers (fire-and-forget in middleware)
  const reqInfo = extractRequestInfo(req)
  dispatchNotifications(
    {
      report,
      environment: 'middleware',
      request: reqInfo,
    },
    undefined,
    { skipGlobal: options?.skipGlobalNotifiers, await: false },
  ).catch(() => {})

  switch (mode) {
    case 'warn':
      console.warn(formatted)
      return null
    case 'throw':
      return formatted
    case 'silent':
      return null
  }
}

function extractRequestInfo(req: unknown): { method: string; url: string } | undefined {
  if (
    req &&
    typeof req === 'object' &&
    'method' in req &&
    'url' in req &&
    typeof (req as Record<string, unknown>).method === 'string' &&
    typeof (req as Record<string, unknown>).url === 'string'
  ) {
    return {
      method: (req as Record<string, string>).method,
      url: (req as Record<string, string>).url,
    }
  }
  return undefined
}
