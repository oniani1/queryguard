import type { NextFunction, Request, Response } from 'express'
import { detect } from '../core/detector.js'
import { createContext, runInContext } from '../core/tracker.js'
import { install } from '../drivers/install.js'
import { handleReport, isDisabled } from './shared.js'
import type { QueryGuardMiddlewareOptions } from './shared.js'

export type { QueryGuardMiddlewareOptions }

export function queryGuard(options?: QueryGuardMiddlewareOptions) {
  const mode = options?.mode ?? 'warn'
  const onDetection = options?.onDetection

  // Eagerly kick off install (async, but we don't need to await)
  let installPromise: Promise<void> | undefined

  return (req: Request, res: Response, next: NextFunction): void => {
    if (isDisabled()) {
      next()
      return
    }

    if (!installPromise) installPromise = install()

    const ctx = createContext()

    // Run everything downstream inside the ALS context
    runInContext(ctx, () => {
      res.on('finish', () => {
        const report = detect(ctx)
        // Express detection runs after res.on('finish'), so the response
        // is already sent. 'throw' mode degrades to stderr logging here.
        // For hard request failures, use queryguard/vitest in tests or
        // queryguard/next or queryguard/hono where pre-send interception works.
        const effectiveMode = mode === 'throw' ? 'warn' : mode
        handleReport(report, effectiveMode, req, onDetection)
      })
      next()
    })
  }
}
