import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { createView, deleteView, fetchMe, fetchViews, keys } from '../../api/queries'
import type { SavedView } from '../../api/types'
import { FilterField } from '../../components/FilterBar'


type Props = {
  section: 'accounts' | 'operations' | 'stats'
  current: Record<string, string | number | undefined>
  columns: string[]
  onLoad: (params: Record<string, unknown>) => void
}

export function SavedViews({ section, current, columns, onLoad }: Props) {
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: keys.views(section),
    queryFn: () => fetchViews(section),
  })
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const canWrite = Boolean(me.data?.permissions.includes('views:write'))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const params: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(current)) {
      if (value !== undefined && value !== '') {
        params[key] = value
      }
    }
    await createView({ section, name: name.trim(), params, columns, shared })
    setName('')
    void queryClient.invalidateQueries({ queryKey: keys.views(section) })
  }

  return (
    <div>
      <FilterField label="Сохранённые представления">
        <select
          aria-label="Сохранённые представления"
          defaultValue=""
          onChange={(event) => {
            const view = list.data?.items.find((item) => item.id === event.target.value)
            if (view) onLoad(view.params)
          }}
        >
          <option value="">Выбрать</option>
          {(list.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.shared ? ' (общее)' : ''}
            </option>
          ))}
        </select>
      </FilterField>
      {canWrite ? (
        <form onSubmit={(event) => void save(event)}>
          <FilterField label="Имя представления">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              name="view_name"
              aria-label="Имя представления"
            />
          </FilterField>
          <label>
            <input
              type="checkbox"
              checked={shared}
              onChange={(event) => setShared(event.target.checked)}
            />{' '}
            Общее
          </label>
          <button type="submit">Сохранить представление</button>
        </form>
      ) : null}
      {canWrite
        ? (list.data?.items ?? []).map((item) => (
            <ViewDelete key={item.id} item={item} role={me.data?.role} section={section} />
          ))
        : null}

    </div>
  )
}

function ViewDelete({
  item,
  role,
  section,
}: {
  item: SavedView
  role?: string
  section: string
}) {
  const queryClient = useQueryClient()
  const canDelete = item.shared ? role === 'admin' : true
  if (!canDelete) return null
  return (
    <button
      type="button"
      onClick={() => {
        void deleteView(item.id).then(() =>
          queryClient.invalidateQueries({ queryKey: keys.views(section) }),
        )
      }}
    >
      Удалить {item.name}
    </button>
  )
}
