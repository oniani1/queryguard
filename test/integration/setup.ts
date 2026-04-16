// Dogfood: wrap every integration test in a tracking context so we notice
// if test-level code (seeding, cleanup, fixtures) accidentally introduces an
// N+1. Nested trackQueries() calls from the test body itself create their
// own inner contexts and are handled by those; this outer context only sees
// queries that happen outside of an explicit tracked block.

import { afterEach, beforeEach } from 'vitest'
import { detect } from '../../src/core/detector.js'
import { install, uninstall } from '../../src/drivers/install.js'
import { createContext, trackingAls } from '../../src/core/tracker.js'
import type { TrackingContext } from '../../src/core/tracker.js'

let outerCtx: TrackingContext | undefined

beforeEach(async () => {
  await install()
  outerCtx = createContext()
  trackingAls.enterWith(outerCtx)
})

afterEach(() => {
  if (!outerCtx) return
  const report = detect(outerCtx)
  if (report.detections.length > 0) {
    const summary = report.detections
      .map((d) => `  - ${d.normalizedSql} (${d.occurrences}x)`)
      .join('\n')
    console.warn(
      `[qguard dogfood] outer context observed an N+1 pattern. If intentional, wrap it in trackQueries() or ignore():\n${summary}`,
    )
  }
  outerCtx = undefined
  uninstall()
})
