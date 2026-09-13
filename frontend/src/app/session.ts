import type { QueryClient } from '@tanstack/react-query'
import { resetApiSession } from '../api/client'

export function clearSession(queryClient: QueryClient): void {
  resetApiSession()
  queryClient.clear()
}
