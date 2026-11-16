import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { DetailDrawer } from '../../components/DetailDrawer'
import { DataTable } from '../../components/DataTable'
import { Panel, Table, Filters } from './AccountPanel'
import { portraitTopics } from './portraitTopics'
import { usePartners } from './Partners'
import { useAccountDraft } from './AccountDrafts'
import { boards, clients } from './fixtures'
import { can, cellText, money, useDemo, type Block } from './DemoSession'
import styles from './AccountPanels.module.css'

type WidgetSettings = {
  tier: 'FREE' | 'TOP' | 'PRO'
  trial: number
  price: number
  archived: boolean
}
export function WidgetsBoard() {
  const { actor, state } = useDemo()
  const [settings, setSettings] = useAccountDraft<Record<string, WidgetSettings>>(
    'widgetSettings',
    {},
  )
  const [tier, setTier] = useState('Все')
  const [sort, setSort] = useState('name')
  const [selected, setSelected] = useState('')
  const [queue, setQueue] = useState(false)
  const rows = boards.widgets.rows
    .map((row) => ({
      ...row,
      settings: settings[row.id] ?? {
        tier: typeof row.cells[0] === 'object' ? (row.cells[0].line ?? 'FREE') : 'FREE',
        trial: 14,
        price: 1900,
        archived: false,
      },
    }))
    .filter((r) => tier === 'Все' || r.settings.tier === tier)
    .sort((a, b) =>
      sort === 'name'
        ? cellText(a.cells[0]).localeCompare(cellText(b.cells[0]), 'ru')
        : Number(cellText(b.cells[1])) - Number(cellText(a.cells[1])),
    )
  const current = rows.find((r) => r.id === selected)
  return (
    <>
      <h1>Виджеты</h1>
      <p>Каталог, тарифы, активации и очередь повторной авторизации.</p>
      <Filters
        filters={['Все', 'FREE', 'TOP', 'PRO'].map((label) => ({ label }))}
        active={tier}
        change={setTier}
      >
        <select
          aria-label="Сортировка виджетов"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">По названию</option>
          <option value="installs">По установкам</option>
        </select>
        <button type="button" onClick={() => setQueue(!queue)}>
          Требуют повторной авторизации
        </button>
      </Filters>
      {queue ? (
        <Panel title="Очередь авторизации">
          <p>Проверить связь с владельцем аккаунта. Внешняя авторизация здесь не запускается.</p>
          {state.rows
            .filter((row) => row.needsAuthorization)
            .map((row) => (
              <p key={row.id}>
                <Link to="/managers" search={{ section: 'widgets', client: row.client }}>
                  {row.client} · {cellText(row.cells[1])}
                </Link>
              </p>
            ))}
        </Panel>
      ) : null}
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { id: 'name', header: 'Виджет', cell: (r) => <strong>{cellText(r.cells[0])}</strong> },
          { id: 'tier', header: 'Линейка', cell: (r) => r.settings.tier },
          { id: 'installs', header: 'Установки за год', cell: (r) => cellText(r.cells[1]) },
          { id: 'active', header: 'Стоят сейчас', cell: (r) => cellText(r.cells[2]) },
          {
            id: 'trial',
            header: 'Тест · цена',
            cell: (r) =>
              `${r.settings.trial} дн. · ${r.settings.tier === 'FREE' ? 'Бесплатно' : money(r.settings.price)}`,
          },
          {
            id: 'action',
            header: 'Настройки',
            cell: (r) => (
              <button
                type="button"
                disabled={!can(actor, 'admin')}
                onClick={() => setSelected(r.id)}
              >
                {r.settings.archived ? 'В архиве' : 'Настроить'}
              </button>
            ),
          },
        ]}
      />
      <DetailDrawer title="Настройки виджета" open={!!current} onClose={() => setSelected('')}>
        {current ? (
          <form
            className={styles.stack}
            onSubmit={(e) => {
              e.preventDefault()
              if (!can(actor, 'admin')) return
              const f = new FormData(e.currentTarget)
              setSettings((previous) => ({
                ...previous,
                [current.id]: {
                  tier: f.get('tier') === 'FREE' ? 'FREE' : f.get('tier') === 'PRO' ? 'PRO' : 'TOP',
                  trial: Number(f.get('trial')),
                  price: Number(f.get('price')),
                  archived: f.has('archived'),
                },
              }))
              setSelected('')
            }}
          >
            <h3>{cellText(current.cells[0])}</h3>
            <label>
              Линейка
              <select name="tier" defaultValue={current.settings.tier}>
                <option>FREE</option>
                <option>TOP</option>
                <option>PRO</option>
              </select>
            </label>
            <label>
              Тест, дней
              <input
                type="number"
                name="trial"
                min="1"
                max="90"
                required
                defaultValue={current.settings.trial}
              />
            </label>
            <label>
              Цена, ₽
              <input
                type="number"
                name="price"
                min="0"
                required
                defaultValue={current.settings.price}
              />
            </label>
            <label>
              <input type="checkbox" name="archived" defaultChecked={current.settings.archived} />{' '}
              Архивный виджет
            </label>
            <button type="submit">Сохранить настройки</button>
          </form>
        ) : null}
      </DetailDrawer>
    </>
  )
}

export type MarketSetting = { category: string; mark: string; topic: string }
export function MarketBoard() {
  const [topics] = useAccountDraft('/portraitTopics', portraitTopics)
  const { actor } = useDemo()
  const [settings, setSettings] = useAccountDraft<Record<string, MarketSetting>>(
    '/marketSettings',
    {},
  )
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Все')
  const [selected, setSelected] = useState('')
  const rows = boards.market.rows
    .map((r) => ({
      ...r,
      settings: settings[r.id] ?? {
        category: cellText(r.cells[4]),
        mark: 'Сторонний',
        topic: r.id === 'market-1' ? 'telephony' : r.id === 'market-2' ? 'messengers' : '',
      },
    }))
    .filter(
      (r) =>
        cellText(r.cells[0]).toLowerCase().includes(query.toLowerCase()) &&
        (category === 'Все' || r.settings.category === category),
    )
  const current = rows.find((r) => r.id === selected)
  return (
    <>
      <h1>amoМаркет</h1>
      <p>Справочник замеченных виджетов и связь с портретом клиента.</p>
      <div className={styles.toolbar}>
        <input
          type="search"
          aria-label="Поиск виджета amoМаркета"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Категория"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {['Все', 'Связь', 'Коммуникации', 'Автоматизация', 'Другое'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { id: 'name', header: 'Виджет', cell: (r) => cellText(r.cells[0]) },
          { id: 'category', header: 'Категория', cell: (r) => r.settings.category },
          { id: 'mark', header: 'Отметка', cell: (r) => r.settings.mark },
          {
            id: 'topic',
            header: 'В портрет',
            cell: (r) => topics.find((t) => t.id === r.settings.topic)?.title ?? 'Не сопоставлен',
          },
          {
            id: 'accounts',
            header: 'Клиенты',
            cell: (r) => (
              <Link to="/managers" search={{ section: 'clients', client: undefined, market: r.id }}>
                Показать клиентов
              </Link>
            ),
          },
          {
            id: 'action',
            header: 'Настройки',
            cell: (r) => (
              <button
                type="button"
                disabled={!can(actor, 'clients')}
                onClick={() => setSelected(r.id)}
              >
                Изменить
              </button>
            ),
          },
        ]}
      />
      <DetailDrawer
        title="Карточка виджета amoМаркета"
        open={!!current}
        onClose={() => setSelected('')}
      >
        {current ? (
          <form
            className={styles.stack}
            onSubmit={(e) => {
              e.preventDefault()
              if (!can(actor, 'clients')) return
              const f = new FormData(e.currentTarget)
              setSettings((s) => ({
                ...s,
                [current.id]: {
                  category: String(f.get('category')),
                  mark: String(f.get('mark')),
                  topic: String(f.get('topic')),
                },
              }))
              setSelected('')
            }}
          >
            <h3>{cellText(current.cells[0])}</h3>
            <label>
              Категория
              <select name="category" defaultValue={current.settings.category}>
                {['Связь', 'Коммуникации', 'Автоматизация', 'Другое'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Отметка
              <select name="mark" defaultValue={current.settings.mark}>
                {['Сторонний', 'Наш новый', 'Наш старый', 'Конкурент'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Тема портрета
              <select name="topic" defaultValue={current.settings.topic}>
                <option value="">Не показывать</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Сохранить сопоставление</button>
          </form>
        ) : null}
      </DetailDrawer>
    </>
  )
}

export function StaffBoard() {
  const { state, dispatch } = useDemo()
  const labels: Record<Block, string> = {
    clients: 'Клиенты',
    pay: 'Повторные оплаты',
    partners: 'Партнёры',
    admin: 'Администратор',
  }
  return (
    <>
      <h1>Сотрудники</h1>
      <p>
        Статистика, лента и чтение карточки доступны всем. Последнего администратора нельзя лишить
        доступа.
      </p>
      <DataTable
        rows={state.staff}
        rowKey={(r) => r.id}
        columns={[
          { id: 'name', header: 'Сотрудник', cell: (r) => r.name },
          ...Object.entries(labels).map(([block, label]) => ({
            id: block,
            header: label,
            cell: (r: (typeof state.staff)[number]) => (
              <input
                type="checkbox"
                aria-label={`${r.name}: ${label}`}
                checked={r.blocks.includes(block as Block)}
                disabled={
                  block === 'admin' &&
                  r.blocks.includes('admin') &&
                  state.staff.filter((s) => s.blocks.includes('admin')).length === 1
                }
                onChange={(e) =>
                  dispatch({
                    type: 'staff',
                    id: r.id,
                    blocks: e.target.checked
                      ? [...r.blocks, block as Block]
                      : r.blocks.filter((b) => b !== block),
                  })
                }
              />
            ),
          })),
        ]}
      />
    </>
  )
}

export function PaymentsBoard() {
  const { state } = useDemo()
  const [partners] = usePartners()
  const [tab, setTab] = useState('Поступления')
  const paid = state.invoices.filter((i) => i.state === 'paid')
  const bonuses = clients.filter(
    (c) =>
      tab !== 'Сгорают бонусы' ||
      (state.accounts[c.id].bonus > 0 && state.accounts[c.id].bonusUntil <= '2026-12-16'),
  )
  const rows =
    tab === 'Бонусы клиентов' || tab === 'Сгорают бонусы'
      ? bonuses.map((c) => ({
          id: c.id,
          cells: [c.name, money(state.accounts[c.id].bonus), state.accounts[c.id].bonusUntil],
        }))
      : tab === 'Балансы партнёров'
        ? partners.map((p) => ({ id: p.id, cells: [p.name, money(p.bonus), 'Бонусный баланс'] }))
        : tab === 'Оплаты виджетов'
          ? [
              ...paid
                .filter((i) => i.installation)
                .map((i) => ({
                  id: i.id,
                  cells: [i.id, i.description, money(i.amount - i.bonus)],
                })),
              ...state.events
                .filter((e) => e.title === 'Виджет продлён')
                .map((e) => ({ id: e.id, cells: [e.date, e.details, 'Без денег'] })),
            ]
          : paid.map((i) => ({
              id: i.id,
              cells: [
                i.number ?? i.id,
                clients.find((c) => c.id === i.client)?.name ?? '—',
                money(i.amount - i.bonus),
              ],
            }))
  return (
    <>
      <h1>Оплаты</h1>
      <p>
        Поступления, оплаты виджетов и бонусные балансы. Ручные продления не увеличивают выручку.
      </p>
      <Filters
        filters={[
          'Поступления',
          'Сгорают бонусы',
          'Оплаты виджетов',
          'Балансы партнёров',
          'Бонусы клиентов',
        ].map((label) => ({ label }))}
        active={tab}
        change={setTab}
      />
      <Panel title={tab}>
        <Table
          columns={
            tab === 'Бонусы клиентов' || tab === 'Сгорают бонусы'
              ? ['Клиент', 'Бонусы', 'Действуют до']
              : tab === 'Балансы партнёров'
                ? ['Партнёр', 'Баланс', 'Тип']
                : tab === 'Оплаты виджетов'
                  ? ['Дата или счёт', 'Продление', 'Получено денег']
                  : ['Счёт', 'Клиент', 'Получено денег']
          }
          rows={rows}
        />
      </Panel>
    </>
  )
}

export function StatsBoard() {
  const { state } = useDemo()
  const [from, setFrom] = useState('2026-11-01')
  const [to, setTo] = useState('2026-11-30')
  const rows = state.rows.filter((r) => (r.date ?? '') >= from && (r.date ?? '') <= to)
  const paid = state.invoices.filter((i) => i.state === 'paid' && i.date >= from && i.date <= to)
  return (
    <>
      <h1>Статистика</h1>
      <div className={styles.toolbar}>
        <label>
          С<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          По
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className={styles.callsGrid}>
        <Panel title="Аккаунты с установками">
          <strong>{new Set(rows.map((r) => r.client)).size}</strong>
        </Panel>
        <Panel title="Установки">
          <strong>{rows.length}</strong>
        </Panel>
        <Panel title="Оплаченные счета">
          <strong>
            {paid.length} · {money(paid.reduce((sum, i) => sum + i.amount - i.bonus, 0))}
          </strong>
        </Panel>
      </div>
      <Table
        columns={['Виджет', 'Установок за период']}
        rows={boards.widgets.rows.map((w) => ({
          id: w.id,
          cells: [
            cellText(w.cells[0]),
            String(rows.filter((r) => cellText(r.cells[1]) === cellText(w.cells[0])).length),
          ],
        }))}
      />
    </>
  )
}
