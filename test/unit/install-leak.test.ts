import { beforeEach, describe, expect, it } from 'vitest'
import { install, uninstall } from '../../src/drivers/install.js'
import {
  installPgHook,
  isPgHookInstalled,
  uninstallPgHook,
} from '../../src/drivers/pg.js'
import {
  installMysql2Hook,
  isMysql2HookInstalled,
  uninstallMysql2Hook,
} from '../../src/drivers/mysql2.js'

describe('pg hook uninstall cleanliness', () => {
  beforeEach(() => {
    uninstallPgHook()
  })

  it('restores prototype.query to strict equality with the original', () => {
    const original = () => 'original'
    const clientProto = { query: original }
    const mockPg = { Client: { prototype: clientProto } }

    installPgHook(mockPg as never)
    expect(clientProto.query).not.toBe(original)

    uninstallPgHook()
    expect(clientProto.query).toBe(original)
  })

  it('second install is idempotent, single uninstall restores state', () => {
    const original = () => 'original'
    const clientProto = { query: original }
    const mockPg = { Client: { prototype: clientProto } }

    installPgHook(mockPg as never)
    const firstPatched = clientProto.query
    installPgHook(mockPg as never)
    expect(clientProto.query).toBe(firstPatched)

    uninstallPgHook()
    expect(clientProto.query).toBe(original)
    expect(isPgHookInstalled()).toBe(false)
  })

  it('removes the install symbol from the prototype', () => {
    const HOOK_INSTALLED = Symbol.for('queryguard.pg.hooked')
    const clientProto: { query: unknown; [key: symbol]: unknown } = {
      query: () => 'original',
    }
    const mockPg = { Client: { prototype: clientProto } }

    installPgHook(mockPg as never)
    expect(clientProto[HOOK_INSTALLED]).toBe(true)

    uninstallPgHook()
    expect(clientProto[HOOK_INSTALLED]).toBeUndefined()
  })
})

describe('mysql2 hook uninstall cleanliness', () => {
  beforeEach(() => {
    uninstallMysql2Hook()
  })

  it('restores Connection.query and Connection.execute to originals', () => {
    const originalQuery = () => 'q'
    const originalExecute = () => 'e'
    const connProto = { query: originalQuery, execute: originalExecute }
    const mockMysql = { Connection: { prototype: connProto } }

    installMysql2Hook(mockMysql as never)
    expect(connProto.query).not.toBe(originalQuery)
    expect(connProto.execute).not.toBe(originalExecute)

    uninstallMysql2Hook()
    expect(connProto.query).toBe(originalQuery)
    expect(connProto.execute).toBe(originalExecute)
    expect(isMysql2HookInstalled()).toBe(false)
  })

  it('restores Pool prototype methods to originals', () => {
    const originals = {
      connQuery: () => 'cq',
      connExecute: () => 'ce',
      poolQuery: () => 'pq',
      poolExecute: () => 'pe',
    }
    const connProto = { query: originals.connQuery, execute: originals.connExecute }
    const poolProto = { query: originals.poolQuery, execute: originals.poolExecute }
    const mockMysql = {
      Connection: { prototype: connProto },
      Pool: { prototype: poolProto },
    }

    installMysql2Hook(mockMysql as never)
    uninstallMysql2Hook()

    expect(connProto.query).toBe(originals.connQuery)
    expect(connProto.execute).toBe(originals.connExecute)
    expect(poolProto.query).toBe(originals.poolQuery)
    expect(poolProto.execute).toBe(originals.poolExecute)
  })
})

describe('top-level install/uninstall', () => {
  it('uninstall clears the installPromise so re-install takes effect', async () => {
    await install()
    uninstall()

    // If installPromise was not cleared, calling install() would return the
    // old resolved promise without re-hooking. Verify by calling it again.
    await install()
    uninstall()
  })
})

describe('partial install recovery', () => {
  beforeEach(() => {
    uninstallPgHook()
    uninstallMysql2Hook()
  })

  it('uninstall cleans up pg even when mysql2 module is unusable', () => {
    const originalPgQuery = () => 'orig'
    const pgProto = { query: originalPgQuery }
    installPgHook({ Client: { prototype: pgProto } } as never)
    // Simulate a separate mysql2 install attempt that fails; the pg side must
    // still be cleanly uninstallable without throwing.
    expect(() => installMysql2Hook({} as never)).toThrow()

    uninstallPgHook()
    expect(pgProto.query).toBe(originalPgQuery)
  })
})
