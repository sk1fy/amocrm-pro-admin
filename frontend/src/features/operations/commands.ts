export type CommandSpec = {
  path: string
  backend: string
  targetType: string
  targetId: string
  command: string
  label: string
  permission: string
  object: string
  scope: string
  consequence: string
  nextStep?: string
}

export const operationStates = [
  'accepted',
  'pending',
  'running',
  'succeeded',
  'failed',
  'partial',
  'unknown_outcome',
] as const

export function operationPending(state?: string): boolean {
  return state === 'accepted' || state === 'pending' || state === 'running'
}

export function jobPending(state?: string): boolean {
  return state === 'queued' || state === 'processing' || state === 'retry'
}

export function safeOperationURL(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value, window.location.origin)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export function connectionCommand(
  backend: string,
  id: string,
  command: string,
  accountId?: string,
): CommandSpec {
  const definitions: Record<
    string,
    Pick<CommandSpec, 'label' | 'permission' | 'scope' | 'consequence' | 'nextStep'>
  > = {
    check: {
      label: 'Проверить подключение',
      permission: 'connections:check',
      scope: 'Одна установка. Проверка запроса к amoCRM через очередь задач.',
      consequence:
        'Проверка не меняет настройки установки. Результат появится после выполнения задачи.',
    },
    enable: {
      label: 'Включить подключение',
      permission: 'connections:enable',
      scope: 'Только эта установка виджета в аккаунте.',
      consequence: 'Установка снова сможет обрабатывать запросы. Действие обратимо отключением.',
    },
    disable: {
      label: 'Отключить подключение',
      permission: 'connections:disable',
      scope: 'Только эта установка виджета в аккаунте.',
      consequence: 'Обработка для установки будет отключена. Действие обратимо включением.',
    },
    revoke: {
      label: 'Сбросить авторизацию',
      permission: 'connections:revoke',
      scope: 'Локальные учётные данные этой установки в Core.',
      consequence:
        'Локальная авторизация станет недействительной. Это не отзыв разрешений на стороне amoCRM.',
      nextStep:
        'Клиенту потребуется повторная авторизация. Ссылка OAuth появится в результате операции.',
    },
    uninstall: {
      label: 'Удалить подключение',
      permission: 'connections:uninstall',
      scope: 'Эта установка: локальные учётные данные и снятие webhook-подписки.',
      consequence: 'Установка будет удалена. Снятие webhook может завершиться частично.',
      nextStep:
        'Для восстановления клиент должен заново пройти OAuth. При частичном удалении проверьте ошибку webhook и явно повторите удаление.',
    },
    reconcile: {
      label: 'Восстановить webhook',
      permission: 'webhooks:reconcile',
      scope: 'Webhook-подписка этой установки.',
      consequence:
        'Будет поставлена задача регистрации подписки. Её постановка ещё не подтверждает регистрацию webhook.',
    },
    'pilot-enable': {
      label: 'Включить пилот Activity',
      permission: 'activity:pilot',
      scope: 'Настройка пилота Activity в Core для этой установки.',
      consequence:
        'Пилот будет включён. Состояние синхронизации проверяется отдельно; настройка обратима.',
    },
    'pilot-disable': {
      label: 'Выключить пилот Activity',
      permission: 'activity:pilot',
      scope: 'Настройка пилота Activity в Core для этой установки.',
      consequence: 'Пилот будет выключен. Настройка обратима.',
    },
  }
  const definition = definitions[command]
  if (!definition) throw new Error('Unknown connection command')
  return {
    ...definition,
    backend,
    targetType: 'installation',
    targetId: id,
    command,
    path: `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/commands/${command}`,
    object: `Подключение ${id}${accountId ? ` · аккаунт ${accountId}` : ''} · ${backend}`,
  }
}

export function splitValues(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string'
    ? value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}
