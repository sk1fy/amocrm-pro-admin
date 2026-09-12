export type ApiErrorBody = {
  error: {
    code: string
    message: string
    request_id: string
    details?: Record<string, unknown>
  }
}

export type SourceStatus = {
  backend: string
  status: string
  observed_at?: string | null
  error?: ObsError | null
}

export type ObsError = {
  code: string
  message: string
}

export type Observation<T> = {
  source: string
  observed_at: string
  freshness: string
  error?: ObsError | null
  data?: T | null
  raw?: string
}

export type SourcedList<T> = {
  items: T[]
  next_cursor?: string | null
  total?: number | null
  sources: SourceStatus[]
}

export type Me = {
  id: string
  email: string
  name: string
  role: string
  permissions: string[]
}

export type Session = {
  id: string
  created_at: string
  last_seen_at: string
  expires_at: string
  revoked_at?: string | null
  revoke_reason?: string | null
  ip?: string | null
  user_agent?: string | null
}

export type Employee = {
  id: string
  email: string
  name: string
  role: string
  status: string
  created_at: string
  updated_at: string
}

export type AdminAudit = {
  id: number
  employee_id?: string | null
  actor_email?: string | null
  action: string
  object_type?: string | null
  object_ref?: string | null
  outcome: string
  request_id?: string | null
  ip?: string | null
  metadata: unknown
  created_at: string
}

export type AccountConnection = {
  backend: string
  connection_id: string
  integration_id?: string
  integration_code: string
  state: string
  raw?: string
  recent_failed_jobs?: number
}

export type AccountListItem = {
  account_id: string
  domains: string[]
  state: string
  problems: string[]
  origin: string
  last_activity_at?: string | null
  connections: AccountConnection[]
}

export type Grant = {
  service: string
  state: string
  raw?: string
}

export type Authorization = {
  state: string
  raw?: string
  credentials_present: boolean
  expires_at?: string | null
  credential_version?: number
  refreshed_at?: string | null
  key_version?: number
  lease_active: boolean
  unverified: boolean
}

export type Webhook = {
  status: string
  raw?: string
  events: string[]
  checked_at?: string | null
  last_error?: string | null
  confirmed_destinations: number
}

export type AccountConnectionCard = {
  backend: string
  connection_id: string
  integration_code: string
  state: string
  raw?: string
  account_domain?: string
  origin?: string
  authorization?: Authorization
  webhook?: Webhook
  grants?: Grant[]
  activity?: { pilot?: string; pilot_raw?: string }
}

export type AccountCard = {
  account_id: string
  domains: string[]
  state: string
  problems: string[]
  origin: string
  last_activity_at?: string | null
  connections: Observation<AccountConnectionCard>[]
  sources: SourceStatus[]
}

export type ConnectionIdentity = {
  id: string
  integration_id: string
  integration_code: string
  account_id: string
  account_domain: string
  state: string
  raw?: string
  origin: string
  installed_by?: number | null
  created_at: string
  updated_at: string
}

export type Delivery = {
  command_id: string
  installation_id: string
  target: string
  action: string
  status: string
  raw?: string
  error_code?: string
  attempts: number
  max_attempts: number
  created_at: string
  updated_at: string
}

export type Job = {
  id: string
  installation_id?: string | null
  account_id?: string | null
  type: string
  actor_type?: string | null
  actor_id?: string | null
  resource_type?: string | null
  resource_id?: string | null
  status: string
  raw?: string
  priority: number
  attempts: number
  max_attempts: number
  run_after: string
  last_error_code?: string | null
  last_error_message?: string | null
  created_at: string
  updated_at: string
  finished_at?: string | null
}

export type JobAttempt = {
  id: number
  job_id: string
  attempt: number
  worker_id: string
  started_at: string
  finished_at?: string | null
  outcome: string
  raw?: string
  error_code?: string | null
  error_message?: string | null
  duration_ms?: number | null
}

export type JobDetail = {
  job: Job
  attempts: JobAttempt[]
}

export type CoreAudit = {
  id: number
  installation_id?: string | null
  actor_type: string
  actor_id?: string | null
  action: string
  object_type?: string | null
  object_id?: string | null
  metadata: unknown
  correlation_job_id?: string | null
  created_at: string
}

export type HistoryItem = {
  source: string
  backend?: string
  occurred_at: string
  action: string
  actor_type?: string | null
  actor_id?: string | null
  actor_email?: string | null
  object_type?: string | null
  object_id?: string | null
  object_ref?: string | null
  connection_id?: string | null
  outcome?: string | null
  metadata: unknown
}

export type ConnectionCard = {
  backend: string
  connection: Observation<ConnectionIdentity>
  authorization: Observation<Authorization>
  webhook: Observation<Webhook>
  grants: Observation<Grant[]>
  activity: Observation<unknown>
  activity_sync: Observation<unknown>
  recent_jobs: Observation<Job[]>
  recent_audit: Observation<CoreAudit[]>
}

export type Integration = {
  backend: string
  id: string
  code: string
  client_id: string
  redirect_uri: string
  state: string
  raw?: string
  webhook_events: string[]
  created_at: string
  updated_at: string
  key_version: number
  grants: Grant[]
  installations_by_status: Record<string, number>
}

export type CatalogProduct = {
  code: string
  display_name: string
}

export type CatalogBackend = {
  code: string
  kind: string
  display_name: string
  products: CatalogProduct[]
}

export type Catalog = {
  backends: CatalogBackend[]
  products: CatalogProduct[]
}

export type BackendHealth = {
  backend?: string
  revision?: string
  contract_version?: string
  capabilities?: string[]
  components?: unknown
}

export type BackendsResponse = {
  items: Observation<BackendHealth>[]
}

export type ListResponse<T> = {
  items: T[]
  next_cursor?: string | null
  total?: number | null
}
