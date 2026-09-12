import { isApiError, isForbidden } from '../api/client'
import styles from './ErrorState.module.css'

type Props = {
  error: unknown
  onRetry?: () => void
}

export function ErrorState({ error, onRetry }: Props) {
  const forbidden = isForbidden(error)
  const api = isApiError(error)
  const message = forbidden
    ? 'Недостаточно прав'
    : api
      ? error.message
      : 'Не удалось загрузить данные'
  const requestId = api ? error.requestId : ''
  return (
    <div className={styles.box} role="alert">
      <strong>{message}</strong>
      {requestId ? <div className={styles.requestId}>request_id: {requestId}</div> : null}
      {onRetry && !forbidden ? (
        <div>
          <button type="button" onClick={onRetry}>
            Повторить
          </button>
        </div>
      ) : null}
    </div>
  )
}
