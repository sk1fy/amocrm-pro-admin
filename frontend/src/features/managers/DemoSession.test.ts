import { describe, expect, it } from 'vitest'
import { initialState, initialStaff, transition, canView, type Invoice } from './DemoSession'

describe('demo workflow boundaries', () => {
  it('reserves bonuses once and refunds only an open invoice', () => {
    const initial = initialState()
    const invoice: Invoice = {
      id: 'test-invoice',
      client: '91001001',
      description: 'Test',
      amount: 1200,
      bonus: 600,
      state: 'open',
      date: '2026-11-16',
    }
    const reserved = transition(initial, initialStaff[0], { type: 'invoice', invoice })
    expect(reserved.accounts[invoice.client].bonus).toBe(1800)
    expect(transition(reserved, initialStaff[0], { type: 'invoice', invoice })).toBe(reserved)
    const cancelled = transition(reserved, initialStaff[0], { type: 'cancel', id: invoice.id })
    expect(cancelled.accounts[invoice.client].bonus).toBe(2400)
    expect(transition(cancelled, initialStaff[0], { type: 'settle', id: invoice.id })).toBe(
      cancelled,
    )
    expect(transition(cancelled, initialStaff[0], { type: 'cancel', id: invoice.id })).toBe(
      cancelled,
    )
  })
  it('settles one receipt, one history event and one installation extension', () => {
    const initial = initialState()
    const row = initial.rows[0]
    const invoice: Invoice = {
      id: 'paid-test',
      client: row.client!,
      description: 'Renew',
      amount: 1000,
      bonus: 0,
      state: 'open',
      date: '2026-11-16',
      installation: row.id,
      until: '2027-06-01',
    }
    const created = transition(initial, initialStaff[0], { type: 'invoice', invoice })
    const paid = transition(created, initialStaff[0], { type: 'settle', id: invoice.id })
    expect(paid.rows[0].paidUntil).toBe('01.06.2027')
    expect(paid.invoices[0].receipt).toContain('Максим')
    expect(transition(paid, initialStaff[0], { type: 'settle', id: invoice.id })).toBe(paid)
    expect(transition(paid, initialStaff[0], { type: 'cancel', id: invoice.id })).toBe(paid)
  })
  it('separates client and finance authority and keeps the last admin', () => {
    const initial = initialState()
    expect(canView(initialStaff[1], 'invoices')).toBe(false)
    expect(canView(initialStaff[2], 'clients')).toBe(false)
    expect(canView(initialStaff[2], 'feed')).toBe(true)
    expect(transition(initial, initialStaff[1], { type: 'settle', id: 'invoice-1' })).toBe(initial)
    expect(
      transition(initial, initialStaff[2], {
        type: 'install',
        id: initial.rows[0].id,
        patch: { reviewed: true },
        title: 'Review',
      }),
    ).toBe(initial)
    expect(transition(initial, initialStaff[0], { type: 'staff', id: 'max', blocks: [] })).toBe(
      initial,
    )
  })
  it('manual renewal does not record cash or create an invoice', () => {
    const initial = initialState()
    const next = transition(initial, initialStaff[0], {
      type: 'renew',
      id: initial.rows[0].id,
      until: '2027-07-16',
      reason: 'Сделка AMO',
      detail: '880001',
      bonus: 0,
    })
    expect(next.invoices).toBe(initial.invoices)
    expect(next.accounts['91001001'].bonus).toBe(initial.accounts['91001001'].bonus)
    expect(next.events[0].details).toContain('без поступления денег')
  })
})
