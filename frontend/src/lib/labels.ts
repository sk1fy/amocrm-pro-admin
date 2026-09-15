const jobLabels: Record<string, string> = {
  'admin.connection_check': 'Проверка подключения',
  'webhook.process_event': 'Обработка webhook-события',
  'webhook.parse': 'Разбор webhook',
  'webhook.reconcile': 'Восстановление webhook',
  'oauth.refresh': 'Обновление токена',
  'activity.sync': 'Синхронизация Activity',
  'activity.deliver': 'Доставка команды Activity',
  'activity.command_deliver': 'Доставка команды Activity',
}

const auditLabels: Record<string, string> = {
  'admin.command.succeeded': 'Команда администратора выполнена',
  'admin.command.failed': 'Команда администратора завершилась ошибкой',
  'admin.command.accepted': 'Команда администратора принята',
  'widget.ping': 'Проверка виджета',
  'webhook.event.processed': 'Webhook-событие обработано',
  'webhook.event.received': 'Webhook-событие получено',
  'installation.authorized': 'Установка авторизована',
  'installation.disabled': 'Установка отключена',
  'installation.enabled': 'Установка включена',
  'installation.uninstalled': 'Установка удалена',
  'installation.revoked': 'Авторизация сброшена',
  'auth.login': 'Вход',
  'auth.login_failed': 'Неуспешный вход',
  'auth.logout': 'Выход',
  'employee.create': 'Сотрудник создан',
  'employee.update': 'Сотрудник изменён',
  'employee.disable': 'Сотрудник отключён',
  'employee.sessions.revoke': 'Сессии сотрудника отозваны',
  'session.revoke': 'Сессия отозвана',
  'operation.accepted': 'Операция принята',
  'operation.pending': 'Операция ожидает',
  'operation.running': 'Операция выполняется',
  'operation.succeeded': 'Операция выполнена',
  'operation.failed': 'Операция завершилась ошибкой',
  'operation.partial': 'Операция выполнена частично',
  'operation.unknown_outcome': 'Исход операции неизвестен',
  'view.create': 'Представление создано',
  'view.update': 'Представление обновлено',
  'view.delete': 'Представление удалено',
}

export const auditActionKeys = Object.keys(auditLabels)

const actorLabels: Record<string, string> = {
  admin: 'Сотрудник админки',
  system: 'Система',
  integration: 'Интеграция',
  user: 'Пользователь amoCRM',
  worker: 'Фоновый обработчик',
  customer: 'Клиент',
}

const webhookEventLabels: Record<string, string> = {
  add_lead: 'Сделка создана',
  update_lead: 'Сделка изменена',
  delete_lead: 'Сделка удалена',
  status_lead: 'Смена статуса сделки',
  restore_lead: 'Сделка восстановлена',
  responsible_lead: 'Смена ответственного сделки',
  note_lead: 'Примечание к сделке',
  add_contact: 'Контакт создан',
  update_contact: 'Контакт изменён',
  delete_contact: 'Контакт удалён',
  restore_contact: 'Контакт восстановлен',
  note_contact: 'Примечание к контакту',
  add_company: 'Компания создана',
  update_company: 'Компания изменена',
  delete_company: 'Компания удалена',
  add_talk: 'Разговор создан',
  update_talk: 'Разговор изменён',
}

const webhookEventGroups: Record<string, string> = {
  add_lead: 'Сделки',
  update_lead: 'Сделки',
  delete_lead: 'Сделки',
  status_lead: 'Сделки',
  restore_lead: 'Сделки',
  responsible_lead: 'Сделки',
  note_lead: 'Сделки',
  add_contact: 'Контакты',
  update_contact: 'Контакты',
  delete_contact: 'Контакты',
  restore_contact: 'Контакты',
  note_contact: 'Контакты',
  add_company: 'Компании',
  update_company: 'Компании',
  delete_company: 'Компании',
  add_talk: 'Разговоры',
  update_talk: 'Разговоры',
}

export type ExplainedError = {
  title: string
  action: string
  affects: string
  technical: string
}

function lookup(map: Record<string, string>, value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  return map[value] ?? null
}

export function jobLabel(type: string): string {
  return lookup(jobLabels, type) ?? 'Фоновая задача'
}

export function auditLabel(action: string): string {
  return lookup(auditLabels, action) ?? 'Событие журнала'
}

export function isFailedAudit(action: string, outcome?: string | null): boolean {
  if (outcome === 'failed' || outcome === 'denied') {
    return true
  }
  return action.includes('login_failed') || action.endsWith('.failed')
}

export function actorLabel(type: string | null | undefined): string {
  if (!type) {
    return 'Неизвестный субъект'
  }
  return lookup(actorLabels, type) ?? type
}

export function webhookEventLabel(code: string): string {
  return lookup(webhookEventLabels, code) ?? code
}

export function webhookEventGroup(code: string): string {
  return lookup(webhookEventGroups, code) ?? 'Другие'
}

export function groupWebhookEvents(events: string[]): Array<{ group: string; items: string[] }> {
  const buckets = new Map<string, string[]>()
  for (const event of events) {
    const group = webhookEventGroup(event)
    const items = buckets.get(group) ?? []
    items.push(event)
    buckets.set(group, items)
  }
  return [...buckets.entries()].map(([group, items]) => ({ group, items }))
}

export function explainError(
  message: string | null | undefined,
  code?: string | null,
): ExplainedError | null {
  if (!message && !code) {
    return null
  }
  const text = message ?? ''
  if (text.toLowerCase().includes('core admin authentication failed')) {
    return {
      title:
        'Сервис не смог получить данные Activity: внутренняя авторизация бекенда завершилась ошибкой.',
      action:
        'Повторите запрос. Если ошибка сохраняется, проверьте доступ Admin API к Core и журнал операций.',
      affects:
        'Виджет amoCRM это не отключает. Недоступны административные данные Activity, панелей и сотрудников.',
      technical: text || code || '',
    }
  }
  return {
    title: text || 'Источник вернул ошибку.',
    action: 'Повторите запрос. Если ошибка повторяется, откройте технические подробности и журнал.',
    affects: 'Зависит от раздела, в котором показана ошибка.',
    technical: [code, text].filter(Boolean).join(': '),
  }
}

export function isCoreAdminAuthError(message: string | null | undefined): boolean {
  return (message ?? '').toLowerCase().includes('core admin authentication failed')
}
