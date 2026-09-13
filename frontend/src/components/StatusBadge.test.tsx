import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('uses dictionary labels and does not paint unknown as ok', () => {
    const { rerender } = render(<StatusBadge domain="connection" state="active" />)
    expect(screen.getByText('Активно').className).toMatch(/ok/)

    rerender(<StatusBadge domain="connection" state="mystery" raw="mystery" />)
    const unknown = screen.getByText('Неизвестно')
    expect(unknown.className).toMatch(/unknown/)
    expect(unknown.className).not.toMatch(/ok/)
    expect(screen.getByText('mystery')).toBeInTheDocument()
  })

  it('keeps connection states independent', () => {
    render(
      <>
        <StatusBadge domain="connection" state="reauth_required" testId="a" />
        <StatusBadge domain="connection" state="active" testId="b" />
      </>,
    )
    expect(screen.getByTestId('a').textContent).toContain('повторн')
    expect(screen.getByTestId('b').textContent).toContain('Активно')
  })
})
