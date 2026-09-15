import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

afterEach(cleanup)

describe('EmptyState', () => {
  it('explains why the list is empty and what to do', () => {
    render(
      <EmptyState
        title="Нет интеграций"
        description="Источник ответил, записей нет. Создайте интеграцию кнопкой в шапке."
        action={<a href="/widgets">К каталогу</a>}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Нет интеграций')
    expect(screen.getByText(/Источник ответил/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'К каталогу' })).toBeInTheDocument()
  })
})
