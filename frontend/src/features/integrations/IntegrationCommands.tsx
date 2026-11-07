import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { fetchCatalog, fetchMe, keys } from '../../api/queries'
import type { Integration } from '../../api/types'
import { ActionMenu } from '../../components/ActionMenu'
import { CommandAction, type CommandField } from '../operations/CommandAction'
import { splitValues, type CommandSpec } from '../operations/commands'
import styles from './IntegrationCommands.module.css'

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

export function CreateIntegration({ resultTarget }: { resultTarget?: Element | null }) {
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  const [draftBackend, setDraftBackend] = useState('')
  const backends = catalog.data?.backends ?? []
  const backend = draftBackend || backends[0]?.code || ''
  if (!me.data?.permissions.includes('integrations:write')) return null
  return (
    <div className={styles.create}>
      {backends.length > 1 ? (
        <select
          aria-label="Бекенд новой интеграции"
          title="Бекенд, в котором будет создана интеграция"
          value={backend}
          onChange={(event) => setDraftBackend(event.target.value)}
        >
          {backends.map((item) => (
            <option key={item.code} value={item.code}>
              {item.display_name}
            </option>
          ))}
        </select>
      ) : null}
      {backend ? (
        <CommandAction
          layout="inline"
          emphasis="primary"
          resultTarget={resultTarget}
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
    </div>
  )
}

/**
 * Header actions of the integration card (ADR-0021): one primary command,
 * only the toggle that applies to the current state, rarer commands in
 * «Ещё». Results render into `resultTarget` under the header.
 */
export function IntegrationCommands({
  item,
  onInspect,
  resultTarget,
}: {
  item: Integration
  onInspect: () => void
  resultTarget?: Element | null
}) {
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  const services = catalog.data?.products ?? []
  return (
    <>
      <CommandAction
        layout="inline"
        emphasis="primary"
        resultTarget={resultTarget}
        spec={integrationSpec(item.backend, item.id, 'update', 'Изменить параметры')}
        fields={parameters(item)}
        buildPayload={parameterPayload}
        onInspect={onInspect}
      />
      {item.state === 'disabled' ? (
        <CommandAction
          layout="inline"
          resultTarget={resultTarget}
          spec={integrationSpec(
            item.backend,
            item.id,
            'enable',
            'Включить интеграцию',
            'integrations:enable',
          )}
          onInspect={onInspect}
        />
      ) : null}
      {item.state === 'active' ? (
        <CommandAction
          layout="inline"
          resultTarget={resultTarget}
          spec={integrationSpec(
            item.backend,
            item.id,
            'disable',
            'Отключить интеграцию',
            'integrations:disable',
          )}
          onInspect={onInspect}
        />
      ) : null}
      <ActionMenu>
        <CommandAction
          layout="inline"
          resultTarget={resultTarget}
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
          layout="inline"
          resultTarget={resultTarget}
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
        <Link
          to="/operations/admin"
          search={{ backend: item.backend, target_type: 'integration', target_id: item.id }}
        >
          История команд интеграции
        </Link>
      </ActionMenu>
    </>
  )
}
