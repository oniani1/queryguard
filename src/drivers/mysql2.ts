import { recordQuery } from '../core/tracker.js'

const CONN_QUERY_HOOKED = Symbol.for('queryguard.mysql2.conn.query.hooked')
const CONN_EXECUTE_HOOKED = Symbol.for('queryguard.mysql2.conn.execute.hooked')
const POOL_QUERY_HOOKED = Symbol.for('queryguard.mysql2.pool.query.hooked')
const POOL_EXECUTE_HOOKED = Symbol.for('queryguard.mysql2.pool.execute.hooked')

type Mysql2Prototype = {
  query: (...args: unknown[]) => unknown
  execute: (...args: unknown[]) => unknown
  [key: symbol]: unknown
}

type Mysql2Module = {
  Connection: { prototype: Mysql2Prototype }
  Pool?: { prototype: Mysql2Prototype }
}

let originalConnQuery: ((...args: unknown[]) => unknown) | undefined
let originalConnExecute: ((...args: unknown[]) => unknown) | undefined
let connPrototype: Mysql2Prototype | undefined

let originalPoolQuery: ((...args: unknown[]) => unknown) | undefined
let originalPoolExecute: ((...args: unknown[]) => unknown) | undefined
let poolPrototype: Mysql2Prototype | undefined

function extractSql(args: unknown[]): string {
  const first = args[0]
  if (typeof first === 'string') return first
  if (first !== null && typeof first === 'object' && 'sql' in first) {
    return String((first as { sql: unknown }).sql)
  }
  return '<unknown>'
}

function createPatchedMethod(
  methodName: string,
  original: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  const patched = function (this: unknown, ...args: unknown[]): unknown {
    const sql = extractSql(args)
    const startTime = performance.now()

    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      const cb = lastArg as (...cbArgs: unknown[]) => void
      const wrappedArgs = [...args]
      wrappedArgs[wrappedArgs.length - 1] = (...cbArgs: unknown[]) => {
        recordQuery(sql, performance.now() - startTime)
        cb(...cbArgs)
      }
      return original.apply(this, wrappedArgs)
    }

    let result: unknown
    try {
      result = original.apply(this, args)
    } catch (err) {
      recordQuery(sql, performance.now() - startTime)
      throw err
    }

    if (
      result !== null &&
      typeof result === 'object' &&
      typeof (result as { once?: unknown }).once === 'function'
    ) {
      ;(result as { once: (event: string, listener: () => void) => void }).once('end', () => {
        recordQuery(sql, performance.now() - startTime)
      })
    } else {
      recordQuery(sql, performance.now() - startTime)
    }

    return result
  }

  Object.defineProperty(patched, 'name', {
    value: `patched${methodName.charAt(0).toUpperCase()}${methodName.slice(1)}`,
  })
  return patched
}

export function installMysql2Hook(mysql2Module?: Mysql2Module): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysql2 = mysql2Module ?? (require('mysql2') as Mysql2Module)
  const connProto = mysql2.Connection.prototype

  if (!connProto[CONN_QUERY_HOOKED] && connProto.query) {
    originalConnQuery = connProto.query
    connPrototype = connProto
    connProto.query = createPatchedMethod('query', originalConnQuery) as typeof connProto.query
    connProto[CONN_QUERY_HOOKED] = true
  }

  if (!connProto[CONN_EXECUTE_HOOKED] && connProto.execute) {
    originalConnExecute = connProto.execute
    if (!connPrototype) connPrototype = connProto
    connProto.execute = createPatchedMethod(
      'execute',
      originalConnExecute,
    ) as typeof connProto.execute
    connProto[CONN_EXECUTE_HOOKED] = true
  }

  if (mysql2.Pool) {
    const poolProto = mysql2.Pool.prototype

    if (!poolProto[POOL_QUERY_HOOKED] && poolProto.query) {
      originalPoolQuery = poolProto.query
      poolPrototype = poolProto
      poolProto.query = createPatchedMethod('query', originalPoolQuery) as typeof poolProto.query
      poolProto[POOL_QUERY_HOOKED] = true
    }

    if (!poolProto[POOL_EXECUTE_HOOKED] && poolProto.execute) {
      originalPoolExecute = poolProto.execute
      if (!poolPrototype) poolPrototype = poolProto
      poolProto.execute = createPatchedMethod(
        'execute',
        originalPoolExecute,
      ) as typeof poolProto.execute
      poolProto[POOL_EXECUTE_HOOKED] = true
    }
  }
}

export function uninstallMysql2Hook(): void {
  if (connPrototype) {
    if (originalConnQuery && connPrototype[CONN_QUERY_HOOKED]) {
      connPrototype.query = originalConnQuery
      delete connPrototype[CONN_QUERY_HOOKED]
    }
    if (originalConnExecute && connPrototype[CONN_EXECUTE_HOOKED]) {
      connPrototype.execute = originalConnExecute
      delete connPrototype[CONN_EXECUTE_HOOKED]
    }
    originalConnQuery = undefined
    originalConnExecute = undefined
    connPrototype = undefined
  }

  if (poolPrototype) {
    if (originalPoolQuery && poolPrototype[POOL_QUERY_HOOKED]) {
      poolPrototype.query = originalPoolQuery
      delete poolPrototype[POOL_QUERY_HOOKED]
    }
    if (originalPoolExecute && poolPrototype[POOL_EXECUTE_HOOKED]) {
      poolPrototype.execute = originalPoolExecute
      delete poolPrototype[POOL_EXECUTE_HOOKED]
    }
    originalPoolQuery = undefined
    originalPoolExecute = undefined
    poolPrototype = undefined
  }
}

export function isMysql2HookInstalled(): boolean {
  if (!connPrototype) return false
  return connPrototype[CONN_QUERY_HOOKED] === true
}
