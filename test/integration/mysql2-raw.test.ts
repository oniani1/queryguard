// Integration tests for mysql2 driver. Requires a running MySQL instance.
// Set TEST_MYSQL_URL or rely on the default (mysql://root:test@localhost:3306/test).

import mysqlCallback from 'mysql2'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetConfig, trackQueries, uninstall } from 'qguard'

const DB_URL = process.env.TEST_MYSQL_URL ?? 'mysql://root:test@localhost:3306/test'

async function seed(conn: mysql.Connection): Promise<void> {
  // DROP + CREATE so a stale schema from a previous run can't silently alter behaviour.
  await conn.query('DROP TABLE IF EXISTS qguard_post')
  await conn.query('DROP TABLE IF EXISTS qguard_user')
  await conn.query('CREATE TABLE qguard_user (id INT PRIMARY KEY, name VARCHAR(64))')
  await conn.query(
    'CREATE TABLE qguard_post (id INT PRIMARY KEY, user_id INT, title VARCHAR(128))',
  )
  await conn.query('INSERT INTO qguard_user (id, name) VALUES (1, \'a\'), (2, \'b\'), (3, \'c\')')
  await conn.query(
    'INSERT INTO qguard_post (id, user_id, title) VALUES (1, 1, \'p1\'), (2, 2, \'p2\'), (3, 3, \'p3\')',
  )
}

describe('mysql2 raw integration', () => {
  beforeAll(async () => {
    const conn = await mysql.createConnection(DB_URL)
    await seed(conn)
    await conn.end()
  })

  afterAll(async () => {
    const conn = await mysql.createConnection(DB_URL)
    await conn.query('DROP TABLE IF EXISTS qguard_post')
    await conn.query('DROP TABLE IF EXISTS qguard_user')
    await conn.end()
  })

  beforeEach(() => {
    uninstall()
    resetConfig()
  })

  it('detects N+1 with raw mysql2 Connection', async () => {
    const { report } = await trackQueries(async () => {
      const conn = await mysql.createConnection(DB_URL)
      const [users] = await conn.query('SELECT * FROM qguard_user')
      for (const u of users as Array<{ id: number }>) {
        await conn.query('SELECT * FROM qguard_post WHERE user_id = ?', [u.id])
      }
      await conn.end()
    })

    expect(report.detections.length).toBe(1)
    expect(report.detections[0].occurrences).toBe(3)
  })

  it('reports clean when no N+1', async () => {
    const { report } = await trackQueries(async () => {
      const conn = await mysql.createConnection(DB_URL)
      await conn.query('SELECT * FROM qguard_user')
      await conn.end()
    })

    expect(report.detections.length).toBe(0)
  })

  it('detects N+1 via Pool.query', async () => {
    const { report } = await trackQueries(async () => {
      const pool = mysql.createPool(DB_URL)
      const [users] = await pool.query('SELECT * FROM qguard_user')
      for (const u of users as Array<{ id: number }>) {
        await pool.query('SELECT * FROM qguard_post WHERE user_id = ?', [u.id])
      }
      await pool.end()
    })

    expect(report.detections.length).toBe(1)
    expect(report.detections[0].occurrences).toBe(3)
  })

  it('detects N+1 via connection.execute (prepared statements)', async () => {
    const { report } = await trackQueries(async () => {
      const conn = await mysql.createConnection(DB_URL)
      const [users] = await conn.execute('SELECT * FROM qguard_user')
      for (const u of users as Array<{ id: number }>) {
        await conn.execute('SELECT * FROM qguard_post WHERE user_id = ?', [u.id])
      }
      await conn.end()
    })

    expect(report.detections.length).toBe(1)
    expect(report.detections[0].occurrences).toBe(3)
  })

  it('preserves legacy callback semantics and records queries', async () => {
    // Test the callback API that does not go through mysql2/promise.
    // The patched method must still deliver (err, rows) to the user callback.
    const { report } = await trackQueries(
      () =>
        new Promise<void>((resolve, reject) => {
          const conn = mysqlCallback.createConnection(DB_URL)
          conn.query<mysqlCallback.RowDataPacket[]>(
            'SELECT * FROM qguard_user',
            (err, users) => {
              if (err) return reject(err)
              let pending = users.length
              if (pending === 0) {
                conn.end()
                return resolve()
              }
              for (const u of users) {
                conn.query(
                  'SELECT * FROM qguard_post WHERE user_id = ?',
                  [u.id],
                  (err2) => {
                    if (err2) return reject(err2)
                    if (--pending === 0) {
                      conn.end()
                      resolve()
                    }
                  },
                )
              }
            },
          )
        }),
    )

    expect(report.detections.length).toBe(1)
    expect(report.detections[0].occurrences).toBe(3)
  })
})
