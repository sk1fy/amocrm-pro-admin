import { expect, test } from '@playwright/test'

const timestamp = '2026-09-20T10:00:00Z'
const observation = (data: unknown) => ({
  source: 'core',
  observed_at: timestamp,
  freshness: 'fresh',
  data,
})

for (const count of [0, null, undefined]) {
  test(`webhook registry count ${String(count)} is explained without asserting delivery failure`, async ({
    page,
  }) => {
    let mutations = 0
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') mutations += 1
      if (path === '/api/v1/me') {
        return route.fulfill({
          json: {
            id: 'fixture-operator',
            name: 'Fixture operator',
            role: 'operator',
            permissions: ['connections:check', 'webhooks:reconcile'],
          },
        })
      }
      if (path === '/api/v1/connections/core/fixture-connection') {
        return route.fulfill({
          json: {
            backend: 'core',
            connection: observation({
              id: 'fixture-connection',
              account_id: '91000002',
              integration_id: 'fixture-integration',
              integration_code: 'fixture-widget',
              account_domain: 'fixture.amocrm.test',
              state: 'active',
              origin: 'fixture',
              created_at: timestamp,
              updated_at: timestamp,
            }),
            authorization: observation({
              state: 'valid',
              unverified: false,
              credentials_present: true,
            }),
            authorization_check: observation({
              classification: 'verified_ok',
              observed_at: timestamp,
            }),
            webhook: observation({
              status: 'active',
              events: ['add_lead'],
              checked_at: timestamp,
              confirmed_destinations: count,
            }),
            grants: observation([]),
            activity: observation({ pilot: 'enabled', deliveries: [] }),
            activity_sync: observation({ state: 'idle', reauth_required: false, lag_seconds: 0 }),
            recent_jobs: observation([]),
            recent_audit: observation([]),
          },
        })
      }
      if (path === '/api/v1/accounts/91000002') {
        return route.fulfill({
          json: {
            account_id: '91000002',
            domains: ['fixture.amocrm.test'],
            state: 'ok',
            origin: 'fixture',
            problems: [],
            connections: [],
            sources: [],
          },
        })
      }
      return route.fulfill({ json: { items: [], sources: [], products: [], backends: [] } })
    })
    await page.goto('/accounts/91000002/widgets/core/fixture-connection?section=webhook')
    await expect(
      page.getByText(`Адресов в локальном реестре: ${count === 0 ? '0' : '—'}`, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/Реестр не подтверждает текущую подписку/)).toBeVisible()
    if (count === 0) {
      await expect(
        page.getByText('Регистрация webhook требует сверки', { exact: true }),
      ).toBeVisible()
      await expect(page.getByText(/это возможно и при рабочей доставке/)).toBeVisible()
    } else {
      await expect(
        page.getByText('Нет данных локального реестра webhook', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('Источник не передал число адресов в локальном реестре.', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Восстановить webhook', exact: true }),
      ).toHaveCount(0)
    }
    await expect(page.getByText(/Последняя успешная сверка регистрации/)).toBeVisible()
    expect(mutations).toBe(0)
  })
}
