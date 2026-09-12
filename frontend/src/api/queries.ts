import { apiGet, apiSend, queryString } from './client'
import type {
  AccountCard,
  AccountListItem,
  AdminAudit,
  BackendsResponse,
  Catalog,
  ConnectionCard,
  Employee,
  HistoryItem,
  Integration,
  Job,
  JobDetail,
  ListResponse,
  Me,
  Session,
  SourcedList,
} from './types'

export const keys = {
  me: ['me'] as const,
  accounts: (params: Record<string, string | number | undefined>) => ['accounts', params] as const,
  account: (id: string) => ['account', id] as const,
  accountHistory: (id: string, params: Record<string, string | number | undefined>) =>
    ['account-history', id, params] as const,
  connection: (backend: string, id: string) => ['connection', backend, id] as const,
  connectionJobs: (
    backend: string,
    id: string,
    params: Record<string, string | number | undefined>,
  ) => ['connection-jobs', backend, id, params] as const,
  integrations: (params: Record<string, string | number | undefined>) =>
    ['integrations', params] as const,
  integration: (backend: string, id: string) => ['integration', backend, id] as const,
  jobs: (params: Record<string, string | number | undefined>) => ['jobs', params] as const,
  job: (backend: string, id: string) => ['job', backend, id] as const,
  backends: ['backends'] as const,
  catalog: ['catalog'] as const,
  employees: ['employees'] as const,
  sessions: ['sessions'] as const,
  audit: (params: Record<string, string | number | undefined>) => ['audit', params] as const,
}

export function fetchMe(): Promise<Me> {
  return apiGet<Me>('/api/v1/me')
}

export function login(email: string, password: string): Promise<Me> {
  return apiSend<Me>('/api/v1/auth/login', 'POST', { email, password })
}

export function logout(): Promise<{ ok: boolean }> {
  return apiSend<{ ok: boolean }>('/api/v1/auth/logout', 'POST')
}

export function fetchAccounts(
  params: Record<string, string | number | undefined>,
): Promise<SourcedList<AccountListItem>> {
  return apiGet(`/api/v1/accounts${queryString(params)}`)
}

export function fetchAccount(id: string): Promise<AccountCard> {
  return apiGet(`/api/v1/accounts/${encodeURIComponent(id)}`)
}

export function fetchAccountHistory(
  id: string,
  params: Record<string, string | number | undefined>,
): Promise<SourcedList<HistoryItem>> {
  return apiGet(`/api/v1/accounts/${encodeURIComponent(id)}/history${queryString(params)}`)
}

export function fetchConnection(backend: string, id: string): Promise<ConnectionCard> {
  return apiGet(`/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}`)
}

export function fetchConnectionJobs(
  backend: string,
  id: string,
  params: Record<string, string | number | undefined>,
): Promise<SourcedList<Job>> {
  return apiGet(
    `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/jobs${queryString(params)}`,
  )
}

export function fetchIntegrations(
  params: Record<string, string | number | undefined>,
): Promise<SourcedList<Integration>> {
  return apiGet(`/api/v1/integrations${queryString(params)}`)
}

export function fetchIntegration(
  backend: string,
  id: string,
): Promise<{
  source: string
  observed_at: string
  freshness: string
  error?: { code: string; message: string } | null
  data?: Integration | null
}> {
  return apiGet(`/api/v1/integrations/${encodeURIComponent(backend)}/${encodeURIComponent(id)}`)
}

export function fetchJobs(
  params: Record<string, string | number | undefined>,
): Promise<SourcedList<Job>> {
  return apiGet(`/api/v1/operations/jobs${queryString(params)}`)
}

export function fetchJob(
  backend: string,
  id: string,
): Promise<{
  source: string
  observed_at: string
  freshness: string
  data?: JobDetail | null
}> {
  return apiGet(`/api/v1/operations/jobs/${encodeURIComponent(backend)}/${encodeURIComponent(id)}`)
}

export function fetchBackends(): Promise<BackendsResponse> {
  return apiGet('/api/v1/system/backends')
}

export function fetchCatalog(): Promise<Catalog> {
  return apiGet('/api/v1/catalog')
}

export function fetchEmployees(): Promise<ListResponse<Employee>> {
  return apiGet('/api/v1/system/employees')
}

export function fetchSessions(): Promise<ListResponse<Session>> {
  return apiGet('/api/v1/me/sessions')
}

export function revokeSession(id: string): Promise<{ ok: boolean }> {
  return apiSend(`/api/v1/me/sessions/${encodeURIComponent(id)}`, 'DELETE')
}

export function fetchAudit(
  params: Record<string, string | number | undefined>,
): Promise<ListResponse<AdminAudit>> {
  return apiGet(`/api/v1/system/audit${queryString(params)}`)
}
