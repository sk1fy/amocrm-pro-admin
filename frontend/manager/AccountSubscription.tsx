import { useState } from 'react'
import type { AccountDetail } from './accountsApi'
import type { AccountActions } from './AccountOverview'
import { useAccountCommand, CommandFeedback } from './accountCommands'
import { createRequestKey } from '../src/features/operations/intents'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import card from './AccountCard.module.css'
import styles from './Accounts.module.css'

const plans = { top: 'Все TOP — «Наш клиент»', unified: 'Единая подписка — все виджеты' }
const buttons = {
  grant: 'Выдать',
  renew: 'Продлить',
  seats: 'Сохранить лимит',
  revoke: 'Снять подписку',
}
type Action = keyof typeof buttons
type Editor = {
  action: Action
  version: number
  plan: keyof typeof plans
  ends: string
  seats: string
  deal: string
}
function dealID(value: string) {
  return /^(?:https:\/\/rakurscrm\.amocrm\.ru\/leads\/detail\/)?([1-9]\d{0,14})\/?$/.exec(
    value.trim(),
  )?.[1]
}
export function defaultSubscriptionEnd(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const part = (key: string) => Number(parts.find((p) => p.type === key)?.value)
  const last = new Date(Date.UTC(part('year'), part('month') + 3, 0))
  last.setUTCDate(Math.min(part('day'), last.getUTCDate()))
  return last.toISOString().slice(0, 10)
}
function calendar(value: string) {
  return value.split('-').reverse().join('.')
}
export function AccountSubscription({
  account,
  editable,
  ...actions
}: AccountActions & { account: AccountDetail; editable: boolean }) {
  const current = account.subscription?.state === 'revoked' ? undefined : account.subscription
  const previous = account.previous_subscription
  const count = account.active_users.value
  const [form, setForm] = useState<Editor | null>(null)
  const cmd = useAccountCommand(account.account_id + ':subscription', {
    ...actions,
    onCompleted: () => setForm(null),
  })
  function open(action: Action) {
    cmd.discardDraft()
    setForm({
      action,
      version: account.version,
      plan: current?.plan ?? 'top',
      ends: action === 'grant' ? defaultSubscriptionEnd(new Date()) : (current?.ends_on ?? ''),
      seats: String(current?.seats ?? count ?? ''),
      deal: '',
    })
  }
  function field(name: keyof Omit<Editor, 'action' | 'version'>, value: string) {
    if (form) setForm({ ...form, [name]: value })
  }
  const grant = form?.action === 'grant'
  const full = grant || form?.action === 'renew'
  const conflict = cmd.entry.state.kind === 'conflict'
  return (
    <section className={card.summaryPanel} aria-label="Подписка клиента">
      <h2 className={card.panelTitle}>
        <span aria-hidden="true">▤</span>Подписка клиента
      </h2>
      <div className={card.subscriptionTitle}>
        <strong>
          {current ? plans[current.plan] + ' до ' + calendar(current.ends_on) : 'Нет подписки'}
        </strong>
        {current && <StatusBadge domain="subscription_status" state={current.state} calm />}
      </div>
      {current && (
        <p className={styles.meta}>
          По сделке{' '}
          <a
            href={'https://rakurscrm.amocrm.ru/leads/detail/' + current.deal_id}
            target="_blank"
            rel="noreferrer"
          >
            №{current.deal_id} ↗
          </a>{' '}
          · Пользователи: {count ?? '—'} из {current.seats}
        </p>
      )}
      {current?.state === 'suspended' && count !== undefined && count !== null && (
        <p role="status" className={card.overLimit}>
          В аккаунте {count}, по подписке {current.seats}. Превышение на {count - current.seats}.
          Действуют собственные сроки виджетов. Проверено{' '}
          {formatTime(account.active_users.observed_at)}.
        </p>
      )}
      {editable && !form && (
        <div className={styles.actions}>
          {(!current || current.state === 'expired') && (
            <button type="button" data-variant="primary" onClick={() => open('grant')}>
              Выдать подписку
            </button>
          )}
          {current && (
            <>
              <button type="button" onClick={() => open('renew')}>
                Продлить
              </button>
              <button type="button" onClick={() => open('seats')}>
                Изменить лимит
              </button>
              <button type="button" onClick={() => open('revoke')}>
                Снять
              </button>
            </>
          )}
        </div>
      )}
      {editable && form && (
        <form
          className={card.subscriptionForm}
          onSubmit={(event) => {
            event.preventDefault()
            if (conflict || cmd.locked) return
            const body = full
              ? {
                  action: form.action,
                  plan: form.plan,
                  ends_on: form.ends,
                  seats: Number(form.seats),
                  deal_id: dealID(form.deal),
                }
              : form.action === 'seats'
                ? { action: 'seats', seats: Number(form.seats) }
                : { action: 'revoke' }
            cmd.start({
              kind: 'subscription',
              account: account.account_id,
              version: form.version,
              key: createRequestKey(),
              body: JSON.stringify(body),
            })
          }}
        >
          <fieldset disabled={cmd.locked || conflict}>
            {full && (
              <>
                <label>
                  Тип
                  <select
                    value={form.plan}
                    disabled={!grant}
                    onChange={(e) => field('plan', e.target.value)}
                  >
                    <option value="top">{plans.top}</option>
                    <option value="unified">{plans.unified}</option>
                  </select>
                </label>
                <label>
                  Действует до
                  <input
                    type="date"
                    required
                    value={form.ends}
                    onChange={(e) => field('ends', e.target.value)}
                  />
                </label>
              </>
            )}
            {form.action !== 'revoke' && (
              <label>
                Лимит пользователей
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  step={1}
                  required
                  value={form.seats}
                  onChange={(e) => field('seats', e.target.value)}
                />
              </label>
            )}
            {full && (
              <label className={card.wideField}>
                Сделка в amoCRM — основание
                <input
                  required
                  placeholder="Ссылка на сделку в RakursCRM или её номер"
                  value={form.deal}
                  onChange={(e) => field('deal', e.target.value)}
                />
              </label>
            )}
          </fieldset>
          {grant && form.plan === 'top' && account.classification !== 'Наш клиент' && (
            <p>
              После выдачи статус клиента изменится: {account.classification ?? 'Не указан'} →{' '}
              <strong>Наш клиент</strong>.
            </p>
          )}
          {form.action === 'renew' && current && (
            <p>
              Срок подписки: {calendar(current.ends_on)} → {form.ends ? calendar(form.ends) : '—'}.
            </p>
          )}
          {form.action === 'revoke' && (
            <p>
              Снять подписку? Виджеты вернутся к своим срокам. Запись о подписке останется в
              истории.
            </p>
          )}
          {conflict && (
            <p role="alert">
              Условия аккаунта изменились. Откройте форму заново, чтобы проверить актуальные
              значения.
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="submit"
              data-variant="primary"
              disabled={
                cmd.locked ||
                conflict ||
                (full &&
                  (!dealID(form.deal) ||
                    !form.ends ||
                    (form.action === 'renew' && !!current && form.ends <= current.ends_on))) ||
                (form.action !== 'revoke' && Number(form.seats) < 1)
              }
            >
              {buttons[form.action]}
            </button>
            <button
              type="button"
              disabled={cmd.locked}
              onClick={() => {
                cmd.discardDraft()
                setForm(null)
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
      <CommandFeedback command={cmd} />
      {previous && (
        <p className={styles.meta}>
          Ранее: {plans[previous.plan]} до {calendar(previous.ends_on)}, лимит {previous.seats},
          сделка №{previous.deal_id}. Снята {formatTime(previous.changed_at)}.
        </p>
      )}
      {current && (
        <p className={styles.meta}>
          {current.plan === 'top' ? 'Все TOP-виджеты' : 'Все TOP- и PRO-виджеты'}, включая новые
          установки. Если собственный срок виджета дольше, он продолжит работать до своего срока.
        </p>
      )}
    </section>
  )
}
