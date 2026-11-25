import type { AccountCheck } from './accountsApi'

const reasons: Record<string, string> = {
  account_blocked: 'Запрет работы',
  catalog_binding_missing: 'Привязка виджета не подтверждена',
  source_scope_changed: 'Привязка виджета не подтверждена',
  source_permission_denied: 'Требуется авторизация',
  source_rate_limited: 'Лимит запросов amoCRM',
  source_unavailable: 'Источник недоступен',
  source_timeout: 'Источник не ответил вовремя',
  source_incomplete: 'Получены неполные данные',
}

export function accountCheckLabel(check: AccountCheck, now: Date) {
  if (check.reason) return reasons[check.reason] ?? 'Проверка не завершена'
  if (!check.succeeded_at) return 'Ожидает проверки'
  return now.getTime() - Date.parse(check.succeeded_at) >= 86400000
    ? 'Данные устарели'
    : 'Данные актуальны'
}
