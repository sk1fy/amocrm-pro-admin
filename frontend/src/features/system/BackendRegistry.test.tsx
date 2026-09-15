import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { BackendRegistryEntry } from '../../api/types'
import { BackendRegistry } from './BackendRegistry'

afterEach(cleanup)

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
})

function entry(overrides: Partial<BackendRegistryEntry> = {}): BackendRegistryEntry {
  return {
    backend: 'core',
    kind: 'core-http',
    display_name: 'Core (amocrm-pro)',
    products: [{ code: 'lead-status', display_name: 'Смена статусов лидов' }],
    status: 'available',
    contract_version: 'v1',
    revision: 'build-rev',
    adapter_capabilities: ['accounts', 'connections'],
    backend_capabilities: ['accounts'],
    observed_at: '2026-09-13T10:00:00Z',
    checked_at: '2026-09-13T10:05:00Z',
    ...overrides,
  }
}

describe('BackendRegistry', () => {
  it('renders the compact table and keeps details in the drawer', () => {
    render(<BackendRegistry items={[entry()]} />)
    expect(screen.getByText('Core (amocrm-pro)')).toBeInTheDocument()
    expect(screen.getByText('core')).toBeInTheDocument()
    expect(screen.getByText('core-http')).toBeInTheDocument()
    expect(screen.getByTestId('backend-status-core').textContent).toBe('Доступен')
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByTitle('2026-09-13T10:05:00Z')).toBeInTheDocument()
    expect(screen.queryByText('accounts, connections')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Core (amocrm-pro)'))
    expect(screen.getByText('Возможности адаптера')).toBeInTheDocument()
    expect(screen.getByText('Возможности бекенда')).toBeInTheDocument()
    expect(screen.getByText('lead-status — Смена статусов лидов')).toBeInTheDocument()
    expect(screen.getByTitle('build-rev')).toBeInTheDocument()
    expect(screen.getByTitle('2026-09-13T10:00:00Z')).toBeInTheDocument()
  })

  it('renders components as pretty-printed JSON in the drawer instead of markup', () => {
    const { container } = render(
      <BackendRegistry
        items={[
          entry({
            components: {
              activity: { ready: true },
              note: '<img src=x onerror=alert(1)>',
            },
          }),
        ]}
      />,
    )
    fireEvent.click(screen.getByText('Core (amocrm-pro)'))
    expect(screen.queryByText('Показать JSON')).not.toBeInTheDocument()
    expect(screen.getByText(/"ready": true/)).toBeInTheDocument()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('pre code')).not.toBeNull()
  })

  it('shows dashes for absent products, backend capabilities and components', () => {
    render(
      <BackendRegistry
        items={[entry({ products: [], backend_capabilities: [], components: undefined })]}
      />,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getByText('Core (amocrm-pro)'))
    expect(screen.queryByText('Показать JSON')).not.toBeInTheDocument()
    expect(screen.getByText(/Компоненты:/).textContent).toContain('—')
  })

  it('shows a dash when the backend never answered and reports the failure', () => {
    render(
      <BackendRegistry
        items={[
          entry({
            backend: 'legacy',
            display_name: 'Legacy',
            status: 'unavailable',
            observed_at: null,
            error: { code: 'backend_unavailable', message: 'нет ответа' },
          }),
        ]}
      />,
    )
    expect(screen.getByTestId('backend-status-legacy').textContent).toBe('Недоступен')
    expect(screen.getByText('нет ответа')).toBeInTheDocument()
    expect(screen.getByText('(backend_unavailable)')).toBeInTheDocument()
    expect(screen.queryByTitle('2026-09-13T10:00:00Z')).not.toBeInTheDocument()
  })

  it('does not paint never-probed backends as available', () => {
    render(<BackendRegistry items={[entry({ status: 'unknown', observed_at: null })]} />)
    const badge = screen.getByTestId('backend-status-core')
    expect(badge.textContent).toBe('Ещё не опрашивался')
    expect(badge.className).not.toMatch(/ok/)
  })
})
