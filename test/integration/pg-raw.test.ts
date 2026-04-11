import { describe, it, expect, beforeEach } from 'vitest'
import pg from 'pg'
import { trackQueries, uninstall, resetConfig } from 'queryguard'

const DB_URL = 'postgresql://postgres:spike@localhost:5432/spike'

describe('pg raw integration', () => {
  beforeEach(() => {
    uninstall()
    resetConfig()
  })

  it('detects N+1 with raw pg', async () => {
    const { report } = await trackQueries(async () => {
      const client = new pg.Client({ connectionString: DB_URL })
      await client.connect()
      const users = await client.query('SELECT * FROM "User"')
      for (const user of users.rows) {
        await client.query('SELECT * FROM "Post" WHERE "userId" = $1', [user.id])
      }
      await client.end()
    })

    expect(report.detections.length).toBe(1)
    expect(report.detections[0].occurrences).toBe(3) // 3 users -> 3 post queries
    expect(report.detections[0].type).toBe('n-plus-one')
    expect(report.totalQueries).toBe(4) // 1 user query + 3 post queries
  })

  it('reports clean when no N+1', async () => {
    const { report } = await trackQueries(async () => {
      const client = new pg.Client({ connectionString: DB_URL })
      await client.connect()
      const users = await client.query('SELECT * FROM "User"')
      // Single query, no loop
      await client.end()
    })

    expect(report.detections.length).toBe(0)
  })
})
