import { describe, it, expect, beforeEach, vi } from 'vitest'
import { withQueryGuard } from '../../src/middleware/next.js'
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
  return new Promise((resolve) => setTimeout(resolve, 5))
}

function nplusOneHandler(): (req: Request) => Promise<Response> {
  return async () => {
    recordQuery('SELECT * FROM "User"', 1)
    await tick()
    recordQuery('SELECT * FROM "User"', 1)
    return new Response('ok')
  }
}

function cleanHandler(): (req: Request) => Promise<Response> {
  return async () => {
    recordQuery('SELECT * FROM "User"', 1)
    return new Response('clean')
  }
}

describe('withQueryGuard (Next.js)', () => {
  it('returns original response when no N+1', async () => {
    const wrapped = withQueryGuard(cleanHandler())
    const res = await wrapped(new Request('http://localhost/api/test'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('clean')
  })

  it('warns on N+1 in warn mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapped = withQueryGuard(nplusOneHandler(), { mode: 'warn' })
    const res = await wrapped(new Request('http://localhost/api/test'))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(warnSpy).toHaveBeenCalled()
    const warnOutput = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(warnOutput).toContain('select')

    warnSpy.mockRestore()
  })

  it('returns 500 on N+1 in throw mode', async () => {
    const wrapped = withQueryGuard(nplusOneHandler(), { mode: 'throw' })
    const res = await wrapped(new Request('http://localhost/api/test'))

    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toBe('text/plain')
    const body = await res.text()
    expect(body).toContain('select')
  })

  it('calls onDetection in silent mode', async () => {
    const onDetection = vi.fn()
    const wrapped = withQueryGuard(nplusOneHandler(), { mode: 'silent', onDetection })
    const res = await wrapped(new Request('http://localhost/api/test'))

    expect(res.status).toBe(200)
    expect(onDetection).toHaveBeenCalledOnce()
    const [report, req] = onDetection.mock.calls[0]
    expect(report.detections.length).toBeGreaterThan(0)
    expect(req).toBeInstanceOf(Request)
  })

  it('passes through when disabled', async () => {
    const origEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    resetConfig()

    const wrapped = withQueryGuard(cleanHandler(), { mode: 'throw' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await wrapped(new Request('http://localhost/api/test'))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('clean')

    warnSpy.mockRestore()
    process.env.NODE_ENV = origEnv
    resetConfig()
  })
})
