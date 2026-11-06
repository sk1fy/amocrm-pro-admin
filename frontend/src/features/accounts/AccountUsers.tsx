import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useCallback, useSyncExternalStore } from 'react'
import { useRouteParams } from '../../app/hooks'
import { fetchCrmUsers, keys } from '../../api/queries'
import type {
  CrmUser,
  CrmUsers,
  Observation as ObservationType,
  SourceStatus,
} from '../../api/types'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { PageHeader } from '../../components/PageHeader'
import { RefreshStatus } from '../../components/RefreshStatus'
import {
  SourcesBanner,
  allSourcesUnavailable,
  sourcesUnavailable,
} from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatDurationSeconds, formatTime } from '../../lib/format'
import styles from './AccountUsers.module.css'

// Why the list is unknown. The list is never shown as empty in these states.
const unknownListHints: Record<string, string> = {
  no_authorized_connection:
    'У аккаунта нет активной установки с OAuth-доступом, читать пользователей не через что.',
  auth_error: 'amoCRM отклонила токен подключения. Проверьте авторизацию на карточке подключения.',
  rate_limited: 'amoCRM ограничила частоту запросов.',
  incomplete:
    'В аккаунте больше 1000 пользователей или ответ слишком большой. Частичный список не показывается.',
  network_error: 'amoCRM не ответила вовремя. Повторите позже.',
  internal_error: 'Core не смог прочитать список. Подробности в журнале worker.',
}

function UsersTable({ users }: { users: CrmUser[] }) {
  if (users.length === 0) {
    return <EmptyState title="В аккаунте нет пользователей" />
  }
  return (
    <DataTable
      rows={users}
      rowKey={(user) => String(user.id)}
      columns={[
        {
          id: 'id',
          header: 'ID',
          mono: true,
          cell: (user) => user.id,
          sortValue: (user) => user.id,
        },
        {
          id: 'name',
          header: 'Имя',
          ellipsis: true,
          cell: (user) => user.name || '—',
          sortValue: (user) => user.name,
        },
        {
          id: 'active',
          header: 'Статус',
          cell: (user) => (
            <StatusBadge
              domain="crm_user"
              state={user.is_active ? 'active' : 'inactive'}
              variant="text"
            />
          ),
          sortValue: (user) => (user.is_active ? 0 : 1),
        },
        {
          id: 'admin',
          header: 'Администратор',
          cell: (user) => (user.is_admin ? 'Да' : 'Нет'),
          sortValue: (user) => (user.is_admin ? 0 : 1),
        },
      ]}
    />
  )
}

function CrmUsersCard({
  data,
  accountId,
  backend,
  snapshotExpired,
}: {
  data: CrmUsers
  accountId: string
  backend: string
  snapshotExpired: boolean
}) {
  const known = data.state === 'ok' && data.users !== null
  const hint = unknownListHints[data.state] ?? 'Источник вернул неизвестное состояние.'
  return (
    <div className={page.stack}>
      <div className={page.row}>
        <StatusBadge
          domain="crm_users"
          state={data.state}
          raw={data.raw}
          testId="crm-users-state"
          calm
        />
        {known ? <span>Всего: {data.total ?? data.users?.length}</span> : null}
        {known && data.fresh_until ? (
          <span className={page.muted}>
            {snapshotExpired ? 'Срок актуальности снимка Core истёк в' : 'Снимок Core актуален до'}{' '}
            <time dateTime={data.fresh_until}>{formatTime(data.fresh_until)}</time>
          </span>
        ) : null}
      </div>
      {data.connection ? (
        <p className={page.muted}>
          Через подключение{' '}
          <Link
            to="/accounts/$accountId/widgets/$backend/$connectionId"
            params={{ accountId, backend, connectionId: data.connection.id }}
          >
            {data.connection.integration_code || data.connection.id}
          </Link>
        </p>
      ) : null}
      {known && data.users ? (
        <UsersTable users={data.users} />
      ) : (
        <div className={`${page.card} ${styles.unknown}`} role="status">
          <strong>Список пользователей неизвестен</strong>
          <p>
            {hint}
            {data.state === 'rate_limited' && data.retry_after_seconds
              ? ` Повторите через ${formatDurationSeconds(data.retry_after_seconds)}.`
              : null}
          </p>
        </div>
      )}
    </div>
  )
}

function CrmUsersObservation({
  accountId,
  observation,
  onRetry,
}: {
  accountId: string
  observation: ObservationType<CrmUsers>
  onRetry?: () => void
}) {
  const { data, freshness } = observation
  const deadline = freshness === 'fresh' && data?.state === 'ok' ? data.fresh_until : null
  const expiresAt = deadline === null ? Number.POSITIVE_INFINITY : Date.parse(deadline)
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!Number.isFinite(expiresAt)) return () => {}

      let timer: number | undefined
      function notifyAtExpiry() {
        const remaining = expiresAt - Date.now()
        if (remaining > 0) timer = window.setTimeout(notifyAtExpiry, remaining)
        else onChange()
      }
      notifyAtExpiry()
      return () => window.clearTimeout(timer)
    },
    [expiresAt],
  )
  const expired = useSyncExternalStore(subscribe, () => Date.now() >= expiresAt)

  return (
    <Observation
      observation={expired ? { ...observation, freshness: 'stale' } : observation}
      onRetry={onRetry}
    >
      {(data) => (
        <CrmUsersCard
          data={data}
          accountId={accountId}
          backend={observation.source}
          snapshotExpired={expired}
        />
      )}
    </Observation>
  )
}

export function CrmUsersList({
  accountId,
  items,
  sources,
  onRetry,
}: {
  accountId: string
  items: ObservationType<CrmUsers>[]
  sources?: SourceStatus[] | null
  onRetry?: () => void
}) {
  const partial = sourcesUnavailable(sources)
  const allUnavailable = allSourcesUnavailable(sources)
  return (
    <div className={page.stack}>
      {partial ? <SourcesBanner sources={sources} /> : null}
      {items.length > 0 ? (
        items.map((obs) => (
          <CrmUsersObservation
            key={`${obs.source}:${obs.observed_at}`}
            accountId={accountId}
            observation={obs}
            onRetry={onRetry}
          />
        ))
      ) : allUnavailable ? (
        <EmptyState title="Источник недоступен" />
      ) : partial ? null : (
        <div className={`${page.card} ${styles.unknown}`} role="status">
          <strong>Данные о пользователях недоступны</strong>
          <p>Ни один источник не читает пользователей amoCRM для этого аккаунта.</p>
        </div>
      )}
    </div>
  )
}

export function AccountUsers() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const users = useQuery({
    queryKey: keys.crmUsers(accountId),
    queryFn: () => fetchCrmUsers(accountId),
    staleTime: 60_000,
  })
  return (
    <section className={page.stack}>
      <PageHeader
        as="h2"
        title="Пользователи amoCRM"
        description="Читаются из amoCRM при открытии вкладки и по кнопке обновления. Email, телефоны, группы и права не показываются."
        refresh={
          <RefreshStatus
            updatedAt={users.dataUpdatedAt}
            fetching={users.isFetching}
            failed={Boolean(users.error) && Boolean(users.data)}
            onRefresh={() => void users.refetch({ cancelRefetch: false })}
            sources={users.data?.sources}
          />
        }
      />
      {users.isPending ? (
        <div className={page.skeleton} />
      ) : users.error && !users.data ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <CrmUsersList
          accountId={accountId}
          items={users.data?.items ?? []}
          sources={users.data?.sources}
          onRetry={() => void users.refetch()}
        />
      )}
    </section>
  )
}
