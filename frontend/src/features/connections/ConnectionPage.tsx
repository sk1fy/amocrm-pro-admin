import { lookupState } from '../../states'
import { RefreshStatus } from '../../components/RefreshStatus'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useRouteParams, useRouteSearch } from '../../app/hooks'
import { fetchAccount, fetchBackends, fetchConnection, keys } from '../../api/queries'
import type {
  AccountConnectionCard,
  ConnectionCard,
  CoreAudit,
  Delivery,
  Job,
} from '../../api/types'
import { ActionMenu } from '../../components/ActionMenu'
import { BackToTop } from '../../components/BackToTop'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { DetailDrawer } from '../../components/DetailDrawer'
import { ErrorState } from '../../components/ErrorState'
import { IncidentBanner } from '../../components/IncidentBanner'
import { Observation } from '../../components/Observation'
import { PageSkeleton } from '../../components/PageSkeleton'
import { StatusBadge } from '../../components/StatusBadge'
import { TechnicalDetails } from '../../components/TechnicalDetails'
import page from '../../components/page.module.css'
import { parseActivity } from '../../lib/activity'
import {
  computeConnectionHealth,
  groupAudit,
  lastSyncDurationSeconds,
  parsePilot,
  sectionDefaultOpen,
  sortJobs,
  syncIdleReason,
  webhookSuccessfulCheckAt,
  type ConnectionHealth,
  type ConnectionSection,
} from '../../lib/connectionHealth'
import { observationDependsOnIncident } from '../../lib/incidents'
import {
  actorLabel,
  auditLabel,
  groupWebhookEvents,
  jobLabel,
  webhookEventLabel,
} from '../../lib/labels'
import {
  formatAttempts,
  formatDateLong,
  formatDurationSeconds,
  formatExpiry,
  formatNull,
  formatRelativeTime,
  formatTime,
  sameInstant,
} from '../../lib/format'
import { exploreURL } from '../../lib/observability'
import { CommandAction } from '../operations/CommandAction'
import { connectionCommand } from '../operations/commands'
import { RetryDelivery } from '../operations/RetryActions'
import { resolveConnectionModule } from './modules/registry'
import styles from './connection.module.css'

const tabs: Array<{ id: ConnectionSection; label: string }> = [
  { id: 'status', label: 'Обзор' },
  { id: 'auth', label: 'Авторизация' },
  { id: 'webhook', label: 'Webhook' },
  { id: 'activity', label: 'Activity' },
  { id: 'jobs', label: 'Задачи' },
  { id: 'history', label: 'История' },
  { id: 'tech', label: 'Технические данные' },
]

export function ConnectionPage() {
  const { accountId, backend, connectionId } = useRouteParams<{
    accountId: string
    backend: string
    connectionId: string
  }>()
  const search = useRouteSearch<{ section?: ConnectionSection }>()
  const query = useQuery({
    queryKey: keys.connection(backend, connectionId),
    queryFn: () => fetchConnection(backend, connectionId),
  })
  const backends = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })
  const settingsAvailable =
    resolveConnectionModule(backend, backends.data?.items).kind === 'activity'

  if (query.isPending) {
    return <PageSkeleton label="Загрузка подключения…" />
  }
  if (query.error && !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  const card = query.data
  if (!card) {
    return null
  }
  const health = computeConnectionHealth(card)
  const section = search.section ?? health.defaultSection
  const identity = card.connection.data
  const refetch = () => void query.refetch()
  const hide = (source: string) => source === health.pageSource
  const dependent = (observation: ConnectionCard['activity']) =>
    observationDependsOnIncident(observation, health.coreAuthIncident) ? (
      <p>
        Данные Activity частично недоступны из-за{' '}
        <a href="#core-incident-title">ошибки авторизации Core</a>.
      </p>
    ) : undefined

  return (
    <div className={page.page}>
      <p>
        <Link to="/accounts/$accountId" params={{ accountId }}>
          Назад к аккаунту {accountId}
        </Link>
      </p>
      <ConnectionSwitcher accountId={accountId} backend={backend} connectionId={connectionId} />
      <h2>Подключение {identity?.integration_code ?? connectionId}</h2>
      <RefreshStatus
        updatedAt={query.dataUpdatedAt}
        fetching={query.isFetching}
        failed={Boolean(query.error)}
        onRefresh={() => void query.refetch({ cancelRefetch: false })}
      />
      <HealthSummary
        card={card}
        health={health}
        accountId={accountId}
        backend={backend}
        connectionId={connectionId}
      />
      {health.coreAuthIncident ? (
        <IncidentBanner incident={health.coreAuthIncident} onRetry={refetch} />
      ) : null}
      {health.problems.length > 0 ? (
        <section className={styles.summary} aria-labelledby="problem-center">
          <h3 id="problem-center">Требуют внимания — {health.problems.length}</h3>
          <ul className={styles.problems}>
            {health.problems.map((problem) => (
              <li key={problem.id}>
                <Link
                  to="/accounts/$accountId/widgets/$backend/$connectionId"
                  params={{ accountId, backend, connectionId }}
                  search={{ section: problem.section }}
                >
                  {problem.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ConnectionToolbar
        accountId={accountId}
        backend={backend}
        connectionId={connectionId}
        card={card}
        settingsAvailable={settingsAvailable}
        onInspect={refetch}
      />
      <nav className={page.tabs} aria-label="Разделы подключения">
        {tabs.map((tab) => {
          const active = section === tab.id
          return (
            <Link
              key={tab.id}
              to="/accounts/$accountId/widgets/$backend/$connectionId"
              params={{ accountId, backend, connectionId }}
              search={{ section: tab.id }}
              className={active ? `${page.tab} ${page.tabActive}` : page.tab}
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
      {section === 'status' ? (
        <StatusSection card={card} health={health} hideSource={hide} onRetry={refetch} />
      ) : null}
      {section === 'auth' ? (
        <AuthSection
          accountId={accountId}
          backend={backend}
          connectionId={connectionId}
          card={card}
          hideSource={hide}
          onRetry={refetch}
        />
      ) : null}
      {section === 'webhook' ? (
        <WebhookSection
          accountId={accountId}
          backend={backend}
          connectionId={connectionId}
          card={card}
          hideSource={hide}
          onRetry={refetch}
        />
      ) : null}
      {section === 'activity' ? (
        <ActivitySection
          accountId={accountId}
          backend={backend}
          connectionId={connectionId}
          card={card}
          hideSource={hide}
          dependent={dependent}
          grafana={backends.data?.observability.grafana_base_url}
          loki={backends.data?.observability.loki_base_url}
          onRetry={refetch}
          settingsAvailable={settingsAvailable}
        />
      ) : null}
      {section === 'jobs' ? <JobsSection card={card} hideSource={hide} onRetry={refetch} /> : null}
      {section === 'history' ? (
        <HistorySection card={card} hideSource={hide} onRetry={refetch} />
      ) : null}
      {section === 'tech' ? (
        <TechSection
          card={card}
          hideSource={hide}
          grafana={backends.data?.observability.grafana_base_url}
          loki={backends.data?.observability.loki_base_url}
          accountId={accountId}
          connectionId={connectionId}
          onRetry={refetch}
        />
      ) : null}
      <BackToTop />
    </div>
  )
}

function HealthSummary({
  card,
  health,
  accountId,
  backend,
  connectionId,
}: {
  card: ConnectionCard
  health: ReturnType<typeof computeConnectionHealth>
  accountId: string
  backend: string
  connectionId: string
}) {
  const items: Array<{ section: ConnectionSection; label: string; node: ReactNode }> = [
    {
      section: 'auth',
      label: 'Авторизация',
      node: <StatusBadge domain="authorization" state={card.authorization.data?.state} />,
    },
    {
      section: 'webhook',
      label: 'Webhook',
      node: <StatusBadge domain="webhook" state={card.webhook.data?.status} />,
    },
    {
      section: 'activity',
      label: 'Activity',
      node: <StatusBadge domain="pilot" state={parsePilot(card)} />,
    },
    {
      section: 'activity',
      label: 'Синхронизация',
      node: (
        <StatusBadge
          domain="sync"
          state={card.activity_sync.data?.state}
          raw={card.activity_sync.data?.raw}
        />
      ),
    },
  ]
  const checkAt =
    card.authorization_check?.data?.observed_at ?? card.authorization_check?.observed_at
  return (
    <section className={styles.summary}>
      <div className={page.row}>
        <StatusBadge domain="connection_health" state={health.state} />
        <StatusBadge
          domain="connection"
          state={card.connection.data?.state}
          raw={card.connection.data?.raw}
        />
        <span className={page.muted}>источник: {health.pageSource}</span>
      </div>
      {health.reasons.length > 0 ? (
        <ul>
          {health.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p className={page.muted}>Активных проблем нет.</p>
      )}
      <nav className={styles.summaryNav} aria-label="Сводка здоровья">
        {items.map((item) => (
          <Link
            key={`${item.section}-${item.label}`}
            to="/accounts/$accountId/widgets/$backend/$connectionId"
            params={{ accountId, backend, connectionId }}
            search={{ section: item.section }}
          >
            {item.label}: {item.node}
          </Link>
        ))}
        <p className={styles.secondary}>
          Последняя проверка amoCRM:{' '}
          <time dateTime={checkAt} title={formatTime(checkAt)}>
            {formatRelativeTime(checkAt)}
          </time>
        </p>
      </nav>
    </section>
  )
}

function ConnectionToolbar({
  accountId,
  backend,
  connectionId,
  card,
  settingsAvailable,
  onInspect,
}: {
  accountId: string
  backend: string
  connectionId: string
  card: ConnectionCard
  settingsAvailable: boolean
  onInspect: () => void
}) {
  const state = card.connection.data?.state
  const webhook = card.webhook.data
  const showEnable = state === 'disabled'
  const showDisable = Boolean(state && state !== 'disabled' && state !== 'uninstalled')
  const showReconcile = webhook?.status !== 'active' || webhook?.confirmed_destinations === 0
  const cmd = (command: string, label?: string) => {
    const spec = connectionCommand(backend, connectionId, command, accountId)
    return label ? { ...spec, label } : spec
  }
  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        <p className={styles.groupLabel}>Диагностика</p>
        <CommandAction
          spec={cmd('check')}
          layout="inline"
          emphasis="primary"
          onInspect={onInspect}
        />
      </div>
      {showEnable || showDisable ? (
        <div className={styles.group}>
          <p className={styles.groupLabel}>Состояние</p>
          {showEnable ? (
            <CommandAction spec={cmd('enable')} layout="inline" onInspect={onInspect} />
          ) : null}
          {showDisable ? (
            <CommandAction spec={cmd('disable')} layout="inline" onInspect={onInspect} />
          ) : null}
        </div>
      ) : null}
      {showReconcile ? (
        <div className={styles.group}>
          <p className={styles.groupLabel}>Webhook</p>
          <CommandAction spec={cmd('reconcile')} layout="inline" onInspect={onInspect} />
        </div>
      ) : null}
      {settingsAvailable ? (
        <div className={styles.group}>
          <p className={styles.groupLabel}>Activity</p>
          <Link
            to="/accounts/$accountId/widgets/$backend/$connectionId/settings"
            params={{ accountId, backend, connectionId }}
          >
            Настройки Activity и lead-status
          </Link>
        </div>
      ) : null}
      <ActionMenu>
        <Link
          to="/operations/admin"
          search={{ backend, target_type: 'installation', target_id: connectionId }}
        >
          История команд этого подключения
        </Link>
        <div className={styles.danger}>
          <p>
            Опасная зона. Сброс авторизации не отзывает доступ в amoCRM. Удаление может снять
            webhook лишь частично.
          </p>
          <CommandAction
            spec={cmd('revoke')}
            layout="inline"
            emphasis="danger"
            disabled={!state || ['disabled', 'uninstalled'].includes(state)}
            onInspect={onInspect}
          />
          <CommandAction
            spec={cmd('uninstall')}
            layout="inline"
            emphasis="danger"
            onInspect={onInspect}
          />
        </div>
      </ActionMenu>
    </div>
  )
}

function ConnectionSwitcher({
  accountId,
  backend,
  connectionId,
}: {
  accountId: string
  backend: string
  connectionId: string
}) {
  const navigate = useNavigate()
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  const items = (account.data?.connections ?? [])
    .map((obs) => obs.data)
    .filter((item): item is AccountConnectionCard => Boolean(item))
  if (items.length < 2) {
    return null
  }
  const index = items.findIndex(
    (item) => item.connection_id === connectionId && item.backend === backend,
  )
  const prev = index > 0 ? items[index - 1] : undefined
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined
  return (
    <div className={styles.switcher}>
      {prev ? (
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId"
          params={{ accountId, backend: prev.backend, connectionId: prev.connection_id }}
        >
          Предыдущее подключение
        </Link>
      ) : null}
      <label>
        Подключение
        <select
          aria-label="Другие подключения аккаунта"
          value={`${backend}:${connectionId}`}
          onChange={(event) => {
            const [nextBackend, nextId] = event.target.value.split(':')
            void navigate({
              to: '/accounts/$accountId/widgets/$backend/$connectionId',
              params: { accountId, backend: nextBackend, connectionId: nextId },
            })
          }}
        >
          {items.map((item) => (
            <option
              key={`${item.backend}:${item.connection_id}`}
              value={`${item.backend}:${item.connection_id}`}
            >
              {item.integration_code} · {item.backend}
            </option>
          ))}
        </select>
      </label>
      {next ? (
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId"
          params={{ accountId, backend: next.backend, connectionId: next.connection_id }}
        >
          Следующее подключение
        </Link>
      ) : null}
    </div>
  )
}

function StatusSection({
  card,
  health,
  hideSource,
  onRetry,
}: {
  card: ConnectionCard
  health: ConnectionHealth
  hideSource: (source: string) => boolean
  onRetry: () => void
}) {
  const identityOpen = sectionDefaultOpen(health.problems, 'status', card.connection)
  const grantsOpen = sectionDefaultOpen(health.problems, 'status', card.grants)
  return (
    <>
      <CompactSection title="Идентификация" defaultOpen={identityOpen}>
        <Observation
          title="Идентификация"
          observation={card.connection}
          hideSource={hideSource(card.connection.source)}
          onRetry={onRetry}
          status={
            <StatusBadge
              domain="connection"
              state={card.connection.data?.state}
              raw={card.connection.data?.raw}
            />
          }
        >
          {(conn) => (
            <div className={page.stack}>
              <dl className={page.dl}>
                <dt>Интеграция</dt>
                <dd>{conn.integration_code}</dd>
                <dt>Домен</dt>
                <dd>{formatNull(conn.account_domain)}</dd>
                <dt>Состояние установки</dt>
                <dd>
                  <StatusBadge domain="connection" state={conn.state} raw={conn.raw} />
                </dd>
                <dt>Создано</dt>
                <dd>
                  <time dateTime={conn.created_at} title={formatTime(conn.created_at)}>
                    {formatDateLong(conn.created_at)}
                  </time>
                </dd>
                {sameInstant(conn.created_at, conn.updated_at) ? null : (
                  <>
                    <dt>Обновлено</dt>
                    <dd>
                      <time dateTime={conn.updated_at} title={formatTime(conn.updated_at)}>
                        {formatRelativeTime(conn.updated_at)}
                      </time>
                    </dd>
                  </>
                )}
                <dt>Происхождение</dt>
                <dd>
                  <StatusBadge domain="origin" state={conn.origin} />
                </dd>
              </dl>
            </div>
          )}
        </Observation>
      </CompactSection>
      <CompactSection title="Гранты сервисов" defaultOpen={grantsOpen}>
        <Observation
          title="Гранты сервисов"
          observation={card.grants}
          hideSource={hideSource(card.grants.source)}
          onRetry={onRetry}
        >
          {(grants) =>
            grants.length === 0 ? (
              <p className={page.muted}>Нет грантов</p>
            ) : (
              <ul>
                {grants.map((grant) => (
                  <li key={grant.service}>
                    {grant.service}:{' '}
                    <StatusBadge domain="grant" state={grant.state} raw={grant.raw} />
                  </li>
                ))}
              </ul>
            )
          }
        </Observation>
      </CompactSection>
    </>
  )
}

function AuthSection({
  accountId,
  backend,
  connectionId,
  card,
  hideSource,
  onRetry,
}: {
  accountId: string
  backend: string
  connectionId: string
  card: ConnectionCard
  hideSource: (source: string) => boolean
  onRetry: () => void
}) {
  const check = card.authorization_check
  const staleOrUnknown =
    !check || check.freshness === 'stale' || check.freshness === 'unknown' || !check.data
  return (
    <>
      <Observation
        title="Локальная авторизация"
        observation={card.authorization}
        hideSource={hideSource(card.authorization.source)}
        onRetry={onRetry}
        status={<StatusBadge domain="authorization" state={card.authorization.data?.state} />}
      >
        {(auth) => (
          <div className={page.stack}>
            <p>Учётные данные: {auth.credentials_present ? 'присутствуют' : 'нет'}</p>
            {auth.unverified ? <p>Фактическая авторизация не проверена.</p> : null}
            <p>{formatExpiry(auth.expires_at)}</p>
            <p className={styles.secondary}>Действует до {formatTime(auth.expires_at)}</p>
            <TechnicalDetails>
              <p>Версия учётных данных: {formatNull(auth.credential_version ?? null)}</p>
              <p>Версия ключа: {formatNull(auth.key_version ?? null)}</p>
            </TechnicalDetails>
          </div>
        )}
      </Observation>
      {check ? (
        <Observation
          title="Последняя проверка amoCRM"
          observation={check}
          hideSource={hideSource(check.source)}
          onRetry={onRetry}
          status={
            staleOrUnknown ? (
              <span>Требуется повторная проверка</span>
            ) : (
              <StatusBadge domain="verification" state={check.data?.classification} />
            )
          }
        >
          {(result) => (
            <div className={page.stack}>
              {staleOrUnknown ? (
                <p className={styles.secondary}>
                  Последняя завершённая проверка:{' '}
                  <span>
                    {lookupState('verification', result.classification).label} (исторический
                    результат)
                  </span>{' '}
                  ·{' '}
                  <time dateTime={result.observed_at} title={formatTime(result.observed_at)}>
                    {formatRelativeTime(result.observed_at)}
                  </time>
                </p>
              ) : (
                <time dateTime={result.observed_at} title={formatTime(result.observed_at)}>
                  {formatRelativeTime(result.observed_at)}
                </time>
              )}
              {result.retry_after ? (
                <p>Повторно можно через {formatDurationSeconds(result.retry_after)}.</p>
              ) : null}
              <CommandAction
                spec={{
                  ...connectionCommand(backend, connectionId, 'check', accountId),
                  label: 'Проверить сейчас',
                }}
                layout="inline"
                onInspect={onRetry}
              />
            </div>
          )}
        </Observation>
      ) : null}
    </>
  )
}

function WebhookSection({
  accountId,
  backend,
  connectionId,
  card,
  hideSource,
  onRetry,
}: {
  accountId: string
  backend: string
  connectionId: string
  card: ConnectionCard
  hideSource: (source: string) => boolean
  onRetry: () => void
}) {
  return (
    <Observation
      title="Webhook"
      observation={card.webhook}
      hideSource={hideSource(card.webhook.source)}
      onRetry={onRetry}
      status={
        <StatusBadge
          domain="webhook"
          state={card.webhook.data?.status}
          raw={card.webhook.data?.raw}
        />
      }
    >
      {(hook) => (
        <div className={page.stack}>
          <WebhookEvents events={hook.events} />
          <WebhookCheckedAt checkedAt={hook.checked_at} lastError={hook.last_error} />
          {hook.last_error ? (
            <p>Последняя ошибка: {hook.last_error}</p>
          ) : (
            <p className={page.muted}>Ошибок нет</p>
          )}
          <p>Подтверждённых адресов доставки: {formatNull(hook.confirmed_destinations)}</p>
          <p className={styles.secondary}>
            Это число адресов, которые Core подтвердил как приёмники событий amoCRM. Обычно нужен
            хотя бы один. Ноль при активной подписке значит, что события могут не доходить.
          </p>
          {hook.confirmed_destinations === 0 && hook.status === 'active' ? (
            <CommandAction
              spec={connectionCommand(backend, connectionId, 'reconcile', accountId)}
              layout="inline"
              onInspect={onRetry}
            />
          ) : null}
        </div>
      )}
    </Observation>
  )
}

function WebhookEvents({ events }: { events: string[] }) {
  if (events.length === 0) {
    return <p>События: {formatNull(null)}</p>
  }
  const groups = groupWebhookEvents(events)
  return (
    <details className={styles.events}>
      <summary>{events.length} событий</summary>
      {groups.map((group) => (
        <div key={group.group}>
          <strong>{group.group}</strong>
          <ul>
            {group.items.map((code) => (
              <li key={code}>
                {webhookEventLabel(code)} <span className={styles.code}>{code}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  )
}

function ActivitySection({
  accountId,
  backend,
  connectionId,
  card,
  hideSource,
  dependent,
  grafana,
  loki,
  onRetry,
  settingsAvailable,
}: {
  accountId: string
  backend: string
  connectionId: string
  card: ConnectionCard
  hideSource: (source: string) => boolean
  dependent: (observation: ConnectionCard['activity']) => ReactNode
  grafana?: string
  loki?: string
  onRetry: () => void
  settingsAvailable: boolean
}) {
  const activityHint = dependent(card.activity)
  const syncHint = dependent(card.activity_sync)
  return (
    <>
      <Observation
        title="Пилот Activity"
        observation={card.activity}
        hideSource={hideSource(card.activity.source)}
        onRetry={onRetry}
        dependentHint={activityHint}
        status={<StatusBadge domain="pilot" state={parsePilot(card)} />}
      >
        {(raw) => {
          const activity = parseActivity(raw)
          const pilot = activity.pilot || 'not_configured'
          return (
            <div className={page.stack}>
              <p>
                <StatusBadge domain="pilot" state={pilot} />
              </p>
              {settingsAvailable ? (
                <Link
                  to="/accounts/$accountId/widgets/$backend/$connectionId/settings"
                  params={{ accountId, backend, connectionId }}
                >
                  Открыть настройки
                </Link>
              ) : null}
              {pilot === 'enabled' ? (
                <CommandAction
                  spec={connectionCommand(backend, connectionId, 'pilot-disable', accountId)}
                  layout="inline"
                  onInspect={onRetry}
                />
              ) : (
                <CommandAction
                  spec={connectionCommand(backend, connectionId, 'pilot-enable', accountId)}
                  layout="inline"
                  onInspect={onRetry}
                />
              )}
            </div>
          )
        }}
      </Observation>
      <DeliveriesBlock
        card={card}
        backend={backend}
        connectionId={connectionId}
        hideSource={hideSource}
        dependentHint={activityHint}
        onRetry={onRetry}
      />
      <Observation
        title="Синхронизация Activity"
        observation={card.activity_sync}
        hideSource={hideSource(card.activity_sync.source)}
        onRetry={onRetry}
        dependentHint={syncHint}
        status={
          <StatusBadge
            domain="sync"
            state={card.activity_sync.data?.state}
            raw={card.activity_sync.data?.raw}
          />
        }
      >
        {(sync) => (
          <div className={page.stack}>
            <p>{syncIdleReason(sync)}</p>
            <p>Задержка: {formatDurationSeconds(sync.lag_seconds ?? null)}</p>
            {lastSyncDurationSeconds(sync) !== null ? (
              <p>
                Длительность последнего синка:{' '}
                {formatDurationSeconds(lastSyncDurationSeconds(sync))}
              </p>
            ) : null}
            <ol className={styles.timeline}>
              <li>
                Последнее событие получено:{' '}
                <time
                  dateTime={sync.last_event_at ?? undefined}
                  title={formatTime(sync.last_event_at)}
                >
                  {formatRelativeTime(sync.last_event_at)}
                </time>
              </li>
              <li>
                Последний успех:{' '}
                <time
                  dateTime={sync.last_success_at ?? undefined}
                  title={formatTime(sync.last_success_at)}
                >
                  {formatRelativeTime(sync.last_success_at)}
                </time>
              </li>
              <li>
                Проверено по{' '}
                <time
                  dateTime={sync.verified_through ?? undefined}
                  title={formatTime(sync.verified_through)}
                >
                  {formatDateLong(sync.verified_through)}
                </time>
              </li>
            </ol>
            {sync.reauth_required ? <p>Требуется повторная авторизация клиента.</p> : null}
            <TechnicalDetails>
              <p>
                Диапазон: {formatTime(sync.verified_from)} — {formatTime(sync.verified_through)}
              </p>
              <p>Код ошибки: {formatNull(sync.error_code || null)}</p>
              <ObservabilityLinks
                grafana={grafana}
                loki={loki}
                accountId={card.connection.data?.account_id ?? accountId}
                installationId={connectionId}
              />
            </TechnicalDetails>
          </div>
        )}
      </Observation>
    </>
  )
}

function DeliveriesBlock({
  card,
  backend,
  connectionId,
  hideSource,
  dependentHint,
  onRetry,
}: {
  card: ConnectionCard
  backend: string
  connectionId: string
  hideSource: (source: string) => boolean
  dependentHint: ReactNode
  onRetry: () => void
}) {
  const [selected, setSelected] = useState<Delivery | null>(null)
  const [showAll, setShowAll] = useState(false)
  return (
    <Observation
      title="Доставки Activity"
      observation={card.activity}
      hideSource={hideSource(card.activity.source)}
      onRetry={onRetry}
      dependentHint={dependentHint}
    >
      {(raw) => {
        const deliveries = parseActivity(raw).deliveries
        if (deliveries.length === 0) {
          return <p className={page.muted}>Нет команд доставки</p>
        }
        const grouped = groupDeliveries(deliveries)
        const rows = showAll ? grouped : grouped.slice(0, 5)
        return (
          <div className={page.stack}>
            <DataTable
              rows={rows}
              rowKey={(row) => row.command_id}
              columns={[
                {
                  id: 'delivery',
                  header: 'Доставка',
                  cell: (row) => (
                    <span>
                      {row.action} → {row.target}
                      {row.copies > 1 ? ` · ${row.copies}` : ''}
                    </span>
                  ),
                },
                {
                  id: 'status',
                  header: 'Статус',
                  cell: (row) => <StatusBadge domain="delivery" state={row.status} raw={row.raw} />,
                },
                {
                  id: 'time',
                  header: 'Обновлено',
                  cell: (row) => (
                    <time dateTime={row.updated_at} title={formatTime(row.updated_at)}>
                      {formatRelativeTime(row.updated_at)}
                    </time>
                  ),
                },
                {
                  id: 'attempts',
                  header: 'Попытки',
                  cell: (row) =>
                    row.status === 'accepted' && row.attempts <= 1
                      ? formatNull(null)
                      : formatAttempts(row.attempts, row.max_attempts),
                },
                {
                  id: 'retry',
                  header: '',
                  cell: (row) => (
                    <RetryDelivery
                      backend={backend}
                      connectionId={connectionId}
                      delivery={row}
                      onInspect={onRetry}
                    />
                  ),
                },
                {
                  id: 'open',
                  header: '',
                  cell: (row) => (
                    <button type="button" onClick={() => setSelected(row)}>
                      Подробнее
                    </button>
                  ),
                },
              ]}
            />
            {grouped.length > 5 && !showAll ? (
              <button type="button" onClick={() => setShowAll(true)}>
                Показать все ({grouped.length})
              </button>
            ) : null}
            <DetailDrawer
              title="Доставка"
              open={Boolean(selected)}
              onClose={() => setSelected(null)}
            >
              {selected ? (
                <dl className={page.dl}>
                  <dt>ID</dt>
                  <dd>
                    <CopyableId value={selected.command_id} label="ID доставки" />
                  </dd>
                  <dt>Создана</dt>
                  <dd>{formatTime(selected.created_at)}</dd>
                  <dt>Обновлена</dt>
                  <dd>{formatTime(selected.updated_at)}</dd>
                  <dt>Итог</dt>
                  <dd>
                    <StatusBadge domain="delivery" state={selected.status} raw={selected.raw} />
                  </dd>
                  <dt>Попытки</dt>
                  <dd>{formatAttempts(selected.attempts, selected.max_attempts)}</dd>
                  <dt>Повтор</dt>
                  <dd>
                    {selected.retry_reason ||
                      (selected.retry_allowed ? 'доступен' : formatNull(null))}
                  </dd>
                </dl>
              ) : null}
            </DetailDrawer>
          </div>
        )
      }}
    </Observation>
  )
}

function groupDeliveries(items: Delivery[]): Array<Delivery & { copies: number }> {
  const buckets = new Map<string, Delivery[]>()
  const sorted = [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  for (const item of sorted) {
    const key = `${item.action}|${item.target}|${item.status}`
    const list = buckets.get(key) ?? []
    list.push(item)
    buckets.set(key, list)
  }
  return [...buckets.values()].map((list) => ({ ...list[0], copies: list.length }))
}

function JobsSection({
  card,
  hideSource,
  onRetry,
}: {
  card: ConnectionCard
  hideSource: (source: string) => boolean
  onRetry: () => void
}) {
  const [selected, setSelected] = useState<Job | null>(null)
  const [showAll, setShowAll] = useState(false)
  return (
    <Observation
      title="Фоновые задачи"
      observation={card.recent_jobs}
      hideSource={hideSource(card.recent_jobs.source)}
      onRetry={onRetry}
    >
      {(jobs) => {
        if (jobs.length === 0) {
          return <p className={page.muted}>Нет задач</p>
        }
        const sorted = sortJobs(jobs)
        const grouped = new Map<string, number>()
        for (const job of sorted) {
          grouped.set(job.type, (grouped.get(job.type) ?? 0) + 1)
        }
        const rows = showAll ? sorted : sorted.slice(0, 8)
        return (
          <div className={page.stack}>
            <p className={styles.secondary}>
              Очередь Core по этой установке, не журнал действий администратора.
            </p>
            <p className={styles.secondary}>
              {[...grouped.entries()]
                .map(([type, count]) => `${jobLabel(type)} ×${count}`)
                .join(' · ')}
            </p>
            <DataTable
              rows={rows}
              rowKey={(job) => job.id}
              columns={[
                {
                  id: 'job',
                  header: 'Задача',
                  cell: (job) => (
                    <span>
                      {jobLabel(job.type)}
                      <span className={styles.secondary}> {job.type}</span>
                    </span>
                  ),
                },
                {
                  id: 'status',
                  header: 'Статус',
                  cell: (job) => <StatusBadge domain="job" state={job.status} raw={job.raw} />,
                },
                {
                  id: 'time',
                  header: 'Время',
                  cell: (job) => (
                    <time dateTime={job.updated_at} title={formatTime(job.updated_at)}>
                      {formatRelativeTime(job.updated_at)}
                    </time>
                  ),
                },
                {
                  id: 'open',
                  header: '',
                  cell: (job) => (
                    <button type="button" onClick={() => setSelected(job)}>
                      Подробнее
                    </button>
                  ),
                },
              ]}
            />
            {sorted.length > 8 && !showAll ? (
              <button type="button" onClick={() => setShowAll(true)}>
                Показать все ({sorted.length})
              </button>
            ) : null}
            <DetailDrawer title="Задача" open={Boolean(selected)} onClose={() => setSelected(null)}>
              {selected ? (
                <dl className={page.dl}>
                  <dt>Задача</dt>
                  <dd>
                    {jobLabel(selected.type)}
                    <div className={styles.code}>{selected.type}</div>
                  </dd>
                  <dt>Статус</dt>
                  <dd>
                    <StatusBadge domain="job" state={selected.status} raw={selected.raw} />
                  </dd>
                  <dt>Попытки</dt>
                  <dd>{formatAttempts(selected.attempts, selected.max_attempts)}</dd>
                  <dt>Ошибка</dt>
                  <dd>{formatNull(selected.last_error_message)}</dd>
                  <dt>ID</dt>
                  <dd>
                    <CopyableId value={selected.id} label="ID задачи" />
                  </dd>
                </dl>
              ) : null}
            </DetailDrawer>
          </div>
        )
      }}
    </Observation>
  )
}

function HistorySection({
  card,
  hideSource,
  onRetry,
}: {
  card: ConnectionCard
  hideSource: (source: string) => boolean
  onRetry: () => void
}) {
  const [selected, setSelected] = useState<CoreAudit | null>(null)
  const [showAll, setShowAll] = useState(false)
  return (
    <Observation
      title="Действия пользователей и системы"
      observation={card.recent_audit}
      hideSource={hideSource(card.recent_audit.source)}
      onRetry={onRetry}
    >
      {(items) => {
        if (items.length === 0) {
          return <p className={page.muted}>Нет записей аудита</p>
        }
        const grouped = groupAudit(items)
        const rows = showAll ? items : items.slice(0, 8)
        return (
          <div className={page.stack}>
            <p className={styles.secondary}>
              Журнал аудита Core. Фоновые задачи очереди смотрите во вкладке «Задачи».
            </p>
            <p className={styles.secondary}>
              {grouped
                .map((group) => `${auditLabel(group.key)} ×${group.items.length}`)
                .join(' · ')}
            </p>
            <DataTable
              rows={rows}
              rowKey={(item) => String(item.id)}
              columns={[
                {
                  id: 'action',
                  header: 'Событие',
                  cell: (item) => (
                    <span>
                      {auditLabel(item.action)}
                      <span className={styles.secondary}> {item.action}</span>
                    </span>
                  ),
                },
                {
                  id: 'actor',
                  header: 'Кто',
                  cell: (item) => (
                    <span>
                      {actorLabel(item.actor_type)}
                      {item.actor_id ? <span className={styles.code}> {item.actor_id}</span> : null}
                    </span>
                  ),
                },
                {
                  id: 'object',
                  header: 'Объект',
                  cell: (item) => formatNull(item.object_type),
                },
                {
                  id: 'time',
                  header: 'Время',
                  cell: (item) => (
                    <time dateTime={item.created_at} title={formatTime(item.created_at)}>
                      {formatRelativeTime(item.created_at)}
                    </time>
                  ),
                },
                {
                  id: 'open',
                  header: '',
                  cell: (item) => (
                    <button type="button" onClick={() => setSelected(item)}>
                      Подробнее
                    </button>
                  ),
                },
              ]}
            />
            {items.length > 8 && !showAll ? (
              <button type="button" onClick={() => setShowAll(true)}>
                Показать все ({items.length})
              </button>
            ) : null}
            <DetailDrawer
              title="Событие"
              open={Boolean(selected)}
              onClose={() => setSelected(null)}
            >
              {selected ? (
                <dl className={page.dl}>
                  <dt>Действие</dt>
                  <dd>
                    {auditLabel(selected.action)}
                    <div className={styles.code}>{selected.action}</div>
                  </dd>
                  <dt>Субъект</dt>
                  <dd>
                    {actorLabel(selected.actor_type)} {formatNull(selected.actor_id)}
                  </dd>
                  <dt>Объект</dt>
                  <dd>
                    {formatNull(selected.object_type)} {formatNull(selected.object_id)}
                  </dd>
                </dl>
              ) : null}
            </DetailDrawer>
          </div>
        )
      }}
    </Observation>
  )
}

function CompactSection({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen: boolean
  children: ReactNode
}) {
  return (
    <details className={styles.compact} open={defaultOpen || undefined}>
      <summary>{title}</summary>
      {children}
    </details>
  )
}

function WebhookCheckedAt({
  checkedAt,
  lastError,
}: {
  checkedAt?: string | null
  lastError?: string | null
}) {
  const successAt = webhookSuccessfulCheckAt(checkedAt, lastError)
  if (successAt) {
    return (
      <p className={styles.secondary}>
        Последняя успешная проверка{' '}
        <time dateTime={successAt} title={formatTime(successAt)}>
          {formatRelativeTime(successAt)}
        </time>
      </p>
    )
  }
  return (
    <p className={styles.secondary}>
      Проверено{' '}
      <time dateTime={checkedAt ?? undefined} title={formatTime(checkedAt)}>
        {formatRelativeTime(checkedAt)}
      </time>
    </p>
  )
}

function TechSection({
  card,
  hideSource,
  grafana,
  loki,
  accountId,
  connectionId,
  onRetry,
}: {
  card: ConnectionCard
  hideSource: (source: string) => boolean
  grafana?: string
  loki?: string
  accountId: string
  connectionId: string
  onRetry: () => void
}) {
  const conn = card.connection.data
  return (
    <>
      <Observation
        title="Идентификаторы"
        observation={card.connection}
        hideSource={hideSource(card.connection.source)}
        onRetry={onRetry}
      >
        {(item) => (
          <dl className={page.dl}>
            <dt>ID установки</dt>
            <dd>
              <CopyableId value={item.id} label="ID установки" />
            </dd>
            <dt>ID аккаунта</dt>
            <dd>
              <CopyableId value={item.account_id} label="ID аккаунта" />
            </dd>
            <dt>ID интеграции</dt>
            <dd>
              <CopyableId value={item.integration_id} label="ID интеграции" />
            </dd>
            {item.installed_by === null || item.installed_by === undefined ? null : (
              <>
                <dt>Кем установлено</dt>
                <dd>{formatNull(item.installed_by)}</dd>
              </>
            )}
            <dt>Происхождение</dt>
            <dd>
              <StatusBadge domain="origin" state={item.origin} />
            </dd>
            <dt>Источник наблюдения</dt>
            <dd>{card.connection.source}</dd>
          </dl>
        )}
      </Observation>
      <Observation
        title="Версии"
        observation={card.authorization}
        hideSource={hideSource(card.authorization.source)}
        onRetry={onRetry}
      >
        {(item) => (
          <dl className={page.dl}>
            <dt>Версия учётных данных</dt>
            <dd>{formatNull(item.credential_version ?? null)}</dd>
            <dt>Версия ключа</dt>
            <dd>{formatNull(item.key_version ?? null)}</dd>
          </dl>
        )}
      </Observation>
      <Observation
        title="Наблюдаемость"
        observation={card.activity_sync}
        hideSource={hideSource(card.activity_sync.source)}
        onRetry={onRetry}
      >
        {(sync) => (
          <div className={page.stack}>
            <p>
              Диапазон: {formatTime(sync.verified_from)} — {formatTime(sync.verified_through)}
            </p>
            <p>Код ошибки: {formatNull(sync.error_code || null)}</p>
            <ObservabilityLinks
              grafana={grafana}
              loki={loki}
              accountId={conn?.account_id ?? accountId}
              installationId={connectionId}
            />
          </div>
        )}
      </Observation>
    </>
  )
}

function ObservabilityLinks({
  grafana,
  loki,
  accountId,
  installationId,
}: {
  grafana?: string
  loki?: string
  accountId: string
  installationId: string
}) {
  const query = `account_id=${accountId} installation_id=${installationId}`
  const grafanaURL = exploreURL(grafana, 'now-24h', 'now', query)
  const lokiURL = exploreURL(loki, 'now-24h', 'now', query)
  if (!grafanaURL && !lokiURL) return null
  return (
    <p className={page.row}>
      {grafanaURL ? (
        <a href={grafanaURL} rel="noreferrer">
          Grafana
        </a>
      ) : null}
      {lokiURL ? (
        <a href={lokiURL} rel="noreferrer">
          Loki
        </a>
      ) : null}
    </p>
  )
}
