import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { createView, deleteView, fetchMe, fetchViews, keys, patchView } from '../../api/queries'
import { FilterField } from '../../components/FilterBar'
import styles from './SavedViews.module.css'

type Props = {
  section: 'accounts' | 'operations' | 'stats'
  current: Record<string, string | number | undefined>
  columns: string[]
  onLoad: (params: Record<string, unknown>) => void
}

export function normalizeViewParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key === 'cursor' || value === undefined || value === '') {
      continue
    }
    out[key] = String(value)
  }
  return out
}

export function viewMatchesCurrent(
  params: Record<string, unknown>,
  current: Record<string, string | number | undefined>,
  section?: Props['section'],
): boolean {
  const left = normalizeViewParams(params)
  const right = normalizeViewParams(current)
  if (section === 'accounts') {
    left.origin ??= 'all'
    right.origin ??= 'all'
  }
  const keysLeft = Object.keys(left).sort()
  const keysRight = Object.keys(right).sort()
  if (keysLeft.length !== keysRight.length) {
    return false
  }
  return keysLeft.every((key) => left[key] === right[key])
}

export function SavedViews({ section, current, columns, onLoad }: Props) {
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: keys.views(section),
    queryFn: () => fetchViews(section),
  })
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [shared, setShared] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const canWrite = Boolean(me.data?.permissions.includes('views:write'))
  const isAdmin = me.data?.role === 'admin'
  const items = list.data?.items ?? []
  const selected = items.find((item) => item.id === selectedId)
  const active = items.find((item) => viewMatchesCurrent(item.params, current, section))
  const canManageSelected = Boolean(selected) && canWrite && (selected?.shared ? isAdmin : true)

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: keys.views(section) })
  }

  function currentParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(current)) {
      if (value !== undefined && value !== '') {
        params[key] = value
      }
    }
    return params
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    await createView({
      section,
      name: name.trim(),
      params: currentParams(),
      columns,
      shared: isAdmin && shared,
    })
    setName('')
    void refresh()
  }

  async function rename() {
    if (!selected || !name.trim()) return
    await patchView(selected.id, { name: name.trim() })
    setName('')
    void refresh()
  }

  async function updateSelected() {
    if (!selected) return
    await patchView(selected.id, { params: currentParams(), columns })
    void refresh()
  }

  async function removeSelected() {
    if (!selected) return
    await deleteView(selected.id)
    setSelectedId('')
    void refresh()
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <FilterField label="Сохранённые представления">
          <select
            aria-label="Сохранённые представления"
            value={selectedId}
            onChange={(event) => {
              const id = event.target.value
              setSelectedId(id)
              const view = items.find((item) => item.id === id)
              if (view) onLoad(view.params)
            }}
          >
            <option value="">Выбрать</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.shared ? ' (доступно всем администраторам)' : ''}
                {viewMatchesCurrent(item.params, current, section) ? ' — текущее' : ''}
              </option>
            ))}
          </select>
        </FilterField>
        {canWrite ? (
          <button
            type="button"
            aria-expanded={editing}
            aria-controls={`view-editor-${section}`}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? 'Закрыть настройки вида' : 'Сохранить вид'}
          </button>
        ) : null}
      </div>
      {active ? (
        <p className={styles.active} aria-live="polite">
          Активно: {active.name}
          {active.shared ? ' (доступно всем администраторам)' : ''}
        </p>
      ) : null}
      {canWrite && editing ? (
        <form
          id={`view-editor-${section}`}
          className={styles.manage}
          onSubmit={(event) => void save(event)}
        >
          <FilterField label="Имя представления">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              name="view_name"
              aria-label="Имя представления"
            />
          </FilterField>
          {isAdmin ? (
            <label className={styles.shared}>
              <input
                type="checkbox"
                checked={shared}
                onChange={(event) => setShared(event.target.checked)}
              />{' '}
              Доступно всем администраторам
            </label>
          ) : null}
          <div className={styles.actions}>
            <button type="submit">Сохранить представление</button>
            {canManageSelected ? (
              <>
                <button type="button" onClick={() => void updateSelected()}>
                  Обновить выбранное
                </button>
                <button type="button" onClick={() => void rename()} disabled={!name.trim()}>
                  Переименовать
                </button>
                <button type="button" onClick={() => void removeSelected()}>
                  Удалить {selected?.name}
                </button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}
