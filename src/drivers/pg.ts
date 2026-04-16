import { createPatchedMethod, promiseCompletion } from './shared.js'

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

function extractPgSql(args: unknown[]): string {
  const first = args[0]
  if (typeof first === 'string') return first
  if (first !== null && typeof first === 'object' && 'text' in first) {
    return String((first as { text: unknown }).text)
  }
  return '<unknown>'
}

export function installPgHook(pgModule?: PgModule): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = pgModule ?? (require('pg') as PgModule)
  const proto = pg.Client.prototype

  if (!proto[HOOK_INSTALLED] && proto.query) {
    originalQuery = proto.query
    clientPrototype = proto
    proto.query = createPatchedMethod({
      extractSql: extractPgSql,
      original: originalQuery,
      completeQuery: promiseCompletion,
      name: 'patchedQuery',
    })
    proto[HOOK_INSTALLED] = true
  }

  // Also patch Pool.prototype.query — pg-pool's connect callback can lose ALS context
  // because it runs from an internal event queue. Patching Pool directly ensures capture.
  if (pg.Pool && !pg.Pool.prototype[POOL_HOOK_INSTALLED]) {
    const poolProto = pg.Pool.prototype
    originalPoolQuery = poolProto.query
    poolPrototype = poolProto
    poolProto.query = createPatchedMethod({
      extractSql: extractPgSql,
      original: originalPoolQuery,
      completeQuery: promiseCompletion,
      name: 'patchedPoolQuery',
    })
    poolProto[POOL_HOOK_INSTALLED] = true
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
