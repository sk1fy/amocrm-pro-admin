import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AdminOperation } from '../../api/types'
import { OperationView } from './OperationView'

describe('distribution verification receipt', () => {
  it.each([false, true])(
    'keeps an unknown assignment visible after a successful check (compact=%s)',
    (compact) => {
      const client = new QueryClient()
      const operation: AdminOperation = {
        id: 'receipt-id',
        employee_id: 'employee-id',
        backend: 'core',
        target_type: 'installation',
        target_id: 'installation-id',
        command: 'distribution-reconcile',
        state: 'succeeded',
        outcome: 'observed',
        result: {
          assignment_state: 'outcome_unknown',
          external_effect_state: 'unknown',
          evidence: 'observed_state_only',
        },
        created_at: '2026-10-04T00:00:00Z',
        updated_at: '2026-10-04T00:00:00Z',
      }
      const view = render(
        <QueryClientProvider client={client}>
          <OperationView operation={operation} compact={compact} link={false} />
        </QueryClientProvider>,
      )
      expect(screen.getByText('Команда проверки:')).toBeVisible()
      expect(screen.getByText('Исход назначения неизвестен')).toBeVisible()
      expect(screen.getByText('Основание: observed_state_only')).toBeVisible()
      expect(screen.getByText(/Завершение проверки не подтверждает назначение/)).toBeVisible()
      view.unmount()
      client.clear()
    },
  )
})
