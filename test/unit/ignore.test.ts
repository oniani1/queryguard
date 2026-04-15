import { describe, it, expect, beforeEach } from 'vitest'
import { resetConfig } from '../../src/core/config.js'
import { recordQuery, ignore, trackingAls, createContext } from '../../src/core/tracker.js'
import { trackQueries, runAssertNoNPlusOne } from '../../src/integrations/shared.js'

beforeEach(() => {
  resetConfig()
})

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe('ignore', () => {
  it('suppresses queries inside ignore block', async () => {
    const { report } = await trackQueries(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await ignore(async () => {
        recordQuery('SELECT * FROM "Post"', 1)
        await tick()
        recordQuery('SELECT * FROM "Post"', 1)
      })
      return null
    })
    expect(report.totalQueries).toBe(1)
    expect(report.detections.length).toBe(0)
  })

  it('tracks queries before and after ignore block', async () => {
    const { report } = await trackQueries(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      await ignore(async () => {
        recordQuery('SELECT * FROM "Noise"', 1)
      })
      recordQuery('SELECT * FROM "User"', 1)
      return null
    })
    expect(report.totalQueries).toBe(2)
    expect(report.detections.length).toBe(1)
  })

  it('nested ignore blocks work', async () => {
    const { report } = await trackQueries(async () => {
      await ignore(async () => {
        recordQuery('SELECT * FROM "Outer"', 1)
        await ignore(async () => {
          recordQuery('SELECT * FROM "Inner"', 1)
        })
        recordQuery('SELECT * FROM "Outer2"', 1)
      })
      return null
    })
    expect(report.totalQueries).toBe(0)
  })

  it('is a no-op outside a tracking context', async () => {
    let called = false
    const result = await ignore(async () => {
      called = true
      return 42
    })
    expect(called).toBe(true)
    expect(result).toBe(42)
  })

  it('returns the value from the wrapped function', async () => {
    const { result } = await trackQueries(async () => {
      const value = await ignore(async () => {
        recordQuery('SELECT 1', 1)
        return 'ignored-result'
      })
      return value
    })
    expect(result).toBe('ignored-result')
  })

  it('works with assertNoNPlusOne', async () => {
    const result = await runAssertNoNPlusOne(async () => {
      await ignore(async () => {
        recordQuery('SELECT * FROM "Seed"', 1)
        await tick()
        recordQuery('SELECT * FROM "Seed"', 1)
        await tick()
        recordQuery('SELECT * FROM "Seed"', 1)
      })
      recordQuery('SELECT * FROM "User"', 1)
      return 'ok'
    })
    expect(result).toBe('ok')
  })

  it('suppresses async code inside ignore block', async () => {
    const { report } = await trackQueries(async () => {
      await ignore(async () => {
        recordQuery('SELECT 1', 1)
        await new Promise((resolve) => setTimeout(resolve, 10))
        recordQuery('SELECT 2', 1)
        await tick()
        recordQuery('SELECT 3', 1)
      })
      return null
    })
    expect(report.totalQueries).toBe(0)
  })

  it('works with synchronous functions', async () => {
    const { report } = await trackQueries(async () => {
      await ignore(() => {
        recordQuery('SELECT * FROM "Sync"', 1)
      })
      recordQuery('SELECT * FROM "Tracked"', 1)
      return null
    })
    expect(report.totalQueries).toBe(1)
  })
})
