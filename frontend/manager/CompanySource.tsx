import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import type { parseCompanySource } from './companyApi'
import styles from './Accounts.module.css'

export function CompanySource({
  source,
  compact = false,
}: {
  source: ReturnType<typeof parseCompanySource>
  compact?: boolean
}) {
  if (compact) {
    return (
      <p className={styles.meta}>
        <StatusBadge domain="company_source" state={source.state} calm />
        {source.observed_at ? ' · Воронки обновлены ' + formatTime(source.observed_at) : null}
      </p>
    )
  }
  return (
    <div className={styles.meta}>
      <StatusBadge domain="company_source" state={source.state} calm />
      <p>
        Platform · источник {source.source_account_id ?? '—'} · привязка{' '}
        {source.binding_revision ?? '—'}
      </p>
      <p>
        Наблюдение: {source.observed_at ? formatTime(source.observed_at) : '—'} · полнота:{' '}
        {source.complete ? 'полный снимок' : 'полного снимка нет'}
      </p>
      {source.error_code ? <p>Ошибка источника: {source.error_code}</p> : null}
      {source.retry_at ? <p>Следующая попытка источника: {formatTime(source.retry_at)}</p> : null}
    </div>
  )
}
