import type { FastifyPluginCallback } from 'fastify'
import { detect } from '../core/detector.js'
import { createContext, trackingAls } from '../core/tracker.js'
import type { TrackingContext } from '../core/tracker.js'
import { install } from '../drivers/install.js'
import { handleReport, isDisabled } from './shared.js'
import type { QueryGuardMiddlewareOptions } from './shared.js'

export type { QueryGuardMiddlewareOptions }

declare module 'fastify' {
  interface FastifyRequest {
    queryGuardCtx?: TrackingContext
  }
}

const plugin: FastifyPluginCallback<QueryGuardMiddlewareOptions> = (instance, opts, done) => {
  if (isDisabled()) {
    done()
    return
  }

  const mode = opts.mode ?? 'warn'
  const onDetection = opts.onDetection

  let installPromise: Promise<void> | undefined

  // Use preParsing to set up ALS context. enterWith() binds the store to
  // the current async resource, so all downstream hooks and the route handler
  // inherit the context through Fastify's async continuation chain.
  instance.addHook('preParsing', (req, _reply, payload, hookDone) => {
    if (!installPromise) installPromise = install()
    const ctx = createContext()
    req.queryGuardCtx = ctx
    trackingAls.enterWith(ctx)
    hookDone(null, payload)
  })

  instance.addHook('onSend', async (req, reply, payload) => {
    const ctx = req.queryGuardCtx
    if (!ctx) return payload
    const report = detect(ctx)
    const body = handleReport(report, mode, req, onDetection)
    if (body) {
      reply.code(500).type('text/plain')
      return body
    }
    return payload
  })

  done()
}

// Break Fastify's encapsulation so hooks apply to routes registered
// on the parent instance, not just within the plugin's own scope.
;(plugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true

export const queryGuard = plugin
