import { apiFetch, apiGet, apiSend, queryString } from './client'
import type {
  AccountCard,
  AccountListItem,
  AccountJob,
  AdminAudit,
  AdminOperation,
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
  Observation,
  OperationResponse,
  Session,
  SavedView,
  SourcedList,
  StatsAccount,
  StatsResponse,
  SubscriptionResponse,
  ActivityEmployee,
  ActivityPanel,
  ActivitySettings,
  ActivitySync,
  LeadStatusRule,
  LeadStatusRun,
} from './types'

export const keys = {
  me: ['me'] as const,
  accounts: (params: Record<string, string | number | undefined>) => ['accounts', params] as const,
  account: (id: string) => ['account', id] as const,
  accountHistory: (id: string, params: Record<string, string | number | undefined>) =>
    ['account-history', id, params] as const,
  accountJobs: (id: string, params: Record<string, string | number | undefined>) =>
    ['account-jobs', id, params] as const,
  subscription: (accountId: string) => ['account-subscription', accountId] as const,
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
  adminOperations: (params: Record<string, string | number | undefined>) =>
    ['admin-operations', params] as const,
  adminOperation: (id: string) => ['admin-operation', id] as const,
  activitySettings: (backend: string, id: string) => ['connection-settings', backend, id] as const,
  activityStatus: (backend: string, id: string) => ['connection-status', backend, id] as const,
  activityPanels: (backend: string, id: string) => ['connection-panels', backend, id] as const,
  activityEmployees: (backend: string, id: string) =>
    ['connection-employees', backend, id] as const,
  leadStatusRules: (backend: string, id: string) => ['connection-rules', backend, id] as const,
  leadStatusRuns: (backend: string, id: string) => ['connection-runs', backend, id] as const,
  stats: (period: string) => ['stats', period] as const,
  statsAccounts: (params: Record<string, string | number | undefined>) =>
    ['stats-accounts', params] as const,
  views: (section: string) => ['views', section] as const,
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

export function fetchAccountJobs(
  id: string,
  params: Record<string, string | number | undefined>,
): Promise<SourcedList<AccountJob>> {
  return apiGet(`/api/v1/accounts/${encodeURIComponent(id)}/jobs${queryString(params)}`)
}

export function fetchSubscription(accountId: string): Promise<SubscriptionResponse> {
  return apiGet(`/api/v1/accounts/${encodeURIComponent(accountId)}/subscription`)
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

export function fetchJob(backend: string, id: string): Promise<Observation<JobDetail>> {
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

export function sendCommand(
  path: string,
  payload: Record<string, unknown>,
  key: string,
): Promise<OperationResponse> {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(payload),
  })
}

export function fetchAdminOperation(id: string): Promise<OperationResponse> {
  return apiGet(`/api/v1/operations/admin/${encodeURIComponent(id)}`)
}

export function fetchAdminOperations(
  params: Record<string, string | number | undefined>,
): Promise<ListResponse<AdminOperation>> {
  return apiGet(`/api/v1/operations/admin${queryString(params)}`)
}

export function fetchActivitySettings(
  backend: string,
  id: string,
): Promise<Observation<ActivitySettings>> {
  return apiGet(
    `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/activity/settings`,
  )
}

export function fetchActivityStatus(
  backend: string,
  id: string,
): Promise<Observation<ActivitySync>> {
  return apiGet(
    `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/activity/status`,
  )
}

export function fetchActivityPanels(
  backend: string,
  id: string,
): Promise<Observation<ActivityPanel[]>> {
  return apiGet(
    `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/activity/panels`,
  )
}

export function fetchActivityEmployees(
  backend: string,
  id: string,
): Promise<Observation<ActivityEmployee[]>> {
  return apiGet(
    `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/activity/employees`,
  )
}

export function fetchLeadStatusRules(
  backend: string,
  id: string,
): Promise<Observation<LeadStatusRule[]>> {
  return apiGet(
    `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/lead-status/rules`,
  )
}

export function fetchLeadStatusRuns(
  backend: string,
  id: string,
): Promise<Observation<{ items: LeadStatusRun[]; next_cursor?: string | null }>> {
  return apiGet(
    `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/lead-status/runs`,
  )
}

export function fetchStats(period: string): Promise<StatsResponse> {
  return apiGet(`/api/v1/stats${queryString({ period })}`)
}

export function fetchStatsAccounts(
  params: Record<string, string | number | undefined>,
): Promise<SourcedList<StatsAccount>> {
  return apiGet(`/api/v1/stats/accounts${queryString(params)}`)
}

export function fetchViews(section: string): Promise<ListResponse<SavedView>> {
  return apiGet(`/api/v1/views${queryString({ section })}`)
}

export function createView(body: {
  section: string
  name: string
  params: Record<string, unknown>
  columns: string[]
  shared?: boolean
}): Promise<SavedView> {
  return apiSend('/api/v1/views', 'POST', body)
}

export function patchView(
  id: string,
  body: {
    name?: string
    params?: Record<string, unknown>
    columns?: string[]
  },
): Promise<SavedView> {
  return apiSend(`/api/v1/views/${encodeURIComponent(id)}`, 'PATCH', body)
}

export function deleteView(id: string): Promise<{ ok: boolean }> {
  return apiSend(`/api/v1/views/${encodeURIComponent(id)}`, 'DELETE')
}
