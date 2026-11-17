import type { FormEvent } from 'react'
import { installationFilters } from './installationsLocation'
import styles from './InstallationsPage.module.css'

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

export function InstallationFilters({
  filters,
  apply,
}: {
  filters: URLSearchParams
  apply: (changes: Changes) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const changes: Changes = { cursor: null }
    for (const key of installationFilters) {
      const field = data.get(key)
      if (typeof field === 'string') changes[key] = field.trim()
    }
    apply(changes)
  }

  function clear() {
    const changes: Changes = {}
    for (const key of installationFilters) changes[key] = null
    apply(changes)
  }

  return (
    <form className={styles.filters} aria-label="Фильтры установок" onSubmit={submit}>
      <div className={styles.fields}>
        <label className={styles.search}>
          Аккаунт или продукт
          <input name="q" type="search" defaultValue={filters.get('q') ?? ''} maxLength={200} />
        </label>
        <FilterSelect
          name="review"
          label="Проверка"
          filters={filters}
          options={[
            ['unreviewed', 'Не проверены'],
            ['reviewed', 'Проверены'],
          ]}
        />
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
          name="sort"
          label="Дата установки"
          filters={filters}
          emptyLabel="По умолчанию"
          options={[
            ['-installed_at', 'Сначала новые'],
            ['installed_at', 'Сначала старые'],
          ]}
        />
      </div>
      <details className={styles.advanced}>
        <summary>Дополнительные фильтры</summary>
        <div className={styles.fields}>
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
            Установлено с
            <input name="from" type="date" defaultValue={filters.get('from') ?? ''} />
          </label>
          <label>
            Установлено по
            <input name="to" type="date" defaultValue={filters.get('to') ?? ''} />
          </label>
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
      <div className={styles.actions}>
        <button type="submit" data-variant="primary">
          Применить
        </button>
        <button type="button" onClick={clear}>
          Сбросить фильтры
        </button>
      </div>
    </form>
  )
}
