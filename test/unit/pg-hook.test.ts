import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import pg from 'pg'
import { installPgHook, uninstallPgHook, isPgHookInstalled } from '../../src/drivers/pg.js'
import { createContext, runInContext } from '../../src/core/tracker.js'
import { resetConfig } from '../../src/core/config.js'

beforeEach(() => {
  resetConfig()
  uninstallPgHook()
})

afterEach(() => {
  uninstallPgHook()
})

describe('pg hook', () => {
  it('installPgHook patches Client.prototype.query', () => {
    const original = pg.Client.prototype.query
    installPgHook()
    expect(pg.Client.prototype.query).not.toBe(original)
    expect(pg.Client.prototype.query.name).toBe('patchedQuery')
  })

  it('isPgHookInstalled returns correct state', () => {
    expect(isPgHookInstalled()).toBe(false)
    installPgHook()
    expect(isPgHookInstalled()).toBe(true)
    uninstallPgHook()
    expect(isPgHookInstalled()).toBe(false)
  })

  it('patched query calls recordQuery with SQL string', async () => {
    installPgHook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      const client = new pg.Client()
      // Override the internal connection to avoid real Postgres
      const origQuery = Object.getPrototypeOf(Object.getPrototypeOf(client)).query
      // We patch prototype.query, so we need to make the original return a promise
      // Temporarily replace the patched function's internal call
      // Simpler: just call the prototype method directly with a fake `this`
      const fakeClient = {
        // The patched query calls original.apply(this, args)
        // We need the original to resolve. Let's just test via prototype.
      }

      // Actually, the simplest approach: replace the original query temporarily
      // Since we already patched, let's call the patched method with a mock this
      // whose underlying original would return a promise.
      // The hook saved the original before patching, so we need a different approach.

      // Best approach: save a reference to the patched function, uninstall,
      // replace original with a mock, reinstall, then call.
      uninstallPgHook()
      const realOriginal = pg.Client.prototype.query
      pg.Client.prototype.query = function mockQuery() {
        return Promise.resolve({ rows: [], rowCount: 0 })
      } as typeof pg.Client.prototype.query
      installPgHook()

      await pg.Client.prototype.query.call({}, 'SELECT * FROM users')

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM users')
      expect(ctx.queries[0].durationMs).toBeGreaterThanOrEqual(0)

      uninstallPgHook()
      pg.Client.prototype.query = realOriginal
    })
  })

  it('patched query calls recordQuery with config object { text }', async () => {
    const realOriginal = pg.Client.prototype.query
    pg.Client.prototype.query = function mockQuery() {
      return Promise.resolve({ rows: [], rowCount: 0 })
    } as typeof pg.Client.prototype.query
    installPgHook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await pg.Client.prototype.query.call({}, { text: 'SELECT * FROM posts' })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM posts')
    })

    uninstallPgHook()
    pg.Client.prototype.query = realOriginal
  })

  it('patched query returns original result unchanged', async () => {
    const realOriginal = pg.Client.prototype.query
    const expected = { rows: [{ id: 1 }], rowCount: 1 }
    pg.Client.prototype.query = function mockQuery() {
      return Promise.resolve(expected)
    } as typeof pg.Client.prototype.query
    installPgHook()

    const ctx = createContext()
    const result = await runInContext(ctx, async () => {
      return pg.Client.prototype.query.call({}, 'SELECT 1')
    })

    expect(result).toBe(expected)

    uninstallPgHook()
    pg.Client.prototype.query = realOriginal
  })

  it('double install does not double-patch (idempotent)', () => {
    installPgHook()
    const firstPatch = pg.Client.prototype.query
    installPgHook()
    expect(pg.Client.prototype.query).toBe(firstPatch)
  })

  it('uninstallPgHook restores original query', () => {
    const original = pg.Client.prototype.query
    installPgHook()
    expect(pg.Client.prototype.query).not.toBe(original)
    uninstallPgHook()
    expect(pg.Client.prototype.query).toBe(original)
  })

  it('patched query handles callback-style invocation', async () => {
    const realOriginal = pg.Client.prototype.query
    // Mock that forwards to the callback (simulating pg's callback path)
    pg.Client.prototype.query = function mockQuery(...args: unknown[]) {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        setTimeout(() => (cb as (err: null, res: unknown) => void)(null, { rows: [], rowCount: 0 }), 5)
        return {} // Query object, not a Promise
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    } as typeof pg.Client.prototype.query
    installPgHook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await new Promise<void>((resolve) => {
        pg.Client.prototype.query.call({}, 'SELECT * FROM users', (err: unknown, res: unknown) => {
          resolve()
        })
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM users')
      expect(ctx.queries[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    uninstallPgHook()
    pg.Client.prototype.query = realOriginal
  })

  it('patched query handles callback-style with values array', async () => {
    const realOriginal = pg.Client.prototype.query
    pg.Client.prototype.query = function mockQuery(...args: unknown[]) {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        setTimeout(() => (cb as (err: null, res: unknown) => void)(null, { rows: [{ id: 1 }], rowCount: 1 }), 5)
        return {}
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    } as typeof pg.Client.prototype.query
    installPgHook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await new Promise<void>((resolve) => {
        pg.Client.prototype.query.call({}, 'SELECT * FROM users WHERE id = $1', [1], (err: unknown, res: unknown) => {
          resolve()
        })
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM users WHERE id = $1')
    })

    uninstallPgHook()
    pg.Client.prototype.query = realOriginal
  })

  it('patched query handles synchronous (non-promise) return', async () => {
    const realOriginal = pg.Client.prototype.query
    const syncResult = { rows: [{ id: 1 }], rowCount: 1 }
    pg.Client.prototype.query = function mockQuery() {
      return syncResult // not a Promise, not thenable
    } as typeof pg.Client.prototype.query
    installPgHook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      const result = pg.Client.prototype.query.call({}, 'SELECT 1')

      expect(result).toBe(syncResult)
      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT 1')
      expect(ctx.queries[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    uninstallPgHook()
    pg.Client.prototype.query = realOriginal
  })

  it('patched query records on error and re-throws', async () => {
    const realOriginal = pg.Client.prototype.query
    const testError = new Error('connection refused')
    pg.Client.prototype.query = function mockQuery() {
      return Promise.reject(testError)
    } as typeof pg.Client.prototype.query
    installPgHook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await expect(
        pg.Client.prototype.query.call({}, 'SELECT 1'),
      ).rejects.toThrow('connection refused')

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT 1')
    })

    uninstallPgHook()
    pg.Client.prototype.query = realOriginal
  })
})
