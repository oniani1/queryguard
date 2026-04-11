import type { MiddlewareHandler } from 'hono'
import { detect } from '../core/detector.js'
import { createContext, runInContext } from '../core/tracker.js'
import { install } from '../drivers/install.js'
import { handleReport, isDisabled } from './shared.js'
import type { QueryGuardMiddlewareOptions } from './shared.js'

export type { QueryGuardMiddlewareOptions }

export function queryGuard(options?: QueryGuardMiddlewareOptions): MiddlewareHandler {
  const mode = options?.mode ?? 'warn'
  const onDetection = options?.onDetection

  return async (c, next) => {
    if (isDisabled()) {
      await next()
      return
    }

    await install()
    const ctx = createContext()

    await runInContext(ctx, async () => {
      await next()
    })

    const report = detect(ctx)
    const body = handleReport(report, mode, c.req.raw, onDetection)
    if (body) {
      c.res = new Response(body, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  }
}
