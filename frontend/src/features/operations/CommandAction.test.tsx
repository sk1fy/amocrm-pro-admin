import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminOperations, keys, sendCommand } from '../../api/queries'
import { CommandAction } from './CommandAction'
import type { CommandSpec } from './commands'
import { intentStorageKey, readIntent, writeIntent } from './intents'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('../../api/queries', async (original) => ({
  ...(await original<typeof import('../../api/queries')>()),
  fetchAdminOperations: vi.fn(async () => ({ items: [] })),
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
