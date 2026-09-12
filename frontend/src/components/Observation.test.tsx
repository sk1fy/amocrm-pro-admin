import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Observation as ObservationType } from '../api/types'
import { Observation } from './Observation'

const base: ObservationType<{ n: number }> = {
  source: 'core',
  observed_at: '2026-09-12T10:00:00Z',
  freshness: 'fresh',
  data: { n: 1 },
}

describe('Observation', () => {
  it('shows observed_at and special unavailable view with retry', () => {
    render(
      <Observation
        title="Авторизация"
        observation={{
          ...base,
          freshness: 'unavailable',
          error: { code: 'backend_unavailable', message: 'таймаут' },
          data: null,
        }}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('Источник недоступен')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    expect(screen.getByTitle('2026-09-12T10:00:00Z')).toBeInTheDocument()
  })

  it('does not treat unknown as ok', () => {
    render(
      <Observation
        observation={{
          ...base,
          freshness: 'unknown',
          error: { code: 'capability_unavailable', message: 'источник подключается на этапе 3' },
          data: null,
        }}
      />,
    )
    expect(screen.getByText(/этапе 3/)).toBeInTheDocument()
    expect(screen.getByText('Нет данных').className).toMatch(/unknown/)
  })
})
