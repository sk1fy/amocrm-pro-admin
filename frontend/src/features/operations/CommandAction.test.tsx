import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminOperation, fetchAdminOperations, keys, sendCommand } from '../../api/queries'
import type { AdminOperation } from '../../api/types'
import { CommandAction } from './CommandAction'
import type { CommandSpec } from './commands'
import { intentStorageKey, readIntent, writeIntent } from './intents'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('../../api/queries', async (original) => ({
  ...(await original<typeof import('../../api/queries')>()),
  fetchAdminOperations: vi.fn(async () => ({ items: [] })),
  fetchAdminOperation: vi.fn(),
  sendCommand: vi.fn(),
}))
afterEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
})
const spec: CommandSpec = {
  path: '/api/v1/connections/core/installation-id/commands/distribution-delivery-retry',
  backend: 'core',
  targetType: 'installation',
  targetId: 'installation-id',
  command: 'distribution-delivery-retry',
  label: 'Повторить доставку',
  permission: 'operations:retry',
  object: 'Установка',
  scope: 'Сообщение',
  consequence: 'Замороженный конверт',
}
function mounted() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(keys.me, { id: 'employee-id', permissions: ['operations:retry'] })
  const result = render(
    <QueryClientProvider client={client}>
      <section data-testid="first">
        <CommandAction
          spec={spec}
          intentScope="message-one"
          payload={{ message_id: 'message-one', expected_attempts: 3 }}
        />
      </section>
      <section data-testid="second">
        <CommandAction
          spec={spec}
          intentScope="message-two"
          payload={{ message_id: 'message-two', expected_attempts: 5 }}
        />
      </section>
    </QueryClientProvider>,
  )
  return { client, result }
}
describe('immutable trace command intents', () => {
  it('isolates unknown receipt from the adjacent message and restores only that receipt after reload', async () => {
    const firstKey = intentStorageKey('employee-id', spec.path, 'message-one')
    const secondKey = intentStorageKey('employee-id', spec.path, 'message-two')
    writeIntent(firstKey, { requestKey: 'original-request' })
    expect(readIntent(secondKey)).toBeNull()
    const first = mounted()
    await waitFor(() => expect(fetchAdminOperations).toHaveBeenCalled())
    expect(
      within(screen.getByTestId('first')).getByRole('button', {
        name: /^Повторить доставку$/,
      }),
    ).toBeDisabled()
    expect(
      within(screen.getByTestId('second')).getByRole('button', {
        name: /^Повторить доставку$/,
      }),
    ).toBeEnabled()
    expect(sendCommand).not.toHaveBeenCalled()
    first.result.unmount()
    first.client.clear()
    const reloaded = mounted()
    await waitFor(() =>
      expect(within(screen.getByTestId('first')).getByText('Исход неизвестен')).toBeVisible(),
    )
    expect(readIntent(firstKey)?.requestKey).toBe('original-request')
    expect(readIntent(secondKey)).toBeNull()
    expect(sendCommand).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(fetchAdminOperations)
        .mock.calls.every(([params]) => params.request_key === 'original-request'),
    ).toBe(true)
    reloaded.result.unmount()
    reloaded.client.clear()
  })
  it('keeps existing unscoped commands storage-compatible', () => {
    expect(intentStorageKey('employee', '/old/path')).toBe('admin-command:employee:/old/path')
  })
})

describe('detached command result', () => {
  function operation(state: string): AdminOperation {
    return {
      id: 'operation-one',
      employee_id: 'employee-id',
      backend: 'core',
      target_type: 'installation',
      target_id: 'installation-id',
      command: spec.command,
      state,
      result: {},
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    }
  }
  function mountDetached(state: string) {
    writeIntent(intentStorageKey('employee-id', spec.path), {
      requestKey: 'request-one',
      operationId: 'operation-one',
    })
    vi.mocked(fetchAdminOperation).mockResolvedValue({ operation: operation(state) })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(keys.me, { id: 'employee-id', permissions: ['operations:retry'] })
    const target = document.createElement('div')
    target.dataset.testid = 'slot'
    document.body.append(target)
    const result = render(
      <QueryClientProvider client={client}>
        <div data-testid="bar">
          <CommandAction spec={spec} layout="inline" onInspect={() => {}} resultTarget={target} />
        </div>
      </QueryClientProvider>,
    )
    return {
      unmount: () => {
        result.unmount()
        client.clear()
        target.remove()
      },
    }
  }

  it('renders the result with the command name into the target, not under the button', async () => {
    const mounted = mountDetached('succeeded')
    const slot = screen.getByTestId('slot')
    const region = await within(slot).findByRole('region', { name: 'Результат операции' })
    expect(within(slot).getByText('Повторить доставку')).toBeVisible()
    expect(within(screen.getByTestId('bar')).queryByRole('region')).toBeNull()
    expect(within(region).queryByRole('button', { name: 'Проверить объект' })).toBeNull()
    mounted.unmount()
  })

  it('keeps object inspection while the outcome is in doubt', async () => {
    const mounted = mountDetached('unknown_outcome')
    const region = await within(screen.getByTestId('slot')).findByRole('region', {
      name: 'Результат операции',
    })
    expect(within(region).getByRole('button', { name: 'Проверить объект' })).toBeVisible()
    mounted.unmount()
  })
})
