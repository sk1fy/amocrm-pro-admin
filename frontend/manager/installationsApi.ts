import { apiFetch, apiFetchResponse } from '../src/api/client'
import { createRequestKey } from '../src/features/operations/intents'
import { managerApi } from './session'

type InstallationId = string & { readonly __brand: 'InstallationId' }
type OperationId = string & { readonly __brand: 'OperationId' }
type AmoAccountId = string & { readonly __brand: 'AmoAccountId' }

export type InstallationContact = {
  amo_user_id: string
  name: string
  phone: string
  email?: string
  role?: string
}

export type InstallationDeal = {
  state: string
  id?: string
  url?: string
  next_run_at?: string
  retry_version: number
  can_retry: boolean
}

export type Installation = {
  id: InstallationId
  account_id: string
  amo_account_id: AmoAccountId
  product_code: string
  product_name: string
  product_line?: string
  account_name?: string
  account_domain?: string
  account_classification?: string
  account_time_zone?: string
  generation: number
  kind: string
  installed_by?: string
  installed_at: string
  removed_at: string | null
  last_lifecycle_event: string
  lifecycle: string
  authorization: string
  activation_status: string
  contact?: InstallationContact
  deal?: InstallationDeal
  review: {
    reviewed: boolean
    reviewed_by?: string
    reviewed_by_name?: string
    reviewed_at?: string
  }
  access: {
    active: boolean
    source: string
    valid_until: string | null
    own_until: string | null
    computed_at: string
  }
  version: number
}

type InstallationSummary = { total: number; reviewed: number; unreviewed: number }

export type InstallationPage = {
  items: Installation[]
  next_cursor: string | null
  snapshot_at: string
  summary: InstallationSummary
  queue_counts?: InstallationSummary
  source: { backend: 'platform'; status: 'available'; observed_at: string }
}

export type ReviewCommand = Readonly<{
  installationId: InstallationId
  reviewed: boolean
  key: string
  version: number
}>

export type ReviewResult =
  | { kind: 'completed' }
  | { kind: 'pending'; operationId: OperationId; retryNotBefore?: number }

const installationsPath = managerApi + '/installations'
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const nilUUID = '00000000-0000-0000-0000-000000000000'

export function isUUID(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) && value !== nilUUID
}

function isInstallationId(value: unknown): value is InstallationId {
  return isUUID(value)
}

function isOperationId(value: unknown): value is OperationId {
  return isUUID(value)
}

export function isAmoAccountId(value: unknown): value is AmoAccountId {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    (value.length < 19 || value <= '9223372036854775807')
  )
}

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : string(value)
}

function invalidResponse(): never {
  throw new Error('invalid manager installation response')
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResponse()
  return { ...value }
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalidResponse()
  return value
}

export function date(value: unknown): string {
  if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) {
    invalidResponse()
  }
  return value
}

function nullableDate(value: unknown): string | null {
  return value === null ? null : date(value)
}

export function integer(value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) invalidResponse()
  return value
}

function parseContact(value: unknown): InstallationContact | undefined {
  if (value === undefined) return undefined
  const contact = record(value)
  const phone = string(contact.phone)
  if (!isAmoAccountId(contact.amo_user_id) || !/^\+[1-9][0-9]{7,14}$/.test(phone)) invalidResponse()
  return {
    amo_user_id: contact.amo_user_id,
    name: string(contact.name),
    phone,
    email: optionalString(contact.email),
    role: optionalString(contact.role),
  }
}

function parseDeal(value: unknown): InstallationDeal | undefined {
  if (value === undefined) return undefined
  const deal = record(value)
  const url = optionalString(deal.url)
  const id = optionalString(deal.id)
  if (url) {
    const target = new URL(url)
    if (
      !isAmoAccountId(id) ||
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.port ||
      target.search ||
      target.hash ||
      !/\.(amocrm\.(ru|com)|kommo\.com)$/.test(target.hostname) ||
      target.pathname !== '/leads/detail/' + id
    )
      invalidResponse()
  }
  if (typeof deal.can_retry !== 'boolean') invalidResponse()
  return {
    state: string(deal.state),
    id,
    url,
    next_run_at: deal.next_run_at === undefined ? undefined : date(deal.next_run_at),
    retry_version: integer(deal.retry_version, 1),
    can_retry: deal.can_retry,
  }
}

export function retryInstallationDeal(installation: InstallationId, version: number) {
  return apiFetch<void>(installationsPath + '/' + installation + '/crm-deal/retry', {
    method: 'POST',
    headers: { 'If-Match': '"' + version + '"', 'Idempotency-Key': createRequestKey() },
    body: JSON.stringify({ reason: 'Повтор из очереди установок' }),
  })
}

export function parseInstallation(value: unknown): Installation {
  const item = record(value)
  const review = record(item.review)
  const access = record(item.access)
  if (
    !isInstallationId(item.id) ||
    !isUUID(item.account_id) ||
    !isAmoAccountId(item.amo_account_id) ||
    typeof review.reviewed !== 'boolean' ||
    typeof access.active !== 'boolean' ||
    (review.reviewed_by !== undefined && !isUUID(review.reviewed_by))
  ) {
    invalidResponse()
  }
  return {
    id: item.id,
    account_id: item.account_id,
    amo_account_id: item.amo_account_id,
    product_code: string(item.product_code),
    product_name: string(item.product_name),
    product_line: optionalString(item.product_line),
    account_name: optionalString(item.account_name),
    account_domain: optionalString(item.account_domain),
    account_classification: optionalString(item.account_classification),
    account_time_zone: optionalString(item.account_time_zone),
    generation: integer(item.generation, item.kind === 'observed' ? 0 : 1),
    kind: string(item.kind),
    installed_by: optionalString(item.installed_by),
    installed_at: date(item.installed_at),
    removed_at: nullableDate(item.removed_at),
    last_lifecycle_event: string(item.last_lifecycle_event),
    lifecycle: string(item.lifecycle),
    authorization: string(item.authorization),
    activation_status: string(item.activation_status),
    contact: parseContact(item.contact),
    deal: parseDeal(item.deal),
    review: {
      reviewed: review.reviewed,
      reviewed_by: review.reviewed_by,
      reviewed_by_name: optionalString(review.reviewed_by_name),
      reviewed_at: review.reviewed_at === undefined ? undefined : date(review.reviewed_at),
    },
    access: {
      active: access.active,
      source: string(access.source),
      valid_until: nullableDate(access.valid_until),
      own_until: nullableDate(access.own_until),
      computed_at: date(access.computed_at),
    },
    version: integer(item.version, 1),
  }
}

function parseSummary(value: unknown): InstallationSummary {
  const summary = record(value)
  return {
    total: integer(summary.total, 0),
    reviewed: integer(summary.reviewed, 0),
    unreviewed: integer(summary.unreviewed, 0),
  }
}

export async function listInstallations(
  search: string,
  signal: AbortSignal,
): Promise<InstallationPage> {
  const page = record(
    await apiFetch<unknown>(search ? installationsPath + '?' + search : installationsPath, {
      signal,
    }),
  )
  if (!Array.isArray(page.items) || !Array.isArray(page.sources) || page.sources.length !== 1) {
    invalidResponse()
  }
  const source = record(page.sources[0])
  if (source.backend !== 'platform' || source.status !== 'available') invalidResponse()

  return {
    items: page.items.map(parseInstallation),
    next_cursor: page.next_cursor === null ? null : string(page.next_cursor),
    snapshot_at: date(page.snapshot_at),
    summary: parseSummary(page.summary),
    queue_counts: page.queue_counts === undefined ? undefined : parseSummary(page.queue_counts),
    source: {
      backend: source.backend,
      status: source.status,
      observed_at: date(source.observed_at),
    },
  }
}

export async function submitReview(
  command: ReviewCommand,
  signal: AbortSignal,
): Promise<ReviewResult> {
  const { data, status, retryNotBefore } = await apiFetchResponse<unknown>(
    installationsPath + '/' + command.installationId + '/review',
    {
      signal,
      method: 'PUT',
      headers: { 'Idempotency-Key': command.key, 'If-Match': '"' + command.version + '"' },
      body: JSON.stringify({ reviewed: command.reviewed }),
    },
  )
  const result = record(data)
  if (status === 202 && result.state === 'unknown_outcome' && isOperationId(result.id)) {
    return { kind: 'pending', operationId: result.id, retryNotBefore }
  }
  if (status !== 200) invalidResponse()
  const installation = parseInstallation(result)
  if (
    installation.id !== command.installationId ||
    installation.review.reviewed !== command.reviewed
  ) {
    invalidResponse()
  }
  return { kind: 'completed' }
}

export async function getReviewReceipt(
  id: OperationId,
  signal: AbortSignal,
): Promise<'completed' | 'rejected' | 'unknown_outcome'> {
  const result = record(await apiFetch<unknown>(managerApi + '/operations/' + id, { signal }))
  if (result.id !== id) invalidResponse()
  switch (result.state) {
    case 'completed':
    case 'rejected':
    case 'unknown_outcome':
      return result.state
    default:
      return invalidResponse()
  }
}
