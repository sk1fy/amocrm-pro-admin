import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useRouteParams, useRouteSearch } from '../../app/hooks'
import { fetchAccount, fetchBackends, fetchConnection, keys } from '../../api/queries'
import type {
  AccountCard,
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
import { OriginTag } from '../../components/OriginTag'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProductGrants } from '../../components/ProductGrants'
import { RefreshStatus } from '../../components/RefreshStatus'
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
import { observationDependsOnIncident } from '../../lib/incidents'
import {
  actorLabel,
  auditLabel,
  groupWebhookEvents,
  jobLabel,
  webhookEventLabel,
} from '../../lib/labels'
import { exploreURL } from '../../lib/observability'
import { lookupState } from '../../states'
import { CommandAction } from '../operations/CommandAction'
import { connectionCommand } from '../operations/commands'
import { RetryDelivery } from '../operations/RetryActions'
import { DistributionSection } from './DistributionSection'
import { resolveConnectionModule } from './modules/registry'
import styles from './connection.module.css'

const tabs: Array<{ id: ConnectionSection; label: string }> = [
  { id: 'status', label: 'Обзор' },
  { id: 'auth', label: 'Авторизация' },
  { id: 'webhook', label: 'Webhook' },
  { id: 'activity', label: 'Activity' },
  { id: 'distribution', label: 'Распределение сделок' },
  { id: 'jobs', label: 'Задачи' },
  { id: 'history', label: 'История' },
  { id: 'tech', label: 'Технические данные' },
]

const connectionRoute = '/accounts/$accountId/widgets/$backend/$connectionId'

function sectionLabel(section: ConnectionSection): string {
  return tabs.find((tab) => tab.id === section)?.label ?? section
}

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
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  const backends = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })
  const [resultSlot, setResultSlot] = useState<HTMLDivElement | null>(null)
  const settingsAvailable =
    resolveConnectionModule(backend, backends.data?.items).kind === 'activity'

  if (query.isPending) {
    return <PageSkeleton label="Загрузка подключения…" />
  }
  const card = query.data
  const identity = card?.connection.data
  const domain = identity?.account_domain ?? account.data?.domains[0]
  const health = card ? computeConnectionHealth(card) : null
  const header = (
    <PageHeader
      title={card ? `Подключение ${identity?.integration_code ?? 'без названия'}` : 'Подключение'}
      meta={
        <>
          <Link to="/accounts/$accountId" params={{ accountId }}>
            {domain ?? `Аккаунт ${accountId}`}
          </Link>
          {domain ? <span>ID {accountId}</span> : null}
          {health ? <StatusBadge domain="connection_health" state={health.state} calm /> : null}
          <OriginTag origin={identity?.origin ?? account.data?.origin} />
        </>
      }
      actions={
        <ConnectionSwitcher
          accountId={accountId}
          backend={backend}
          connectionId={connectionId}
          account={account.data}
        />
      }
      refresh={
        <RefreshStatus
          updatedAt={query.dataUpdatedAt}
          fetching={query.isFetching}
          failed={Boolean(query.error)}
          onRefresh={() => void query.refetch({ cancelRefetch: false })}
        />
      }
    />
  )
  if (!card || !health) {
    return (
      <div className={page.page}>
        {header}
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : null}
      </div>
    )
  }

  const section = search.section ?? health.defaultSection
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
      {header}
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
      <div className={styles.commands}>
        <ConnectionActions
          accountId={accountId}
          backend={backend}
          connectionId={connectionId}
          card={card}
          settingsAvailable={settingsAvailable}
          onInspect={refetch}
          resultTarget={resultSlot}
        />
        <div ref={setResultSlot} className={styles.results} />
      </div>
      <nav className={page.tabs} aria-label="Разделы подключения">
        {tabs.map((tab) => {
          const active = section === tab.id
          return (
            <Link
              key={tab.id}
              to={connectionRoute}
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
        <StatusSection
          backend={backend}
          card={card}
          health={health}
          hideSource={hide}
          onRetry={refetch}
        />
      ) : null}
      {section === 'auth' ? <AuthSection card={card} hideSource={hide} onRetry={refetch} /> : null}
      {section === 'webhook' ? (
        <WebhookSection card={card} hideSource={hide} onRetry={refetch} />
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
        />
      ) : null}
      {section === 'distribution' ? (
        <DistributionSection backend={backend} connectionId={connectionId} accountId={accountId} />
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

/**
 * What needs attention and where to fix it, then the state of each part as
 * quiet text. The overall state is in the page header.
 */
function HealthSummary({
  card,
  health,
  accountId,
  backend,
  connectionId,
}: {
  card: ConnectionCard
  health: ConnectionHealth
  accountId: string
  backend: string
  connectionId: string
}) {
  const params = { accountId, backend, connectionId }
  const checkAt =
    card.authorization_check?.data?.observed_at ?? card.authorization_check?.observed_at
  const facets: Array<{ section: ConnectionSection; label: string; node: ReactNode }> = [
    {
      section: 'auth',
      label: 'Авторизация',
      node: (
        <StatusBadge
          domain="authorization"
          state={card.authorization.data?.state}
          raw={card.authorization.data?.raw}
          variant="text"
        />
      ),
    },
    {
      section: 'webhook',
      label: 'Webhook',
      node: (
        <StatusBadge
          domain="webhook"
          state={card.webhook.data?.status}
          raw={card.webhook.data?.raw}
          variant="text"
        />
      ),
    },
    {
      section: 'activity',
      label: 'Activity',
      node: <StatusBadge domain="pilot" state={parsePilot(card)} variant="text" />,
    },
    {
      section: 'activity',
      label: 'Синхронизация',
      node: (
        <StatusBadge
          domain="sync"
          state={card.activity_sync.data?.state}
          raw={card.activity_sync.data?.raw}
          variant="text"
        />
      ),
    },
    {
      section: 'auth',
      label: 'Проверка amoCRM',
      node: (
        <time dateTime={checkAt} title={formatTime(checkAt)}>
          {formatRelativeTime(checkAt)}
        </time>
      ),
    },
  ]
  return (
    <section className={styles.summary} aria-label="Состояние подключения">
      {health.problems.length > 0 ? (
        <div className={styles.problemCenter}>
          <h2 className={styles.summaryTitle}>Требует внимания</h2>
          <ul className={styles.problems}>
            {health.problems.map((problem) => (
              <li key={problem.id}>
                <Link
                  to={connectionRoute}
                  params={params}
                  search={{ section: problem.section }}
                  className={styles.problem}
                >
                  <span>{problem.title}</span>
                  <span className={styles.problemTarget}>{sectionLabel(problem.section)} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.noProblems}>Активных проблем нет.</p>
      )}
      <nav className={styles.facets} aria-label="Сводка здоровья">
        {facets.map((facet) => (
          <Link
            key={facet.label}
            to={connectionRoute}
            params={params}
            search={{ section: facet.section }}
            className={styles.facet}
          >
            <span className={styles.facetLabel}>{facet.label}</span>
            {facet.node}
          </Link>
        ))}
      </nav>
    </section>
  )
}

/**
 * One action bar: the check first, then the state change and webhook repair
 * that fit the current state; rare and destructive commands under «Ещё».
 */
function ConnectionActions({
  accountId,
  backend,
  connectionId,
  card,
  settingsAvailable,
  onInspect,
  resultTarget,
}: {
  accountId: string
  backend: string
  connectionId: string
  card: ConnectionCard
  settingsAvailable: boolean
  onInspect: () => void
  resultTarget: Element | null
}) {
  const state = card.connection.data?.state
  const webhook = card.webhook.data
  const showEnable = state === 'disabled'
  const showDisable = Boolean(state && state !== 'disabled' && state !== 'uninstalled')
  const showReconcile = webhook?.status !== 'active' || webhook?.confirmed_destinations === 0
  const cmd = (command: string) => connectionCommand(backend, connectionId, command, accountId)
  return (
    <div className={styles.actionBar} role="group" aria-label="Действия с подключением">
      <CommandAction
        spec={cmd('check')}
        layout="inline"
        emphasis="primary"
        onInspect={onInspect}
        resultTarget={resultTarget}
      />
      {showEnable ? (
        <CommandAction
          spec={cmd('enable')}
          layout="inline"
          onInspect={onInspect}
          resultTarget={resultTarget}
        />
      ) : null}
      {showDisable ? (
        <CommandAction
          spec={cmd('disable')}
          layout="inline"
          onInspect={onInspect}
          resultTarget={resultTarget}
        />
      ) : null}
      {showReconcile ? (
        <CommandAction
          spec={cmd('reconcile')}
          layout="inline"
          onInspect={onInspect}
          resultTarget={resultTarget}
        />
      ) : null}
      {settingsAvailable ? (
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId/settings"
          params={{ accountId, backend, connectionId }}
          className={styles.actionLink}
          title="Настройки Activity и lead-status"
        >
          Настройки Activity
        </Link>
      ) : null}
      <div className={styles.more}>
        <ActionMenu>
          <Link
            to="/operations/admin"
            search={{ backend, target_type: 'installation', target_id: connectionId }}
          >
            История команд подключения
          </Link>
          <div className={styles.danger}>
            <p>
              Сброс авторизации не отзывает доступ в amoCRM. Удаление может снять webhook лишь
              частично.
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
    </div>
  )
}

function ConnectionSwitcher({
  accountId,
  backend,
  connectionId,
  account,
}: {
  accountId: string
  backend: string
  connectionId: string
  account: AccountCard | undefined
}) {
  const navigate = useNavigate()
  const items = (account?.connections ?? [])
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
  // The backend matters only when two connections share an integration code.
  const optionLabel = (item: AccountConnectionCard) =>
    items.filter((other) => other.integration_code === item.integration_code).length > 1
      ? `${item.integration_code} · ${item.backend}`
      : item.integration_code
  return (
    <div className={styles.switcher}>
      {prev ? (
        <Link
          to={connectionRoute}
          params={{ accountId, backend: prev.backend, connectionId: prev.connection_id }}
          className={styles.step}
          aria-label="Предыдущее подключение"
          title={`Предыдущее подключение: ${optionLabel(prev)}`}
        >
          ←
        </Link>
      ) : null}
      <select
        aria-label="Другие подключения аккаунта"
        value={`${backend}:${connectionId}`}
        onChange={(event) => {
          const [nextBackend, nextId] = event.target.value.split(':')
          void navigate({
            to: connectionRoute,
            params: { accountId, backend: nextBackend, connectionId: nextId },
          })
        }}
      >
        {items.map((item) => (
          <option
            key={`${item.backend}:${item.connection_id}`}
            value={`${item.backend}:${item.connection_id}`}
          >
            {optionLabel(item)}
          </option>
        ))}
      </select>
      {next ? (
        <Link
          to={connectionRoute}
          params={{ accountId, backend: next.backend, connectionId: next.connection_id }}
          className={styles.step}
          aria-label="Следующее подключение"
          title={`Следующее подключение: ${optionLabel(next)}`}
        >
          →
        </Link>
      ) : null}
    </div>
  )
}

function StatusSection({
  backend,
  card,
  health,
  hideSource,
  onRetry,
}: {
  backend: string
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
          observation={card.connection}
          hideSource={hideSource(card.connection.source)}
          onRetry={onRetry}
        >
          {(conn) => (
            <dl className={page.dl}>
              <dt>Интеграция</dt>
              <dd>
                <Link
                  to="/widgets/$backend/$integrationId"
                  params={{ backend, integrationId: conn.integration_id }}
                >
                  {conn.integration_code}
                </Link>
              </dd>
              <dt>Домен</dt>
              <dd>{formatNull(conn.account_domain)}</dd>
              <dt>Состояние установки</dt>
              <dd>
                <StatusBadge domain="connection" state={conn.state} raw={conn.raw} calm />
              </dd>
              <dt>Установлено</dt>
              <dd>
                <time dateTime={conn.created_at} title={formatTime(conn.created_at)}>
                  {formatDateLong(conn.created_at)}
                </time>
              </dd>
              {sameInstant(conn.created_at, conn.updated_at) ? null : (
                <>
                  <dt>Изменено</dt>
                  <dd>
                    <time dateTime={conn.updated_at} title={formatTime(conn.updated_at)}>
                      {formatRelativeTime(conn.updated_at)}
                    </time>
                  </dd>
                </>
              )}
              <dt>Происхождение</dt>
              <dd>
                <StatusBadge domain="origin" state={conn.origin} calm />
              </dd>
            </dl>
          )}
        </Observation>
      </CompactSection>
      <CompactSection title="Доступ к продуктам" defaultOpen={grantsOpen}>
        <Observation
          observation={card.grants}
          hideSource={hideSource(card.grants.source)}
          onRetry={onRetry}
        >
          {(grants) => <ProductGrants grants={grants} />}
        </Observation>
      </CompactSection>
    </>
  )
}

function AuthSection({
  card,
  hideSource,
  onRetry,
}: {
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
        status={
          <StatusBadge
            domain="authorization"
            state={card.authorization.data?.state}
            raw={card.authorization.data?.raw}
            calm
          />
        }
      >
        {(auth) => (
          <div className={page.stack}>
            <dl className={page.dl}>
              <dt>Учётные данные</dt>
              <dd>{auth.credentials_present ? 'есть' : 'нет'}</dd>
              <dt>Срок действия</dt>
              <dd>
                <time dateTime={auth.expires_at ?? undefined} title={formatTime(auth.expires_at)}>
                  {formatExpiry(auth.expires_at)}
                </time>
              </dd>
            </dl>
            {auth.unverified ? (
              <p className={styles.note}>Фактическая авторизация не проверена запросом к amoCRM.</p>
            ) : null}
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
              <span className={styles.note}>Требуется повторная проверка</span>
            ) : (
              <StatusBadge domain="verification" state={check.data?.classification} calm />
            )
          }
        >
          {(result) => (
            <div className={page.stack}>
              {staleOrUnknown ? (
                <p className={styles.secondary}>
                  Последний результат: {lookupState('verification', result.classification).label},{' '}
                  <time dateTime={result.observed_at} title={formatTime(result.observed_at)}>
                    {formatRelativeTime(result.observed_at)}
                  </time>
                  . Запустите «Проверить подключение», чтобы обновить.
                </p>
              ) : (
                <dl className={page.dl}>
                  <dt>Проверено</dt>
                  <dd>
                    <time dateTime={result.observed_at} title={formatTime(result.observed_at)}>
                      {formatRelativeTime(result.observed_at)}
                    </time>
                  </dd>
                </dl>
              )}
              {result.retry_after ? (
                <p>Повторно можно через {formatDurationSeconds(result.retry_after)}.</p>
              ) : null}
            </div>
          )}
        </Observation>
      ) : null}
    </>
  )
}

function WebhookSection({
  card,
  hideSource,
  onRetry,
}: {
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
          calm
        />
      }
    >
      {(hook) => (
        <div className={page.stack}>
          <WebhookEvents events={hook.events} />
          <WebhookCheckedAt
            checkedAt={hook.checked_at}
            lastError={hook.last_error}
            status={hook.status}
          />
          {hook.last_error ? (
            <p className={styles.note}>Последняя ошибка: {hook.last_error}</p>
          ) : null}
          <div className={styles.registry}>
            <p>Адресов в локальном реестре: {formatNull(hook.confirmed_destinations ?? null)}</p>
            {hook.confirmed_destinations == null ? (
              <p className={styles.secondary}>
                Источник не передал число адресов в локальном реестре.
              </p>
            ) : null}
            {hook.confirmed_destinations === 0 && hook.status === 'active' ? (
              <p className={styles.secondary}>
                В локальном реестре нет адресов. У подписки, созданной до появления реестра, это
                возможно и при рабочей доставке. Сверьте регистрацию в amoCRM; при необходимости
                запустите «Восстановить webhook».
              </p>
            ) : null}
            <p className={styles.secondary}>
              Число адресов, учтённых Core для этой установки. Реестр не подтверждает текущую
              подписку в amoCRM или доставку событий.
            </p>
          </div>
        </div>
      )}
    </Observation>
  )
}

function eventsCount(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} событие`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} события`
  }
  return `${count} событий`
}

function WebhookEvents({ events }: { events: string[] }) {
  if (events.length === 0) {
    return <p>События: {formatNull(null)}</p>
  }
  const groups = groupWebhookEvents(events)
  return (
    <details className={styles.events}>
      <summary>Подписка на {eventsCount(events.length)}</summary>
      {groups.map((group) => (
        <div key={group.group}>
          <strong>{group.group}</strong>
          <ul>
            {group.items.map((code) => (
              <li key={code} title={code}>
                {webhookEventLabel(code)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  )
}

function WebhookCheckedAt({
  checkedAt,
  lastError,
  status,
}: {
  status?: string
  checkedAt?: string | null
  lastError?: string | null
}) {
  const successAt = webhookSuccessfulCheckAt(checkedAt, lastError, status)
  if (!checkedAt) {
    return <p className={styles.secondary}>Сверка регистрации ещё не зафиксирована.</p>
  }
  return (
    <p>
      {successAt ? 'Последняя успешная сверка регистрации ' : 'Последняя сверка регистрации '}
      <time dateTime={checkedAt} title={formatTime(checkedAt)}>
        {formatRelativeTime(checkedAt)}
      </time>
    </p>
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
        status={<StatusBadge domain="pilot" state={parsePilot(card)} calm />}
      >
        {(raw) =>
          parseActivity(raw).pilot === 'enabled' ? (
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
          )
        }
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
            calm
          />
        }
      >
        {(sync) => {
          const duration = lastSyncDurationSeconds(sync)
          return (
            <div className={page.stack}>
              <p>{syncIdleReason(sync)}</p>
              <dl className={page.dl}>
                <dt>Задержка</dt>
                <dd>{formatDurationSeconds(sync.lag_seconds ?? null)}</dd>
                {duration !== null ? (
                  <>
                    <dt>Последний синк длился</dt>
                    <dd>{formatDurationSeconds(duration)}</dd>
                  </>
                ) : null}
                <dt>Последнее событие</dt>
                <dd>
                  <time
                    dateTime={sync.last_event_at ?? undefined}
                    title={formatTime(sync.last_event_at)}
                  >
                    {formatRelativeTime(sync.last_event_at)}
                  </time>
                </dd>
                <dt>Последний успех</dt>
                <dd>
                  <time
                    dateTime={sync.last_success_at ?? undefined}
                    title={formatTime(sync.last_success_at)}
                  >
                    {formatRelativeTime(sync.last_success_at)}
                  </time>
                </dd>
                <dt>Проверено по</dt>
                <dd>
                  <time
                    dateTime={sync.verified_through ?? undefined}
                    title={formatTime(sync.verified_through)}
                  >
                    {formatDateLong(sync.verified_through)}
                  </time>
                </dd>
              </dl>
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
          )
        }}
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
        const retryable = rows.some((row) => row.retry_allowed === true)
        return (
          <div className={page.stack}>
            <DataTable
              rows={rows}
              rowKey={(row) => row.command_id}
              onRowClick={(row) => setSelected(row)}
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
                  cell: (row) => (
                    <StatusBadge domain="delivery" state={row.status} raw={row.raw} calm />
                  ),
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
                ...(retryable
                  ? [
                      {
                        id: 'retry',
                        header: '',
                        cell: (row: Delivery) => (
                          <RetryDelivery
                            backend={backend}
                            connectionId={connectionId}
                            delivery={row}
                            onInspect={onRetry}
                          />
                        ),
                      },
                    ]
                  : []),
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
                <div className={page.stack}>
                  <dl className={page.dl}>
                    <dt>Доставка</dt>
                    <dd>
                      {selected.action} → {selected.target}
                    </dd>
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
                    <dt>Создана</dt>
                    <dd>{formatTime(selected.created_at)}</dd>
                    <dt>Обновлена</dt>
                    <dd>{formatTime(selected.updated_at)}</dd>
                  </dl>
                  <TechnicalDetails>
                    <CopyableId value={selected.command_id} label="ID доставки" />
                  </TechnicalDetails>
                </div>
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
            <p className={styles.summaryLine}>
              {[...grouped.entries()]
                .map(([type, count]) => `${jobLabel(type)} ×${count}`)
                .join(' · ')}
            </p>
            <DataTable
              rows={rows}
              rowKey={(job) => job.id}
              onRowClick={(job) => setSelected(job)}
              columns={[
                {
                  id: 'job',
                  header: 'Задача',
                  cell: (job) => jobLabel(job.type),
                  title: (job) => job.type,
                },
                {
                  id: 'status',
                  header: 'Статус',
                  cell: (job) => <StatusBadge domain="job" state={job.status} raw={job.raw} calm />,
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
              ]}
            />
            {sorted.length > 8 && !showAll ? (
              <button type="button" onClick={() => setShowAll(true)}>
                Показать все ({sorted.length})
              </button>
            ) : null}
            <DetailDrawer
              title={selected ? jobLabel(selected.type) : 'Задача'}
              open={Boolean(selected)}
              onClose={() => setSelected(null)}
            >
              {selected ? (
                <div className={page.stack}>
                  <dl className={page.dl}>
                    <dt>Статус</dt>
                    <dd>
                      <StatusBadge domain="job" state={selected.status} raw={selected.raw} />
                    </dd>
                    <dt>Попытки</dt>
                    <dd>{formatAttempts(selected.attempts, selected.max_attempts)}</dd>
                    <dt>Обновлена</dt>
                    <dd>{formatTime(selected.updated_at)}</dd>
                    <dt>Ошибка</dt>
                    <dd>{formatNull(selected.last_error_message)}</dd>
                  </dl>
                  <TechnicalDetails>
                    <p>Тип: {selected.type}</p>
                    <CopyableId value={selected.id} label="ID задачи" />
                  </TechnicalDetails>
                </div>
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
            <p className={styles.summaryLine}>
              {grouped
                .map((group) => `${auditLabel(group.key)} ×${group.items.length}`)
                .join(' · ')}
            </p>
            <DataTable
              rows={rows}
              rowKey={(item) => String(item.id)}
              onRowClick={(item) => setSelected(item)}
              columns={[
                {
                  id: 'action',
                  header: 'Событие',
                  cell: (item) => auditLabel(item.action),
                  title: (item) => item.action,
                },
                {
                  id: 'actor',
                  header: 'Кто',
                  cell: (item) => actorLabel(item.actor_type),
                  title: (item) => item.actor_id ?? actorLabel(item.actor_type),
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
              ]}
            />
            {items.length > 8 && !showAll ? (
              <button type="button" onClick={() => setShowAll(true)}>
                Показать все ({items.length})
              </button>
            ) : null}
            <DetailDrawer
              title={selected ? auditLabel(selected.action) : 'Событие'}
              open={Boolean(selected)}
              onClose={() => setSelected(null)}
            >
              {selected ? (
                <div className={page.stack}>
                  <dl className={page.dl}>
                    <dt>Кто</dt>
                    <dd>
                      {actorLabel(selected.actor_type)} {formatNull(selected.actor_id)}
                    </dd>
                    <dt>Когда</dt>
                    <dd>{formatTime(selected.created_at)}</dd>
                    <dt>Объект</dt>
                    <dd>
                      {formatNull(selected.object_type)} {formatNull(selected.object_id)}
                    </dd>
                  </dl>
                  <TechnicalDetails>
                    <p>Код события: {selected.action}</p>
                  </TechnicalDetails>
                </div>
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
              <StatusBadge domain="origin" state={item.origin} calm />
            </dd>
            <dt>Источник данных</dt>
            <dd>
              {card.connection.source} · {formatTime(card.connection.observed_at)}
            </dd>
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
