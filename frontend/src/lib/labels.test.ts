import { describe, expect, it } from 'vitest'
import {
  actorLabel,
  auditLabel,
  explainError,
  groupWebhookEvents,
  isCoreAdminAuthError,
  jobLabel,
  webhookEventLabel,
} from './labels'

describe('labels', () => {
  it('localizes known job and audit codes', () => {
    expect(jobLabel('admin.connection_check')).toBe('Проверка подключения')
    expect(auditLabel('admin.command.succeeded')).toBe('Команда администратора выполнена')
    expect(auditLabel('auth.login_failed')).toBe('Неуспешный вход')
    expect(actorLabel('admin')).toBe('Сотрудник админки')
    expect(webhookEventLabel('add_lead')).toBe('Сделка создана')
  })

  it('groups webhook events by entity', () => {
    const groups = groupWebhookEvents(['add_lead', 'update_contact', 'status_lead'])
    expect(groups).toEqual([
      { group: 'Сделки', items: ['add_lead', 'status_lead'] },
      { group: 'Контакты', items: ['update_contact'] },
    ])
  })

  it('explains core admin authentication failure', () => {
    expect(isCoreAdminAuthError('core admin authentication failed')).toBe(true)
    const explained = explainError('core admin authentication failed')
    expect(explained?.title).toMatch(/внутренн/i)
    expect(explained?.title).not.toBe('core admin authentication failed')
  })
})
