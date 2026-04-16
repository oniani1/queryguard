import { describe, expect, it } from 'vitest'
import * as qguard from '../../src/index.js'

// Runtime-level contract. A removed type export would still fail vitest under
// `isolatedDeclarations` + typecheck, but we also want a runtime signal — this
// checks the actual shape of the module namespace. If an export is deleted
// without being migrated, this assertion fails even without tsc.

describe('public API surface', () => {
  it('exports the required runtime values', () => {
    const runtimeExports = [
      'install',
      'uninstall',
      'configure',
      'getConfig',
      'resetConfig',
      'ignore',
      'trackQueries',
      'QueryGuardError',
      'ScalingError',
    ] as const

    for (const name of runtimeExports) {
      expect(name in qguard, `missing export: ${name}`).toBe(true)
      expect(typeof (qguard as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('QueryGuardError is a real Error subclass with report property', () => {
    const { QueryGuardError } = qguard
    const report = {
      detections: [],
      totalQueries: 0,
      totalDurationMs: 0,
      contextDurationMs: 0,
    }
    const err = new QueryGuardError(report)
    expect(err).toBeInstanceOf(QueryGuardError)
    expect(err).toBeInstanceOf(Error)
    expect(err.report).toBe(report)
    expect(err.name).toBe('QueryGuardError')
  })

  it('ScalingError is a real Error subclass with scalingReport property', () => {
    const { ScalingError } = qguard
    const scalingReport = {
      scalingDetections: [],
      constantFingerprints: 0,
      factors: [2, 3],
    }
    const err = new ScalingError(scalingReport)
    expect(err).toBeInstanceOf(ScalingError)
    expect(err).toBeInstanceOf(Error)
    expect(err.scalingReport).toBe(scalingReport)
    expect(err.name).toBe('ScalingError')
  })

  it('type-level symbols compile against the namespace', () => {
    // These aliases force TypeScript to resolve each type at compile time.
    // If an export is removed, `tsc --noEmit` fails; the runtime assertion
    // is a belt-and-suspenders double check that doesn't substitute for typecheck.
    type Check<T> = T extends never ? never : T
    type _Detection = Check<qguard.Detection>
    type _Report = Check<qguard.DetectionReport>
    type _Config = Check<qguard.QueryGuardConfig>
    type _Frame = Check<qguard.StackFrame>
    type _ScalingDet = Check<qguard.ScalingDetection>
    type _ScalingRep = Check<qguard.ScalingReport>
    type _AssertOpts = Check<qguard.AssertOptions>
    type _ScalingOpts = Check<qguard.AssertScalingOptions>
    type _Notifier = Check<qguard.Notifier>
    type _NotifyCtx = Check<qguard.NotificationContext>
    type _Recorded = Check<qguard.RecordedQuery>
    type _Tracking = Check<qguard.TrackingContext>

    // Tag uses so linters don't complain about unused type aliases.
    const _unused: Array<unknown> = []
    _unused.push(null as unknown as _Detection)
    _unused.push(null as unknown as _Report)
    _unused.push(null as unknown as _Config)
    _unused.push(null as unknown as _Frame)
    _unused.push(null as unknown as _ScalingDet)
    _unused.push(null as unknown as _ScalingRep)
    _unused.push(null as unknown as _AssertOpts)
    _unused.push(null as unknown as _ScalingOpts)
    _unused.push(null as unknown as _Notifier)
    _unused.push(null as unknown as _NotifyCtx)
    _unused.push(null as unknown as _Recorded)
    _unused.push(null as unknown as _Tracking)
    expect(_unused).toHaveLength(12)
  })
})
