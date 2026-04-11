import { getConfig } from '../core/config.js'
import type { DetectionReport } from '../core/detector.js'
import { formatReport } from '../core/report.js'

export type MiddlewareMode = 'warn' | 'throw' | 'silent'

export interface QueryGuardMiddlewareOptions {
  mode?: MiddlewareMode
  onDetection?: (report: DetectionReport, req: unknown) => void
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
): string | null {
  if (report.detections.length === 0) return null

  const formatted = formatReport(report)

  // Always call onDetection if provided, regardless of mode
  onDetection?.(report, req)

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
