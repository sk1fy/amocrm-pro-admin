import { useRef, useState, type ReactNode } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatNull, formatTime, formatRelativeTime } from '../src/lib/format'
import { lookupState } from '../src/states'
import type { AccountDetail, AccountObservation } from './accountsApi'
import { CommandFeedback, useAccountCommand } from './accountCommands'
import { AccountSubscription } from './AccountSubscription'
import { AccountForm } from './AccountForms'
import styles from './Accounts.module.css'
import card from './AccountCard.module.css'

export type AccountActions = {
  onSaved: () => void
  onExpired: () => void
  onForbidden: () => void
}

const licenseDateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
})

const licenseCalendarDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' })

const trialDateFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
})

function observedValue<T>(value: AccountObservation<T>) {
  return value.state === 'fresh' || value.state === 'stale' ? value.value : undefined
}

export function ObservationSource({ value }: { value: AccountObservation<unknown> }) {
  const source = value.source === 'core.gateway.amocrm.users' ? 'amoCRM' : value.source
  const sourceLabel = source === 'unverified' ? null : source
  return (
    <div className={card.observation}>
      <StatusBadge domain="freshness" state={value.state} calm />
      {sourceLabel || value.observed_at ? (
        <span className={styles.meta}>
          {sourceLabel}
          {sourceLabel && value.observed_at ? ' · ' : null}
          {value.observed_at ? (
            <time dateTime={value.observed_at}>{formatTime(value.observed_at)}</time>
          ) : null}
        </span>
      ) : null}
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
  const refreshButton = useRef<HTMLButtonElement>(null)
  const completed = attempt.entry.state.kind === 'saved' || attempt.entry.state.kind === 'error'
  return (
    <div className={card.refreshControl}>
      <button
        ref={refreshButton}
        type="button"
        className={`${card.primary} ${card.refreshButton}`}
        disabled={attempt.locked}
        onClick={() =>
          attempt.start({
            kind: 'refresh',
            account: account.account_id,
            key: createRequestKey(),
            body: JSON.stringify({
              components: ['users', 'license', 'amostart'],
              reason: 'Обновление данных из карточки клиента',
            }),
          })
        }
      >
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 20 20" fill="none">
          <path
            d="M17 5v4h-4M17 9a6.8 6.8 0 1 0-.6 4.3"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Обновить
      </button>
      <div className={card.refreshFeedback}>
        <CommandFeedback command={attempt} savedLabel="Данные обновлены." />
        {completed ? (
          <button
            type="button"
            className={card.refreshFeedbackDismiss}
            aria-label="Закрыть сообщение об обновлении"
            onClick={() => {
              attempt.discardDraft()
              refreshButton.current?.focus()
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function accountTitle(account: AccountDetail) {
  return (
    account.current_domain?.split('.')[0] ??
    account.display_name ??
    'Аккаунт amoCRM ' + account.amo_account_id
  )
}

const clientStatuses = [
  'Свободный клиент',
  'Клиент партнёра',
  'Наш клиент',
  'Запрет работы',
] as const

function ClientStatus({
  account,
  editable,
  ...actions
}: AccountActions & { account: AccountDetail; editable: boolean }) {
  const classification = account.classification ?? ''
  const partnerName = account.partner_name ?? ''
  const isKnown = clientStatuses.some((value) => value === classification)
  const statusChange = account.classification_change
  const automaticBan = statusChange?.reason === 'technical_tariff_detected'

  return (
    <div className={card.classification}>
      <p className={card.fieldTitle}>Статус клиента</p>
      {editable ? (
        <AccountForm
          {...actions}
          inline
          actionsOnEdit
          iconActions
          id={account.account_id + ':classification'}
          title="Изменение статуса"
          version={account.version}
          initial={{ classification, partnerName, confirmBan: '' }}
          current={
            <StatusBadge domain="client_classification" state={classification || 'unknown'} calm />
          }
          command={(fields, original, version, key) => ({
            kind: 'profile',
            account: account.account_id,
            version,
            key,
            body: JSON.stringify({
              classification:
                fields.classification === original.classification && !fields.confirmBan
                  ? undefined
                  : fields.classification,
              partner_name:
                fields.classification === 'Клиент партнёра' &&
                fields.partnerName.trim() !== original.partnerName
                  ? fields.partnerName.trim()
                  : undefined,
              reason: 'Изменение статуса клиента',
            }),
          })}
        >
          {(fields, edit) => (
            <>
              <select
                aria-label="Статус клиента"
                value={fields.classification}
                onChange={(event) => edit('classification', event.target.value)}
              >
                {!isKnown ? (
                  <option value={classification} disabled>
                    {classification || 'Не указан'}
                  </option>
                ) : null}
                {clientStatuses.map((value) => (
                  <option key={value} value={value}>
                    {lookupState('client_classification', value).label}
                  </option>
                ))}
              </select>
              {automaticBan && fields.classification === 'Запрет работы' ? (
                <label className={card.confirmBan}>
                  <input
                    type="checkbox"
                    checked={fields.confirmBan === 'yes'}
                    onChange={(event) => edit('confirmBan', event.target.checked ? 'yes' : '')}
                  />
                  Сохранить запрет вручную
                </label>
              ) : null}
              {fields.classification === 'Клиент партнёра' ? (
                <label>
                  Название партнёра
                  <input
                    required
                    maxLength={200}
                    value={fields.partnerName}
                    onChange={(event) => edit('partnerName', event.target.value)}
                  />
                </label>
              ) : null}
            </>
          )}
        </AccountForm>
      ) : (
        <>
          <StatusBadge domain="client_classification" state={classification || 'unknown'} calm />
          {partnerName ? <p className={styles.meta}>{partnerName}</p> : null}
        </>
      )}
      {statusChange ? (
        <p className={card.statusHistory}>
          {
            lookupState('client_classification_change', statusChange.reason ?? statusChange.source)
              .label
          }{' '}
          · <time dateTime={statusChange.occurred_at}>{formatTime(statusChange.occurred_at)}</time>{' '}
          ·{' '}
          {statusChange.previous !== statusChange.current ? (
            <>
              {statusChange.previous ?? 'Не указан'} → {statusChange.current ?? 'Не указан'}
            </>
          ) : (
            (statusChange.current ?? 'Не указан')
          )}
        </p>
      ) : null}
    </div>
  )
}

function AccountNote({
  account,
  editable,
  ...actions
}: AccountActions & { account: AccountDetail; editable: boolean }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className={card.summaryPanel} aria-labelledby="account-note">
      <header className={card.noteHeading}>
        <h2 id="account-note" className={card.panelTitle}>
          <span aria-hidden="true">✎</span>Примечание
        </h2>
        {editable && !editing ? (
          <button type="button" onClick={() => setEditing(true)}>
            {account.note ? 'Изменить' : 'Добавить'}
          </button>
        ) : null}
      </header>
      {editing && editable ? (
        <AccountForm
          {...actions}
          inline
          id={account.account_id + ':profile'}
          title="Профиль клиента"
          version={account.version}
          onCancel={() => setEditing(false)}
          onCompleted={() => setEditing(false)}
          initial={{ note: account.note ?? '' }}
          current={<p>Текущая заметка: {account.note ?? '—'}</p>}
          command={(fields, _original, version, key) => ({
            kind: 'profile',
            account: account.account_id,
            version,
            key,
            body: JSON.stringify({
              note: fields.note.trim() || null,
              reason: 'Изменение примечания',
            }),
          })}
        >
          {(fields, edit) => (
            <textarea
              aria-label="Заметка"
              ref={(element) => {
                if (element && !element.dataset.focused) {
                  element.dataset.focused = 'true'
                  element.focus()
                }
              }}
              className={card.noteInput}
              value={fields.note}
              maxLength={4000}
              placeholder="Договорённости, кто принимает решения, когда звонить"
              onChange={(event) => edit('note', event.target.value)}
            />
          )}
        </AccountForm>
      ) : !account.note ? (
        <p className={card.emptyNote}>
          Нет примечания. Запишите договорённости, кто принимает решения, когда удобно звонить.
        </p>
      ) : null}
      {!editing && account.note ? (
        <dl className={card.savedNote}>
          <dt>
            <span className={card.visuallyHidden}>Заметка</span>
          </dt>
          <dd>{account.note}</dd>
        </dl>
      ) : null}
    </section>
  )
}

export function AccountOverview({
  account,
  canWrite,
  canRenew,
  usersLink,
  ...actions
}: AccountActions & {
  account: AccountDetail
  canWrite: boolean
  canRenew: boolean
  usersLink: (label: string) => ReactNode
}) {
  const updatedAt = [
    account.identity_observed_at,
    account.active_users.observed_at,
    account.license.observed_at,
    account.amo_license_status?.observed_at,
    ...(account.checks ?? [])
      .filter((check) => check.component !== 'installations')
      .map((check) => check.succeeded_at),
  ]
    .filter((date): date is string => !!date)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
  const title = accountTitle(account)
  const license = observedValue(account.license)
  const licenseStatus = account.amo_license_status
  const trialEnd =
    licenseStatus?.state === 'trial' || licenseStatus?.state === 'expired_pending'
      ? licenseStatus.trial_end
      : undefined
  const licenseDate = license?.license_until ? new Date(license.license_until) : null
  const licenseExpired =
    !licenseStatus &&
    licenseDate &&
    licenseCalendarDay.format(licenseDate) < licenseCalendarDay.format(new Date())
  const licenseError = account.license.error_code
  const activeUsers = observedValue(account.active_users)
  const editable =
    canWrite &&
    account.capabilities.some(
      (capability) => capability.action === 'account.profile' && capability.allowed,
    )
  const canRefresh =
    canWrite &&
    account.capabilities.some(
      (capability) => capability.action === 'account.refresh' && capability.allowed,
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
                account.display_name && account.display_name !== title
                  ? account.display_name
                  : null,
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
            <p className={styles.meta}>
              {updatedAt ? (
                <>
                  Данные аккаунта обновлены{' '}
                  <time dateTime={updatedAt}>
                    {formatTime(updatedAt)} ({formatRelativeTime(updatedAt)})
                  </time>
                </>
              ) : (
                'Данные аккаунта ещё не обновлялись'
              )}
            </p>
          </div>
          <ClientStatus account={account} editable={editable} {...actions} />
        </div>
        <div className={card.overviewMetrics}>
          <dl className={card.metrics}>
            <div>
              <dt>Тариф amoCRM</dt>
              <dd>{formatNull(license?.tariff)}</dd>
              <ObservationSource value={account.license} />
            </div>
            <div>
              <dt>{licenseStatus ? 'Лицензия amoCRM' : 'Действует до'}</dt>
              <dd>
                {licenseStatus ? (
                  <StatusBadge domain="amo_license" state={licenseStatus.state} calm />
                ) : licenseDate ? (
                  licenseDateFormat.format(licenseDate)
                ) : (
                  '—'
                )}
              </dd>
              {trialEnd ? (
                <span className={styles.meta}>
                  Окончание{' '}
                  <time dateTime={trialEnd}>{trialDateFormat.format(new Date(trialEnd))}</time>
                </span>
              ) : licenseStatus?.state === 'trial' ? (
                <span className={styles.meta}>Дата окончания неизвестна</span>
              ) : null}
              {licenseStatus &&
              licenseDate &&
              (licenseStatus.state === 'paid' || licenseStatus.state === 'unknown') ? (
                <span className={styles.meta}>
                  {licenseStatus.state === 'paid'
                    ? 'Действует до '
                    : 'Последний срок по данным amoSTART '}
                  <time dateTime={license?.license_until ?? undefined}>
                    {licenseDateFormat.format(licenseDate)}
                  </time>
                </span>
              ) : null}
              {licenseExpired ? <span className={styles.meta}>Лицензия истекла</span> : null}
              {license?.paid_seat_limit != null &&
              (!licenseStatus || licenseStatus.state === 'paid') ? (
                <span className={styles.meta}>Оплаченных мест {license.paid_seat_limit}</span>
              ) : null}
              {licenseStatus?.source === 'widget' || licenseStatus?.source === 'amocrm' ? (
                <span className={styles.meta}>
                  {licenseStatus.source === 'widget' ? 'Виджет amoCRM' : 'amoCRM'}
                  {licenseStatus.observed_at ? (
                    <>
                      {' '}
                      ·{' '}
                      <time dateTime={licenseStatus.observed_at}>
                        {formatTime(licenseStatus.observed_at)}
                      </time>
                    </>
                  ) : null}
                </span>
              ) : (
                <ObservationSource value={account.license} />
              )}
              {licenseError?.startsWith('amostart_') ? (
                <span className={styles.meta}>
                  {licenseError === 'amostart_not_configured'
                    ? 'Доступ к amoSTART не настроен.'
                    : licenseError === 'amostart_license_unavailable'
                      ? 'amoSTART не подтвердил срок оплаты.'
                      : 'Не удалось получить данные из amoSTART.'}
                </span>
              ) : null}
            </div>
            <div>
              <dt>Активные пользователи</dt>
              <dd>{activeUsers === undefined ? '—' : usersLink(String(activeUsers))}</dd>
              <ObservationSource value={account.active_users} />
            </div>
            <div>
              <dt>Активные продукты</dt>
              <dd>{account.active_products_count}</dd>
            </div>
          </dl>
          {canRefresh ? (
            <div className={card.refreshArea}>
              <AccountRefresh account={account} {...actions} />
            </div>
          ) : null}
        </div>
      </section>
      <div className={card.summaryGrid}>
        <AccountSubscription
          key={account.account_id}
          account={account}
          editable={
            canRenew &&
            account.capabilities.some((cap) => cap.action === 'account.subscription' && cap.allowed)
          }
          {...actions}
        />
        <AccountNote account={account} editable={editable} {...actions} />
      </div>
    </>
  )
}
