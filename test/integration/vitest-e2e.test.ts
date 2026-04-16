import { describe, it, expect, beforeEach } from 'vitest'
import pg from 'pg'
import { assertNoNPlusOne, queryBudget, QueryGuardError } from 'qguard/vitest'
import { uninstall, resetConfig } from 'qguard'

const DB_URL = process.env.TEST_PG_URL ?? 'postgresql://postgres:test@localhost:5432/test'

describe('vitest integration', () => {
  beforeEach(() => {
    uninstall()
    resetConfig()
  })

  it('assertNoNPlusOne throws on N+1', async () => {
    await expect(assertNoNPlusOne(async () => {
      const client = new pg.Client({ connectionString: DB_URL })
      await client.connect()
      const users = await client.query('SELECT * FROM "User"')
      for (const user of users.rows) {
        await client.query('SELECT * FROM "Post" WHERE "userId" = $1', [user.id])
      }
      await client.end()
    })).rejects.toThrow(QueryGuardError)
  })

  it('assertNoNPlusOne passes when clean', async () => {
    const result = await assertNoNPlusOne(async () => {
      const client = new pg.Client({ connectionString: DB_URL })
      await client.connect()
      await client.query('SELECT * FROM "User"')
      await client.end()
      return 'ok'
    })
    expect(result).toBe('ok')
  })

  it('queryBudget throws when over budget', async () => {
    await expect(queryBudget(2, async () => {
      const client = new pg.Client({ connectionString: DB_URL })
      await client.connect()
      await client.query('SELECT * FROM "User"')
      await client.query('SELECT * FROM "Post"')
      await client.query('SELECT 1')
      await client.end()
    })).rejects.toThrow(QueryGuardError)
  })

  it('queryBudget passes under budget', async () => {
    await expect(queryBudget(5, async () => {
      const client = new pg.Client({ connectionString: DB_URL })
      await client.connect()
      await client.query('SELECT * FROM "User"')
      await client.end()
    })).resolves.not.toThrow()
  })

  it('error message contains N+1 report', async () => {
    try {
      await assertNoNPlusOne(async () => {
        const client = new pg.Client({ connectionString: DB_URL })
        await client.connect()
        const users = await client.query('SELECT * FROM "User"')
        for (const user of users.rows) {
          await client.query('SELECT * FROM "Post" WHERE "userId" = $1', [user.id])
        }
        await client.end()
      })
      expect.fail('should have thrown')
    } catch (e) {
      const err = e as QueryGuardError
      expect(err.message).toContain('N+1 query detected')
      expect(err.message).toContain('Repeated query executed')
      expect(err.message).toContain('Fingerprint:')
      expect(err.report.detections.length).toBe(1)
    }
  })
})
