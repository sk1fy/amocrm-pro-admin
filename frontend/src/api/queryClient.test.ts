import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusManager, QueryObserver } from '@tanstack/react-query'
import { backendIntervals, createQueryClient, invalidateCommandQueries } from './queryClient'

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  focusManager.setFocused(undefined)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

describe('backend refresh policy', () => {
  it('polls at 90 seconds only while visible and focused, then resumes immediately', async () => {
    vi.useFakeTimers()
    expect(backendIntervals).toEqual({ detail: 15_000, list: 90_000, operation: 1500 })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const client = createQueryClient()
    client.mount()
    const fetcher = vi.fn(async () => ({ items: [] }))
    const session = vi.fn(async () => ({ id: 'fixture' }))
    const observer = new QueryObserver(client, { queryKey: ['accounts', {}], queryFn: fetcher })
    const staticObserver = new QueryObserver(client, { queryKey: ['me'], queryFn: session })
    const unsubscribe = observer.subscribe(() => undefined)
    const unsubscribeStatic = staticObserver.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(89_999)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.mocked(document.hasFocus).mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.mocked(document.hasFocus).mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(fetcher).toHaveBeenCalledTimes(4)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetcher).toHaveBeenCalledTimes(4)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(fetcher).toHaveBeenCalledTimes(6)
    expect(session).toHaveBeenCalledTimes(1)
    unsubscribe()
    unsubscribeStatic()
    client.unmount()
    client.clear()
  })
  it('terminal command invalidates account, connection, stats and backends on any screen', async () => {
    const client = createQueryClient()
    for (const key of ['accounts', 'account', 'connection', 'stats', 'backends'])
      client.setQueryData([key], {})
    await client.fetchQuery({
      queryKey: ['admin-operation', 'fixture'],
      queryFn: async () => ({
        operation: { id: 'fixture', state: 'succeeded', updated_at: '2026-09-19T12:00:00Z' },
      }),
    })
    for (const key of ['accounts', 'account', 'connection', 'stats', 'backends'])
      expect(client.getQueryState([key])?.isInvalidated).toBe(true)
    client.clear()
  })
  it('keeps prior snapshot on refetch failure and leaves sessions untouched', async () => {
    const client = createQueryClient()
    client.setQueryData(['accounts'], { items: ['old'] })
    client.setQueryData(['me'], { id: 'employee' })
    await invalidateCommandQueries(client)
    await expect(
      client.fetchQuery({
        queryKey: ['accounts'],
        queryFn: async () => {
          throw new Error('offline')
        },
      }),
    ).rejects.toThrow('offline')
    expect(client.getQueryData(['accounts'])).toEqual({ items: ['old'] })
    expect(client.getQueryState(['me'])?.isInvalidated).toBe(false)
    client.clear()
  })
})

it('waits for an old in-flight snapshot, then refetches after command completion', async () => {
  const client = createQueryClient()
  let resolve: ((value: string) => void) | undefined
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done
        }),
    )
    .mockResolvedValue('new')
  const observer = new QueryObserver(client, { queryKey: ['account', 'fixture'], queryFn: fetcher })
  const off = observer.subscribe(() => undefined)
  const refresh = invalidateCommandQueries(client)
  expect(fetcher).toHaveBeenCalledTimes(1)
  resolve?.('old')
  await refresh
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(client.getQueryData(['account', 'fixture'])).toBe('new')
  off()
  client.clear()
})
