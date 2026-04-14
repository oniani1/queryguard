import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import mysql2 from 'mysql2'
import {
  installMysql2Hook,
  uninstallMysql2Hook,
  isMysql2HookInstalled,
} from '../../src/drivers/mysql2.js'
import { createContext, runInContext } from '../../src/core/tracker.js'
import { resetConfig } from '../../src/core/config.js'

beforeEach(() => {
  resetConfig()
  uninstallMysql2Hook()
})

afterEach(() => {
  uninstallMysql2Hook()
})

describe('mysql2 Connection.prototype.query', () => {
  it('installMysql2Hook patches Connection.prototype.query', () => {
    const original = mysql2.Connection.prototype.query
    installMysql2Hook()
    expect(mysql2.Connection.prototype.query).not.toBe(original)
    expect(mysql2.Connection.prototype.query.name).toBe('patchedQuery')
  })

  it('isMysql2HookInstalled returns correct state', () => {
    expect(isMysql2HookInstalled()).toBe(false)
    installMysql2Hook()
    expect(isMysql2HookInstalled()).toBe(true)
    uninstallMysql2Hook()
    expect(isMysql2HookInstalled()).toBe(false)
  })

  it('double install is idempotent', () => {
    installMysql2Hook()
    const firstPatch = mysql2.Connection.prototype.query
    installMysql2Hook()
    expect(mysql2.Connection.prototype.query).toBe(firstPatch)
  })

  it('uninstall restores original query', () => {
    const original = mysql2.Connection.prototype.query
    installMysql2Hook()
    expect(mysql2.Connection.prototype.query).not.toBe(original)
    uninstallMysql2Hook()
    expect(mysql2.Connection.prototype.query).toBe(original)
  })

  it('records SQL from string arg via event mode', async () => {
    const realOriginal = mysql2.Connection.prototype.query
    mysql2.Connection.prototype.query = function mockQuery() {
      const cmd = new EventEmitter()
      setTimeout(() => cmd.emit('end'), 5)
      return cmd
    } as unknown as typeof mysql2.Connection.prototype.query
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      const result = mysql2.Connection.prototype.query.call({}, 'SELECT * FROM users')
      await new Promise<void>((resolve) => {
        ;(result as EventEmitter).on('end', () => resolve())
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM users')
      expect(ctx.queries[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.query = realOriginal
  })

  it('records SQL from { sql } object arg', async () => {
    const realOriginal = mysql2.Connection.prototype.query
    mysql2.Connection.prototype.query = function mockQuery() {
      const cmd = new EventEmitter()
      setTimeout(() => cmd.emit('end'), 5)
      return cmd
    } as unknown as typeof mysql2.Connection.prototype.query
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      const result = mysql2.Connection.prototype.query.call(
        {},
        { sql: 'SELECT * FROM posts' },
      )
      await new Promise<void>((resolve) => {
        ;(result as EventEmitter).on('end', () => resolve())
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM posts')
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.query = realOriginal
  })

  it('handles callback-style invocation', async () => {
    const realOriginal = mysql2.Connection.prototype.query
    mysql2.Connection.prototype.query = function mockQuery(...args: unknown[]) {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        setTimeout(
          () => (cb as (err: null, rows: unknown[], fields: unknown[]) => void)(null, [{ id: 1 }], []),
          5,
        )
        return undefined
      }
      const cmd = new EventEmitter()
      setTimeout(() => cmd.emit('end'), 5)
      return cmd
    } as unknown as typeof mysql2.Connection.prototype.query
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await new Promise<void>((resolve) => {
        mysql2.Connection.prototype.query.call(
          {},
          'SELECT * FROM users',
          (err: unknown, rows: unknown) => {
            resolve()
          },
        )
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM users')
      expect(ctx.queries[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.query = realOriginal
  })

  it('returns original Command result unchanged', async () => {
    const realOriginal = mysql2.Connection.prototype.query
    const expectedCmd = new EventEmitter()
    mysql2.Connection.prototype.query = function mockQuery() {
      setTimeout(() => expectedCmd.emit('end'), 5)
      return expectedCmd
    } as unknown as typeof mysql2.Connection.prototype.query
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      const result = mysql2.Connection.prototype.query.call({}, 'SELECT 1')
      expect(result).toBe(expectedCmd)
      await new Promise<void>((resolve) => {
        ;(result as EventEmitter).on('end', () => resolve())
      })
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.query = realOriginal
  })

  it('records on synchronous throw and re-throws', () => {
    const realOriginal = mysql2.Connection.prototype.query
    const testError = new Error('connection lost')
    mysql2.Connection.prototype.query = function mockQuery() {
      throw testError
    } as unknown as typeof mysql2.Connection.prototype.query
    installMysql2Hook()

    const ctx = createContext()
    runInContext(ctx, () => {
      expect(() => {
        mysql2.Connection.prototype.query.call({}, 'SELECT 1')
      }).toThrow('connection lost')

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT 1')
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.query = realOriginal
  })

  it('records via end event when command emits error then end (event mode)', async () => {
    const realOriginal = mysql2.Connection.prototype.query
    mysql2.Connection.prototype.query = function mockQuery() {
      const cmd = new EventEmitter()
      setTimeout(() => {
        cmd.emit('error', new Error('query failed'))
        cmd.emit('end')
      }, 5)
      return cmd
    } as unknown as typeof mysql2.Connection.prototype.query
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      const cmd = mysql2.Connection.prototype.query.call({}, 'SELECT 1') as EventEmitter
      // Attach error listener to prevent unhandled error throw
      cmd.on('error', () => {})
      await new Promise<void>((resolve) => {
        cmd.once('end', resolve)
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT 1')
      expect(ctx.queries[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.query = realOriginal
  })
})

describe('mysql2 Connection.prototype.execute', () => {
  it('install patches execute', () => {
    const original = mysql2.Connection.prototype.execute
    installMysql2Hook()
    expect(mysql2.Connection.prototype.execute).not.toBe(original)
    expect(mysql2.Connection.prototype.execute.name).toBe('patchedExecute')
  })

  it('records SQL from execute with callback', async () => {
    const realOriginal = mysql2.Connection.prototype.execute
    mysql2.Connection.prototype.execute = function mockExecute(...args: unknown[]) {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        setTimeout(
          () => (cb as (err: null, rows: unknown[], fields: unknown[]) => void)(null, [{ id: 1 }], []),
          5,
        )
        return undefined
      }
      const cmd = new EventEmitter()
      setTimeout(() => cmd.emit('end'), 5)
      return cmd
    } as unknown as typeof mysql2.Connection.prototype.execute
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await new Promise<void>((resolve) => {
        mysql2.Connection.prototype.execute.call(
          {},
          'SELECT * FROM users WHERE id = ?',
          [1],
          (err: unknown, rows: unknown) => {
            resolve()
          },
        )
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM users WHERE id = ?')
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.execute = realOriginal
  })

  it('records SQL from execute with event mode', async () => {
    const realOriginal = mysql2.Connection.prototype.execute
    mysql2.Connection.prototype.execute = function mockExecute() {
      const cmd = new EventEmitter()
      setTimeout(() => cmd.emit('end'), 5)
      return cmd
    } as unknown as typeof mysql2.Connection.prototype.execute
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      const result = mysql2.Connection.prototype.execute.call(
        {},
        'SELECT * FROM orders',
      )
      await new Promise<void>((resolve) => {
        ;(result as EventEmitter).on('end', () => resolve())
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM orders')
    })

    uninstallMysql2Hook()
    mysql2.Connection.prototype.execute = realOriginal
  })

  it('uninstall restores original execute', () => {
    const original = mysql2.Connection.prototype.execute
    installMysql2Hook()
    expect(mysql2.Connection.prototype.execute).not.toBe(original)
    uninstallMysql2Hook()
    expect(mysql2.Connection.prototype.execute).toBe(original)
  })
})

describe('mysql2 Pool', () => {
  it('install patches Pool.prototype.query and Pool.prototype.execute', () => {
    const originalQuery = mysql2.Pool.prototype.query
    const originalExecute = mysql2.Pool.prototype.execute
    installMysql2Hook()
    expect(mysql2.Pool.prototype.query).not.toBe(originalQuery)
    expect(mysql2.Pool.prototype.query.name).toBe('patchedQuery')
    expect(mysql2.Pool.prototype.execute).not.toBe(originalExecute)
    expect(mysql2.Pool.prototype.execute.name).toBe('patchedExecute')
  })

  it('Pool.prototype.query records via callback', async () => {
    const realOriginal = mysql2.Pool.prototype.query
    mysql2.Pool.prototype.query = function mockPoolQuery(...args: unknown[]) {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        setTimeout(
          () => (cb as (err: null, rows: unknown[], fields: unknown[]) => void)(null, [{ id: 1 }], []),
          5,
        )
        return undefined
      }
      const cmd = new EventEmitter()
      setTimeout(() => cmd.emit('end'), 5)
      return cmd
    } as unknown as typeof mysql2.Pool.prototype.query
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await new Promise<void>((resolve) => {
        mysql2.Pool.prototype.query.call(
          {},
          'SELECT * FROM items',
          (err: unknown, rows: unknown) => {
            resolve()
          },
        )
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM items')
      expect(ctx.queries[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    uninstallMysql2Hook()
    mysql2.Pool.prototype.query = realOriginal
  })

  it('Pool.prototype.execute records via callback (returns void)', async () => {
    const realOriginal = mysql2.Pool.prototype.execute
    mysql2.Pool.prototype.execute = function mockPoolExecute(...args: unknown[]) {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        setTimeout(
          () => (cb as (err: null, rows: unknown[], fields: unknown[]) => void)(null, [{ id: 2 }], []),
          5,
        )
      }
      return undefined
    } as unknown as typeof mysql2.Pool.prototype.execute
    installMysql2Hook()

    const ctx = createContext()
    await runInContext(ctx, async () => {
      await new Promise<void>((resolve) => {
        mysql2.Pool.prototype.execute.call(
          {},
          'SELECT * FROM products WHERE id = ?',
          [2],
          (err: unknown, rows: unknown) => {
            resolve()
          },
        )
      })

      expect(ctx.queries).toHaveLength(1)
      expect(ctx.queries[0].sql).toBe('SELECT * FROM products WHERE id = ?')
    })

    uninstallMysql2Hook()
    mysql2.Pool.prototype.execute = realOriginal
  })

  it('uninstall restores Pool prototypes', () => {
    const originalQuery = mysql2.Pool.prototype.query
    const originalExecute = mysql2.Pool.prototype.execute
    installMysql2Hook()
    expect(mysql2.Pool.prototype.query).not.toBe(originalQuery)
    expect(mysql2.Pool.prototype.execute).not.toBe(originalExecute)
    uninstallMysql2Hook()
    expect(mysql2.Pool.prototype.query).toBe(originalQuery)
    expect(mysql2.Pool.prototype.execute).toBe(originalExecute)
  })
})
