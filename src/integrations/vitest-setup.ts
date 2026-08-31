import { afterEach, beforeEach } from 'vitest'
import { detect } from '../core/detector.js'
import { dispatchNotifications } from '../core/notify.js'
import { createContext, trackingAls } from '../core/tracker.js'
import type { TrackingContext } from '../core/tracker.js'
import { install } from '../drivers/install.js'
import { QueryGuardError } from './shared.js'

const contexts = new WeakMap<object, TrackingContext>()

await install()

// Keep this hook synchronous: entering ALS after an await does not propagate the store back to
// Vitest's runner, so queries from the test would escape the context.
beforeEach((testContext) => {
  const context = createContext()
  contexts.set(testContext, context)
  trackingAls.enterWith(context)
})

afterEach(async (testContext) => {
  const context = contexts.get(testContext)
  contexts.delete(testContext)
  if (!context) return

  const report = detect(context)
  if (report.detections.length === 0) return

  await dispatchNotifications({
    report,
    environment: 'test',
    test: {
      name: testContext.task.name,
      file: testContext.task.file.filepath,
    },
  })
  throw new QueryGuardError(report)
})
