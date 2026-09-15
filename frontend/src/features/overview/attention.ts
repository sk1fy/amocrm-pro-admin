import type { BackendRegistryEntry } from '../../api/types'
import { lookupState, problemCodes, type Tone } from '../../states'

export type AttentionItem = {
  problem: (typeof problemCodes)[number]
  count: number | null
  unavailable: boolean
}

const toneRank: Record<Tone, number> = {
  error: 0,
  action: 1,
  attention: 2,
  unknown: 3,
  off: 4,
  ok: 5,
}

export const problemNextAction: Record<(typeof problemCodes)[number], string> = {
  reauth_required: 'Открыть аккаунты и запросить повторную авторизацию у клиента',
  webhook_error: 'Открыть аккаунты и восстановить подписку webhook',
  job_failures: 'Открыть аккаунты с ошибками фоновых задач',
  missing_credentials: 'Открыть аккаунты без учётных данных',
  disabled: 'Открыть отключённые подключения',
  source_unavailable: 'Открыть аккаунты, у которых источник не ответил',
}

export function problemSeverity(problem: string): number {
  return toneRank[lookupState('problem', problem).tone]
}

export function partitionAttention(items: AttentionItem[]): {
  open: AttentionItem[]
  passed: AttentionItem[]
} {
  const open: AttentionItem[] = []
  const passed: AttentionItem[] = []
  for (const item of items) {
    if (!item.unavailable && item.count === 0) {
      passed.push(item)
    } else {
      open.push(item)
    }
  }
  const bySeverity = (left: AttentionItem, right: AttentionItem) => {
    const severity = problemSeverity(left.problem) - problemSeverity(right.problem)
    if (severity !== 0) {
      return severity
    }
    return (right.count ?? 0) - (left.count ?? 0)
  }
  open.sort(bySeverity)
  passed.sort(bySeverity)
  return { open, passed }
}

export function backendAbsenceReason(item: BackendRegistryEntry): string | null {
  if (item.status === 'unknown') {
    return 'Данных нет: бекенд ещё не опрашивался.'
  }
  if (item.status === 'unavailable') {
    return item.error?.message
      ? `Источник недоступен: ${item.error.message}`
      : 'Источник недоступен: снимок получить не удалось.'
  }
  if (!item.revision && !item.observed_at) {
    return 'Снимок пуст: бекенд доступен, но не передал ревизию и время наблюдения.'
  }
  return null
}
