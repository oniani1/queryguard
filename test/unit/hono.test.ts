import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { queryGuard } from '../../src/middleware/hono.js'
import { recordQuery } from '../../src/core/tracker.js'
import { resetConfig } from '../../src/core/config.js'
import { uninstall } from '../../src/drivers/install.js'
import { resetWarnedFlag } from '../../src/middleware/shared.js'

beforeEach(() => {
  resetConfig()
  uninstall()
  resetWarnedFlag()
})

function nPlusOneHandler(c: { text: (s: string) => Response }) {
  return async () => {
    recordQuery('SELECT * FROM "User"', 1)
    await new Promise((r) => setTimeout(r, 5))
    recordQuery('SELECT * FROM "User"', 1)
    return c.text('ok')
  }
}

describe('queryGuard hono middleware', () => {
  it('passes through when no N+1 detected', async () => {
    const app = new Hono()
    app.use(queryGuard())
    app.get('/clean', (c) => {
      recordQuery('SELECT * FROM "User"', 1)
      return c.text('ok')
    })

    const res = await app.request('/clean')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('warns on N+1 in warn mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = new Hono()
    app.use(queryGuard({ mode: 'warn' }))
    app.get('/n-plus-one', async (c) => {
      recordQuery('SELECT * FROM "User"', 1)
      await new Promise((r) => setTimeout(r, 5))
      recordQuery('SELECT * FROM "User"', 1)
      return c.text('ok')
    })

    const res = await app.request('/n-plus-one')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('returns 500 in throw mode', async () => {
    const app = new Hono()
    app.use(queryGuard({ mode: 'throw' }))
    app.get('/n-plus-one', async (c) => {
      recordQuery('SELECT * FROM "User"', 1)
      await new Promise((r) => setTimeout(r, 5))
      recordQuery('SELECT * FROM "User"', 1)
      return c.text('ok')
    })

    const res = await app.request('/n-plus-one')
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    const body = await res.text()
    expect(body).toContain('N+1')
  })

  it('calls onDetection in silent mode', async () => {
    const onDetection = vi.fn()
    const app = new Hono()
    app.use(queryGuard({ mode: 'silent', onDetection }))
    app.get('/n-plus-one', async (c) => {
      recordQuery('SELECT * FROM "User"', 1)
      await new Promise((r) => setTimeout(r, 5))
      recordQuery('SELECT * FROM "User"', 1)
      return c.text('ok')
    })

    const res = await app.request('/n-plus-one')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(onDetection).toHaveBeenCalledOnce()
    expect(onDetection.mock.calls[0][0].detections.length).toBe(1)
  })

  it('no-op when disabled', async () => {
    process.env.NODE_ENV = 'production'
    resetConfig()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = new Hono()
    app.use(queryGuard({ mode: 'throw' }))
    app.get('/n-plus-one', async (c) => {
      recordQuery('SELECT * FROM "User"', 1)
      await new Promise((r) => setTimeout(r, 5))
      recordQuery('SELECT * FROM "User"', 1)
      return c.text('ok')
    })

    const res = await app.request('/n-plus-one')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')

    process.env.NODE_ENV = 'test'
    resetConfig()
    warnSpy.mockRestore()
  })
})
