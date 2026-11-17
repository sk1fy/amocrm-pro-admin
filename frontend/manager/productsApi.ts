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
