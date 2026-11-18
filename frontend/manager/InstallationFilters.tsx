import type { FormEvent } from 'react'
import type { InstallationPage } from './installationsApi'
import { installationFilters } from './installationsLocation'
import styles from './InstallationsPage.module.css'
import workspace from '../src/components/ManagerWorkspace.module.css'

type Filter = (typeof installationFilters)[number]
type Changes = Partial<Record<Filter, string | null>>
type Option = readonly [value: string, label: string]

function FilterSelect({
  name,
  label,
  options,
  filters,
  emptyLabel = 'Все',
}: {
  name: Filter
  label: string
  options: readonly Option[]
  filters: URLSearchParams
  emptyLabel?: string
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={filters.get(name) ?? ''}>
        <option value="">{emptyLabel}</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

const reviewGroups = [
  ['unreviewed', 'Непроверенные', 'unreviewed'],
  ['reviewed', 'Проверенные', 'reviewed'],
  ['', 'Все установки', 'total'],
] as const

export function InstallationFilters({
  filters,
  apply,
  summary,
}: {
  filters: URLSearchParams
  apply: (changes: Changes) => void
  summary: InstallationPage['summary'] | undefined
}) {
  const review = filters.get('review') ?? ''

  function applyForm(form: HTMLFormElement, nextReview: string) {
    const data = new FormData(form)
    const changes: Changes = { cursor: null, review: nextReview }
    for (const key of installationFilters) {
      const field = data.get(key)
      if (typeof field === 'string') changes[key] = field.trim()
    }
    apply(changes)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    applyForm(event.currentTarget, review)
  }

  function clear() {
    const changes: Changes = {}
    for (const key of installationFilters) changes[key] = null
    apply(changes)
  }

  const advancedActive = [
    'kind',
    'last_lifecycle_event',
    'product_id',
    'line',
    'activation',
    'access_state',
    'limit',
  ].some((key) => filters.has(key))

  return (
    <form className={styles.filters} aria-label="Фильтры установок" onSubmit={submit}>
      <div className={styles.toolbar}>
        <div className={workspace.tabs} aria-label="Проверка установок" role="group">
          {reviewGroups.map(([value, label, countKey]) => {
            const count = review === '' || review === value ? summary?.[countKey] : undefined
            return (
              <button
                key={value}
                type="button"
                aria-pressed={review === value}
                onClick={(event) => {
                  const form = event.currentTarget.form
                  if (form && form.reportValidity()) applyForm(form, value)
                }}
              >
                {label}
                {count === undefined ? null : <span className={styles.count}>{count}</span>}
              </button>
            )
          })}
        </div>
        <div className={styles.primaryFields}>
          <label>
            Дата установки с
            <input name="from" type="date" defaultValue={filters.get('from') ?? ''} />
          </label>
          <label>
            по
            <input
              name="to"
              type="date"
              aria-label="Дата установки по"
              defaultValue={filters.get('to') ?? ''}
            />
          </label>
          <input
            aria-label="Аккаунт или продукт"
            className={styles.search}
            name="q"
            type="search"
            placeholder="ID amoCRM или виджет"
            defaultValue={filters.get('q') ?? ''}
            maxLength={200}
          />
          <button type="submit">Применить</button>
        </div>
      </div>
      <details className={styles.advanced} open={advancedActive || undefined}>
        <summary>Дополнительные фильтры</summary>
        <div className={styles.fields}>
          <FilterSelect
            name="kind"
            label="Тип установки"
            filters={filters}
            options={[
              ['install', 'Первая установка'],
              ['reinstall', 'Повторная установка'],
            ]}
          />
          <FilterSelect
            name="last_lifecycle_event"
            label="Последнее событие"
            filters={filters}
            options={[
              ['installed', 'Установка'],
              ['reinstalled', 'Повторная установка'],
              ['reauthorized', 'Повторная авторизация'],
              ['uninstalled', 'Удаление'],
            ]}
          />
          <label>
            ID продукта
            <input name="product_id" defaultValue={filters.get('product_id') ?? ''} />
          </label>
          <FilterSelect
            name="line"
            label="Линейка"
            filters={filters}
            options={[
              ['FREE', 'FREE'],
              ['TOP', 'TOP'],
              ['PRO', 'PRO'],
            ]}
          />
          <FilterSelect
            name="activation"
            label="Активация"
            filters={filters}
            options={[
              ['pending', 'Ожидает'],
              ['activated', 'Активирована'],
              ['unavailable', 'Нет данных'],
            ]}
          />
          <FilterSelect
            name="access_state"
            label="Доступ к продукту"
            filters={filters}
            options={[
              ['active', 'Действует'],
              ['inactive', 'Не действует'],
            ]}
          />
          <label>
            Строк на странице
            <input
              name="limit"
              type="number"
              min={1}
              max={100}
              placeholder="25"
              defaultValue={filters.get('limit') ?? ''}
            />
          </label>
        </div>
      </details>
      {filters.size > 0 ? (
        <button className={styles.reset} type="button" onClick={clear}>
          Сбросить фильтры
        </button>
      ) : null}
    </form>
  )
}
