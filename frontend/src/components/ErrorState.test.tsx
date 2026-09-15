import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ErrorState } from './ErrorState'

afterEach(cleanup)

describe('ErrorState', () => {
  it('always offers retry for recoverable errors', () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        error={new ApiError(500, 'internal', 'ошибка запроса', 'req-1')}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('ошибка запроса')).toBeInTheDocument()
    expect(screen.getByText(/req-1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('hides retry for forbidden errors', () => {
    render(
      <ErrorState
        error={new ApiError(403, 'forbidden', 'недостаточно прав', 'req-2')}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('Недостаточно прав')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
  })
})
