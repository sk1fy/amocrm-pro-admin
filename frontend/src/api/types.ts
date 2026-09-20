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

export type Verification = {
  classification: string
  observed_at?: string | null
  freshness: string
  fresh_for_seconds: number
  retry_after?: number
  raw?: string
}
export type AccountConnection = {
  authorization_check?: Verification | null
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
  confirmed_destinations?: number | null
}

export type AccountConnectionCard = {
  authorization_check?: Verification | null
  backend: string
  connection_id: string
  integration_code: string
  state: string
  raw?: string
  account_domain?: string
  origin?: string
  authorization?: Partial<Authorization> & Pick<Authorization, 'state' | 'unverified'>
  webhook?: Partial<Webhook> & Pick<Webhook, 'status'>
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

export type Subscription = {
  plan: string
  state: string
  raw?: string
  expires_at: string | null
  capabilities: string[]
}

export type SubscriptionResponse = {
  items: Observation<Subscription>[]
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
  retry_allowed?: boolean
  retry_reason?: string
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
  retry_allowed?: boolean
  retry_reason?: string
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

export type AccountJob = Job & { backend: string }

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

export type ActivitySync = {
  state: string
  raw?: string
  verification?: string
  enabled?: boolean | null
  verified_from?: string | null
  verified_through?: string | null
  last_success_at?: string | null
  last_event_at?: string | null
  lag_seconds?: number | null
  error_code?: string
  reauth_required: boolean
}

export type ActivitySettings = {
  initial_days: number
  retention_days: number
  updated_at?: string | null
}

export type ActivityPanel = {
  id: string
  name: string
  employee_ids: number[]
  display_window: { from: string; to: string }
  timezone: string
  enabled: boolean
  revision: number
  updated_at: string
  share_url_issued: boolean
}

export type ActivityEmployee = {
  id: number
  name: string
  group_id: number
  group_name: string
}

export type LeadStatusRule = {
  id: string
  source_pipeline_id: number
  source_status_id: number
  target_pipeline_id: number
  target_status_id: number
  enabled: boolean
  revision: number
  updated_at: string
}

export type LeadStatusRun = {
  id: string
  status: string
  raw?: string
  workflow_type: string
  skip_reason?: string
  error_reason?: string
  effect_state?: string
  created_at: string
  finished_at?: string | null
}

export type StatsSnapshot = {
  verification?: { unverified: number; temporary_errors: number; verified: number } | null
  period: string
  period_start: string
  period_end: string
  connections: Array<{ product: string; status: string; count: number }>
  connected?: number | null
  disconnected?: number | null
  active_accounts?: number | null
  last_use_at?: string | null
  job_errors?: number | null
  latency_p50_ms?: number | null
  queues: Array<{ type: string; status: string; count: number }>
  auth_problems?: number | null
  sync_problems?: number | null
}

export type StatsAccount = {
  account_id: string
  domain: string
  backend: string
  installation_id: string
  integration_code: string
  reason: string
}

export type SavedView = {
  id: string
  owner_employee_id?: string | null
  section: 'accounts' | 'operations' | 'stats'
  name: string
  params: Record<string, unknown>
  columns: string[]
  created_at: string
  updated_at: string
  shared: boolean
}

export type ConnectionCard = {
  backend: string
  connection: Observation<ConnectionIdentity>
  authorization: Observation<Authorization>
  webhook: Observation<Webhook>
  grants: Observation<Grant[]>
  activity: Observation<unknown>
  activity_sync: Observation<ActivitySync>
  recent_jobs: Observation<Job[]>
  recent_audit: Observation<CoreAudit[]>
  authorization_check?: Observation<ConnectionCheck>
}

export type ConnectionCheck = {
  classification: string
  observed_at?: string
  retry_after?: number
}

export type AdminOperation = {
  id: string
  employee_id: string
  backend: string
  target_type: string
  target_id: string
  command: string
  state: string
  outcome?: string | null
  result: Record<string, unknown>
  error?: ObsError | null
  created_at: string
  updated_at: string
  finished_at?: string | null
  observed_at?: string | null
}

export type OperationResponse = { operation: AdminOperation }

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

export type BackendRegistryEntry = {
  backend: string
  kind: string
  display_name: string
  products: CatalogProduct[]
  status: string
  contract_version: string
  revision: string
  adapter_capabilities: string[]
  backend_capabilities: string[]
  components?: unknown
  observed_at: string | null
  checked_at: string
  error?: ObsError | null
}

export type BackendsResponse = {
  items: BackendRegistryEntry[]
  observability: {
    grafana_base_url?: string
    loki_base_url?: string
  }
}

export type StatsResponse = {
  items: Observation<StatsSnapshot>[]
  period: string
}

export type ListResponse<T> = {
  items: T[]
  next_cursor?: string | null
  total?: number | null
}
