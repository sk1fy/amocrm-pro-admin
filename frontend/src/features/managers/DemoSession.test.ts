import { describe, expect, it } from 'vitest'
import { initialState, initialStaff, transition, canView, type Invoice } from './DemoSession'
import { getReceipts } from './paymentRegistry'

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
  it('reconciles only a matching statement and never settles two invoices from one bank receipt', () => {
    const create = (id: string, amount: number): Invoice => ({
      id,
      client: '91001001',
      description: 'Продление виджета',
      amount,
      bonus: 0,
      state: 'open',
      date: '2026-11-02',
    })
    const actor = initialStaff[0]
    const prepared = [
      create('underpaid', 12000),
      create('matching-a', 10000),
      create('matching-b', 10000),
    ].reduce(
      (state, invoice) => transition(state, actor, { type: 'invoice', invoice }),
      initialState(),
    )
    const statementId = '5372'
    expect(
      transition(prepared, actor, { type: 'reconcileReceipt', id: 'underpaid', statementId }),
    ).toBe(prepared)
    const settled = transition(prepared, actor, {
      type: 'reconcileReceipt',
      id: 'matching-a',
      statementId,
    })
    expect(settled.invoices.find((invoice) => invoice.id === 'matching-a')).toMatchObject({
      state: 'paid',
      paidAt: '2026-11-04',
      statementId,
    })
    expect(
      transition(settled, actor, { type: 'reconcileReceipt', id: 'matching-b', statementId }),
    ).toBe(settled)
    const receipts = getReceipts(settled, {})
    expect(receipts.filter((receipt) => receipt.number === 'matching-a')).toEqual([
      expect.objectContaining({ id: statementId, state: 'paid', amount: 10000 }),
    ])
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
  it('adds staff by unique phone and rejects staff mutations from non-admin employees', () => {
    const initial = initialState()
    const [admin, manager] = initialStaff
    const add = {
      type: 'addStaff',
      id: 'new-staff',
      name: ' Тестовый сотрудник ',
      phone: '+7 (000) 123-45-67',
      block: 'partners',
    } as const
    expect(transition(initial, manager, add)).toBe(initial)
    expect(transition(initial, admin, { ...add, phone: '8 (921) 600-22-01' })).toBe(initial)
    const next = transition(initial, admin, add)
    const employee = next.staff.at(-1)!
    expect(employee).toMatchObject({
      id: add.id,
      name: add.name.trim(),
      phone: add.phone,
      blocks: [add.block],
    })
    expect(canView(employee, 'partners')).toBe(true)
    expect(canView(employee, 'staff')).toBe(false)
    expect(transition(next, manager, { type: 'removeStaff', id: add.id })).toBe(next)
    expect(transition(next, admin, { type: 'removeStaff', id: add.id }).staff).toEqual(
      initial.staff,
    )
  })
  it('protects the active employee from removal even when another admin exists', () => {
    const initial = initialState()
    const [admin] = initialStaff
    expect(transition(initial, admin, { type: 'removeStaff', id: admin.id })).toBe(initial)
    const next = transition(initial, admin, {
      type: 'staff',
      id: 'anna',
      blocks: ['clients', 'admin'],
    })
    expect(transition(next, admin, { type: 'removeStaff', id: admin.id })).toBe(next)
    expect(transition(next, admin, { type: 'removeStaff', id: 'anna' }).staff).toEqual(
      initial.staff.filter((employee) => employee.id !== 'anna'),
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
