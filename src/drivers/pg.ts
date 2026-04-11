import { recordQuery } from '../core/tracker.js'

const HOOK_INSTALLED = Symbol.for('queryguard.pg.hooked')
const POOL_HOOK_INSTALLED = Symbol.for('queryguard.pg.pool.hooked')

type PgPrototype = {
  query: (...args: unknown[]) => unknown
  [key: symbol]: unknown
}

type PgModule = {
  Client: { prototype: PgPrototype }
  Pool?: { prototype: PgPrototype }
}

let originalQuery: ((...args: unknown[]) => unknown) | undefined
let clientPrototype: PgPrototype | undefined
let originalPoolQuery: ((...args: unknown[]) => unknown) | undefined
let poolPrototype: PgPrototype | undefined

export function installPgHook(pgModule?: PgModule): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = pgModule ?? (require('pg') as PgModule)
  const proto = pg.Client.prototype

  if (proto[HOOK_INSTALLED]) return

  originalQuery = proto.query
  clientPrototype = proto

  if (!originalQuery) return
  const orig = originalQuery

  proto.query = function patchedQuery(this: unknown, ...args: unknown[]): unknown {
    let sql = '<unknown>'
    const first = args[0]
    if (typeof first === 'string') {
      sql = first
    } else if (first !== null && typeof first === 'object' && 'text' in first) {
      sql = String((first as { text: unknown }).text)
    }

    const startTime = performance.now()

    // Check for callback pattern: client.query(text, cb) or client.query(text, values, cb)
    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      const cb = lastArg as (...cbArgs: unknown[]) => void
      const wrappedArgs = [...args]
      wrappedArgs[wrappedArgs.length - 1] = (...cbArgs: unknown[]) => {
        const duration = performance.now() - startTime
        recordQuery(sql, duration)
        cb(...cbArgs)
      }
      return orig.apply(this, wrappedArgs)
    }

    let result: unknown
    try {
      result = orig.apply(this, args)
    } catch (err) {
      const duration = performance.now() - startTime
      recordQuery(sql, duration)
      throw err
    }

    if (
      result !== null &&
      typeof result === 'object' &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      return (result as Promise<unknown>).then(
        (value) => {
          const duration = performance.now() - startTime
          recordQuery(sql, duration)
          return value
        },
        (err) => {
          const duration = performance.now() - startTime
          recordQuery(sql, duration)
          throw err
        },
      )
    }

    const duration = performance.now() - startTime
    recordQuery(sql, duration)
    return result
  }

  proto[HOOK_INSTALLED] = true

  // Also patch Pool.prototype.query — pg-pool's connect callback can lose ALS context
  // because it runs from an internal event queue. Patching Pool directly ensures capture.
  if (pg.Pool && !pg.Pool.prototype[POOL_HOOK_INSTALLED]) {
    const poolProto = pg.Pool.prototype
    originalPoolQuery = poolProto.query
    poolPrototype = poolProto

    if (originalPoolQuery) {
      const origPool = originalPoolQuery

      poolProto.query = function patchedPoolQuery(this: unknown, ...args: unknown[]): unknown {
        let sql = '<unknown>'
        const first = args[0]
        if (typeof first === 'string') {
          sql = first
        } else if (first !== null && typeof first === 'object' && 'text' in first) {
          sql = String((first as { text: unknown }).text)
        }

        const startTime = performance.now()
        let result: unknown
        try {
          result = origPool.apply(this, args)
        } catch (err) {
          const duration = performance.now() - startTime
          recordQuery(sql, duration)
          throw err
        }

        if (
          result !== null &&
          typeof result === 'object' &&
          typeof (result as { then?: unknown }).then === 'function'
        ) {
          return (result as Promise<unknown>).then(
            (value) => {
              const duration = performance.now() - startTime
              recordQuery(sql, duration)
              return value
            },
            (err) => {
              const duration = performance.now() - startTime
              recordQuery(sql, duration)
              throw err
            },
          )
        }

        const duration = performance.now() - startTime
        recordQuery(sql, duration)
        return result
      }

      poolProto[POOL_HOOK_INSTALLED] = true
    }
  }
}

export function uninstallPgHook(): void {
  if (clientPrototype && originalQuery && clientPrototype[HOOK_INSTALLED]) {
    clientPrototype.query = originalQuery
    delete clientPrototype[HOOK_INSTALLED]
    originalQuery = undefined
    clientPrototype = undefined
  }

  if (poolPrototype && originalPoolQuery && poolPrototype[POOL_HOOK_INSTALLED]) {
    poolPrototype.query = originalPoolQuery
    delete poolPrototype[POOL_HOOK_INSTALLED]
    originalPoolQuery = undefined
    poolPrototype = undefined
  }
}

export function isPgHookInstalled(): boolean {
  if (!clientPrototype) return false
  return clientPrototype[HOOK_INSTALLED] === true
}
