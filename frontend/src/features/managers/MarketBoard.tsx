import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useAccountDraft } from './AccountDrafts'
import { can, useDemo } from './DemoSession'
import {
  marketCategories,
  marketMarkLabels,
  marketWidgets,
  type MarketSetting,
} from './marketFixtures'
import { defaultMarketFilters, marketSortColumns, type MarketFilters } from './marketSearch'
import { portraitTopics } from './portraitTopics'
import styles from './MarketBoard.module.css'

const marks = [
  ['', 'Все'],
  ['unknown', 'Неизвестно'],
  ['partner', 'Партнёрские'],
  ['ours', 'Наши'],
] as const

export function MarketBoard() {
  const { actor } = useDemo()
  const editable = can(actor, 'clients')
  const [settings, setSettings] = useAccountDraft<Record<string, MarketSetting>>(
    '/marketSettings',
    {},
  )
  const [, setTopics] = useAccountDraft('/portraitTopics', portraitTopics)
  const [categories, setCategories] = useAccountDraft('/marketCategories', marketCategories)
  const search = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const { mark, category, query, column, ascending } = search.marketCatalog ?? defaultMarketFilters
  const [dictionaryOpen, setDictionaryOpen] = useState(false)
  const dictionary = useRef<HTMLDialogElement>(null)
  const suggestionsId = useId()
  const titleId = useId()

  useEffect(() => {
    const dialog = dictionary.current
    if (!dialog) return
    if (dictionaryOpen && !dialog.open) dialog.showModal()
    if (!dictionaryOpen && dialog.open) dialog.close()
  }, [dictionaryOpen])

  const entries = marketWidgets.map((widget) => ({
    ...widget,
    settings: settings[widget.code] ?? widget.settings,
  }))
  const normalizedQuery = query.trim().toLocaleLowerCase('ru')
  const rows = entries
    .filter(
      (widget) =>
        (!mark || widget.settings.mark === mark) &&
        (!category || widget.settings.category === (category === '—' ? '' : category)) &&
        `${widget.name} ${widget.code}`.toLocaleLowerCase('ru').includes(normalizedQuery),
    )
    .sort((a, b) => {
      const difference =
        column === 'name' || column === 'firstSeen'
          ? a[column].localeCompare(b[column], 'ru')
          : a[column].length - b[column].length
      return (ascending ? difference : -difference) || a.name.localeCompare(b.name, 'ru')
    })

  function updateFilters(patch: Partial<MarketFilters>, replace = false) {
    void navigate({
      replace,
      search: (previous) => ({
        ...previous,
        marketCatalog: { ...(previous.marketCatalog ?? defaultMarketFilters), ...patch },
      }),
    })
  }

  function canonicalCategory(value: string) {
    const cleaned = value.trim().replace(/\s+/g, ' ')
    return (
      categories.find(
        (candidate) => candidate.toLocaleLowerCase('ru') === cleaned.toLocaleLowerCase('ru'),
      ) ?? cleaned
    )
  }

  function addCategory(value: string) {
    if (value && value !== '—' && !categories.includes(value))
      setCategories((list) => [...list, value])
  }

  function updateWidget(code: string, defaults: MarketSetting, patch: Partial<MarketSetting>) {
    if (!editable) return
    setSettings((current) => ({
      ...current,
      [code]: { ...(current[code] ?? defaults), ...patch },
    }))
  }

  function renameCategory(current: string, next: string) {
    if (!editable || !next || next === '—' || current === next) return
    setCategories((list) => [...new Set(list.map((value) => (value === current ? next : value)))])
    setSettings((previous) => {
      const updated = { ...previous }
      entries.forEach((widget) => {
        if (widget.settings.category === current) {
          updated[widget.code] = { ...widget.settings, category: next }
        }
      })
      return updated
    })
    setTopics((previous) =>
      previous.map((topic) => (topic.category === current ? { ...topic, category: next } : topic)),
    )
    if (category === current) updateFilters({ category: next }, true)
  }

  return (
    <section className={styles.board} aria-labelledby={titleId}>
      <header>
        <h1 id={titleId}>amoМаркет</h1>
        <p className={styles.description}>
          Виджеты из amoМаркета, которые стоят или стояли у наших клиентов. Берём из «Установленных
          виджетов» в карточках — обновляется при пульсе любого нашего виджета и по «Обновить».
          Приватные интеграции (в amoCRM — «Приватные интеграции», не из Маркета) сервер не
          собирает: их здесь нет. «В портрет» — виджет сам попадёт в портрет клиента (блок
          «Партнёрские виджеты») у клиентов, где он стоит: партнёрские и нужные наши.
        </p>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.filters} aria-label="Отметки виджетов" role="group">
          {marks.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mark === key}
              onClick={() => updateFilters({ mark: key })}
            >
              {label} · {entries.filter((row) => !key || row.settings.mark === key).length}
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <label className={styles.filterLabel}>
            Категория
            <select
              aria-label="Категория"
              value={category}
              onChange={(event) => updateFilters({ category: event.target.value })}
            >
              <option value="">все</option>
              {category && category !== '—' && !categories.includes(category) ? (
                <option>{category}</option>
              ) : null}
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
              <option value="—">не указана</option>
            </select>
          </label>
          <button type="button" onClick={() => setDictionaryOpen(true)}>
            Справочник · {categories.length}
          </button>
          <input
            type="search"
            aria-label="Поиск виджета"
            placeholder="Название или код виджета"
            value={query}
            onChange={(event) => updateFilters({ query: event.target.value }, true)}
          />
        </div>
      </div>
      <datalist id={suggestionsId}>
        {categories.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: '26%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              {marketSortColumns.map(([key, label]) => (
                <th
                  key={key}
                  scope="col"
                  className={key === 'accounts' || key === 'removed' ? styles.numeric : undefined}
                  aria-sort={column === key ? (ascending ? 'ascending' : 'descending') : undefined}
                >
                  <button
                    type="button"
                    onClick={() =>
                      updateFilters({
                        column: key,
                        ascending: key === column ? !ascending : key === 'name',
                      })
                    }
                  >
                    {label}
                    {column === key ? (ascending ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              <th scope="col">Отметка</th>
              <th scope="col">В портрет</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((widget) => {
              const { code, name, firstSeen, accounts, removed, settings } = widget
              return (
                <tr key={code}>
                  <td>
                    <span className={styles.name}>{name}</span>
                    <small>{code}</small>
                    <input
                      key={settings.category}
                      aria-label={`Категория: ${name}`}
                      className={styles.inlineCategory}
                      list={suggestionsId}
                      placeholder="категория не указана"
                      defaultValue={settings.category}
                      disabled={!editable}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') {
                          event.currentTarget.value = settings.category
                          event.currentTarget.blur()
                        }
                      }}
                      onBlur={(event) => {
                        if (!editable) return
                        const value = canonicalCategory(event.currentTarget.value)
                        event.currentTarget.value = value === '—' ? settings.category : value
                        if (value === '—' || value === settings.category) return
                        addCategory(value)
                        updateWidget(code, settings, { category: value })
                      }}
                    />
                  </td>
                  <td className={styles.numeric}>
                    <Link
                      className={styles.countLink}
                      search={{ section: 'clients', client: undefined, market: code }}
                      to="/managers"
                      aria-label={`Показать клиентов с виджетом ${name}: ${accounts.length}`}
                    >
                      {accounts.length}
                    </Link>
                  </td>
                  <td className={styles.numeric}>
                    {removed.length ? (
                      <Link
                        className={styles.removedLink}
                        to="/managers"
                        search={{
                          section: 'clients',
                          client: undefined,
                          market: `${code}:removed`,
                        }}
                        aria-label={`Показать клиентов, которые удалили ${name}: ${removed.length}`}
                      >
                        {removed.length}
                      </Link>
                    ) : (
                      <span className={styles.zero}>0</span>
                    )}
                  </td>
                  <td>{firstSeen.split('-').reverse().join('.')}</td>
                  <td>
                    {settings.mark === 'ours' ? (
                      <span className={styles.ours}>Наш</span>
                    ) : (
                      <div
                        className={styles.markGroup}
                        role="group"
                        aria-label={`Отметка: ${name}`}
                      >
                        {(['unknown', 'partner'] as const).map((value) => (
                          <button
                            type="button"
                            key={value}
                            data-mark={value}
                            aria-pressed={settings.mark === value}
                            disabled={!editable}
                            onClick={() =>
                              updateWidget(code, settings, {
                                mark: value,
                                inPortrait: value === 'partner',
                              })
                            }
                          >
                            {marketMarkLabels[value]}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {settings.mark === 'unknown' ? (
                      <span className={styles.zero}>—</span>
                    ) : (
                      <button
                        className={styles.toggle}
                        role="switch"
                        type="button"
                        aria-label={`В портрет: ${name}`}
                        aria-checked={settings.inPortrait}
                        disabled={!editable}
                        onClick={() =>
                          updateWidget(code, settings, { inPortrait: !settings.inPortrait })
                        }
                      >
                        <span aria-hidden="true" />
                        {settings.inPortrait ? `у ${accounts.length}` : 'нет'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={6}>Ничего не нашли.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <dialog
        className={styles.dictionary}
        aria-label="Категории amoМаркета"
        ref={dictionary}
        onClose={() => setDictionaryOpen(false)}
      >
        <header>
          <h2>Категории amoМаркета</h2>
          <button
            type="button"
            aria-label="Закрыть справочник"
            onClick={() => setDictionaryOpen(false)}
          >
            ×
          </button>
        </header>
        <div className={styles.categoryList}>
          <p>Категории связывают виджеты с темами портрета клиента.</p>
          {categories.map((value) => (
            <form
              key={value}
              onSubmit={(event) => {
                event.preventDefault()
                renameCategory(
                  value,
                  canonicalCategory(String(new FormData(event.currentTarget).get('name') ?? '')),
                )
              }}
            >
              <input
                aria-label={`Переименовать: ${value}`}
                name="name"
                defaultValue={value}
                required
                disabled={!editable}
              />
              <button
                type="button"
                onClick={() => {
                  updateFilters({ category: value, mark: '', query: '' })
                  setDictionaryOpen(false)
                }}
              >
                Виджеты · {entries.filter((row) => row.settings.category === value).length}
              </button>
              <button type="submit" disabled={!editable}>
                Сохранить
              </button>
            </form>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!editable) return
              addCategory(
                canonicalCategory(String(new FormData(event.currentTarget).get('name') ?? '')),
              )
              event.currentTarget.reset()
            }}
          >
            <input
              aria-label="Новая категория"
              name="name"
              placeholder="например, Документы"
              required
              disabled={!editable}
            />
            <button type="submit" disabled={!editable}>
              Добавить
            </button>
          </form>
        </div>
      </dialog>
    </section>
  )
}
