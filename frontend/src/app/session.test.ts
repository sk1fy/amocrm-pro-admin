import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { clearSession } from './session'

describe('clearSession', () => {
  it('removes previous employee data and cancels pending cache writes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['employees'], ['private-employee@example.invalid'])
    let resolveAudit!: (data: string[]) => void
    const pending = client.fetchQuery({
      queryKey: ['audit'],
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          resolveAudit = resolve
        }),
    })
    const cancelled = expect(pending).rejects.toBeDefined()

    clearSession(client)
    resolveAudit(['previous employee audit'])

    await cancelled
    expect(client.getQueryData(['employees'])).toBeUndefined()
    expect(client.getQueryData(['audit'])).toBeUndefined()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })
})
