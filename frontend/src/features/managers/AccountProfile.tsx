import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { boards, dateLabel, type DemoRow } from './fixtures'
import { sections, type Section } from './sections'
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
  const [status, setStatus] = useState(client.owner)
  const [note, setNote] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [subscribed, setSubscribed] = useState(
    client.owner === 'Наш клиент' && client.health !== 'Лицензия истекла',
  )
  const [subscribing, setSubscribing] = useState(false)
  const [bonus, setBonus] = useState(client.id === '91001001' ? 2400 : 0)
  const [bonusAction, setBonusAction] = useState<'history' | 'add' | 'remove' | null>(null)
  const [bonusHistory, setBonusHistory] = useState<number[]>([])
  const expiresIn = Math.round((Date.parse(client.till) - Date.parse('2026-11-16')) / 86400000)
  const accountRows = rows.filter((item) => item.client === client.id)
  const invoiceRows = boards.invoices.rows.filter((item) => item.client === client.id)
  const [portraitAnswers, setPortraitAnswers] = useState(0)
  const { events, users, seen } = accountTabData(client, accountRows, invoiceRows)
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
        <Link to="/managers" search={{ section, client: undefined }}>
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
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {['Без партнёра', 'Наш клиент', 'Клиент партнёра', 'Запрет работы'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <small>До выхода из карточки · демо</small>
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
              <button type="button" onClick={() => setBonusAction('add')}>
                + Пополнить
              </button>
              <button type="button" disabled={!bonus} onClick={() => setBonusAction('remove')}>
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
              setBonus(bonus + delta)
              setBonusHistory((history) => [...history, delta])
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
              ? `Все TOP-виджеты до ${dateLabel(client.till)} · ${client.seats} пользователей`
              : 'Каждый виджет работает по своему сроку оплаты или пробного периода.'}
          </p>
          {subscribing ? (
            <div className={panelStyles.chips}>
              <button
                type="button"
                data-variant="primary"
                onClick={() => {
                  setSubscribed(true)
                  setSubscribing(false)
                }}
              >
                Выдать в демо
              </button>
              <button type="button" onClick={() => setSubscribing(false)}>
                Отмена
              </button>
            </div>
          ) : !subscribed && expiresIn >= 0 ? (
            <button type="button" data-variant="primary" onClick={() => setSubscribing(true)}>
              Выдать подписку
            </button>
          ) : null}
        </section>
        <section className={styles.detailCard}>
          <div className={panelStyles.sectionTitle}>
            <h2>Примечание</h2>
            <button type="button" onClick={() => setEditingNote((previous) => !previous)}>
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
            <small className={styles.note}>Демо-черновик хранится до выхода из карточки.</small>
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
        <Portrait
          client={client}
          rows={accountRows}
          topCurrent={expiresIn >= 0}
          topics={topics}
          changeTopics={changeTopics}
          answered={portraitAnswers}
          setAnswered={setPortraitAnswers}
        />
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
