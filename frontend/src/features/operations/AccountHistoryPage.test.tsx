import { describe, expect, it } from 'vitest'
import type { HistoryItem } from '../../api/types'
import {
  groupHistory,
  historyDayLabel,
  historyObjectHref,
  historyObjectLabel,
  historyOutcome,
  historyItemTitle,
  historyTitle,
} from './AccountHistoryPage'

function event(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    source: 'core',
    backend: 'core',
    occurred_at: '2026-11-06T16:40:00Z',
    action: 'webhook.event.processed',
    actor_type: 'integration',
    object_type: 'installation',
    connection_id: 'conn-1',
    metadata: {},
    ...overrides,
  }
}

describe('historyObjectHref', () => {
  it('builds account and connection routes from typed fields', () => {
    expect(
      historyObjectHref(
        {
          source: 'core',
          backend: 'core',
          occurred_at: '2026-09-14T10:00:00Z',
          action: 'installation.enabled',
          object_type: 'installation',
          connection_id: 'conn-1',
          metadata: {},
        },
        '91000002',
      ),
    ).toBe('/accounts/91000002/widgets/core/conn-1')
    expect(
      historyObjectHref(
        {
          source: 'admin',
          occurred_at: '2026-09-14T10:00:00Z',
          action: 'auth.login_failed',
          object_ref: 'account:91000002',
          metadata: {},
        },
        '91000002',
      ),
    ).toBe('/accounts/91000002')
  })
})

describe('account history feed', () => {
  const now = new Date('2026-11-06T20:00:00')

  it('groups events by local day and folds consecutive identical events', () => {
    const days = groupHistory(
      [
        event({ occurred_at: '2026-11-06T19:40:00' }),
        event({ occurred_at: '2026-11-06T18:54:00' }),
        event({ occurred_at: '2026-11-06T18:50:00' }),
        event({ occurred_at: '2026-11-06T18:00:00', connection_id: 'conn-2' }),
        event({ occurred_at: '2026-11-05T21:44:00', action: 'installation.authorized' }),
        event({ occurred_at: '2026-11-04T16:39:00' }),
      ],
      now,
    )
    expect(days.map((day) => day.label)).toEqual([
      'Сегодня, 6 ноября',
      'Вчера, 5 ноября',
      '4 ноября',
    ])
    expect(days[0]?.entries.map((entry) => entry.count)).toEqual([3, 1])
    expect(days[0]?.entries[0]?.earliest).toBe('2026-11-06T18:50:00')
    expect(days[1]?.entries).toHaveLength(1)
  })

  it('does not fold a failure into successes', () => {
    const days = groupHistory(
      [
        event({ occurred_at: '2026-11-06T19:40:00' }),
        event({ occurred_at: '2026-11-06T19:30:00', outcome: 'failed' }),
      ],
      now,
    )
    expect(days[0]?.entries).toHaveLength(2)
  })

  it('adds the year only for another year', () => {
    expect(historyDayLabel('2025-03-02T10:00:00', now)).toBe('2 марта 2025 г.')
  })

  it('names the object in words instead of an identifier', () => {
    const names = new Map([['conn-1', 'task-control-widget']])
    expect(historyObjectLabel(event(), names)).toBe('task-control-widget')
    expect(historyObjectLabel(event({ connection_id: 'conn-unknown' }), names)).toBe('Подключение')
    expect(
      historyObjectLabel(
        event({ connection_id: null, object_type: null, object_ref: 'account:1' }),
        names,
      ),
    ).toBe('Аккаунт')
  })

  it('marks failures and unknown outcomes but not success', () => {
    expect(historyOutcome(event({ outcome: 'ok' }))).toBeNull()
    expect(historyOutcome(event())).toBeNull()
    expect(historyOutcome(event({ outcome: 'denied' }))).toBe('denied')
    expect(historyOutcome(event({ action: 'admin.command.failed', outcome: 'ok' }))).toBe('failed')
    expect(historyOutcome(event({ outcome: 'surprise' }))).toBe('surprise')
  })

  it('keeps the code of an action without a description', () => {
    expect(historyTitle('webhook.event.processed')).toBe('Webhook-событие обработано')
    expect(historyTitle('distribution.assigned')).toBe('distribution.assigned')
  })

  it('names the command of an operation event', () => {
    const done = event({
      action: 'operation.succeeded',
      object_type: 'installation',
      metadata: { command: 'check', operation_id: 'op-1' },
    })
    expect(historyItemTitle(done)).toBe('Операция выполнена: «Проверить подключение»')
    expect(historyItemTitle(event({ action: 'operation.succeeded', metadata: {} }))).toBe(
      'Операция выполнена',
    )
  })
})
