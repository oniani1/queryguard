import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import { queryGuard } from '../../src/middleware/express.js'
import { recordQuery } from '../../src/core/tracker.js'
import { resetConfig } from '../../src/core/config.js'
import { uninstall } from '../../src/drivers/install.js'
import { resetWarnedFlag } from '../../src/middleware/shared.js'

beforeEach(() => {
  resetConfig()
  uninstall()
  resetWarnedFlag()
})

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

function request(app: express.Express, path = '/'): Promise<http.IncomingMessage> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number }
      http.get(`http://localhost:${addr.port}${path}`, (res) => {
        res.resume()
        res.on('end', () => { server.close(); resolve(res) })
      })
    })
  })
}

describe('queryGuard express middleware', () => {
  it('passes requests through without N+1', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = express()
    app.use(queryGuard())
    app.get('/', (_req, res) => {
      recordQuery('SELECT * FROM "User"', 1)
      res.send('ok')
    })

    const res = await request(app)
    expect(res.statusCode).toBe(200)
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('warns on N+1 in warn mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const app = express()
    app.use(queryGuard({ mode: 'warn' }))
    app.get('/', async (_req, res) => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      res.send('ok')
    })

    await request(app)
    expect(warnSpy).toHaveBeenCalled()
    const output = warnSpy.mock.calls[0][0] as string
    expect(output).toContain('N+1')

    warnSpy.mockRestore()
  })

  it('calls onDetection in silent mode', async () => {
    const onDetection = vi.fn()

    const app = express()
    app.use(queryGuard({ mode: 'silent', onDetection }))
    app.get('/', async (_req, res) => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      res.send('ok')
    })

    await request(app)
    expect(onDetection).toHaveBeenCalledOnce()
    expect(onDetection.mock.calls[0][0].detections.length).toBe(1)
  })

  it('degrades throw mode to warn in Express (response already sent)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const app = express()
    app.use(queryGuard({ mode: 'throw' }))
    app.get('/', async (_req, res) => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      res.send('ok')
    })

    await request(app)
    expect(warnSpy).toHaveBeenCalled()
    const output = warnSpy.mock.calls[0][0] as string
    expect(output).toContain('N+1')

    warnSpy.mockRestore()
  })

  it('is a no-op when disabled', async () => {
    process.env.NODE_ENV = 'production'
    resetConfig()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = express()
    app.use(queryGuard({ mode: 'warn' }))
    app.get('/', async (_req, res) => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      res.send('ok')
    })

    await request(app)
    // The only warn call should be the "disabled in production" message
    const nPlusOneWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('N+1'),
    )
    expect(nPlusOneWarns.length).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    errorSpy.mockRestore()
    delete process.env.NODE_ENV
    resetConfig()
  })
})
