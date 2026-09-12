export const tones = ['ok', 'attention', 'action', 'error', 'off', 'unknown'] as const

export type Tone = (typeof tones)[number]

export type StateEntry = {
  tone: Tone
  label: string
}

export type StateDomain =
  | 'freshness'
  | 'source'
  | 'integration'
  | 'grant'
  | 'connection'
  | 'authorization'
  | 'webhook'
  | 'pilot'
  | 'delivery'
  | 'sync'
  | 'job'
  | 'job_outcome'
  | 'operation'
  | 'account'
  | 'origin'
  | 'problem'
  | 'employee_status'

const unknownEntry: StateEntry = { tone: 'unknown', label: 'Неизвестно' }

const dictionaries: Record<StateDomain, Record<string, StateEntry>> = {
  freshness: {
    fresh: { tone: 'ok', label: 'Актуально' },
    stale: { tone: 'attention', label: 'Данные устарели' },
    unavailable: { tone: 'error', label: 'Источник недоступен' },
    unknown: { tone: 'unknown', label: 'Нет данных' },
  },
  source: {
    available: { tone: 'ok', label: 'Доступен' },
    degraded: { tone: 'attention', label: 'Частично доступен' },
    unavailable: { tone: 'error', label: 'Недоступен' },
    unknown: { tone: 'unknown', label: 'Ещё не опрашивался' },
  },
  integration: {
    active: { tone: 'ok', label: 'Активна' },
    disabled: { tone: 'off', label: 'Отключена оператором' },
  },
  grant: {
    granted: { tone: 'ok', label: 'Выдан' },
    not_granted: { tone: 'off', label: 'Не выдан' },
  },
  connection: {
    pending: { tone: 'attention', label: 'Ожидает авторизации' },
    authorizing: { tone: 'attention', label: 'Авторизация выполняется' },
    active: { tone: 'ok', label: 'Активно' },
    reauth_required: { tone: 'action', label: 'Нужна повторная авторизация' },
    disabled: { tone: 'off', label: 'Отключено оператором' },
    uninstalled: { tone: 'off', label: 'Удалено' },
    error: { tone: 'error', label: 'Ошибка установки' },
  },
  authorization: {
    missing: { tone: 'action', label: 'Нет учётных данных' },
    reauth_required: { tone: 'action', label: 'Требуется повторная авторизация' },
    refreshing: { tone: 'attention', label: 'Обновление токена выполняется' },
    expired_refreshable: {
      tone: 'attention',
      label: 'Access token истёк, обновится при следующем вызове',
    },
    valid: { tone: 'ok', label: 'Действует' },
  },
  webhook: {
    pending: { tone: 'attention', label: 'Ожидает регистрации (reconcile)' },
    active: { tone: 'ok', label: 'Зарегистрирована' },
    disabled: { tone: 'off', label: 'Отключена' },
    unregistered: { tone: 'off', label: 'Снята (uninstall)' },
    error: { tone: 'error', label: 'Ошибка регистрации' },
  },
  pilot: {
    enabled: { tone: 'ok', label: 'Пилот включён' },
    disabled: { tone: 'off', label: 'Пилот выключен' },
    not_configured: { tone: 'unknown', label: 'Пилот не настроен' },
  },
  delivery: {
    pending_delivery: { tone: 'attention', label: 'Ожидает доставки' },
    delivering: { tone: 'attention', label: 'Доставляется' },
    accepted: { tone: 'ok', label: 'Принята' },
    failed: { tone: 'error', label: 'Ошибка доставки' },
    expired: { tone: 'error', label: 'Истекла' },
  },
  sync: {
    unknown: { tone: 'unknown', label: 'Нет данных' },
  },
  job: {
    queued: { tone: 'attention', label: 'В очереди' },
    processing: { tone: 'attention', label: 'Выполняется' },
    retry: { tone: 'attention', label: 'Повтор' },
    completed: { tone: 'ok', label: 'Завершена' },
    failed: { tone: 'error', label: 'Ошибка' },
    dead: { tone: 'error', label: 'Исчерпаны попытки' },
    cancelled: { tone: 'off', label: 'Отменена' },
  },
  job_outcome: {
    completed: { tone: 'ok', label: 'Успех' },
    retry: { tone: 'attention', label: 'Повтор' },
    failed: { tone: 'error', label: 'Ошибка' },
    dead: { tone: 'error', label: 'Исчерпаны попытки' },
    cancelled: { tone: 'off', label: 'Отменена' },
    lease_expired: { tone: 'error', label: 'Истекла аренда' },
  },
  operation: {
    accepted: { tone: 'attention', label: 'Принята' },
    pending: { tone: 'attention', label: 'Ожидает' },
    running: { tone: 'attention', label: 'Выполняется' },
    succeeded: { tone: 'ok', label: 'Успех' },
    failed: { tone: 'error', label: 'Ошибка' },
    partial: { tone: 'attention', label: 'Частично' },
    unknown_outcome: { tone: 'unknown', label: 'Исход неизвестен' },
  },
  account: {
    partial: { tone: 'attention', label: 'Частичные данные' },
    needs_action: { tone: 'action', label: 'Нужно действие' },
    error: { tone: 'error', label: 'Ошибка' },
    attention: { tone: 'attention', label: 'Требует внимания' },
    inactive: { tone: 'off', label: 'Неактивен' },
    ok: { tone: 'ok', label: 'В порядке' },
  },
  origin: {
    real: { tone: 'ok', label: 'реальные данные' },
    fixture: { tone: 'attention', label: 'тестовые данные' },
  },
  problem: {
    reauth_required: { tone: 'action', label: 'Нужна повторная авторизация' },
    webhook_error: { tone: 'error', label: 'Ошибка webhook' },
    job_failures: { tone: 'error', label: 'Ошибки задач' },
    missing_credentials: { tone: 'action', label: 'Нет учётных данных' },
    disabled: { tone: 'off', label: 'Отключено' },
    source_unavailable: { tone: 'error', label: 'Источник недоступен' },
  },
  employee_status: {
    active: { tone: 'ok', label: 'Активен' },
    disabled: { tone: 'off', label: 'Отключён' },
  },
}

export const employeeRoleLabels: Record<string, string> = {
  admin: 'Администратор',
  operator: 'Оператор',
  viewer: 'Наблюдатель',
}

export const problemCodes = [
  'reauth_required',
  'webhook_error',
  'job_failures',
  'missing_credentials',
  'disabled',
  'source_unavailable',
] as const

export function lookupState(domain: StateDomain, canonical: string | null | undefined): StateEntry {
  if (!canonical) {
    return unknownEntry
  }
  return dictionaries[domain][canonical] ?? { tone: 'unknown', label: unknownEntry.label }
}

export function isKnownState(domain: StateDomain, canonical: string): boolean {
  return Object.prototype.hasOwnProperty.call(dictionaries[domain], canonical)
}
