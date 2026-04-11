import { describe, it, expect, beforeEach } from 'vitest'
import { resetConfig, configure } from '../../src/core/config.js'
import {
  createContext,
  recordQuery,
  getContext,
  runInContext,
} from '../../src/core/tracker.js'

beforeEach(() => {
  resetConfig()
})

describe('tracker', () => {
  it('createContext returns empty context with defaults', () => {
    const ctx = createContext()
    expect(ctx.queries).toEqual([])
    expect(ctx.fingerprintCounts.size).toBe(0)
    expect(ctx.fingerprintFirstIndex.size).toBe(0)
    expect(ctx.transactionState.depth).toBe(0)
    expect(ctx.currentTick).toBe(0)
  })

  it('recordQuery adds to queries array and increments fingerprint count', async () => {
    const ctx = createContext()
    await runInContext(ctx, async () => {
      recordQuery('SELECT * FROM "User"', 1)
    })
    expect(ctx.queries).toHaveLength(1)
    expect(ctx.queries[0].sql).toBe('SELECT * FROM "User"')
    expect(ctx.fingerprintCounts.get(ctx.queries[0].fingerprintHash)).toBe(1)
  })

  it('recordQuery is a no-op when no ALS context is active', () => {
    recordQuery('SELECT 1', 1)
    // no error thrown, nothing to assert beyond survival
  })

  it('recordQuery is a no-op when config.enabled is false', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    delete process.env.QUERYGUARD_FORCE
    resetConfig()
    const ctx = createContext()
    await runInContext(ctx, async () => {
      recordQuery('SELECT 1', 1)
    })
    expect(ctx.queries).toHaveLength(0)
    process.env.NODE_ENV = prev
    resetConfig()
  })

  it('recordQuery skips queries matching ignore patterns', async () => {
    configure({ ignore: ['pg_catalog'] })
    const ctx = createContext()
    await runInContext(ctx, async () => {
      recordQuery('SELECT * FROM pg_catalog.pg_tables', 1)
    })
    expect(ctx.queries).toHaveLength(0)
  })

  it('second occurrence of same fingerprint triggers full stack capture on both queries', async () => {
    const ctx = createContext()
    await runInContext(ctx, async () => {
      recordQuery('SELECT * FROM "User" WHERE id = 1', 1)
      recordQuery('SELECT * FROM "User" WHERE id = 2', 1)
    })
    expect(ctx.queries).toHaveLength(2)
    expect(ctx.queries[0].fullStack).toBeDefined()
    expect(ctx.queries[1].fullStack).toBeDefined()
  })

  it('third+ occurrence of same fingerprint also captures full stack', async () => {
    const ctx = createContext()
    await runInContext(ctx, async () => {
      recordQuery('SELECT * FROM "User" WHERE id = 1', 1)
      recordQuery('SELECT * FROM "User" WHERE id = 2', 1)
      recordQuery('SELECT * FROM "User" WHERE id = 3', 1)
    })
    expect(ctx.queries).toHaveLength(3)
    expect(ctx.queries[0].fullStack).toBeDefined()
    expect(ctx.queries[1].fullStack).toBeDefined()
    expect(ctx.queries[2].fullStack).toBeDefined()
  })

  it('queries in same sync batch share tick', async () => {
    const ctx = createContext()
    await runInContext(ctx, async () => {
      recordQuery('SELECT * FROM "User"', 1)
      recordQuery('SELECT * FROM "Post"', 1)
    })
    expect(ctx.queries[0].tick).toBe(ctx.queries[1].tick)
  })

  it('queries after await get different ticks', async () => {
    const ctx = createContext()
    await runInContext(ctx, async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await new Promise(resolve => setTimeout(resolve, 10))
      recordQuery('SELECT * FROM "Post"', 1)
    })
    expect(ctx.queries[0].tick).not.toBe(ctx.queries[1].tick)
  })

  it('runInContext propagates context — getContext() returns the context inside the callback', () => {
    const ctx = createContext()
    runInContext(ctx, () => {
      expect(getContext()).toBe(ctx)
    })
  })
})
