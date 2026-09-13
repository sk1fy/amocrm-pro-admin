import { expect, test } from '@playwright/test'

const now = '2026-09-13T10:00:00Z'
const source = { backend: 'core', status: 'available', observed_at: now }
const job = {
  backend: 'core',
  id: 'job-one',
  installation_id: 'connection-one',
  account_id: '91000002',
  type: 'webhook.reconcile',
  status: 'failed',
  priority: 0,
  attempts: 2,
  max_attempts: 5,
  run_after: now,
  created_at: now,
  updated_at: now,
}
const account = {
  account_id: '91000002',
  domains: ['fixture.amocrm.test'],
  state: 'ok',
  problems: [],
  origin: 'fixture',
  connections: [],
  sources: [source],
}

test('expired admin session cannot expose employee cache after viewer login', async ({ page }) => {
  let role = 'admin'
  let expired = false
  const me = () => ({
    id: `${role}-id`,
    email: `${role}@example.invalid`,
    name: role,
    role,
    permissions: [],
  })
  await page.clock.install({ time: new Date(now) })
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/login') {
      role = 'viewer'
      expired = false
      return route.fulfill({ json: me() })
    }
    if (expired) {
      return route.fulfill({
        status: 401,
        json: { error: { code: 'unauthorized', message: 'unauthorized' } },
      })
    }
    if (path === '/api/v1/me') return route.fulfill({ json: me() })
    if (path === '/api/v1/system/employees') {
      if (role !== 'admin') {
        return route.fulfill({
          status: 403,
          json: { error: { code: 'forbidden', message: 'forbidden' } },
        })
      }
      return route.fulfill({
        json: {
          items: [
            {
              id: 'private-employee',
              email: 'private-employee@example.invalid',
              name: 'Private employee',
              role: 'admin',
              status: 'active',
              created_at: now,
              updated_at: now,
            },
          ],
        },
      })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/system/employees')
  await expect(page.getByText('private-employee@example.invalid')).toBeVisible()
  await page.getByRole('link', { name: 'Сессии', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Мои сессии' })).toBeVisible()
  await page.clock.fastForward(11_000)
  expired = true
  await page.getByRole('link', { name: 'Сотрудники', exact: true }).click()
  await expect(page.getByTestId('login-form')).toBeVisible()
  await page.locator('input[name="email"]').fill('viewer@example.invalid')
  await page.locator('input[name="password"]').fill('fixture-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByText('Недостаточно прав', { exact: true })).toBeVisible()
  await expect(page.getByText('private-employee@example.invalid')).toHaveCount(0)
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('account jobs follow the cursor and preserve filters across reload', async ({ page }) => {
  const requests: URL[] = []
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/me') {
      return route.fulfill({
        json: { id: 'viewer-id', name: 'Viewer', role: 'viewer', permissions: [] },
      })
    }
    if (url.pathname === '/api/v1/accounts/91000002') return route.fulfill({ json: account })
    if (url.pathname === '/api/v1/accounts/91000002/jobs') {
      requests.push(url)
      const older = url.searchParams.get('cursor') === 'older-jobs-page'
      return route.fulfill({
        json: {
          items: older
            ? [{ ...job, id: 'job-old', type: 'older-job' }]
            : Array.from({ length: 25 }, (_, index) => ({
                ...job,
                id: `${job.id}-${index}`,
                type: index === 0 ? job.type : `${job.type}.${index}`,
              })),
          next_cursor: older ? null : 'older-jobs-page',
          total: null,
          sources: [source],
        },
      })
    }
    return route.fulfill({ json: { items: [], sources: [source] } })
  })
  await page.goto('/accounts/91000002/operations?status=failed&type=webhook&limit=25')
  await expect(page.getByText('webhook.reconcile', { exact: true })).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(26)
  await page.getByRole('button', { name: 'Дальше', exact: true }).click()
  await expect(page.getByText('older-job', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/cursor=older-jobs-page/)
  await expect(page.getByRole('button', { name: 'Дальше', exact: true })).toBeDisabled()
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({
    status: 'failed',
    type: 'webhook',
    limit: '25',
    cursor: 'older-jobs-page',
  })
  await page.reload()
  await expect(page.getByText('older-job', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'В начало', exact: true }).click()
  await expect(page.getByText('webhook.reconcile', { exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false)
})

test('unavailable attempts show their source error and can be retried', async ({ page }) => {
  let detailRequests = 0
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me') {
      return route.fulfill({
        json: { id: 'viewer-id', name: 'Viewer', role: 'viewer', permissions: [] },
      })
    }
    if (path === '/api/v1/catalog') return route.fulfill({ json: { products: [], backends: [] } })
    if (path === '/api/v1/operations/jobs')
      return route.fulfill({ json: { items: [job], sources: [source] } })
    if (path === '/api/v1/operations/jobs/core/job-one') {
      detailRequests += 1
      return route.fulfill({
        json:
          detailRequests === 1
            ? {
                source: 'core',
                observed_at: now,
                freshness: 'unavailable',
                data: null,
                error: { code: 'backend_timeout', message: 'Время ожидания источника истекло' },
              }
            : {
                source: 'core',
                observed_at: now,
                freshness: 'fresh',
                data: { job, attempts: [] },
              },
      })
    }
    return route.fulfill({ json: { items: [], sources: [source] } })
  })
  await page.goto('/operations')
  await page.getByRole('button', { name: 'Подробнее' }).click()
  await expect(page.getByText('Источник недоступен', { exact: true })).toBeVisible()
  await expect(page.getByText('Время ожидания источника истекло')).toBeVisible()
  await expect(page.getByText('Попыток нет', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.getByText('Попыток нет', { exact: true })).toBeVisible()
  expect(detailRequests).toBe(2)
})

test('integration card requests its connections separately from product grants', async ({
  page,
}) => {
  let accountRequest: URL | undefined
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/me') {
      return route.fulfill({
        json: { id: 'viewer-id', name: 'Viewer', role: 'viewer', permissions: [] },
      })
    }
    if (url.pathname === '/api/v1/integrations/core/integration-one') {
      return route.fulfill({
        json: {
          source: 'core',
          observed_at: now,
          freshness: 'fresh',
          data: {
            backend: 'core',
            id: 'integration-one',
            code: 'fixture-widget-a',
            state: 'active',
            client_id: 'fixture-client',
            redirect_uri: 'https://fixture.example.invalid/callback',
            updated_at: now,
            webhook_events: [],
            grants: [],
            installations_by_status: { active: 1 },
          },
        },
      })
    }
    if (url.pathname === '/api/v1/accounts') {
      accountRequest = url
      return route.fulfill({
        json: {
          items: [
            {
              ...account,
              connections: [
                {
                  backend: 'core',
                  integration_id: 'integration-one',
                  integration_code: 'fixture-widget-a',
                  connection_id: 'connection-target',
                  state: 'active',
                },
                {
                  backend: 'other',
                  integration_id: 'integration-two',
                  integration_code: 'fixture-widget-a',
                  connection_id: 'connection-unrelated',
                  state: 'active',
                },
              ],
            },
          ],
          sources: [source],
        },
      })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/widgets/core/integration-one')
  await expect(page.getByText('connection-target', { exact: true })).toBeVisible()
  await expect(page.getByText('connection-unrelated', { exact: true })).toHaveCount(0)
  expect(Object.fromEntries(accountRequest!.searchParams)).toEqual({
    integration_id: 'integration-one',
    backend: 'core',
    limit: '100',
  })
})
