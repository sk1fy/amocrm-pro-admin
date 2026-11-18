import { useState, type ReactNode } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatNull, formatTime } from '../src/lib/format'
import type { AccountDetail, AccountObservation } from './accountsApi'
import { CommandFeedback, useAccountCommand } from './accountCommands'
import { AccountForm } from './AccountForms'
import styles from './Accounts.module.css'
import card from './AccountCard.module.css'

export type AccountActions = {
  onSaved: () => void
  onExpired: () => void
  onForbidden: () => void
}

function observedValue<T>(value: AccountObservation<T>) {
  return value.state === 'fresh' || value.state === 'stale' ? value.value : undefined
}

export function ObservationSource({ value }: { value: AccountObservation<unknown> }) {
  return (
    <div className={card.observation}>
      <StatusBadge domain="freshness" state={value.state} calm />
      <span className={styles.meta}>
        {value.source}
        {value.observed_at ? (
          <>
            {' '}
            · <time dateTime={value.observed_at}>{formatTime(value.observed_at)}</time>
          </>
        ) : null}
      </span>
    </div>
  )
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
  const data = observedValue(value)
  return (
    <section className={card.surface} aria-label={title}>
      <header className={card.sectionHeader}>
        <h2>{title}</h2>
        <ObservationSource value={value} />
      </header>
      {data !== undefined ? children(data) : <p className={card.empty}>Нет доступного снимка.</p>}
    </section>
  )
}

function AccountRefresh({ account, ...actions }: AccountActions & { account: AccountDetail }) {
  const attempt = useAccountCommand(account.account_id + ':refresh', actions)
  return (
    <details className={card.refresh}>
      <summary>Обновить данные</summary>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          const components = fields.getAll('component')
          if (components.length === 0) return
          attempt.start({
            kind: 'refresh',
            account: account.account_id,
            key: createRequestKey(),
            body: JSON.stringify({
              components,
              reason: 'Обновление наблюдений из карточки клиента',
            }),
          })
        }}
      >
        <fieldset disabled={attempt.locked}>
          <legend>Что обновить</legend>
          <label>
            <input type="checkbox" name="component" value="users" defaultChecked /> Пользователи
          </label>
          <label>
            <input type="checkbox" name="component" value="license" /> Лицензия
          </label>
        </fieldset>
        <button type="submit" className={card.primary} disabled={attempt.locked}>
          Обновить
        </button>
      </form>
      <CommandFeedback command={attempt} />
    </details>
  )
}

export function accountTitle(account: AccountDetail) {
  return (
    account.display_name ?? account.current_domain ?? 'Аккаунт amoCRM ' + account.amo_account_id
  )
}

export function AccountOverview({
  account,
  canWrite,
  usersLink,
  ...actions
}: AccountActions & {
  account: AccountDetail
  canWrite: boolean
  usersLink: (label: string) => ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const title = accountTitle(account)
  const license = observedValue(account.license)
  const activeUsers = observedValue(account.active_users)
  const amostart = observedValue(account.amostart)
  const editable =
    canWrite &&
    account.capabilities.some(
      (capability) => capability.action === 'account.profile' && capability.allowed,
    )
  return (
    <>
      <section className={card.surface} aria-label="Сводка аккаунта">
        <div className={card.identity}>
          <span className={card.avatar} aria-hidden="true">
            {Array.from(title)[0]?.toUpperCase() ?? '?'}
          </span>
          <div className={card.identityInfo}>
            <div className={card.identityTitle}>
              <h1>{title}</h1>
              <span className={card.id}>ID {account.amo_account_id}</span>
            </div>
            <p className={styles.meta}>
              {[
                account.current_domain !== title ? account.current_domain : null,
                account.region,
                account.time_zone,
              ]
                .filter(Boolean)
                .join(' · ') || 'Аккаунт amoCRM'}
              {account.domain_aliases?.length ? (
                <> · прежние домены {account.domain_aliases.join(', ')}</>
              ) : null}
            </p>
          </div>
          <dl className={card.classification}>
            <dt>Статус клиента</dt>
            <dd>{formatNull(account.classification)}</dd>
          </dl>
        </div>
        <dl className={card.metrics}>
          <div>
            <dt>Тариф amoCRM</dt>
            <dd>{formatNull(license?.tariff)}</dd>
            <ObservationSource value={account.license} />
          </div>
          <div>
            <dt>Лицензия действует до</dt>
            <dd>{formatTime(license?.license_until)}</dd>
            {license?.paid_seat_limit != null ? (
              <span className={styles.meta}>Оплаченных мест {license.paid_seat_limit}</span>
            ) : null}
            <ObservationSource value={account.license} />
          </div>
          <div>
            <dt>Активные пользователи</dt>
            <dd>{activeUsers === undefined ? '—' : usersLink(String(activeUsers))}</dd>
            <ObservationSource value={account.active_users} />
          </div>
          {amostart !== undefined ? (
            <div>
              <dt>amoSTART</dt>
              <dd>{formatTime(amostart)}</dd>
              <ObservationSource value={account.amostart} />
            </div>
          ) : null}
        </dl>
      </section>
      <div className={card.summaryGrid}>
        <section className={card.summaryPanel} aria-label="Продукты аккаунта">
          <h2>Продукты аккаунта</h2>
          <p>
            Активные продукты <strong>{account.active_products_count}</strong>
          </p>
          {canWrite &&
          account.capabilities.some(
            (capability) => capability.action === 'account.refresh' && capability.allowed,
          ) ? (
            <AccountRefresh account={account} {...actions} />
          ) : null}
        </section>
        <section className={card.summaryPanel} aria-labelledby="account-note">
          <header className={card.noteHeading}>
            <h2 id="account-note">Примечание</h2>
            {editable && !editing ? (
              <button type="button" onClick={() => setEditing(true)}>
                {account.note ? 'Изменить' : 'Добавить'}
              </button>
            ) : null}
          </header>
          {editing && editable ? (
            <AccountForm
              {...actions}
              id={account.account_id + ':profile'}
              title="Профиль клиента"
              version={account.version}
              inline
              onCancel={() => setEditing(false)}
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
                  display_name:
                    fields.name === original.name ? undefined : fields.name.trim() || null,
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
                    Заметка
                    <textarea
                      value={fields.note}
                      placeholder="Договорённости, кто принимает решения, когда звонить"
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
                  <details className={card.profileFields}>
                    <summary>Название и статус клиента</summary>
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
                        {account.classification &&
                        !['Без партнёра', 'Запрет работы'].includes(account.classification) ? (
                          <option>{account.classification}</option>
                        ) : null}
                        <option>Без партнёра</option>
                        <option>Запрет работы</option>
                      </select>
                    </label>
                  </details>
                </>
              )}
            </AccountForm>
          ) : !account.note ? (
            <p className={styles.meta}>Нет примечания.</p>
          ) : null}
          {account.note ? (
            <dl className={card.savedNote}>
              <dt>
                {editing ? (
                  'Сохранённая заметка'
                ) : (
                  <span className={card.visuallyHidden}>Заметка</span>
                )}
              </dt>
              <dd>{account.note}</dd>
            </dl>
          ) : null}
        </section>
      </div>
    </>
  )
}
