import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from './espn-proxy.js'

const env = { ALLOWED_ORIGIN: 'https://example.github.io' }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('espn-proxy worker', () => {
  it('answers a CORS preflight without hitting ESPN', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await worker.fetch(
      new Request('https://proxy.example/athletes/123/stats', { method: 'OPTIONS' }),
      env
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a path that is not an athlete stats lookup', async () => {
    const res = await worker.fetch(new Request('https://proxy.example/anything/else'), env)
    expect(res.status).toBe(404)
  })

  it('rejects a non-GET request', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.example/athletes/123/stats', { method: 'POST' }),
      env
    )
    expect(res.status).toBe(405)
  })

  it('proxies a real athlete id to ESPN and forwards the JSON with CORS headers', async () => {
    const payload = { categories: [{ name: 'receiving' }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    )

    const res = await worker.fetch(new Request('https://proxy.example/athletes/4361741/stats'), env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io')
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(await res.json()).toEqual(payload)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/athletes/4361741/stats',
      expect.any(Object)
    )
  })

  it('falls back to the second ESPN host when the first fails', async () => {
    const payload = { categories: [] }
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    const res = await worker.fetch(new Request('https://proxy.example/athletes/1/stats'), env)

    expect(res.status).toBe(200)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns 502 when every host fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))
    const res = await worker.fetch(new Request('https://proxy.example/athletes/1/stats'), env)
    expect(res.status).toBe(502)
  })

  it('defaults Access-Control-Allow-Origin to "*" when unset', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.example/athletes/1/stats', { method: 'OPTIONS' }),
      {}
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
