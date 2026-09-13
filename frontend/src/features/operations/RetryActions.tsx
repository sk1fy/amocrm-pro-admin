import type { Delivery, Job } from '../../api/types'
import { CommandAction } from './CommandAction'

export function RetryJob({ backend, job }: { backend: string; job: Job }) {
  if (!backend) return null
  return (
    <CommandAction
      spec={{
        path: `/api/v1/operations/jobs/${encodeURIComponent(backend)}/${encodeURIComponent(job.id)}/retry`,
        backend,
        targetType: 'job',
        targetId: job.id,
        command: 'retry',
        label: 'Повторить задачу',
        permission: 'operations:retry',
        object: `Задача ${job.id} · ${job.type} · ${backend}`,
        scope: 'Повторная обработка одной задачи.',
        consequence:
          'Будет запланирована новая попытка. Сервер разрешает повтор только для безопасных типов задач и подходящих состояний.',
      }}
      disabled={job.retry_allowed !== true}
      disabledReason={job.retry_allowed === false ? job.retry_reason : undefined}
    />
  )
}

export function RetryDelivery({
  backend,
  connectionId,
  delivery,
  onInspect,
}: {
  backend: string
  connectionId: string
  delivery: Delivery
  onInspect: () => void
}) {
  return (
    <CommandAction
      spec={{
        path: `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(connectionId)}/deliveries/${encodeURIComponent(delivery.command_id)}/retry`,
        backend,
        targetType: 'delivery',
        targetId: delivery.command_id,
        command: 'retry',
        label: 'Повторить доставку',
        permission: 'operations:retry',
        object: `Доставка ${delivery.command_id} · ${delivery.action} → ${delivery.target}`,
        scope: `Одна команда Activity подключения ${connectionId}.`,
        consequence:
          'Будет запланирована повторная доставка. Команды старше семи суток не повторяются.',
      }}
      disabled={delivery.retry_allowed !== true}
      disabledReason={delivery.retry_allowed === false ? delivery.retry_reason : undefined}
      onInspect={onInspect}
    />
  )
}
