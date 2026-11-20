import { apiFetchResponse } from '../src/api/client'
import { record, integer, date, isUUID } from './installationsApi'
import { assertETag, versionETag } from './accountsApi'
import { managerApi } from './session'

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid staff response')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('invalid staff grants')
  return value.map(text)
}
function uuid(value: unknown): string {
  if (!isUUID(value)) throw new Error('invalid staff uuid')
  return value
}
function status(value: unknown) {
  if (value !== 'active' && value !== 'invited' && value !== 'revoked' && value !== 'disabled')
    throw new Error('invalid staff status')
  return value
}
export function parseStaff(value: unknown) {
  const item = record(value)
  if (!isUUID(item.id)) throw new Error('invalid staff id')
  return {
    id: item.id,
    email: text(item.email),
    name: text(item.name),
    status: status(item.status),
    grants: strings(item.grants),
    version: integer(item.version, 1),
    changed_at: date(item.changed_at),
    changed_by: item.changed_by === null ? null : uuid(item.changed_by),
  }
}
export type Staff = ReturnType<typeof parseStaff>
const base = managerApi + '/staff'
export async function listStaff(search: string, signal: AbortSignal) {
  const { data } = await apiFetchResponse<unknown>(base + '?' + search, { signal })
  const page = record(data)
  if (!Array.isArray(page.items)) throw new Error('invalid staff list')
  return {
    items: page.items.map(parseStaff),
    next_cursor: page.next_cursor === null ? null : text(page.next_cursor),
  }
}
export async function getStaff(id: string, signal: AbortSignal) {
  const response = await apiFetchResponse<unknown>(base + '/' + encodeURIComponent(id), { signal })
  const staff = parseStaff(response.data)
  if (staff.id !== id) throw new Error('invalid staff detail')
  assertETag(response.etag, staff.version)
  return staff
}
export async function grantCatalog(signal: AbortSignal) {
  const { data } = await apiFetchResponse<unknown>(base + '/grants', { signal })
  const catalog = record(data)
  return strings(catalog.items)
}
export type StaffCommand = Readonly<{
  path: string
  method: 'POST' | 'PATCH'
  body: string
  key: string
  version?: number
}>
export async function sendStaffCommand(command: StaffCommand) {
  const headers = new Headers({ 'Idempotency-Key': command.key })
  if (command.version !== undefined) headers.set('If-Match', versionETag(command.version))
  const { data } = await apiFetchResponse<unknown>(base + command.path, {
    method: command.method,
    headers,
    body: command.body,
  })
  const result = record(data)
  const staff = parseStaff(result.staff)
  if (typeof result.link_unavailable !== 'boolean') throw new Error('invalid staff receipt')
  if (result.invitation_url !== undefined) {
    const link = new URL(text(result.invitation_url))
    if (
      link.origin !== window.location.origin ||
      link.pathname !== '/managers' ||
      !new URLSearchParams(link.hash.slice(1)).get('invitation')
    )
      throw new Error('invalid invitation link')
  }
  return {
    staff,
    link_unavailable: result.link_unavailable,
    invitation_url: result.invitation_url === undefined ? undefined : text(result.invitation_url),
  }
}
export type InvitationAcceptance = Readonly<{ token: string; password: string; key: string }>
export async function acceptInvitation(command: InvitationAcceptance) {
  const { data } = await apiFetchResponse<unknown>(managerApi + '/auth/invitations/accept', {
    method: 'POST',
    headers: { 'Idempotency-Key': command.key },
    body: JSON.stringify({ token: command.token, password: command.password }),
  })
  if (record(data).accepted !== true) throw new Error('invalid invitation acceptance')
}
export function invitationResult(value: unknown) {
  const item = record(value)
  return {
    link: typeof item.invitation_url === 'string' ? item.invitation_url : null,
    unavailable: item.link_unavailable === true,
  }
}
