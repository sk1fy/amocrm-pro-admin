import { useParams, useRouter, useSearch } from '@tanstack/react-router'

export function useRouteSearch<T>(): T {
  return useSearch({ strict: false } as never) as T
}

export function useRouteParams<T extends Record<string, string>>(): T {
  return useParams({ strict: false } as never) as T
}

export function usePushSearch() {
  const router = useRouter()
  return (path: string, search: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
      if (value === undefined || value === '') {
        continue
      }
      params.set(key, String(value))
    }
    const query = params.toString()
    router.history.push(query === '' ? path : `${path}?${query}`)
  }
}
