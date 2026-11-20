import { apiFetchResponse } from '../src/api/client'
import { date, integer, isUUID, record } from './installationsApi'
import { managerApi } from './session'

function invalid(): never {
  throw new Error('invalid manager product response')
}
function text(value: unknown): string {
  if (typeof value !== 'string') invalid()
  return value
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) invalid()
  return value.map(parse)
}
export type ProductId = string & { readonly __brand: 'ProductId' }
export function isProductId(value: unknown): value is ProductId {
  return isUUID(value)
}
export function parseProduct(raw: unknown) {
  const item = record(raw)
  if (!isProductId(item.id)) invalid()
  const line = item.line
  const availability = item.availability
  if (line !== 'FREE' && line !== 'TOP' && line !== 'PRO') invalid()
  if (
    availability !== 'draft' &&
    availability !== 'pilot' &&
    availability !== 'active' &&
    availability !== 'archived'
  )
    invalid()
  const trial = record(item.trial_policy)
  const kind = trial.kind
  if (kind !== 'none' && kind !== 'free' && kind !== 'once') invalid()
  return {
    id: item.id,
    code: text(item.code),
    display_name: text(item.display_name),
    line,
    availability,
    integration_refs: array(item.integration_refs, (value) => {
      if (!isUUID(value)) invalid()
      return value
    }),
    tariff_version: item.tariff_version === null ? null : integer(item.tariff_version, 1),
    trial_policy: {
      kind,
      duration_days: trial.duration_days === null ? null : integer(trial.duration_days, 0),
    },
    links: array(item.links, (value) => {
      const link = record(value)
      const url = text(link.url)
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
        invalid()
      return { label: text(link.label), url }
    }),
    version: integer(item.version, 1),
  }
}
export type Product = ReturnType<typeof parseProduct>

function parseProductOverview(raw: unknown) {
  const value = record(raw)
  const summary = record(value.summary)
  const lines = record(summary.by_line)
  return {
    summary: {
      total: integer(summary.total, 0),
      by_line: {
        FREE: integer(lines.FREE, 0),
        TOP: integer(lines.TOP, 0),
        PRO: integer(lines.PRO, 0),
      },
      installations: integer(summary.installations, 0),
      current: integer(summary.current, 0),
      recent: integer(summary.recent, 0),
      activation_eligible: integer(summary.activation_eligible, 0),
      activated: integer(summary.activated, 0),
      attention: integer(summary.attention, 0),
      connection_count: integer(summary.connection_count, 0),
    },
    statistics: Object.fromEntries(
      Object.entries(record(value.statistics)).map(([id, rawStats]) => {
        const stats = record(rawStats)
        const months = array(stats.months, (rawMonth) => {
          const month = record(rawMonth)
          const key = text(month.month)
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) invalid()
          return { month: key, count: integer(month.count, 0) }
        })
        if (
          !isProductId(id) ||
          months.length !== 12 ||
          typeof stats.missing_install_link !== 'boolean' ||
          typeof stats.missing_instruction !== 'boolean'
        )
          invalid()
        return [
          id,
          {
            months,
            installations: integer(stats.installations, 0),
            current: integer(stats.current, 0),
            retained: integer(stats.retained, 0),
            recent: integer(stats.recent, 0),
            activation_eligible: integer(stats.activation_eligible, 0),
            activated: integer(stats.activated, 0),
            connection_count: integer(stats.connection_count, 0),
            missing_install_link: stats.missing_install_link,
            missing_instruction: stats.missing_instruction,
          },
        ] as const
      }),
    ),
    connections: array(value.connections, (rawConnection) => {
      const row = record(rawConnection)
      const { installation_id, product_id, account_id, line } = row
      if (
        !isUUID(installation_id) ||
        !isProductId(product_id) ||
        !isUUID(account_id) ||
        (line !== 'FREE' && line !== 'TOP' && line !== 'PRO')
      )
        invalid()
      return {
        installation_id,
        product_id,
        account_id,
        line,
        name: text(row.name),
        amo_account_id: text(row.amo_account_id),
        account_name: row.account_name === null ? null : text(row.account_name),
        account_domain: row.account_domain === null ? null : text(row.account_domain),
        since: row.since === null ? null : date(row.since),
      }
    }),
  }
}
export type ProductOverview = ReturnType<typeof parseProductOverview>
export type ProductCommand =
  | Readonly<{ kind: 'product-create'; code: string; key: string; body: string }>
  | Readonly<{
      kind: 'product-update'
      product: ProductId
      key: string
      body: string
      version: number
    }>
export const productsPath = managerApi + '/products'
export async function listProducts(search: string, signal: AbortSignal) {
  const { data } = await apiFetchResponse<unknown>(productsPath + (search ? '?' + search : ''), {
    signal,
  })
  const page = record(data)
  return {
    items: array(page.items, parseProduct),
    next_cursor: page.next_cursor === null ? null : text(page.next_cursor),
    snapshot_at: date(page.snapshot_at),
    query_hash: text(page.query_hash),
    overview: page.overview === undefined ? undefined : parseProductOverview(page.overview),
  }
}
export async function getProduct(id: ProductId, signal: AbortSignal) {
  const { data, etag } = await apiFetchResponse<unknown>(productsPath + '/' + id, { signal })
  const product = parseProduct(data)
  if (product.id !== id || etag !== '"' + product.version + '"') invalid()
  return product
}
export async function getProductMetrics(id: ProductId, search: string, signal: AbortSignal) {
  const { data } = await apiFetchResponse<unknown>(
    productsPath + '/' + id + '/metrics' + (search ? '?' + search : ''),
    { signal },
  )
  const item = record(data)
  return {
    confirmed_installations: integer(item.confirmed_installations, 0),
    activations: integer(item.activations, 0),
    active_accesses: integer(item.active_accesses, 0),
    snapshot_at: date(item.snapshot_at),
  }
}
type ProductResult =
  | { kind: 'receipt'; response: Awaited<ReturnType<typeof apiFetchResponse<unknown>>> }
  | { kind: 'completed'; product: Product }

export async function sendProductCommand(
  command: ProductCommand,
  signal: AbortSignal,
): Promise<ProductResult> {
  const headers = new Headers({ 'Idempotency-Key': command.key })
  if (command.kind === 'product-update') headers.set('If-Match', '"' + command.version + '"')
  const response = await apiFetchResponse<unknown>(
    productsPath + (command.kind === 'product-update' ? '/' + command.product : ''),
    {
      signal,
      headers,
      method: command.kind === 'product-create' ? 'POST' : 'PATCH',
      body: command.body,
    },
  )
  if (response.status === 202) return { kind: 'receipt', response }
  const product = parseProduct(response.data)
  if (
    command.kind === 'product-create'
      ? response.status !== 201 || product.code !== command.code
      : response.status !== 200 || product.id !== command.product
  )
    invalid()
  if (response.etag !== '"' + product.version + '"') invalid()
  return { kind: 'completed', product }
}
