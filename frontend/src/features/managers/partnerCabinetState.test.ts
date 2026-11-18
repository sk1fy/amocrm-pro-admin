import { describe, expect, it } from 'vitest'
import {
  cabinetHeldBonuses,
  cancelCabinetOrder,
  completeCabinetOrder,
  createCabinetOrder,
  type CabinetOrder,
} from './partnerCabinetState'
import { makePartner } from './partnerDirectory'

const date = '2026-11-06'
const renewal: Omit<CabinetOrder, 'id' | 'state'> = {
  target: 'install-1',
  title: 'Сделки клиента',
  method: 'card',
  price: 6000,
  bonus: 2000,
  until: '2027-11-06',
}

describe('partner cabinet orders', () => {
  it('holds bonus funds, settles once, and restores the trial option for the renewed widget', () => {
    const partner = { ...makePartner('test', 'Демо'), bonus: 5000 }
    const queued = createCabinetOrder(partner, renewal, date)
    expect(cabinetHeldBonuses(queued)).toBe(2000)
    expect(queued.bonus).toBe(5000)
    expect(createCabinetOrder(queued, renewal, date)).toBe(queued)
    expect(createCabinetOrder(queued, { ...renewal, target: 'pro', bonus: 4000 }, date)).toBe(
      queued,
    )

    const settled = completeCabinetOrder(queued, 'ПК-1', date)
    expect(cabinetHeldBonuses(settled)).toBe(0)
    expect(settled.bonus).toBe(3000)
    expect(settled.cabinetRenewals?.['install-1']).toMatchObject({
      until: renewal.until,
      paid: true,
      tested: false,
    })
    expect(completeCabinetOrder(settled, 'ПК-1', date)).toBe(settled)
  })

  it('releases reserved bonuses on cancellation without extending the widget', () => {
    const partner = { ...makePartner('test', 'Демо'), bonus: 5000 }
    const queued = createCabinetOrder(partner, renewal, date)
    const cancelled = cancelCabinetOrder(queued, 'ПК-1')
    expect(cabinetHeldBonuses(cancelled)).toBe(0)
    expect(cancelled.bonus).toBe(5000)
    expect(cancelled.cabinetRenewals).toBeUndefined()
    expect(completeCabinetOrder(cancelled, 'ПК-1', date)).toBe(cancelled)
    expect(cancelCabinetOrder(cancelled, 'ПК-1')).toBe(cancelled)
  })
})
