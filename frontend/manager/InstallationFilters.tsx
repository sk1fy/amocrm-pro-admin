import { useEffect, useState, type FormEvent } from 'react'
import type { InstallationPage } from './installationsApi'
import { installationFilters } from './installationsLocation'
import styles from './InstallationsPage.module.css'
import workspace from '../src/components/ManagerWorkspace.module.css'

type Changes = Partial<Record<(typeof installationFilters)[number], string | null>>

const reviewGroups = [
  ['unreviewed', 'Непроверенные'],
  ['reviewed', 'Проверенные'],
] as const

export function InstallationFilters({
  filters,
  apply,
  summary,
}: {
  filters: URLSearchParams
  apply: (changes: Changes) => void
  summary: Partial<InstallationPage['summary']> | undefined
}) {
  const review = filters.get('review') === 'reviewed' ? 'reviewed' : 'unreviewed'
  const current = filters.get('q') ?? ''
  const location = filters.toString()
  const [draft, setDraft] = useState({ location, value: current })
  if (draft.location !== location) {
    setDraft({ location, value: current })
  }

  useEffect(() => {
    const q = draft.value.trim()
    if (q === current) return
    const timer = window.setTimeout(() => apply({ q, cursor: null }), 300)
    return () => window.clearTimeout(timer)
  }, [apply, current, draft.value, location])

  const from = filters.get('from') ?? ''
  const to = filters.get('to') ?? ''
  const extra = installationFilters.filter(
    (key) => filters.has(key) && !['q', 'review', 'from', 'to', 'cursor', 'sort'].includes(key),
  )

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    apply({ q: draft.value.trim(), cursor: null })
  }

  return (
    <form className={styles.toolbar} aria-label="Фильтры установок" onSubmit={submit}>
      <div className={workspace.tabs} aria-label="Проверка установок" role="group">
        {reviewGroups.map(([value, label]) => {
          const count = summary?.[value]
          return (
            <button
              key={value}
              type="button"
              aria-pressed={review === value}
              onClick={() => apply({ review: value, q: draft.value.trim(), cursor: null })}
            >
              {label}
              {count === undefined ? null : <span className={styles.count}>{count}</span>}
            </button>
          )
        })}
      </div>
      <div className={styles.primaryFields}>
        <label>
          Установлен с
          <input
            name="from"
            type="date"
            aria-label="Дата установки с"
            value={from}
            max={to || undefined}
            onChange={(event) => {
              if (event.target.validity.valid)
                apply({ from: event.target.value, q: draft.value.trim(), cursor: null })
            }}
          />
        </label>
        <label>
          по
          <input
            name="to"
            type="date"
            aria-label="Дата установки по"
            value={to}
            min={from || undefined}
            onChange={(event) => {
              if (event.target.validity.valid)
                apply({ to: event.target.value, q: draft.value.trim(), cursor: null })
            }}
          />
        </label>
        {from || to || extra.length ? (
          <button
            className={styles.reset}
            type="button"
            onClick={() =>
              apply({
                ...Object.fromEntries(extra.map((key) => [key, null])),
                from: null,
                to: null,
                q: draft.value.trim(),
                cursor: null,
              })
            }
          >
            {extra.length ? 'Сбросить фильтры' : 'Сбросить даты'}
          </button>
        ) : null}
        <input
          aria-label="Поиск по установкам"
          className={styles.search}
          name="q"
          type="search"
          placeholder="Телефон, ID, поддомен, имя, виджет"
          value={draft.value}
          onChange={(event) => setDraft({ location, value: event.target.value })}
          maxLength={200}
        />
      </div>
    </form>
  )
}
