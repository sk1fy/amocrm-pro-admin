import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectionCounts, connectionsLabel, summarizeConnections } from './ConnectionCounts'

afterEach(cleanup)

describe('ConnectionCounts', () => {
  it('counts all connections and lists only deviations', () => {
    expect(summarizeConnections({ active: 2, pending: 1, error: 0 })).toEqual({
      total: 3,
      deviations: [{ state: 'pending', count: 1 }],
    })
    expect(summarizeConnections({})).toEqual({ total: 0, deviations: [] })
  })

  it('keeps an unknown state visible', () => {
    expect(summarizeConnections({ future_state: 1 }).deviations).toEqual([
      { state: 'future_state', count: 1 },
    ])
  })

  it('shows no badge for active connections', () => {
    render(<ConnectionCounts counts={{ active: 2, pending: 1 }} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Ожидает авторизации')).toBeInTheDocument()
    expect(screen.queryByText('Активно')).not.toBeInTheDocument()
  })

  it('declines the number of connections', () => {
    expect(connectionsLabel(0)).toBe('Нет подключений')
    expect(connectionsLabel(1)).toBe('1 подключение')
    expect(connectionsLabel(3)).toBe('3 подключения')
    expect(connectionsLabel(11)).toBe('11 подключений')
    expect(connectionsLabel(21)).toBe('21 подключение')
  })
})
