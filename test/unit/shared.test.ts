import { describe, it, expect, beforeEach } from 'vitest'
import { resetConfig, configure, getConfig } from '../../src/core/config.js'
import { recordQuery } from '../../src/core/tracker.js'
import { trackQueries, runAssertNoNPlusOne, runQueryBudget, QueryGuardError } from '../../src/integrations/shared.js'

beforeEach(() => {
  resetConfig()
})

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe('trackQueries', () => {
  it('returns result and report', async () => {
    const { result, report } = await trackQueries(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      return 42
    })
    expect(result).toBe(42)
    expect(report.totalQueries).toBe(2)
    expect(report.detections.length).toBe(1)
  })

  it('returns empty detections when no duplicates', async () => {
    const { result, report } = await trackQueries(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(report.totalQueries).toBe(1)
    expect(report.detections.length).toBe(0)
  })
})

describe('runAssertNoNPlusOne', () => {
  it('throws on N+1', async () => {
    await expect(runAssertNoNPlusOne(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
    })).rejects.toThrow(QueryGuardError)
  })

  it('passes when clean', async () => {
    const result = await runAssertNoNPlusOne(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      return 'ok'
    })
    expect(result).toBe('ok')
  })

  it('thrown error has report property', async () => {
    try {
      await runAssertNoNPlusOne(async () => {
        recordQuery('SELECT * FROM "User"', 1)
        await tick()
        recordQuery('SELECT * FROM "User"', 1)
      })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(QueryGuardError)
      const qgErr = err as QueryGuardError
      expect(qgErr.report.detections.length).toBe(1)
    }
  })

  it('respects threshold option', async () => {
    const result = await runAssertNoNPlusOne(async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      return 'ok'
    }, { threshold: 3 })
    expect(result).toBe('ok')
  })

  it('restores config after runAssertNoNPlusOne with options', async () => {
    configure({ threshold: 5 })
    const configBefore = { ...getConfig() }

    await runAssertNoNPlusOne(async () => {
      return 'ok'
    }, { threshold: 10 })

    const configAfter = getConfig()
    expect(configAfter.threshold).toBe(configBefore.threshold)
  })

  it('restores config even when runAssertNoNPlusOne throws', async () => {
    configure({ threshold: 5 })
    const configBefore = { ...getConfig() }

    try {
      await runAssertNoNPlusOne(async () => {
        recordQuery('SELECT * FROM "User"', 1)
        await tick()
        recordQuery('SELECT * FROM "User"', 1)
      }, { threshold: 1 })
    } catch {
      // expected
    }

    const configAfter = getConfig()
    expect(configAfter.threshold).toBe(configBefore.threshold)
  })

  it('propagates user callback errors', async () => {
    const userError = new Error('user error')
    await expect(
      runAssertNoNPlusOne(async () => {
        throw userError
      }),
    ).rejects.toThrow('user error')
  })
})

describe('runQueryBudget', () => {
  it('throws when over budget', async () => {
    await expect(runQueryBudget(1, async () => {
      recordQuery('SELECT * FROM "User"', 1)
      recordQuery('SELECT * FROM "Post"', 1)
    })).rejects.toThrow(QueryGuardError)
  })

  it('passes when under budget', async () => {
    const result = await runQueryBudget(5, async () => {
      recordQuery('SELECT * FROM "User"', 1)
      return 'done'
    })
    expect(result).toBe('done')
  })

  it('passes when exactly at budget', async () => {
    const result = await runQueryBudget(2, async () => {
      recordQuery('SELECT * FROM "User"', 1)
      recordQuery('SELECT * FROM "Post"', 1)
      return 'ok'
    })
    expect(result).toBe('ok')
  })
})
