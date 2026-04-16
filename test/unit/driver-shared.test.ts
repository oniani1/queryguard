import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConfig } from '../../src/core/config.js'
import { createContext, runInContext } from '../../src/core/tracker.js'
import {
  createPatchedMethod,
  eventEndCompletion,
  promiseCompletion,
} from '../../src/drivers/shared.js'

beforeEach(() => {
  resetConfig()
})

describe('createPatchedMethod', () => {
  it('records on synchronous return', async () => {
    const original = vi.fn((_sql: string) => 'result')
    const patched = createPatchedMethod({
      extractSql: (args) => args[0] as string,
      original: original as (...args: unknown[]) => unknown,
      completeQuery: (result, done) => {
        done()
        return result
      },
    })

    const ctx = createContext()
    const result = await runInContext(ctx, () => patched('SELECT 1'))

    expect(result).toBe('result')
    expect(ctx.queries).toHaveLength(1)
    expect(ctx.queries[0].sql).toBe('SELECT 1')
  })

  it('wraps callback-style APIs and records before user callback fires', async () => {
    const original = (_sql: string, cb: (err: Error | null, rows: number) => void) =>
      setImmediate(() => cb(null, 42))
    const patched = createPatchedMethod({
      extractSql: (args) => args[0] as string,
      original: original as (...args: unknown[]) => unknown,
      completeQuery: (result, done) => {
        done()
        return result
      },
    })

    const ctx = createContext()
    await runInContext(ctx, () => {
      return new Promise<void>((resolve) => {
        patched('SELECT 1', (err: Error | null, rows: number) => {
          expect(err).toBeNull()
          expect(rows).toBe(42)
          expect(ctx.queries).toHaveLength(1)
          resolve()
        })
      })
    })
  })

  it('handles the three-arg callback form (sql, values, cb)', async () => {
    const original = (_sql: string, values: unknown[], cb: (err: null, rows: unknown) => void) =>
      setImmediate(() => cb(null, { values }))
    const patched = createPatchedMethod({
      extractSql: (args) => args[0] as string,
      original: original as (...args: unknown[]) => unknown,
      completeQuery: (result, done) => {
        done()
        return result
      },
    })

    const ctx = createContext()
    await runInContext(ctx, () => {
      return new Promise<void>((resolve, reject) => {
        patched('SELECT * WHERE id = $1', [42], (err: unknown, rows: unknown) => {
          try {
            expect(err).toBeNull()
            expect((rows as { values: unknown[] }).values).toEqual([42])
            expect(ctx.queries).toHaveLength(1)
            resolve()
          } catch (e) {
            reject(e as Error)
          }
        })
      })
    })
  })

  it('records and rethrows on synchronous error', async () => {
    const original = () => {
      throw new Error('boom')
    }
    const patched = createPatchedMethod({
      extractSql: () => 'SELECT 1',
      original,
      completeQuery: (result, done) => {
        done()
        return result
      },
    })

    const ctx = createContext()
    await runInContext(ctx, () => {
      expect(() => patched()).toThrow('boom')
      expect(ctx.queries).toHaveLength(1)
    })
  })

  it('done() is idempotent when completeQuery and callback both call it', async () => {
    const original = vi.fn((_sql: string) => 'result')
    const patched = createPatchedMethod({
      extractSql: (args) => args[0] as string,
      original: original as (...args: unknown[]) => unknown,
      completeQuery: (result, done) => {
        done()
        done()
        done()
        return result
      },
    })

    const ctx = createContext()
    await runInContext(ctx, () => patched('SELECT 1'))
    expect(ctx.queries).toHaveLength(1)
  })

  it('respects the name option', () => {
    const patched = createPatchedMethod({
      extractSql: () => 'SELECT 1',
      original: () => undefined,
      completeQuery: (r, d) => {
        d()
        return r
      },
      name: 'patchedCustom',
    })
    expect(patched.name).toBe('patchedCustom')
  })
})

describe('promiseCompletion', () => {
  it('records on promise resolution', async () => {
    const ctx = createContext()
    await runInContext(ctx, async () => {
      const patched = createPatchedMethod({
        extractSql: (args) => args[0] as string,
        original: () => Promise.resolve({ rows: [] }),
        completeQuery: promiseCompletion,
      })
      const result = await (patched('SELECT 1') as Promise<unknown>)
      expect(result).toEqual({ rows: [] })
    })
    expect(ctx.queries).toHaveLength(1)
  })

  it('records on promise rejection', async () => {
    const ctx = createContext()
    await runInContext(ctx, async () => {
      const patched = createPatchedMethod({
        extractSql: (args) => args[0] as string,
        original: () => Promise.reject(new Error('nope')),
        completeQuery: promiseCompletion,
      })
      await expect(patched('SELECT 1') as Promise<unknown>).rejects.toThrow('nope')
    })
    expect(ctx.queries).toHaveLength(1)
  })

  it('records synchronously when result is not a thenable', async () => {
    const ctx = createContext()
    await runInContext(ctx, () => {
      const patched = createPatchedMethod({
        extractSql: (args) => args[0] as string,
        original: () => ({ rows: [] }),
        completeQuery: promiseCompletion,
      })
      const result = patched('SELECT 1')
      expect(result).toEqual({ rows: [] })
    })
    expect(ctx.queries).toHaveLength(1)
  })
})

describe('eventEndCompletion', () => {
  it('records on end event', async () => {
    const ctx = createContext()
    const emitter = new EventEmitter()
    await runInContext(ctx, () => {
      const patched = createPatchedMethod({
        extractSql: (args) => args[0] as string,
        original: () => emitter,
        completeQuery: eventEndCompletion,
      })
      const result = patched('SELECT 1')
      expect(result).toBe(emitter)
      expect(ctx.queries).toHaveLength(0)
      emitter.emit('end')
      expect(ctx.queries).toHaveLength(1)
    })
  })

  it('records on error event when end is never emitted', async () => {
    const ctx = createContext()
    const emitter = new EventEmitter()
    // Node's EventEmitter throws on unhandled 'error' events; register a listener.
    emitter.on('error', () => {})
    await runInContext(ctx, () => {
      const patched = createPatchedMethod({
        extractSql: (args) => args[0] as string,
        original: () => emitter,
        completeQuery: eventEndCompletion,
      })
      patched('SELECT 1')
      expect(ctx.queries).toHaveLength(0)
      emitter.emit('error', new Error('connection lost'))
      expect(ctx.queries).toHaveLength(1)
    })
  })

  it('records exactly once when both error and end fire', async () => {
    const ctx = createContext()
    const emitter = new EventEmitter()
    emitter.on('error', () => {})
    await runInContext(ctx, () => {
      const patched = createPatchedMethod({
        extractSql: (args) => args[0] as string,
        original: () => emitter,
        completeQuery: eventEndCompletion,
      })
      patched('SELECT 1')
      emitter.emit('error', new Error('partial'))
      emitter.emit('end')
      expect(ctx.queries).toHaveLength(1)
    })
  })

  it('records synchronously when result is not an event emitter', async () => {
    const ctx = createContext()
    await runInContext(ctx, () => {
      const patched = createPatchedMethod({
        extractSql: (args) => args[0] as string,
        original: () => 42,
        completeQuery: eventEndCompletion,
      })
      const result = patched('SELECT 1')
      expect(result).toBe(42)
    })
    expect(ctx.queries).toHaveLength(1)
  })
})
