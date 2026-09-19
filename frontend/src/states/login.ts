import { isApiError } from '../api/client'

export function loginErrorMessage(error: unknown): string {
  if (isApiError(error) && error.status === 401) return 'Неверный email или пароль'
  if (isApiError(error) && error.status === 429) {
    return 'Слишком много попыток, повторите через 60 с'
  }
  const message = 'Сервис входа временно недоступен. Повторите попытку позже.'
  return isApiError(error) && error.requestId
    ? `${message} Код обращения: ${error.requestId}`
    : message
}
