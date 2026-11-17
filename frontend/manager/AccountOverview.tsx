import type { ReactNode } from 'react'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import type { AccountDetail, AccountObservation } from './accountsApi'
import { CommandFeedback, useAccountCommand } from './accountCommands'
import { AccountForm } from './AccountForms'
import styles from './Accounts.module.css'

export type AccountActions = {
  onSaved: () => void
  onExpired: () => void
  onForbidden: () => void
}

export function AccountEvidence<T>({
  title,
  value,
  children,
}: {
  title: string
  value: AccountObservation<T>
  children: (value: T) => ReactNode
}) {
  return (
    <section className={styles.observation} aria-label={title}>
      <h3>{title}</h3>
      <StatusBadge domain="freshness" state={value.state} calm />
      <p className={styles.meta}>
        Источник {value.source}
        {value.observed_at ? (
          <>
            {' '}
            · наблюдение от{' '}
            <time dateTime={value.observed_at}>{formatTime(value.observed_at)}</time>
          </>
        ) : null}
      </p>
      {value.value !== undefined && (value.state === 'fresh' || value.state === 'stale')
        ? children(value.value)
        : null}
    </section>
  )
}

function AccountRefresh({ account, ...actions }: AccountActions & { account: AccountDetail }) {
  const attempt = useAccountCommand(account.account_id + ':refresh', actions)
  return (
    <div className={styles.form}>
      <form
        className={styles.actions}
        onSubmit={(event) => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          const components = fields.getAll('component')
          if (components.length === 0) return
          attempt.start({
            kind: 'refresh',
            account: account.account_id,
            key: crypto.randomUUID(),
            body: JSON.stringify({
              components,
              reason: 'Обновление наблюдений из карточки клиента',
            }),
          })
        }}
      >
        <fieldset disabled={attempt.locked}>
          <legend>Обновить наблюдения</legend>
          <label>
            <input type="checkbox" name="component" value="users" defaultChecked /> Пользователи
          </label>{' '}
          <label>
            <input type="checkbox" name="component" value="license" /> Лицензия
          </label>
        </fieldset>
        <button type="submit" disabled={attempt.locked}>
          Обновить
        </button>
      </form>
      <CommandFeedback command={attempt} />
    </div>
  )
}

export function AccountOverview({
  account,
  canWrite,
  ...actions
}: AccountActions & {
  account: AccountDetail
  canWrite: boolean
}) {
  const editable =
    canWrite &&
    account.capabilities.some(
      (capability) => capability.action === 'account.profile' && capability.allowed,
    )
  return (
    <div className={styles.workspace}>
      <dl className={styles.facts}>
        <dt>Домен</dt>
        <dd>{account.current_domain ?? '—'}</dd>
        <dt>Прежние домены</dt>
        <dd>{account.domain_aliases?.join(', ') || '—'}</dd>
        <dt>Регион</dt>
        <dd>{account.region ?? '—'}</dd>
        <dt>Часовой пояс</dt>
        <dd>{account.time_zone ?? '—'}</dd>
        <dt>Классификация</dt>
        <dd>{account.classification ?? '—'}</dd>
        <dt>Активные продукты</dt>
        <dd>{account.active_products_count}</dd>
        <dt>Сохранённая заметка</dt>
        <dd>{account.note ?? '—'}</dd>
      </dl>
      {editable ? (
        <AccountForm
          {...actions}
          id={account.account_id + ':profile'}
          title="Профиль клиента"
          version={account.version}
          initial={{
            name: account.display_name ?? '',
            note: account.note ?? '',
            classification: account.classification ?? '',
            reason: '',
          }}
          current={<p>Текущая заметка: {account.note ?? '—'}</p>}
          command={(fields, original, version, key) => ({
            kind: 'profile',
            account: account.account_id,
            version,
            key,
            body: JSON.stringify({
              display_name: fields.name === original.name ? undefined : fields.name.trim() || null,
              note: fields.note === original.note ? undefined : fields.note || null,
              classification:
                fields.classification === original.classification
                  ? undefined
                  : fields.classification || null,
              reason: fields.reason.trim(),
            }),
          })}
        >
          {(fields, edit) => (
            <>
              <label>
                Название
                <input
                  value={fields.name}
                  maxLength={512}
                  onChange={(event) => edit('name', event.target.value)}
                />
              </label>
              <label>
                Классификация
                <select
                  value={fields.classification}
                  onChange={(event) => edit('classification', event.target.value)}
                >
                  <option value="">Не указана</option>
                  <option>Без партнёра</option>
                  <option>Запрет работы</option>
                </select>
              </label>
              <label>
                Заметка
                <textarea
                  value={fields.note}
                  maxLength={4000}
                  onChange={(event) => edit('note', event.target.value)}
                />
              </label>
              <label>
                Причина изменения
                <input
                  required
                  value={fields.reason}
                  maxLength={1000}
                  onChange={(event) => edit('reason', event.target.value)}
                />
              </label>
            </>
          )}
        </AccountForm>
      ) : null}
      <AccountEvidence title="Лицензия amoCRM" value={account.license}>
        {(license) => (
          <dl className={styles.facts}>
            <dt>Оплачена до</dt>
            <dd>{license.license_until ? formatTime(license.license_until) : '—'}</dd>
            <dt>Тариф</dt>
            <dd>{license.tariff ?? '—'}</dd>
            <dt>Оплаченных мест</dt>
            <dd>{license.paid_seat_limit ?? '—'}</dd>
          </dl>
        )}
      </AccountEvidence>
      <AccountEvidence title="amoSTART" value={account.amostart}>
        {(date) => <p>{formatTime(date)}</p>}
      </AccountEvidence>
      <AccountEvidence title="Активные пользователи" value={account.active_users}>
        {(count) => <p>{count}</p>}
      </AccountEvidence>
      {canWrite &&
      account.capabilities.some(
        (capability) => capability.action === 'account.refresh' && capability.allowed,
      ) ? (
        <AccountRefresh account={account} {...actions} />
      ) : null}
    </div>
  )
}
