import { apiFetchResponse } from '../src/api/client'
import { date, integer, isAmoAccountId, isUUID, record } from './installationsApi'
import { isAccountId } from './accountsApi'
import { isProductId, productsPath, type ProductId } from './productsApi'
import { managerApi } from './session'

export type CompanyProjectionId = string & { readonly __brand: 'CompanyProjectionId' }
export function isCompanyProjectionId(value: unknown): value is CompanyProjectionId {
  return isUUID(value)
}
function invalid(): never {
  throw new Error('invalid company workflow response')
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) invalid()
  return value
}
function crmId(value: unknown) {
  if (!isAmoAccountId(value)) invalid()
  return value
}
function uuid(value: unknown) {
  if (!isUUID(value)) invalid()
  return value
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value)
}
function array<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) invalid()
  return value.map(parse)
}
function object(value: unknown, fields: string[]) {
  const item = record(value)
  if (Object.keys(item).some((k) => !fields.includes(k)) || fields.some((k) => !(k in item)))
    invalid()
  return item
}
export function parseCompanySource(raw: unknown) {
  const item = object(raw, [
    'source_account_id',
    'binding_revision',
    'state',
    'complete',
    'observed_at',
    'fresh_until',
    'error_code',
    'retry_at',
  ])
  if (typeof item.complete !== 'boolean') invalid()
  const source = {
    source_account_id: nullable(item.source_account_id, crmId),
    binding_revision: nullable(item.binding_revision, text),
    state: text(item.state),
    complete: item.complete,
    observed_at: nullable(item.observed_at, date),
    fresh_until: nullable(item.fresh_until, date),
    error_code: nullable(item.error_code, text),
    retry_at: nullable(item.retry_at, date),
  }
  if (
    (source.source_account_id === null) !== (source.binding_revision === null) ||
    (source.observed_at === null) !== (source.fresh_until === null) ||
    (source.complete && (!source.observed_at || !source.source_account_id)) ||
    (source.state === 'fresh' && !source.complete)
  )
    invalid()
  return source
}
function parseSummary(raw: unknown) {
  const item = record(raw)
  if (!isCompanyProjectionId(item.id)) invalid()
  const claims = array(item.customer_account_ids, crmId)
  const links = array(item.runtime_accounts, (rawLink) => {
    const link = object(rawLink, ['account_id', 'customer_account_id'])
    if (!isAccountId(link.account_id)) invalid()
    const customer = crmId(link.customer_account_id)
    if (!claims.includes(customer)) invalid()
    return { account_id: link.account_id, customer_account_id: customer }
  })
  if (
    new Set(claims).size !== claims.length ||
    new Set(links.map((l) => l.account_id)).size !== links.length
  )
    invalid()
  return {
    id: item.id,
    crm_company_id: crmId(item.crm_company_id),
    name: text(item.name),
    customer_account_ids: claims,
    source_resolution: text(item.source_resolution),
    runtime_resolution: text(item.runtime_resolution),
    runtime_accounts: links,
  }
}
export type CompanySummary = ReturnType<typeof parseSummary>
function link(raw: unknown) {
  const item = object(raw, ['crm_company_id', 'company_id'])
  const id = item.company_id
  if (id !== null && !isCompanyProjectionId(id)) invalid()
  return { crm_company_id: crmId(item.crm_company_id), company_id: id }
}
export function parseCompanyList(raw: unknown) {
  const page = object(raw, ['items', 'next_cursor', 'source', 'sources', 'observation'])
  const source = parseCompanySource(page.source)
  const items = nullable(page.items, (v) => array(v, parseSummary))
  if ((items !== null) !== source.complete) invalid()
  return { items, next_cursor: nullable(page.next_cursor, text), source }
}
export function parseCompanyDetail(raw: unknown) {
  const item = object(raw, [
    'id',
    'crm_company_id',
    'name',
    'customer_account_ids',
    'source_resolution',
    'runtime_resolution',
    'runtime_accounts',
    'source',
    'contacts',
    'unresolved_relations',
    'sources',
    'observation',
  ])
  return {
    ...parseSummary(item),
    source: parseCompanySource(item.source),
    contacts: array(item.contacts, (rawContact) => {
      const contact = object(rawContact, ['id', 'name', 'companies'])
      return {
        id: crmId(contact.id),
        name: text(contact.name),
        companies: array(contact.companies, link),
      }
    }),
    unresolved_relations: array(item.unresolved_relations, link),
  }
}
export function parseWorkflowMetadata(raw: unknown) {
  const item = object(raw, [
    'generation_id',
    'source',
    'pipelines',
    'required_fields_state',
    'write_ready',
    'sources',
    'observation',
  ])
  if (item.write_ready !== false || item.required_fields_state !== 'unknown') invalid()
  const source = parseCompanySource(item.source),
    generation_id = nullable(item.generation_id, uuid)
  const pipelines = nullable(item.pipelines, (value) =>
    array(value, (rawPipeline) => {
      const p = object(rawPipeline, ['id', 'name', 'stages'])
      return {
        id: crmId(p.id),
        name: text(p.name),
        stages: array(p.stages, (rawStage) => {
          const s = object(rawStage, ['id', 'name'])
          return { id: crmId(s.id), name: text(s.name) }
        }),
      }
    }),
  )
  if ((pipelines === null) !== (generation_id === null) || (pipelines !== null) !== source.complete)
    invalid()
  return { generation_id, source, pipelines }
}
export function parseCompanyWorkflow(raw: unknown) {
  const item = object(raw, ['product_id', 'version', 'configuration', 'write_ready'])
  if (!isProductId(item.product_id) || item.write_ready !== false) invalid()
  const version = integer(item.version, 1)
  const configuration = nullable(item.configuration, (value) => {
    const c = object(value, [
      'revision',
      'source_account_id',
      'binding_revision',
      'metadata_generation_id',
      'pipeline_id',
      'initial_stage_id',
      'validated_at',
    ])
    const revision = integer(c.revision, 1)
    if (revision !== version - 1) invalid()
    return {
      revision,
      source_account_id: crmId(c.source_account_id),
      binding_revision: text(c.binding_revision),
      metadata_generation_id: uuid(c.metadata_generation_id),
      pipeline_id: crmId(c.pipeline_id),
      initial_stage_id: crmId(c.initial_stage_id),
      validated_at: date(c.validated_at),
    }
  })
  if ((configuration === null) !== (version === 1)) invalid()
  return { product_id: item.product_id, version, configuration }
}
export type CompanyWorkflow = ReturnType<typeof parseCompanyWorkflow>
export type WorkflowCommand = Readonly<{
  kind: 'company-workflow'
  product: ProductId
  key: string
  version: number
  body: string
}>
export async function listCompanies(query: string, signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(
    managerApi + '/companies' + (query ? '?' + query : ''),
    { signal },
  )
  return parseCompanyList(response.data)
}
export async function getCompany(id: CompanyProjectionId, signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(managerApi + '/companies/' + id, { signal })
  const company = parseCompanyDetail(response.data)
  if (company.id !== id) invalid()
  return company
}
export async function getWorkflowMetadata(signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(managerApi + '/company-workflow-metadata', {
    signal,
  })
  return parseWorkflowMetadata(response.data)
}
function workflowPath(id: ProductId) {
  return productsPath + '/' + id + '/company-workflow'
}
export async function getCompanyWorkflow(id: ProductId, signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(workflowPath(id), { signal }),
    workflow = parseCompanyWorkflow(response.data)
  if (workflow.product_id !== id || response.etag !== '"' + workflow.version + '"') invalid()
  return workflow
}
export async function sendWorkflowCommand(command: WorkflowCommand, signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(workflowPath(command.product), {
    signal,
    method: 'PUT',
    headers: { 'Idempotency-Key': command.key, 'If-Match': '"' + command.version + '"' },
    body: command.body,
  })
  if (response.status === 202) return { kind: 'receipt' as const, response }
  const workflow = parseCompanyWorkflow(response.data)
  if (
    response.status !== 200 ||
    workflow.product_id !== command.product ||
    workflow.version !== command.version + 1 ||
    response.etag !== '"' + workflow.version + '"'
  )
    invalid()
  return { kind: 'workflow-saved' as const, workflow }
}
