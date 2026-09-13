import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGet, resetApiSession, setUnauthorizedHandler } from './client'

afterEach(() => {
  resetApiSession()
  setUnauthorizedHandler(null)
  vi.unstubAllGlobals()
})

describe('API session boundary', () => {
  it('aborts old requests and ignores their late unauthorized responses', async () => {
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)
    let resolveResponse!: (response: Response) => void
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const oldRequest = apiGet('/api/v1/system/employees')
    const rejected = expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' })
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal

    resetApiSession()
    expect(oldSignal?.aborted).toBe(true)
    resolveResponse(
      new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 }),
    )

    await rejected
    expect(unauthorized).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ role: 'viewer' })))
    await expect(apiGet('/api/v1/me')).resolves.toEqual({ role: 'viewer' })
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(false)
  })
})
