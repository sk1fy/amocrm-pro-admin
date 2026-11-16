import { useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { DetailDrawer } from '../../components/DetailDrawer'
import { useAccountDraft } from './AccountDrafts'
import { Panel } from './AccountPanel'
import { can, cellText, money, useDemo } from './DemoSession'
import { clients, dateLabel } from './fixtures'
import {
  defaultWidgetFilters,
  widgetSorts,
  widgetTiers,
  type WidgetFilters,
  type WidgetSort,
  type WidgetTier,
} from './sections'
import {
  activationThreshold,
  defaultWidgetTariff,
  scaledCatalog,
  widgetCatalog,
  widgetMonths,
  type CatalogWidget,
  type WidgetSettings,
  type WidgetTariff,
} from './widgetCatalog'
import styles from './WidgetsBoard.module.css'

const number = new Intl.NumberFormat('ru-RU')
const tiers = ['all', ...widgetTiers] as const
const previewLink = (url: string) => url.startsWith('https://catalog.example.invalid/')

function issues(widget: CatalogWidget): { label: string; tone: 'error' | 'warning' | 'info' }[] {
  const result: ReturnType<typeof issues> = []
  if (widget.stats.lost) result.push({ label: `${widget.stats.lost} нет связи`, tone: 'error' })
  if (widget.stats.activation < activationThreshold)
    result.push({ label: `активация ${widget.stats.activation}%`, tone: 'warning' })
  if (!widget.installUrl) result.push({ label: 'нет ссылки на установку', tone: 'info' })
  if (!widget.guideUrl) result.push({ label: 'нет инструкции', tone: 'info' })
  if (widget.archived) result.push({ label: 'В архиве', tone: 'warning' })
  return result
}

const comparators: Record<WidgetSort, (a: CatalogWidget, b: CatalogWidget) => number> = {
  installs: (a, b) => b.stats.installations - a.stats.installations,
  active: (a, b) => b.stats.active - a.stats.active,
  growth: (a, b) => b.stats.recent - a.stats.recent,
  problems: (a, b) => issueCount(b) - issueCount(a) || b.stats.active - a.stats.active,
  fresh: (a, b) => b.releasedMonth - a.releasedMonth,
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
}

function issueCount(widget: CatalogWidget) {
  return issues(widget).length + Math.max(0, widget.stats.lost - 1)
}

function Sparkline({ monthly }: { monthly: readonly number[] }) {
  const max = Math.max(1, ...monthly)
  return (
    <span
      className={styles.sparkline}
      role="img"
      aria-label={monthly.map((count, index) => `${widgetMonths[index]}: ${count}`).join(', ')}
    >
      {monthly.map((count, index) => (
        <span
          key={widgetMonths[index]}
          title={`${widgetMonths[index]}: ${count}`}
          style={{ height: count > 0 ? Math.max(2, Math.round((count / max) * 24)) : 1 }}
          data-zero={count === 0}
        />
      ))}
    </span>
  )
}

export function WidgetsBoard() {
  const { actor, state } = useDemo()
  const { widgetCatalog: filters = defaultWidgetFilters } = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const [settings, setSettings] = useAccountDraft<Record<string, WidgetSettings>>(
    'widgetSettings',
    {},
  )
  const [selected, setSelected] = useState('')
  const [authorizationChecked, setAuthorizationChecked] = useState('')
  const base = (filters.scale ? scaledCatalog : widgetCatalog).map((widget) => ({
    ...widget,
    ...settings[widget.code],
  }))
  const totalFor = (tier: (typeof tiers)[number]) =>
    tier === 'all' ? base.length : base.filter((widget) => widget.tier === tier).length
  const sum = (read: (widget: CatalogWidget) => number) =>
    base.reduce((total, widget) => total + read(widget), 0)
  const totalInstalls = sum(({ stats }) => stats.installations)
  const totalAttention = base.filter((widget) => issues(widget).length).length
  const activationAverage = Math.round(
    sum(({ stats }) => stats.activation * stats.installations) / Math.max(1, totalInstalls),
  )
  const term = filters.query.trim().toLocaleLowerCase('ru')
  const rows = base
    .filter(
      (widget) =>
        (filters.tier === 'all' || filters.tier === widget.tier) &&
        (!filters.problems || issues(widget).length) &&
        `${widget.name} ${widget.code}`.toLocaleLowerCase('ru').includes(term),
    )
    .sort(comparators[filters.sort])
  const current = base.find((widget) => widget.code === selected)
  const authorizationRows = state.rows
    .filter((row) => row.needsAuthorization)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  function changeFilters(patch: Partial<WidgetFilters>, replace = false) {
    void navigate({
      replace,
      search: (previous) => ({
        ...previous,
        widgetCatalog: { ...filters, ...patch },
      }),
    })
  }

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1>Виджеты</h1>
          <p>
            Каталог на новом сервере: одна строка — один виджет. График — установки по месяцам за
            год. Нажмите на строку, чтобы открыть настройки (категория, тест, тарифы, ссылки).
          </p>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.scale}
            onChange={(event) => changeFilters({ scale: event.target.checked })}
          />
          Показать как при 50 виджетах (демо)
        </label>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <strong>{base.length}</strong>
          <span>виджетов</span>
          <small>{widgetTiers.map((tier) => `${tier} ${totalFor(tier)}`).join(' · ')}</small>
        </div>
        <div className={styles.metric}>
          <strong>{number.format(sum(({ stats }) => stats.active))}</strong>
          <span>стоят сейчас</span>
          <small>из {number.format(totalInstalls)} установок</small>
        </div>
        <div className={styles.metric}>
          <strong>+{number.format(sum(({ stats }) => stats.recent))}</strong>
          <span>установок за 30 дней</span>
          <small>по всем виджетам</small>
        </div>
        <div className={styles.metric}>
          <strong>{activationAverage}%</strong>
          <span>активировали</span>
          <small>в среднем, с учётом числа установок</small>
        </div>
        <button
          className={styles.metric}
          data-warning={totalAttention > 0}
          type="button"
          aria-pressed={filters.problems}
          onClick={() => changeFilters({ problems: !filters.problems })}
        >
          <strong>{totalAttention}</strong>
          <span>требуют внимания</span>
          <small>нет связи, активация &lt; {activationThreshold}%, нет ссылок</small>
        </button>
      </div>

      <div className={styles.filters}>
        <div className={styles.tiers}>
          {tiers.map((tier) => (
            <button
              key={tier}
              type="button"
              aria-pressed={filters.tier === tier}
              onClick={() => changeFilters({ tier })}
            >
              {tier === 'all' ? 'Все' : tier} {totalFor(tier)}
            </button>
          ))}
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.problems}
            onChange={(event) => changeFilters({ problems: event.target.checked })}
          />
          Только требующие внимания
        </label>
        <label className={styles.sort}>
          Сортировка
          <select
            aria-label="Сортировка виджетов"
            value={filters.sort}
            onChange={(event) => changeFilters({ sort: event.target.value as WidgetSort })}
          >
            {Object.entries(widgetSorts).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <input
          className={styles.query}
          type="search"
          aria-label="Поиск виджета"
          placeholder="Название или код виджета"
          value={filters.query}
          onChange={(event) => changeFilters({ query: event.target.value }, true)}
        />
      </div>

      <div className={styles.tablePanel}>
        <div className={styles.tableScroll}>
          <table className={styles.catalog}>
            <colgroup>
              <col style={{ width: '24.3%' }} />
              <col style={{ width: '15.2%' }} />
              <col style={{ width: '7.9%' }} />
              <col style={{ width: '10.2%' }} />
              <col style={{ width: '22.2%' }} />
              <col style={{ width: '7.6%' }} />
              <col style={{ width: '12.6%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Виджет</th>
                <th scope="col">Установки за 12 мес.</th>
                <th scope="col" className={styles.numeric}>
                  Стоят сейчас
                </th>
                <th scope="col">Активировали</th>
                <th scope="col">Требует внимания</th>
                <th scope="col">Тест · тариф</th>
                <th scope="col">Ссылки</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((widget) => {
                const { stats } = widget
                const problemList = issues(widget)
                const tariff = widget.tariffs[0]
                const retained = stats.installations
                  ? Math.round((stats.active / stats.installations) * 100)
                  : 0
                return (
                  // The title button is the keyboard equivalent of clicking the row.
                  <tr
                    key={widget.code}
                    className={styles.widgetRow}
                    onClick={(event) => {
                      if (event.target instanceof Element && !event.target.closest('button, a')) {
                        setSelected(widget.code)
                      }
                    }}
                  >
                    <td>
                      <div className={styles.widgetName}>
                        <span className={styles.tier} data-tier={widget.tier}>
                          {widget.tier}
                        </span>
                        <button
                          type="button"
                          className={styles.open}
                          onClick={() => setSelected(widget.code)}
                        >
                          {widget.name}
                        </button>
                        {widget.releasedMonth >= 10 ? (
                          <span className={styles.new}>новый</span>
                        ) : null}
                      </div>
                      <small>
                        {widget.code} · {widget.version}
                        {widget.demo ? ' · демо' : ''}
                      </small>
                    </td>
                    <td>
                      <div className={styles.trend}>
                        <Sparkline monthly={stats.monthly} />
                        <span>
                          <strong>{stats.installations}</strong>
                          <small>+{stats.recent} за 30 дн.</small>
                        </span>
                      </div>
                    </td>
                    <td className={styles.numeric}>
                      {stats.active}
                      <small>{retained}% остались</small>
                    </td>
                    <td>
                      <div className={styles.activation}>
                        <span
                          aria-hidden="true"
                          className={styles.meter}
                          data-low={stats.activation < activationThreshold}
                        >
                          <span style={{ width: `${stats.activation}%` }} />
                        </span>
                        {stats.activation}%
                      </div>
                      <small>
                        {stats.notActivated
                          ? `${stats.notActivated} без активации`
                          : 'все активировали'}
                      </small>
                    </td>
                    <td>
                      {problemList.length ? (
                        <div className={styles.pills}>
                          {problemList.map(({ label, tone }) => (
                            <span className={styles.pill} data-tone={tone} key={label}>
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.ok}>✓ всё в порядке</span>
                      )}
                    </td>
                    <td>
                      {widget.tier === 'FREE' ? '—' : `${widget.trial} дн.`}
                      <small>
                        {tariff.price
                          ? `${money(tariff.price)} / ${tariff.months === 12 ? 'год' : `${tariff.months} мес.`}${tariff.perUser ? ' за польз.' : ''}`
                          : '0 ₽'}
                      </small>
                    </td>
                    <td>
                      <span className={styles.linkState} data-ready={Boolean(widget.installUrl)}>
                        {widget.installUrl && !previewLink(widget.installUrl) ? (
                          <a href={widget.installUrl} target="_blank" rel="noreferrer">
                            установка
                          </a>
                        ) : widget.installUrl ? (
                          'установка'
                        ) : (
                          'после модерации'
                        )}
                      </span>
                      <small>
                        {widget.guideUrl ? (
                          previewLink(widget.guideUrl) ? (
                            'инструкция ↗'
                          ) : (
                            <a href={widget.guideUrl} target="_blank" rel="noreferrer">
                              инструкция ↗
                            </a>
                          )
                        ) : (
                          'нет инструкции'
                        )}
                      </small>
                    </td>
                  </tr>
                )
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>Ничего не нашлось. Измените фильтр или поиск.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <Panel
          title="Нет связи — слетела авторизация"
          hint={`${authorizationRows.length} · Виджет может не работать, если не удалось обновить доступ к amoCRM`}
        >
          {authorizationRows.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.queue}>
                <thead>
                  <tr>
                    <th scope="col">Нет связи с</th>
                    <th scope="col">Виджет</th>
                    <th scope="col">Аккаунт</th>
                    <th scope="col">ID amoCRM</th>
                    <th scope="col">Что сделано</th>
                    <th scope="col" className={styles.numeric}>
                      Действие
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {authorizationRows.map((row) => {
                    const account = clients.find((client) => client.id === row.client)
                    return (
                      <tr key={row.id}>
                        <td>{row.date ? dateLabel(row.date) : '—'}</td>
                        <td>{cellText(row.cells[1])}</td>
                        <td>
                          <Link to="/managers" search={{ section: 'widgets', client: row.client }}>
                            {account?.domain ?? row.client}
                          </Link>
                          {account ? <small>{account.name}</small> : null}
                        </td>
                        <td>{row.client}</td>
                        <td>
                          {row.id === authorizationChecked ? (
                            <span role="status">
                              Связи по-прежнему нет. Администратор аккаунта может переподключить
                              виджет.
                            </span>
                          ) : (
                            'Не удалось обновить доступ. Требуется переподключение виджета.'
                          )}
                        </td>
                        <td className={styles.numeric}>
                          <button type="button" onClick={() => setAuthorizationChecked(row.id)}>
                            Проверить связь
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>Со всеми аккаунтами есть связь.</p>
          )}
        </Panel>
      </div>

      <DetailDrawer
        title="Настройки виджета"
        open={Boolean(current)}
        onClose={() => setSelected('')}
      >
        {current ? (
          <WidgetEditor
            key={current.code}
            widget={current}
            admin={can(actor, 'admin')}
            onClose={() => setSelected('')}
            onSave={(draft) => {
              if (!can(actor, 'clients')) return
              setSettings((previous) => ({ ...previous, [current.code]: draft }))
              setSelected('')
            }}
          />
        ) : null}
      </DetailDrawer>
    </>
  )
}

function WidgetEditor({
  widget,
  admin,
  onClose,
  onSave,
}: {
  widget: CatalogWidget
  admin: boolean
  onClose: () => void
  onSave: (settings: WidgetSettings) => void
}) {
  const { name, tier, trial, trialExtension, installUrl, guideUrl, archived, tariffs } = widget
  const [draft, setDraft] = useState<WidgetSettings>({
    name,
    tier,
    trial,
    trialExtension,
    installUrl,
    guideUrl,
    archived,
    tariffs,
  })
  const [tariffKeys, setTariffKeys] = useState(() => tariffs.map((_, index) => index))
  const nextTariff = useRef(tariffs.length)

  function changeTariff(index: number, patch: Partial<WidgetTariff>) {
    setDraft((previous) => ({
      ...previous,
      tariffs: previous.tariffs.map((tariff, position) =>
        position === index ? { ...tariff, ...patch } : tariff,
      ),
    }))
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault()
        if (!draft.name.trim() || draft.tariffs.some((tariff) => !tariff.name.trim())) return
        onSave({
          ...draft,
          name: draft.name.trim(),
          installUrl: draft.installUrl.trim(),
          guideUrl: draft.guideUrl.trim(),
        })
      }}
    >
      <small>
        {widget.code} · {widget.version}
      </small>
      <fieldset className={styles.editorGroup} disabled={!admin}>
        <legend>Основное</legend>
        <label>
          Название
          <input
            value={draft.name}
            required
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <div className={styles.editorSplit}>
          <label>
            Категория
            <select
              value={draft.tier}
              onChange={(event) => setDraft({ ...draft, tier: event.target.value as WidgetTier })}
            >
              {widgetTiers.map((tier) => (
                <option key={tier}>{tier}</option>
              ))}
            </select>
          </label>
          <label>
            Тест при установке, дней
            <input
              type="number"
              min={0}
              required
              disabled={draft.tier === 'FREE'}
              value={draft.trial}
              onChange={(event) => setDraft({ ...draft, trial: Number(event.target.value) })}
            />
          </label>
        </div>
        <label>
          Продление теста, дней
          <input
            type="number"
            min={1}
            required
            disabled={draft.tier === 'FREE'}
            value={draft.trialExtension}
            onChange={(event) => setDraft({ ...draft, trialExtension: Number(event.target.value) })}
          />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.archived}
            onChange={(event) => setDraft({ ...draft, archived: event.target.checked })}
          />
          Архивный виджет
        </label>
      </fieldset>
      <fieldset className={styles.editorGroup}>
        <legend>Ссылки</legend>
        <label>
          Ссылка на установку (предоставление доступа)
          <input
            type="url"
            pattern="https?://.+"
            value={draft.installUrl}
            placeholder="Появится после модерации в amoМаркете"
            onChange={(event) => setDraft({ ...draft, installUrl: event.target.value })}
          />
        </label>
        <label>
          Ссылка на инструкцию
          <input
            type="url"
            pattern="https?://.+"
            value={draft.guideUrl}
            placeholder="https://…"
            onChange={(event) => setDraft({ ...draft, guideUrl: event.target.value })}
          />
        </label>
      </fieldset>
      <fieldset className={styles.editorGroup} disabled={!admin}>
        <legend>Тарифы</legend>
        <p>Цена за весь срок. Для расчёта цены по числу пользователей включите «за польз.».</p>
        {draft.tariffs.map((tariff, index) => (
          <div className={styles.tariff} key={tariffKeys[index]}>
            <label>
              Название
              <input
                value={tariff.name}
                required
                onChange={(event) => changeTariff(index, { name: event.target.value })}
              />
            </label>
            <label>
              Срок, мес.
              <input
                type="number"
                min={1}
                required
                value={tariff.months}
                onChange={(event) => changeTariff(index, { months: Number(event.target.value) })}
              />
            </label>
            <label>
              Цена, ₽
              <input
                type="number"
                min={0}
                required
                value={tariff.price}
                onChange={(event) => changeTariff(index, { price: Number(event.target.value) })}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={tariff.perUser}
                onChange={(event) => changeTariff(index, { perUser: event.target.checked })}
              />
              за польз.
            </label>
            <button
              type="button"
              disabled={draft.tariffs.length === 1}
              aria-label="Удалить тариф"
              onClick={() => {
                setDraft({ ...draft, tariffs: draft.tariffs.filter((_, pos) => pos !== index) })
                setTariffKeys(tariffKeys.filter((_, pos) => pos !== index))
              }}
            >
              ×
            </button>
          </div>
        ))}
        {admin ? (
          <button
            type="button"
            className={styles.addTariff}
            onClick={() => {
              setDraft({ ...draft, tariffs: [...draft.tariffs, defaultWidgetTariff(draft.tier)] })
              setTariffKeys([...tariffKeys, nextTariff.current++])
            }}
          >
            + Добавить тариф
          </button>
        ) : null}
        <small>Новые сроки теста действуют для новых установок.</small>
      </fieldset>
      <div className={styles.editorActions}>
        <button type="submit" data-variant="primary">
          Сохранить настройки
        </button>
        <button type="button" onClick={onClose}>
          Отменить
        </button>
      </div>
    </form>
  )
}
