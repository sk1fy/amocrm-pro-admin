import { focusManager, QueryCache, QueryClient } from '@tanstack/react-query'
import type { AdminOperation } from './types'

function interval(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < 1000 || value > 300_000)
    throw new Error('Invalid backend refresh interval')
  return value
}
export const backendIntervals = {
  detail: interval(import.meta.env.VITE_BACKEND_DETAIL_INTERVAL_MS, 15_000),
  list: interval(import.meta.env.VITE_BACKEND_LIST_INTERVAL_MS, 90_000),
  operation: interval(import.meta.env.VITE_OPERATION_INTERVAL_MS, 1500),
} as const
const affected = new Set([
  'accounts',
  'account',
  'account-history',
  'account-jobs',
  'connection',
  'connection-jobs',
  'integration',
  'integrations',
  'job',
  'jobs',
  'audit',
  'catalog',
  'backends',
  'connection-settings',
  'connection-status',
  'connection-panels',
  'connection-employees',
  'connection-rules',
  'connection-runs',
  'stats',
  'stats-accounts',
])
const backendKeys = [...affected].filter((key) => key !== 'catalog')
const pending = new Set(['accepted', 'pending', 'running'])

// An open page is eligible for automatic refresh only while visible and focused.
export function isActiveTab(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

// TanStack serializes requests per query. The callback also guards the short
// interval before visibility/focus events update its focus manager.
export function visibleInterval(milliseconds: number): number | false {
  return isActiveTab() ? milliseconds : false
}

export async function invalidateCommandQueries(client: QueryClient): Promise<void> {
  const inFlight = client.getQueryCache().findAll({
    predicate: (query) =>
      affected.has(String(query.queryKey[0])) && query.state.fetchStatus === 'fetching',
  })
  await client.invalidateQueries(
    {
      predicate: (query) => affected.has(String(query.queryKey[0])),
      refetchType: isActiveTab() ? 'active' : 'none',
    },
    { cancelRefetch: false },
  )
  // A read started before command completion can return an old snapshot. Wait
  // for that read, then make exactly one new read instead of overlapping it.
  if (isActiveTab() && inFlight.length) {
    await client.refetchQueries(
      { predicate: (query) => inFlight.includes(query), type: 'active' },
      { cancelRefetch: false },
    )
  }
}

const terminalSeen = new WeakMap<QueryClient, Set<string>>()
export function observeOperation(client: QueryClient, operation: AdminOperation): void {
  if (pending.has(operation.state)) return
  let seen = terminalSeen.get(client)
  if (!seen) {
    seen = new Set()
    terminalSeen.set(client, seen)
  }
  const signature = `${operation.id}:${operation.state}:${operation.updated_at}`
  if (seen.has(signature)) return
  seen.add(signature)
  if (seen.size > 1000) seen.delete(seen.values().next().value ?? '')
  void invalidateCommandQueries(client)
}

export function createQueryClient(): QueryClient {
  focusManager.setEventListener((handleFocus) => {
    const refresh = () => handleFocus(isActiveTab())
    const focus = () => {
      if (!isActiveTab()) return
      const wasFocused = focusManager.isFocused()
      handleFocus(true)
      if (wasFocused) handleFocus()
    }
    const blur = () => handleFocus(false)
    refresh()
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', refresh)
    }
  })
  const client = new QueryClient({
    queryCache: new QueryCache({
      onSuccess(data, query) {
        const key = query.queryKey[0]
        if (key !== 'admin-operation' && key !== 'admin-operations') return
        const response = data as { operation?: AdminOperation; items?: AdminOperation[] }
        for (const operation of response.operation
          ? [response.operation]
          : (response.items ?? [])) {
          observeOperation(client, operation)
        }
      },
    }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 10_000 } },
  })
  for (const key of [...backendKeys, 'admin-operation', 'admin-operations']) {
    client.setQueryDefaults([key], {
      refetchOnWindowFocus: 'always',
      refetchIntervalInBackground: false,
      refetchInterval: () =>
        visibleInterval(key === 'accounts' ? backendIntervals.list : backendIntervals.detail),
    })
  }
  return client
}
