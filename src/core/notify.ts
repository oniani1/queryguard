import { getConfig, onReset } from './config.js'
import type { DetectionReport } from './detector.js'

export interface NotificationContext {
  report: DetectionReport
  environment: 'test' | 'middleware'
  request?: { method: string; url: string }
  test?: { name: string; file: string }
}

export type Notifier = (ctx: NotificationContext) => void | Promise<void>

const notifiedFingerprints = new Set<string>()

export function resetNotifiedFingerprints(): void {
  notifiedFingerprints.clear()
}

onReset(resetNotifiedFingerprints)

export async function dispatchNotifications(
  ctx: NotificationContext,
  extraNotifiers?: Notifier[],
  options?: { skipGlobal?: boolean; await?: boolean },
): Promise<void> {
  const config = getConfig()
  const global = options?.skipGlobal ? [] : config.onDetection
  const all = [...global, ...(extraNotifiers ?? [])]
  if (all.length === 0) return

  const shouldNotify = config.notifyOnce
    ? ctx.report.detections.filter((d) => {
        if (notifiedFingerprints.has(d.fingerprintHash)) return false
        notifiedFingerprints.add(d.fingerprintHash)
        return true
      })
    : ctx.report.detections

  if (shouldNotify.length === 0) return

  const filteredCtx: NotificationContext = config.notifyOnce
    ? { ...ctx, report: { ...ctx.report, detections: shouldNotify } }
    : ctx

  const promises = all.map((notifier) => {
    try {
      return Promise.resolve(notifier(filteredCtx)).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[qguard] notifier failed: ${message}`)
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[qguard] notifier failed: ${message}`)
      return Promise.resolve()
    }
  })

  if (options?.await !== false) {
    await Promise.allSettled(promises)
  }
}
