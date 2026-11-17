import { apiFetch, apiFetchResponse } from '../src/api/client'
import { managerApi } from './session'

type InstallationId = string & { readonly __brand: 'InstallationId' }
type OperationId = string & { readonly __brand: 'OperationId' }
type AmoAccountId = string & { readonly __brand: 'AmoAccountId' }

export type Installation = {
  id: InstallationId
  account_id: string
  amo_account_id: AmoAccountId
  product_code: string
  product_name: string
  generation: number
  kind: string
  installed_at: string
  removed_at: string | null
  last_lifecycle_event: string
  lifecycle: string
  authorization: string
  activation_status: string
  review: { reviewed: boolean; reviewed_by?: string; reviewed_at?: string }
  access: {
    active: boolean
    source: string
    valid_until: string | null
    own_until: string | null
    computed_at: string
  }
  version: number
}

type InstallationPage = {
  items: Installation[]
  next_cursor: string | null
  snapshot_at: string
  summary: { total: number; reviewed: number; unreviewed: number }
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

function isUUID(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) && value !== nilUUID
}

function isInstallationId(value: unknown): value is InstallationId {
  return isUUID(value)
}

function isOperationId(value: unknown): value is OperationId {
  return isUUID(value)
}

function isAmoAccountId(value: unknown): value is AmoAccountId {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    (value.length < 19 || value <= '9223372036854775807')
  )
}

function invalidResponse(): never {
  throw new Error('invalid manager installation response')
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResponse()
  return { ...value }
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalidResponse()
  return value
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) {
    invalidResponse()
  }
  return value
}

function nullableDate(value: unknown): string | null {
  return value === null ? null : date(value)
}

function integer(value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) invalidResponse()
  return value
}

function parseInstallation(value: unknown): Installation {
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
    generation: integer(item.generation, 1),
    kind: string(item.kind),
    installed_at: date(item.installed_at),
    removed_at: nullableDate(item.removed_at),
    last_lifecycle_event: string(item.last_lifecycle_event),
    lifecycle: string(item.lifecycle),
    authorization: string(item.authorization),
    activation_status: string(item.activation_status),
    review: {
      reviewed: review.reviewed,
      reviewed_by: review.reviewed_by,
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

export async function listInstallations(
  search: string,
  signal: AbortSignal,
): Promise<InstallationPage> {
  const page = record(
    await apiFetch<unknown>(search ? installationsPath + '?' + search : installationsPath, {
      signal,
    }),
  )
  const summary = record(page.summary)
  if (!Array.isArray(page.items) || !Array.isArray(page.sources) || page.sources.length !== 1) {
    invalidResponse()
  }
  const source = record(page.sources[0])
  if (source.backend !== 'platform' || source.status !== 'available') invalidResponse()

  return {
    items: page.items.map(parseInstallation),
    next_cursor: page.next_cursor === null ? null : string(page.next_cursor),
    snapshot_at: date(page.snapshot_at),
    summary: {
      total: integer(summary.total, 0),
      reviewed: integer(summary.reviewed, 0),
      unreviewed: integer(summary.unreviewed, 0),
    },
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
