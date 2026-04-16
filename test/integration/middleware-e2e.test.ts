// End-to-end tests for middleware + real pg driver against a live Postgres.
// Proves: HTTP request -> middleware ALS context -> pg driver -> detection firing.
// Requires TEST_PG_URL or default (postgresql://postgres:test@localhost:5432/test).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import express from 'express'
import fastify from 'fastify'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import pg from 'pg'
import { resetConfig, uninstall } from 'qguard'
import { queryGuard as expressGuard } from '../../src/middleware/express.js'
import { queryGuard as fastifyGuard } from '../../src/middleware/fastify.js'
import { queryGuard as honoGuard } from '../../src/middleware/hono.js'
import { resetWarnedFlag } from '../../src/middleware/shared.js'

const DB_URL = process.env.TEST_PG_URL ?? 'postgresql://postgres:test@localhost:5432/test'

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  await client.query(
    'CREATE TABLE IF NOT EXISTS qguard_e2e_user (id INT PRIMARY KEY, name TEXT)',
  )
  await client.query(
    'CREATE TABLE IF NOT EXISTS qguard_e2e_post (id INT PRIMARY KEY, user_id INT, title TEXT)',
  )
  await client.query('DELETE FROM qguard_e2e_post')
  await client.query('DELETE FROM qguard_e2e_user')
  await client.query(
    "INSERT INTO qguard_e2e_user (id, name) VALUES (1, 'a'), (2, 'b'), (3, 'c')",
  )
  await client.query(
    "INSERT INTO qguard_e2e_post (id, user_id, title) VALUES (1, 1, 'p1'), (2, 2, 'p2'), (3, 3, 'p3')",
  )
  await client.end()
}

async function cleanup(): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  await client.query('DROP TABLE IF EXISTS qguard_e2e_post')
  await client.query('DROP TABLE IF EXISTS qguard_e2e_user')
  await client.end()
}

async function runNPlusOne(): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  const { rows } = await client.query<{ id: number }>('SELECT id FROM qguard_e2e_user')
  for (const u of rows) {
    await client.query('SELECT * FROM qguard_e2e_post WHERE user_id = $1', [u.id])
  }
  await client.end()
}

beforeAll(seed)
afterAll(cleanup)

beforeEach(() => {
  uninstall()
  resetConfig()
  resetWarnedFlag()
})

function httpGet(port: number, path = '/'): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        res.resume()
        res.on('end', () => resolve(res))
      })
      .on('error', reject)
  })
}

function expectNPlusOneWarning(spy: ReturnType<typeof vi.spyOn>): void {
  const messages = spy.mock.calls.map((call) => call.map(String).join(' '))
  const matched = messages.some((m) => m.includes('N+1') || m.includes('qguard'))
  expect(matched, `no N+1 warning among: ${messages.join(' | ')}`).toBe(true)
}

describe('express middleware + real pg driver', () => {
  it('catches an N+1 on the request path', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const app = express()
    app.use(expressGuard())
    app.get('/', async (_req, res) => {
      await runNPlusOne()
      res.send('ok')
    })

    await new Promise<void>((resolve) => {
      const server = app.listen(0, '127.0.0.1', async () => {
        const addr = server.address() as { port: number }
        await httpGet(addr.port)
        server.close(() => resolve())
      })
    })

    expectNPlusOneWarning(warnSpy)
    warnSpy.mockRestore()
  })
})

describe('fastify plugin + real pg driver', () => {
  it('catches an N+1 on the request path', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const app = fastify()
    await app.register(fastifyGuard)
    app.get('/', async () => {
      await runNPlusOne()
      return 'ok'
    })

    const addr = await app.listen({ port: 0, host: '127.0.0.1' })
    const port = Number(new URL(addr).port)
    await httpGet(port)
    await app.close()

    expectNPlusOneWarning(warnSpy)
    warnSpy.mockRestore()
  })
})

describe('hono middleware + real pg driver', () => {
  it('catches an N+1 on the request path through a real HTTP server', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const app = new Hono()
    app.use('*', honoGuard())
    app.get('/', async (c) => {
      await runNPlusOne()
      return c.text('ok')
    })

    await new Promise<void>((resolve, reject) => {
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, async (info) => {
        try {
          await httpGet(info.port)
          server.close(() => resolve())
        } catch (err) {
          reject(err)
        }
      })
    })

    expectNPlusOneWarning(warnSpy)
    warnSpy.mockRestore()
  })
})
