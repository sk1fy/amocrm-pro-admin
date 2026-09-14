import type {
  AccountConnectionCard,
  ActivitySync,
  ConnectionCard,
  ConnectionIdentity,
  CoreAudit,
  Job,
  Observation,
} from '../api/types'
import { parseActivity } from './activity'
import { collectCoreAuthIncident, type CoreAuthIncident } from './incidents'

export const connectionSections = [
  'status',
  'auth',
  'webhook',
  'activity',
  'jobs',
  'history',
  'tech',
] as const

export type ConnectionSection = (typeof connectionSections)[number]

export type ConnectionHealthState =
  | 'working'
  | 'working_with_warnings'
  | 'needs_action'
  | 'unavailable'

export type ConnectionProblem = {
  id: string
  title: string
  section: ConnectionSection
  action?: 'check' | 'reconcile' | 'retry'
}

export type ConnectionHealth = {
  state: ConnectionHealthState
  reasons: string[]
  problems: ConnectionProblem[]
  defaultSection: ConnectionSection
  pageSource: string
  coreAuthIncident: CoreAuthIncident | null
}

const openJob = new Set(['queued', 'processing', 'retry', 'failed', 'dead'])

function pushProblem(problems: ConnectionProblem[], problem: ConnectionProblem) {
  if (problems.some((item) => item.id === problem.id)) {
    return
  }
  problems.push(problem)
}

function freshnessProblem(
  problems: ConnectionProblem[],
  observation: Observation<unknown> | undefined,
  id: string,
  title: string,
  section: ConnectionSection,
) {
  if (!observation) {
    return
  }
  if (observation.freshness === 'unavailable') {
    pushProblem(problems, { id, title, section, action: 'retry' })
  }
}

export function syncIdleReason(sync: ActivitySync): string {
  if (sync.reauth_required) {
    return 'Для синхронизации нужна повторная авторизация клиента.'
  }
  if (sync.state === 'not_enabled' || sync.enabled === false) {
    return 'Синхронизация выключена.'
  }
  if (sync.state === 'disabled') {
    return 'Синхронизация выключена командой.'
  }
  if (sync.state === 'paused') {
    return 'Синхронизация приостановлена источником.'
  }
  if (sync.state === 'failed') {
    return 'Последний запуск синхронизации завершился ошибкой.'
  }
  if (sync.state === 'running') {
    return 'Синхронизация выполняется.'
  }
  if (sync.state === 'pending') {
    return 'Ожидает следующего запуска.'
  }
  if (sync.state === 'idle') {
    if ((sync.lag_seconds ?? 0) > 300) {
      return 'Ожидает следующего запуска, задержка больше пяти минут.'
    }
    if (!sync.last_event_at) {
      return 'Нет новых событий.'
    }
    return 'Нет новых событий, синхронизация включена и сейчас не выполняется.'
  }
  return 'Состояние синхронизации не подтверждено.'
}

export function computeConnectionHealth(card: ConnectionCard): ConnectionHealth {
  const problems: ConnectionProblem[] = []
  const identity = card.connection.data
  const pageSource = card.connection.source || card.backend
  const coreAuthIncident = collectCoreAuthIncident([
    { scope: 'activity', observation: card.activity },
    { scope: 'sync', observation: card.activity_sync },
  ])

  if (card.connection.freshness === 'unavailable') {
    pushProblem(problems, {
      id: 'connection-unavailable',
      title: 'Карточка установки недоступна',
      section: 'status',
      action: 'retry',
    })
  }

  if (coreAuthIncident) {
    pushProblem(problems, {
      id: coreAuthIncident.id,
      title: 'Activity недоступна из-за авторизации Core',
      section: 'activity',
      action: 'retry',
    })
  } else {
    freshnessProblem(
      problems,
      card.activity,
      'activity-unavailable',
      'Данные Activity недоступны',
      'activity',
    )
    freshnessProblem(
      problems,
      card.activity_sync,
      'sync-unavailable',
      'Источник синхронизации недоступен',
      'activity',
    )
  }

  const state = identity?.state
  if (state === 'reauth_required') {
    pushProblem(problems, {
      id: 'reauth',
      title: 'Нужна повторная авторизация клиента',
      section: 'auth',
      action: 'check',
    })
  }
  if (state === 'error') {
    pushProblem(problems, {
      id: 'installation-error',
      title: 'Ошибка установки',
      section: 'status',
    })
  }
  if (state === 'disabled') {
    pushProblem(problems, {
      id: 'disabled',
      title: 'Подключение отключено оператором',
      section: 'status',
    })
  }
  if (state === 'uninstalled') {
    pushProblem(problems, {
      id: 'uninstalled',
      title: 'Подключение удалено',
      section: 'status',
    })
  }
  if (state === 'pending' || state === 'authorizing') {
    pushProblem(problems, {
      id: 'pending-auth',
      title: 'Клиент ещё не завершил авторизацию',
      section: 'auth',
    })
  }

  const auth = card.authorization.data
  if (card.authorization.freshness === 'unavailable') {
    pushProblem(problems, {
      id: 'auth-unavailable',
      title: 'Состояние авторизации недоступно',
      section: 'auth',
      action: 'retry',
    })
  } else if (auth?.state === 'missing' || auth?.credentials_present === false) {
    pushProblem(problems, {
      id: 'missing-credentials',
      title: 'Нет учётных данных',
      section: 'auth',
    })
  } else if (auth?.state === 'reauth_required') {
    pushProblem(problems, {
      id: 'auth-reauth',
      title: 'Локальная авторизация требует повторного OAuth',
      section: 'auth',
    })
  } else if (auth?.unverified) {
    pushProblem(problems, {
      id: 'unverified',
      title: 'Фактическая авторизация не проверена запросом к amoCRM',
      section: 'auth',
      action: 'check',
    })
  }

  const check = card.authorization_check
  if (check?.freshness === 'unavailable') {
    pushProblem(problems, {
      id: 'check-unavailable',
      title: 'Результат проверки amoCRM недоступен',
      section: 'auth',
      action: 'retry',
    })
  } else if (!check || check.freshness === 'unknown' || !check.data) {
    pushProblem(problems, {
      id: 'check-unknown',
      title: 'Проверка amoCRM ещё не выполнялась',
      section: 'auth',
      action: 'check',
    })
  } else if (check.freshness === 'stale') {
    pushProblem(problems, {
      id: 'check-stale',
      title: 'Проверка amoCRM устарела',
      section: 'auth',
      action: 'check',
    })
  } else if (check.data.classification === 'auth_error') {
    pushProblem(problems, {
      id: 'check-auth-error',
      title: 'amoCRM отклонил авторизацию',
      section: 'auth',
      action: 'check',
    })
  } else if (
    check.data.classification === 'network_error' ||
    check.data.classification === 'internal_error'
  ) {
    pushProblem(problems, {
      id: 'check-failed',
      title: 'Последняя проверка amoCRM не подтвердила доступ',
      section: 'auth',
      action: 'check',
    })
  }

  const webhook = card.webhook.data
  if (card.webhook.freshness === 'unavailable') {
    pushProblem(problems, {
      id: 'webhook-unavailable',
      title: 'Состояние webhook недоступно',
      section: 'webhook',
      action: 'retry',
    })
  } else if (webhook?.status === 'error') {
    pushProblem(problems, {
      id: 'webhook-error',
      title: 'Ошибка регистрации webhook',
      section: 'webhook',
      action: 'reconcile',
    })
  } else if (webhook && webhook.confirmed_destinations === 0 && webhook.status === 'active') {
    pushProblem(problems, {
      id: 'webhook-destinations',
      title: 'Нет подтверждённых адресов доставки webhook',
      section: 'webhook',
      action: 'reconcile',
    })
  }

  const jobs = card.recent_jobs.data ?? []
  if (jobs.some((job) => job.status === 'failed' || job.status === 'dead')) {
    pushProblem(problems, {
      id: 'failed-jobs',
      title: 'Есть незавершённые или ошибочные фоновые задачи',
      section: 'jobs',
    })
  }

  const sync = card.activity_sync.data
  if (
    !coreAuthIncident &&
    card.activity_sync.freshness !== 'unavailable' &&
    sync?.state === 'idle' &&
    (sync.lag_seconds ?? 0) > 300
  ) {
    pushProblem(problems, {
      id: 'sync-lag',
      title: 'Синхронизация простаивает с задержкой',
      section: 'activity',
    })
  }

  const reasons = problems.slice(0, 3).map((item) => item.title)
  const healthState = summarize(card.connection, identity, problems)
  return {
    state: healthState,
    reasons,
    problems,
    defaultSection: problems[0]?.section ?? 'status',
    pageSource,
    coreAuthIncident,
  }
}

function summarize(
  connection: Observation<ConnectionIdentity>,
  identity: ConnectionIdentity | null | undefined,
  problems: ConnectionProblem[],
): ConnectionHealthState {
  if (connection.freshness === 'unavailable') {
    return 'unavailable'
  }
  const blocking = problems.filter((item) =>
    [
      'connection-unavailable',
      'reauth',
      'installation-error',
      'disabled',
      'uninstalled',
      'missing-credentials',
      'auth-reauth',
      'check-auth-error',
      'webhook-error',
      'core-admin-auth',
    ].includes(item.id),
  )
  if (blocking.length > 0) {
    return 'needs_action'
  }
  if (problems.length > 0) {
    return 'working_with_warnings'
  }
  if (identity?.state === 'active') {
    return 'working'
  }
  return 'working_with_warnings'
}

export function jobNeedsAttention(job: Job): boolean {
  return openJob.has(job.status)
}

export function sortJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((left, right) => {
    const leftBad = jobNeedsAttention(left) ? 0 : 1
    const rightBad = jobNeedsAttention(right) ? 0 : 1
    if (leftBad !== rightBad) {
      return leftBad - rightBad
    }
    return right.updated_at.localeCompare(left.updated_at)
  })
}

export function groupByType<T extends { type?: string; action?: string }>(
  items: T[],
  key: (item: T) => string,
): Array<{ key: string; items: T[] }> {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const group = key(item)
    const list = buckets.get(group) ?? []
    list.push(item)
    buckets.set(group, list)
  }
  return [...buckets.entries()].map(([group, grouped]) => ({ key: group, items: grouped }))
}

export function groupAudit(items: CoreAudit[]): Array<{ key: string; items: CoreAudit[] }> {
  return groupByType(items, (item) => item.action)
}

export function parsePilot(card: ConnectionCard): string {
  return parseActivity(card.activity.data).pilot || 'not_configured'
}

export function sectionDefaultOpen(
  problems: ConnectionProblem[],
  section: ConnectionSection,
  observation?: Observation<unknown>,
): boolean {
  if (problems.some((item) => item.section === section)) {
    return true
  }
  if (!observation) {
    return false
  }
  return observation.freshness === 'unavailable' || observation.freshness === 'stale'
}

export function lastSyncDurationSeconds(sync: ActivitySync): number | null {
  if (!sync.last_event_at || !sync.last_success_at) {
    return null
  }
  const started = Date.parse(sync.last_event_at)
  const finished = Date.parse(sync.last_success_at)
  if (Number.isNaN(started) || Number.isNaN(finished)) {
    return null
  }
  const seconds = Math.round((finished - started) / 1000)
  if (seconds <= 0 || seconds > 24 * 3600) {
    return null
  }
  return seconds
}

export function webhookSuccessfulCheckAt(
  checkedAt?: string | null,
  lastError?: string | null,
): string | null {
  if (!checkedAt || lastError) {
    return null
  }
  return checkedAt
}

export function widgetProblems(conn: AccountConnectionCard): string[] {
  const items: string[] = []
  if (conn.state === 'reauth_required') {
    items.push('Нужна повторная авторизация')
  }
  if (conn.state === 'error') {
    items.push('Ошибка установки')
  }
  if (conn.state === 'disabled') {
    items.push('Отключено')
  }
  if (conn.authorization?.state === 'missing') {
    items.push('Нет учётных данных')
  } else if (conn.authorization?.unverified) {
    items.push('Авторизация не проверена')
  }
  if (conn.webhook?.status === 'error') {
    items.push('Ошибка webhook')
  }
  return items
}
