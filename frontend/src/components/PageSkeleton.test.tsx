import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PageSkeleton } from './PageSkeleton'

afterEach(cleanup)

describe('PageSkeleton', () => {
  it('keeps the default page layout announcement', () => {
    const { container } = render(<PageSkeleton label="Загрузка подключения…" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Загрузка подключения…')).toBeInTheDocument()
    expect(container.querySelectorAll('[class*="hero"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[class*="block"]').length).toBeGreaterThan(0)
  })

  it('renders a dashboard-shaped skeleton', () => {
    const { container } = render(<PageSkeleton label="Загрузка статистики…" variant="dashboard" />)
    expect(screen.getByText('Загрузка статистики…')).toBeInTheDocument()
    expect(container.querySelectorAll('[class*="metric"]').length).toBeGreaterThan(0)
  })

  it('renders a list-shaped skeleton', () => {
    const { container } = render(<PageSkeleton label="Загрузка списка аккаунтов…" variant="list" />)
    expect(container.querySelectorAll('[class*="line"]').length).toBeGreaterThan(0)
  })
})
