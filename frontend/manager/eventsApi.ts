import { apiFetchResponse } from '../src/api/client'
import { date, isUUID, record } from './installationsApi'
import { accountPath, type AccountId } from './accountsApi'
import { managerApi } from './session'

export const eventKinds = {
  installed: 'Установка',
  reinstalled: 'Повторная установка',
  reauthorized: 'Авторизация',
  uninstalled: 'Удаление',
  activated: 'Активация',
  installation_reviewed: 'Установка проверена',
  installation_unreviewed: 'Проверка снята',
  account_profile_updated: 'Профиль изменён',
  portrait_updated: 'Портрет изменён',
  access_renewed: 'Доступ продлён',
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid event response')
  return value
}
function uuid(value: unknown): string {
  if (!isUUID(value)) throw new Error('invalid event identifier')
  return value
}
function isKind(value: unknown): value is keyof typeof eventKinds {
  return typeof value === 'string' && Object.hasOwn(eventKinds, value)
}
export function parseEvent(value: unknown) {
  const item = record(value)
  if (!isKind(item.kind) || !Array.isArray(item.related_refs)) throw new Error('invalid event')
  return {
    id: uuid(item.id),
    kind: item.kind,
    occurred_at: date(item.occurred_at),
    recorded_at: date(item.recorded_at),
    summary: text(item.summary),
    account_id: item.account_id === undefined ? undefined : uuid(item.account_id),
    product_id: item.product_id === undefined ? undefined : uuid(item.product_id),
    actor_display: item.actor_display === undefined ? undefined : text(item.actor_display),
    related_refs: item.related_refs.map((raw: unknown) => {
      const ref = record(raw)
      const kind = ref.kind
      if (kind !== 'account' && kind !== 'product' && kind !== 'installation')
        throw new Error('invalid event reference')
      return { kind, id: uuid(ref.id) }
    }),
  }
}
export type ManagerEvent = ReturnType<typeof parseEvent>
export type TimelineScope = { kind: 'feed' } | { kind: 'history'; account: AccountId }
export async function listEvents(scope: TimelineScope, query: string, signal: AbortSignal) {
  const path =
    scope.kind === 'feed' ? managerApi + '/feed' : accountPath(scope.account) + '/history'
  const { data } = await apiFetchResponse<unknown>(path + (query ? '?' + query : ''), { signal })
  const page = record(data)
  if (
    !Array.isArray(page.items) ||
    (page.next_cursor !== null && typeof page.next_cursor !== 'string')
  )
    throw new Error('invalid event page')
  return {
    items: page.items.map(parseEvent),
    next_cursor: page.next_cursor,
    snapshot_at: date(page.snapshot_at),
    query_hash: text(page.query_hash),
  }
}
