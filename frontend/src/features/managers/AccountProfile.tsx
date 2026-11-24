import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { dateLabel, type DemoRow } from './fixtures'
import { sections, type Section } from './sections'
import { useDemo, can, invoiceRows as makeInvoiceRows } from './DemoSession'
import { useAccountDraft } from './AccountDrafts'
import { Audit } from './AccountInsights'
import { Portrait } from './Portrait'
import type { PortraitTopic } from './portraitTopics'
import { Companies, History, OurWidgets, SeenWidgets, Users } from './AccountRecords'
import { accountTabData, type DemoClient } from './accountFixtures'
import styles from './ManagersPage.module.css'
import panelStyles from './AccountPanels.module.css'

const clientTabs = [
  'Наши виджеты',
  'Портрет клиента',
  'Аудит',
  'История',
  'Счета и компании',
  'Пользователи',
  'Установленные виджеты',
] as const

export function AccountProfile({
  client,
  section,
  rows,
  check,
  topics,
  changeTopics,
}: {
  client: DemoClient
  section: Section
  rows: readonly DemoRow[]
  topics: readonly PortraitTopic[]
  changeTopics: (topics: readonly PortraitTopic[]) => void
  check: (id: string, checked: boolean) => void
}) {
  const [tab, setTab] = useState<(typeof clientTabs)[number]>(clientTabs[0])
  const { state, actor, dispatch } = useDemo()
  const account = state.accounts[client.id]
  const status = account.owner
  const setStatus = (owner: string) =>
    dispatch({
      type: 'account',
      client: client.id,
      patch: { owner },
      block: 'clients',
      title: 'Статус клиента изменён',
    })
  const note = account.note
  const setNote = (note: string) =>
    dispatch({
      type: 'account',
      client: client.id,
      patch: { note },
      block: 'clients',
      title: 'Примечание изменено',
    })
  const [editingNote, setEditingNote] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const subscribed = account.subscribed
  const [subscribing, setSubscribing] = useState(false)
  const bonus = account.bonus
  const bonusHistory = account.bonusHistory
  const [bonusAction, setBonusAction] = useState<'history' | 'add' | 'remove' | null>(null)
  const expiresIn = Math.round((Date.parse(client.till) - Date.parse('2026-11-16')) / 86400000)
  const accountRows = rows
    .filter((item) => item.client === client.id)
    .map((item) => {
      const tier = typeof item.cells[1] === 'object' ? item.cells[1].line : undefined
      const paidText =
        typeof item.paidUntil === 'object' ? item.paidUntil.text : (item.paidUntil ?? '')
      const paidDate = paidText.split('.').reverse().join('-')
      return account.subscribed && tier === 'TOP' && account.subscriptionTill > paidDate
        ? {
            ...item,
            paidUntil: { text: dateLabel(account.subscriptionTill), note: 'Подписка · все TOP' },
          }
        : item
    })
  const invoiceRows = makeInvoiceRows(state.invoices.filter((item) => item.client === client.id))
  const [portraitAnswers, setPortraitAnswers] = useAccountDraft('portraitCount', 0)
  const {
    events: fixtureEvents,
    users,
    seen,
  } = accountTabData(
    client,
    accountRows,
    invoiceRows.filter((i) => i.id.startsWith('invoice-')),
  )
  const events = [...state.events.filter((e) => e.client === client.id), ...fixtureEvents]
  const activeUsers = users.filter((user) => user.active).length
  const tabCounts = {
    'Наши виджеты': `${accountRows.length}/${accountRows.length}`,
    'Портрет клиента': `${portraitAnswers}/${topics.length}`,
    Аудит: client.health === 'Получаем данные' ? '✓' : '—',
    История: events.length,
    'Счета и компании': invoiceRows.length,
    Пользователи: `${activeUsers}/${users.length}`,
    'Установленные виджеты': seen.length,
  }

  return (
    <>
      <nav className={styles.crumbs} aria-label="Хлебные крошки">
        <Link to="/managers" search={(previous) => ({ ...previous, section, client: undefined })}>
          {sections[section].title}
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{client.domain}</span>
      </nav>
      <section className={styles.client}>
        <header>
          <div className={styles.avatar} aria-hidden="true">
            {client.name.slice(0, 1)}
          </div>
          <div className={styles.clientTitle}>
            <div className={styles.nameRow}>
              <h1>{client.domain}</h1>
              <span className={styles.idChip}>ID {client.id}</span>
            </div>
            <p>
              {client.name} · данные обновлены: {client.updated}
            </p>
            <span
              className={styles.pill}
              data-tone={client.health === 'Получаем данные' ? 'green' : 'amber'}
            >
              {client.health}
            </span>
          </div>
          <label className={styles.clientStatus}>
            Статус клиента
            <select
              disabled={!can(actor, 'clients')}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {['Свободный клиент', 'Наш клиент', 'Клиент партнёра', 'Запрет работы'].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
            <small>До обновления страницы · демо</small>
          </label>
        </header>
        <div className={styles.statbar}>
          <div>
            <small>Тариф amoCRM</small>
            <strong>{client.tariff}</strong>
            <span className={styles.note}>
              {client.health === 'Лицензия истекла' ? 'Лицензия истекла' : 'Данные демо-аккаунта'}
            </span>
          </div>
          <div>
            <small>Действует до</small>
            <strong>{dateLabel(client.till)}</strong>
            <small>{expiresIn < 0 ? 'Срок истёк' : `Осталось ${expiresIn} дн.`}</small>
            <button className={styles.textButton} onClick={() => setTab('История')}>
              История продлений →
            </button>
          </div>
          <div>
            <small>Пользователи</small>
            <button className={styles.metricButton} onClick={() => setTab('Пользователи')}>
              {activeUsers}
            </button>
            <span className={styles.note}>Активны в справочнике</span>
          </div>
          <div>
            <small>Бонусы</small>
            <strong>{bonus.toLocaleString('ru-RU')} ₽</strong>
            <span className={styles.note}>Демонстрационный баланс</span>
            <div className={panelStyles.chips}>
              <button
                type="button"
                onClick={() => setBonusAction((value) => (value === 'history' ? null : 'history'))}
              >
                История бонусов
              </button>
              <button
                type="button"
                disabled={!can(actor, 'pay')}
                onClick={() => setBonusAction('add')}
              >
                + Пополнить
              </button>
              <button
                type="button"
                disabled={!bonus || !can(actor, 'pay')}
                onClick={() => setBonusAction('remove')}
              >
                − Списать
              </button>
            </div>
          </div>
          <div>
            <button
              className={styles.refreshButton}
              data-variant="primary"
              type="button"
              onClick={() => setRefreshed(true)}
            >
              ↻ Обновить
            </button>
            <span role="status" className={styles.note}>
              {refreshed
                ? 'Демо-данные актуальны · запрос не отправлялся'
                : 'Локальный пример обновления'}
            </span>
          </div>
        </div>
        {bonusAction === 'history' ? (
          <div className={panelStyles.bordered}>
            <strong>История бонусов в демо</strong>
            {bonusHistory.length ? (
              <ul>
                {bonusHistory.map((delta, index) => (
                  <li key={index}>
                    {delta > 0 ? '+' : '−'}
                    {Math.abs(delta).toLocaleString('ru-RU')} ₽
                  </li>
                ))}
              </ul>
            ) : (
              <p className={panelStyles.muted}>Изменений в этой карточке пока нет.</p>
            )}
          </div>
        ) : bonusAction ? (
          <form
            className={panelStyles.peopleForm}
            onSubmit={(event) => {
              event.preventDefault()
              const amount = Number(new FormData(event.currentTarget).get('amount'))
              if (
                !Number.isSafeInteger(amount) ||
                amount <= 0 ||
                (bonusAction === 'remove' && amount > bonus)
              )
                return
              const delta = bonusAction === 'remove' ? -amount : amount
              dispatch({
                type: 'account',
                client: client.id,
                block: 'pay',
                title: `${delta > 0 ? 'Бонусы пополнены' : 'Бонусы списаны'}: ${String(new FormData(event.currentTarget).get('reason'))}`,
                patch: { bonus: bonus + delta, bonusHistory: [...bonusHistory, delta] },
              })
              setBonusAction(null)
            }}
          >
            <label>
              Сумма бонусов, ₽
              <input
                type="number"
                name="amount"
                min={1}
                max={bonusAction === 'remove' ? bonus : 10000000}
                required
              />
            </label>
            <label>
              Основание изменения бонусов
              <input name="reason" required maxLength={200} />
            </label>
            <button type="submit" data-variant="primary">
              {bonusAction === 'add' ? 'Пополнить в демо' : 'Списать в демо'}
            </button>
            <button type="button" onClick={() => setBonusAction(null)}>
              Отмена
            </button>
          </form>
        ) : null}
        {status !== 'Клиент партнёра' && status !== 'Запрет работы' ? (
          <div className={styles.nextStep}>
            <strong>Следующий шаг</strong>
            <span>Уточнить, как команда работает со сделками</span>
            <button className={styles.textButton} onClick={() => setTab('Портрет клиента')}>
              Перейти →
            </button>
          </div>
        ) : null}
      </section>
      <div className={styles.clientCards}>
        <section className={styles.detailCard}>
          <h2>Подписка клиента</h2>
          <div className={styles.subscription}>
            <strong>{subscribed ? 'Все TOP · Наш клиент' : 'Нет подписки'}</strong>
            {subscribed ? (
              <span className={styles.pill} data-tone="green">
                Действует
              </span>
            ) : null}
          </div>
          <p>
            {subscribed
              ? `Все TOP-виджеты до ${dateLabel(account.subscriptionTill)} · ${client.seats} пользователей`
              : 'Каждый виджет работает по своему сроку оплаты или пробного периода.'}
          </p>
          {subscribing ? (
            <form
              className={panelStyles.peopleForm}
              onSubmit={(event) => {
                event.preventDefault()
                const until = String(new FormData(event.currentTarget).get('until'))
                if (until < '2026-11-16') return
                dispatch({
                  type: 'account',
                  client: client.id,
                  block: 'pay',
                  title: 'Подписка TOP обновлена',
                  patch: { subscribed: true, subscriptionTill: until },
                })
                setSubscribing(false)
              }}
            >
              <label>
                Подписка TOP до
                <input
                  name="until"
                  type="date"
                  min="2026-11-16"
                  defaultValue={account.subscriptionTill}
                  required
                />
              </label>
              <button type="submit" data-variant="primary">
                Выдать в демо
              </button>
              <button type="button" onClick={() => setSubscribing(false)}>
                Отмена
              </button>
            </form>
          ) : can(actor, 'pay') ? (
            <div className={panelStyles.chips}>
              <button type="button" data-variant="primary" onClick={() => setSubscribing(true)}>
                {subscribed ? 'Изменить подписку' : 'Выдать подписку'}
              </button>
              {subscribed ? (
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'account',
                      client: client.id,
                      block: 'pay',
                      title: 'Подписка TOP отозвана',
                      patch: { subscribed: false },
                    })
                  }
                >
                  Отозвать подписку
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
        <section className={styles.detailCard}>
          <div className={panelStyles.sectionTitle}>
            <h2>Примечание</h2>
            <button
              type="button"
              disabled={!can(actor, 'clients')}
              onClick={() => setEditingNote((previous) => !previous)}
            >
              {editingNote ? 'Готово' : note ? 'Изменить' : 'Добавить'}
            </button>
          </div>
          {editingNote ? (
            <textarea
              aria-label="Примечание"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          ) : (
            <p className={panelStyles.muted}>
              {note || 'Нет примечания. Запишите договорённости и удобное время для звонка.'}
            </p>
          )}
          {editingNote ? (
            <small className={styles.note}>Сохраняется в демо-сессии до обновления страницы.</small>
          ) : null}
        </section>
      </div>
      <div className={styles.tabs} role="group" aria-label="Разделы карточки">
        {clientTabs.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value}
            <span className={styles.count}>{tabCounts[value]}</span>
          </button>
        ))}
      </div>
      <div hidden={tab !== 'Наши виджеты'}>
        <OurWidgets rows={accountRows} check={check} />
      </div>
      <div hidden={tab !== 'Портрет клиента'}>
        <fieldset disabled={!can(actor, 'clients')} className={panelStyles.readonlyFields}>
          <Portrait
            client={client}
            rows={accountRows}
            topCurrent={expiresIn >= 0}
            topics={topics}
            changeTopics={changeTopics}
            answered={portraitAnswers}
            setAnswered={setPortraitAnswers}
          />
        </fieldset>
      </div>
      <div hidden={tab !== 'Аудит'}>
        <Audit client={client} showPortrait={() => setTab('Портрет клиента')} />
      </div>
      <div hidden={tab !== 'История'}>
        <History events={events} />
      </div>
      <div hidden={tab !== 'Счета и компании'}>
        <Companies invoices={invoiceRows} client={client} />
      </div>
      <div hidden={tab !== 'Пользователи'}>
        <Users users={users} />
      </div>
      <div hidden={tab !== 'Установленные виджеты'}>
        <SeenWidgets widgets={seen} />
      </div>
    </>
  )
}
