import { formatTime } from '../src/lib/format'
import type { AccountCheck } from './accountsApi'
import card from './AccountCard.module.css'
import styles from './Accounts.module.css'

const components = {
  installations: 'Установки наших виджетов',
  identity: 'Данные аккаунта amoCRM',
  users: 'Пользователи amoCRM',
}

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

export function AccountChecks({ checks }: { checks: AccountCheck[] | undefined }) {
  if (!checks?.length) return null
  const now = new Date()
  return (
    <details className={card.summaryPanel}>
      <summary>Суточная проверка аккаунта</summary>
      <dl className={styles.facts}>
        {checks.map((check) => (
          <div key={check.component}>
            <dt>{components[check.component]}</dt>
            <dd>{accountCheckLabel(check, now)}</dd>
            <dd>Последняя проверка · {formatTime(check.attempted_at)}</dd>
            <dd>Последнее успешное обновление · {formatTime(check.succeeded_at)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
