import { apiFetchResponse } from '../src/api/client'
import { date, integer, isAmoAccountId, isUUID, record } from './installationsApi'
import { managerApi } from './session'

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
  const item = object(raw, ['version', 'configuration'])
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
  return { version, configuration }
}
export type CompanyWorkflow = ReturnType<typeof parseCompanyWorkflow>
export type WorkflowCommand = Readonly<{
  kind: 'company-workflow'
  key: string
  version: number
  body: string
}>
export async function getWorkflowMetadata(signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(managerApi + '/company-workflow-metadata', {
    signal,
  })
  return parseWorkflowMetadata(response.data)
}
const workflowPath = managerApi + '/installation-deal-settings'

export async function getCompanyWorkflow(signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(workflowPath, { signal }),
    workflow = parseCompanyWorkflow(response.data)
  if (response.etag !== '"' + workflow.version + '"') invalid()
  return workflow
}
export async function sendWorkflowCommand(command: WorkflowCommand, signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(workflowPath, {
    signal,
    method: 'PUT',
    headers: { 'Idempotency-Key': command.key, 'If-Match': '"' + command.version + '"' },
    body: command.body,
  })
  if (response.status === 202) return { kind: 'receipt' as const, response }
  const workflow = parseCompanyWorkflow(response.data)
  if (
    response.status !== 200 ||
    workflow.version !== command.version + 1 ||
    response.etag !== '"' + workflow.version + '"'
  )
    invalid()
  return { kind: 'workflow-saved' as const, workflow }
}
