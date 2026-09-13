import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { fetchCatalog, fetchMe, keys } from '../../api/queries'
import type { Integration } from '../../api/types'
import page from '../../components/page.module.css'
import { CommandAction, type CommandField } from '../operations/CommandAction'
import { splitValues, type CommandSpec } from '../operations/commands'

function integrationSpec(
  backend: string,
  id: string,
  command: string,
  label: string,
  permission = 'integrations:write',
): CommandSpec {
  const consequence =
    command === 'disable'
      ? 'Обработка будет отключена для всей интеграции. Действие обратимо включением.'
      : command === 'enable'
        ? 'Обработка всей интеграции будет включена. Отключённые установки сохраняют собственное состояние.'
        : command === 'rotate-secret'
          ? 'Секрет будет заменён. Старое значение прочитать или восстановить из админки нельзя. Отключённая интеграция не будет включена.'
          : command === 'set-service'
            ? 'Изменится доступность выбранного сервиса для интеграции. Настройка обратима.'
            : 'Параметры интеграции будут сохранены. Изменение влияет на её подключения.'
  return {
    backend,
    targetType: 'integration',
    targetId: id,
    command,
    label,
    permission,
    path:
      id === 'new'
        ? `/api/v1/integrations/${encodeURIComponent(backend)}/commands/create`
        : `/api/v1/integrations/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/commands/${command}`,
    object: `${id === 'new' ? 'Новая интеграция' : `Интеграция ${id}`} · ${backend}`,
    scope: 'Вся интеграция и её подключения во всех аккаунтах.',
    consequence,
  }
}

const parameters = (item?: Integration): CommandField[] => [
  {
    name: 'redirect_uri',
    label: 'OAuth redirect URI',
    type: 'url',
    value: item?.redirect_uri,
    required: true,
  },
  {
    name: 'webhook_events',
    label: 'События webhook, через запятую',
    type: 'textarea',
    value: item?.webhook_events.join(', '),
  },
]
const parameterPayload = (data: FormData) => ({
  redirect_uri: String(data.get('redirect_uri') ?? '').trim(),
  webhook_events: splitValues(data.get('webhook_events')),
})

export function CreateIntegration() {
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  const [draftBackend, setDraftBackend] = useState('')
  const backend = draftBackend || catalog.data?.backends[0]?.code || ''
  if (!me.data?.permissions.includes('integrations:write')) return null
  return (
    <section className={page.card}>
      <h2>Создание интеграции</h2>
      <label>
        Бекенд{' '}
        <select value={backend} onChange={(event) => setDraftBackend(event.target.value)}>
          {catalog.data?.backends.map((item) => (
            <option key={item.code} value={item.code}>
              {item.display_name}
            </option>
          ))}
        </select>
      </label>
      {backend ? (
        <CommandAction
          spec={integrationSpec(backend, 'new', 'create', 'Создать интеграцию')}
          fields={[
            { name: 'code', label: 'Код интеграции', required: true },
            { name: 'client_id', label: 'Client ID amoCRM', required: true },
            {
              name: 'client_secret',
              label: 'Новый client secret',
              type: 'password',
              required: true,
            },
            ...parameters(),
            { name: 'services', label: 'Сервисы через запятую (lead-status, activity)' },
          ]}
          buildPayload={(data) => ({
            ...parameterPayload(data),
            code: String(data.get('code') ?? '').trim(),
            client_id: String(data.get('client_id') ?? '').trim(),
            client_secret: String(data.get('client_secret') ?? ''),
            services: splitValues(data.get('services')),
          })}
        />
      ) : null}
    </section>
  )
}

export function IntegrationCommands({
  item,
  onInspect,
}: {
  item: Integration
  onInspect: () => void
}) {
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  const services = catalog.data?.products ?? []
  return (
    <section className={page.stack} aria-label="Управление интеграцией">
      <Link
        to="/operations/admin"
        search={{ backend: item.backend, target_type: 'integration', target_id: item.id }}
      >
        История команд интеграции
      </Link>
      <div className={page.row}>
        <CommandAction
          spec={integrationSpec(item.backend, item.id, 'update', 'Изменить параметры')}
          fields={parameters(item)}
          buildPayload={parameterPayload}
          onInspect={onInspect}
        />
        <CommandAction
          spec={integrationSpec(
            item.backend,
            item.id,
            'rotate-secret',
            'Заменить секрет',
            'integrations:rotate_secret',
          )}
          fields={[
            {
              name: 'client_secret',
              label: 'Новый client secret',
              type: 'password',
              required: true,
            },
          ]}
          buildPayload={(data) => ({ client_secret: String(data.get('client_secret') ?? '') })}
          onInspect={onInspect}
        />
        <CommandAction
          spec={integrationSpec(
            item.backend,
            item.id,
            'enable',
            'Включить интеграцию',
            'integrations:enable',
          )}
          disabled={item.state !== 'disabled'}
          onInspect={onInspect}
        />
        <CommandAction
          spec={integrationSpec(
            item.backend,
            item.id,
            'disable',
            'Отключить интеграцию',
            'integrations:disable',
          )}
          disabled={item.state !== 'active'}
          onInspect={onInspect}
        />
        <CommandAction
          spec={integrationSpec(item.backend, item.id, 'set-service', 'Настроить сервис')}
          fields={[
            {
              name: 'service',
              label: 'Сервис',
              type: 'select',
              options: services.map((service) => ({
                value: service.code,
                label: service.display_name,
              })),
              required: true,
            },
            {
              name: 'enabled',
              label: 'Доступность',
              type: 'select',
              options: [
                { value: 'true', label: 'Выдать грант' },
                { value: 'false', label: 'Отозвать грант' },
              ],
            },
          ]}
          buildPayload={(data) => ({
            service: String(data.get('service') ?? ''),
            enabled: data.get('enabled') === 'true',
          })}
          onInspect={onInspect}
        />
      </div>
    </section>
  )
}
