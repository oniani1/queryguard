import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import { queryGuard } from '../../src/middleware/fastify.js'
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

describe('queryGuard fastify middleware', () => {
  it('passes requests through without N+1', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = Fastify()
    await app.register(queryGuard)
    app.get('/', async () => {
      recordQuery('SELECT * FROM "User"', 1)
      return { ok: true }
    })

    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    errorSpy.mockRestore()
    await app.close()
  })

  it('warns on N+1 in warn mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const app = Fastify()
    await app.register(queryGuard, { mode: 'warn' })
    app.get('/n-plus-one', async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      return { ok: true }
    })

    const res = await app.inject({ method: 'GET', url: '/n-plus-one' })
    expect(res.statusCode).toBe(200)
    expect(warnSpy).toHaveBeenCalled()
    const output = warnSpy.mock.calls[0][0] as string
    expect(output).toContain('N+1')

    warnSpy.mockRestore()
    await app.close()
  })

  it('returns 500 in throw mode', async () => {
    const app = Fastify()
    await app.register(queryGuard, { mode: 'throw' })
    app.get('/n-plus-one', async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      return { ok: true }
    })

    const res = await app.inject({ method: 'GET', url: '/n-plus-one' })
    expect(res.statusCode).toBe(500)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('N+1')

    await app.close()
  })

  it('calls onDetection in silent mode', async () => {
    const onDetection = vi.fn()

    const app = Fastify()
    await app.register(queryGuard, { mode: 'silent', onDetection })
    app.get('/n-plus-one', async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      return { ok: true }
    })

    const res = await app.inject({ method: 'GET', url: '/n-plus-one' })
    expect(res.statusCode).toBe(200)
    expect(onDetection).toHaveBeenCalledOnce()
    expect(onDetection.mock.calls[0][0].detections.length).toBe(1)

    await app.close()
  })

  it('is a no-op when disabled', async () => {
    process.env.NODE_ENV = 'production'
    resetConfig()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = Fastify()
    await app.register(queryGuard, { mode: 'warn' })
    app.get('/n-plus-one', async () => {
      recordQuery('SELECT * FROM "User"', 1)
      await tick()
      recordQuery('SELECT * FROM "User"', 1)
      return { ok: true }
    })

    const res = await app.inject({ method: 'GET', url: '/n-plus-one' })
    expect(res.statusCode).toBe(200)
    const nPlusOneWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('N+1'),
    )
    expect(nPlusOneWarns.length).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    errorSpy.mockRestore()
    delete process.env.NODE_ENV
    resetConfig()
    await app.close()
  })
})
