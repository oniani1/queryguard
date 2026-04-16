import { createPatchedMethod, eventEndCompletion } from './shared.js'

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

function extractMysql2Sql(args: unknown[]): string {
  const first = args[0]
  if (typeof first === 'string') return first
  if (first !== null && typeof first === 'object' && 'sql' in first) {
    return String((first as { sql: unknown }).sql)
  }
  return '<unknown>'
}

function patchMethod(
  methodName: 'query' | 'execute',
  original: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  return createPatchedMethod({
    extractSql: extractMysql2Sql,
    original,
    completeQuery: eventEndCompletion,
    name: `patched${methodName.charAt(0).toUpperCase()}${methodName.slice(1)}`,
  })
}

export function installMysql2Hook(mysql2Module?: Mysql2Module): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysql2 = mysql2Module ?? (require('mysql2') as Mysql2Module)
  const connProto = mysql2.Connection.prototype

  if (!connProto[CONN_QUERY_HOOKED] && connProto.query) {
    originalConnQuery = connProto.query
    connPrototype = connProto
    connProto.query = patchMethod('query', originalConnQuery) as typeof connProto.query
    connProto[CONN_QUERY_HOOKED] = true
  }

  if (!connProto[CONN_EXECUTE_HOOKED] && connProto.execute) {
    originalConnExecute = connProto.execute
    if (!connPrototype) connPrototype = connProto
    connProto.execute = patchMethod('execute', originalConnExecute) as typeof connProto.execute
    connProto[CONN_EXECUTE_HOOKED] = true
  }

  if (mysql2.Pool) {
    const poolProto = mysql2.Pool.prototype

    if (!poolProto[POOL_QUERY_HOOKED] && poolProto.query) {
      originalPoolQuery = poolProto.query
      poolPrototype = poolProto
      poolProto.query = patchMethod('query', originalPoolQuery) as typeof poolProto.query
      poolProto[POOL_QUERY_HOOKED] = true
    }

    if (!poolProto[POOL_EXECUTE_HOOKED] && poolProto.execute) {
      originalPoolExecute = poolProto.execute
      if (!poolPrototype) poolPrototype = poolProto
      poolProto.execute = patchMethod('execute', originalPoolExecute) as typeof poolProto.execute
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
