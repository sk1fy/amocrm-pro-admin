import { formatTime } from '../lib/format'
import page from './page.module.css'

export function RefreshStatus({
  updatedAt,
  fetching,
  failed,
  onRefresh,
}: {
  updatedAt: number
  fetching: boolean
  failed?: boolean
  onRefresh: () => void
}) {
  return (
    <div className={page.refresh}>
      <button type="button" disabled={fetching} onClick={onRefresh}>
        Обновить
      </button>
      <span role="status">
        {fetching
          ? 'Обновляется…'
          : `Обновлено ${formatTime(updatedAt ? new Date(updatedAt).toISOString() : null)}`}
      </span>
      {failed ? (
        <span role="alert">Обновить данные не удалось. Показан предыдущий снимок.</span>
      ) : null}
    </div>
  )
}
