import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WebhookEvents } from './WebhookEvents'

afterEach(cleanup)

describe('WebhookEvents', () => {
  it('shows a dash when there are no events', () => {
    render(<WebhookEvents events={[]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows a count and expands grouped events instead of a csv', () => {
    render(<WebhookEvents events={['add_lead', 'update_contact', 'status_lead']} />)
    expect(screen.getByText('3 события')).toBeInTheDocument()
    expect(screen.queryByText('add_lead, update_contact, status_lead')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('3 события'))
    expect(screen.getByText('Сделка создана')).toBeInTheDocument()
    expect(screen.getByText('Контакт изменён')).toBeInTheDocument()
    expect(screen.getByText('Сделки')).toBeInTheDocument()
  })
})
