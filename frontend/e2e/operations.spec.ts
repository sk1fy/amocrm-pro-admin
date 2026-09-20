import { expect, test, type Page } from '@playwright/test'

const accountId = '91000002'
const connectionId = 'connection-one'
const connectionPath = `/accounts/${accountId}/widgets/core/${connectionId}`
const timestamp = '2026-09-13T10:00:00Z'
const source = { backend: 'core', status: 'available', observed_at: timestamp }
const operatorPermissions = [
  'connections:check',
  'connections:enable',
  'connections:disable',
  'connections:revoke',
  'webhooks:reconcile',
  'operations:retry',
  'activity:pilot',
]
const adminPermissions = [
  ...operatorPermissions,
  'connections:uninstall',
  'integrations:write',
  'integrations:rotate_secret',
  'integrations:enable',
  'integrations:disable',
]
const observation = (data: unknown) => ({
  source: 'core',
  observed_at: timestamp,
  freshness: 'fresh',
  data,
})
const operation = (
  id: string,
  command: string,
  state: string,
  result: Record<string, unknown> = {},
) => ({
  id,
  employee_id: 'employee-one',
  backend: 'core',
  target_type: 'installation',
  target_id: connectionId,
  command,
  state,
  result,
  created_at: timestamp,
  updated_at: timestamp,
})

async function mockReadAPI(page: Page, permissions: string[] = operatorPermissions) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          id: 'employee-one',
          name: 'Fixture employee',
          role: permissions === adminPermissions ? 'admin' : 'operator',
          permissions,
        },
      })
    if (path === '/api/v1/catalog')
      return route.fulfill({
        json: {
          backends: [{ code: 'core', display_name: 'Core', kind: 'fixture' }],
          products: [
            { code: 'activity', display_name: 'Activity' },
            { code: 'lead-status', display_name: 'Lead Status' },
          ],
        },
      })
    if (path === `/api/v1/accounts/${accountId}`)
      return route.fulfill({
        json: {
          account_id: accountId,
          domains: ['fixture.amocrm.test'],
          state: 'ok',
          origin: 'fixture',
          problems: [],
          connections: [],
          sources: [source],
        },
      })
    if (path === `/api/v1/connections/core/${connectionId}`)
      return route.fulfill({
        json: {
          backend: 'core',
          connection: observation({
            id: connectionId,
            account_id: accountId,
            integration_id: 'integration-one',
            integration_code: 'fixture-widget',
            state: 'active',
            origin: 'fixture',
            account_domain: 'fixture.amocrm.test',
            created_at: timestamp,
            updated_at: timestamp,
          }),
          authorization: observation({
            state: 'valid',
            unverified: true,
            credentials_present: true,
          }),
          authorization_check: { ...observation(null), freshness: 'unknown' },
          webhook: observation({ status: 'error', events: [] }),
          grants: observation([]),
          activity: observation({ pilot: 'enabled', deliveries: [] }),
          activity_sync: { ...observation(null), freshness: 'unknown' },
          recent_jobs: observation([]),
          recent_audit: observation([]),
        },
      })
    return route.fulfill({ json: { items: [], sources: [source], next_cursor: null, total: 0 } })
  })
}

test('viewer sees observations while command controls are hidden', async ({ page }) => {
  await mockReadAPI(page, [])
  await page.goto(connectionPath)
  await expect(page.getByRole('heading', { name: 'Подключение fixture-widget' })).toBeVisible()
  for (const label of ['Проверить подключение', 'Отключить подключение', 'Удалить подключение'])
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
  await page.goto('/widgets')
  await expect(page.getByRole('button', { name: 'Создать интеграцию', exact: true })).toHaveCount(0)
})

test('operator confirms scope once and follows a persisted diagnostic operation', async ({
  page,
}) => {
  await mockReadAPI(page)
  const posts: string[] = []
  await page.route('**/api/v1/connections/core/connection-one/commands/check', async (route) => {
    posts.push(route.request().headers()['idempotency-key'])
    await route.fulfill({
      status: 202,
      json: { operation: operation('operation-check', 'check', 'running') },
    })
  })
  await page.route('**/api/v1/operations/admin/operation-check', (route) =>
    route.fulfill({
      json: {
        operation: operation('operation-check', 'check', 'succeeded', {
          classification: 'auth_error',
          observed_at: timestamp,
        }),
      },
    }),
  )
  await page.goto(connectionPath)
  await expect(page.getByRole('button', { name: 'Удалить подключение', exact: true })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/Область воздействия/)).toBeVisible()
  await expect(dialog.getByText(/connection-one/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Подтвердить' }).click({ clickCount: 2 })
  await expect(page.getByText('Ошибка авторизации amoCRM', { exact: true })).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(posts[0]).toMatch(/^[0-9a-f-]{36}$/)
  await page.locator('a[href="/operations/admin/operation-check"]').click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Операция operation-check' })).toBeVisible()
  await expect(page.getByText('Ошибка авторизации amoCRM', { exact: true })).toBeVisible()
  await expect(page.locator(`time[datetime="${timestamp}"]`).first()).toBeVisible()
})

test('lost POST response is recovered read-only with the original request key after reload', async ({
  page,
}) => {
  await mockReadAPI(page)
  const posts: string[] = []
  const lookups: string[] = []
  const result = operation('operation-recovered', 'disable', 'succeeded')
  await page.route('**/api/v1/connections/core/connection-one/commands/disable', async (route) => {
    posts.push(route.request().headers()['idempotency-key'])
    await route.abort('failed')
  })
  await page.route('**/api/v1/operations/admin?**', async (route) => {
    const key = new URL(route.request().url()).searchParams.get('request_key')
    if (!key) return route.fulfill({ json: { items: [], total: null } })
    lookups.push(key)
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.fulfill({ json: { items: [result], total: null } })
  })
  await page.route('**/api/v1/operations/admin/operation-recovered', (route) =>
    route.fulfill({ json: { operation: result } }),
  )
  await page.goto(connectionPath)
  await page.getByRole('button', { name: 'Отключить подключение', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText(/Ответ на команду не получен/)).toBeVisible()
  await page.reload()
  await expect(page.locator('a[href="/operations/admin/operation-recovered"]')).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(lookups.length).toBeGreaterThan(0)
  expect(lookups.every((key) => key === posts[0])).toBe(true)
})

test('partial uninstall shows webhook error and explicit repeat creates a new operation', async ({
  page,
}) => {
  await mockReadAPI(page, adminPermissions)
  const keys: string[] = []
  await page.route('**/api/v1/connections/core/connection-one/commands/uninstall', (route) => {
    keys.push(route.request().headers()['idempotency-key'])
    return route.fulfill({
      status: 202,
      json: {
        operation: operation(
          `uninstall-${keys.length}`,
          'uninstall',
          keys.length === 1 ? 'partial' : 'succeeded',
          keys.length === 1 ? { webhook_error: 'Не удалось снять подписку' } : {},
        ),
      },
    })
  })
  await page.goto(connectionPath)
  await page.getByText('Ещё', { exact: true }).click()
  await page.getByRole('button', { name: 'Удалить подключение', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByText(/Для восстановления клиент должен заново пройти OAuth/),
  ).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Ошибка webhook: Не удалось снять подписку')).toBeVisible()
  await page.getByRole('button', { name: 'Повторить удаление', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.locator('a[href="/operations/admin/uninstall-2"]')).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe(keys[1])
})

test('integration creation clears secret inputs and persists only receipt identifiers', async ({
  page,
}) => {
  await mockReadAPI(page, adminPermissions)
  let body: Record<string, unknown> | undefined
  await page.route('**/api/v1/integrations/core/commands/create', (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({
      status: 202,
      json: {
        operation: {
          ...operation('integration-created', 'create', 'succeeded', {
            integration_id: 'integration-new',
          }),
          target_type: 'integration',
          target_id: 'new',
        },
      },
    })
  })
  await page.goto('/widgets')
  await page.getByRole('button', { name: 'Создать интеграцию', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Код интеграции').fill('fixture-new')
  await dialog.getByLabel('Client ID amoCRM').fill('11111111-1111-4111-8111-111111111111')
  await dialog.getByLabel('Новый client secret').fill('fixture-secret-never-echo')
  await dialog.getByLabel('OAuth redirect URI').fill('https://fixture.example.invalid/callback')
  await dialog.getByLabel(/Сервисы через запятую/).fill('lead-status, activity')
  await dialog.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.locator('a[href="/operations/admin/integration-created"]')).toBeVisible()
  await expect(page.locator('input[name="client_secret"]')).toHaveValue('')
  expect(body?.services).toEqual(['lead-status', 'activity'])
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
    'fixture-secret-never-echo',
  )
  await expect(page.getByText('fixture-secret-never-echo', { exact: true })).toHaveCount(0)
})

test('server retry eligibility leaves unsafe jobs read-only', async ({ page }) => {
  await mockReadAPI(page)
  await page.route('**/api/v1/operations/jobs?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'unsafe-job',
            type: 'unsafe.fixture',
            status: 'failed',
            attempts: 1,
            max_attempts: 1,
            updated_at: timestamp,
            retry_allowed: false,
            retry_reason: 'Тип задачи не поддерживает безопасный повтор',
          },
        ],
        sources: [source],
      },
    }),
  )
  await page.goto('/operations')
  await expect(page.getByRole('button', { name: 'Повторить задачу', exact: true })).toHaveCount(0)
  await expect(page.getByText('unsafe.fixture', { exact: true })).toBeVisible()
})

test('unknown operation outcome offers inspection without blind resubmission', async ({ page }) => {
  await mockReadAPI(page)
  let posts = 0
  await page.route('**/api/v1/connections/core/connection-one/commands/revoke', (route) => {
    posts += 1
    return route.fulfill({
      status: 202,
      json: { operation: operation('unknown-revoke', 'revoke', 'unknown_outcome') },
    })
  })
  await page.goto(connectionPath)
  await page.getByText('Ещё', { exact: true }).click()
  await page.getByRole('button', { name: 'Сбросить авторизацию', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Исход неизвестен', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Сбросить авторизацию', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Проверить объект', exact: true }).click()
  expect(posts).toBe(1)
})

test('eligible job retry uses the command endpoint and an idempotency key', async ({ page }) => {
  await mockReadAPI(page)
  let requestKey: string | undefined
  await page.route('**/api/v1/operations/jobs?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'eligible-job',
            type: 'webhook.reconcile',
            status: 'failed',
            attempts: 1,
            max_attempts: 3,
            updated_at: timestamp,
            retry_allowed: true,
          },
        ],
        sources: [source],
      },
    }),
  )
  await page.route('**/api/v1/operations/jobs/core/eligible-job/retry', (route) => {
    requestKey = route.request().headers()['idempotency-key']
    return route.fulfill({
      status: 202,
      json: {
        operation: {
          ...operation('retry-operation', 'retry', 'succeeded', { job_id: 'eligible-job' }),
          target_type: 'job',
          target_id: 'eligible-job',
        },
      },
    })
  })
  await page.goto('/operations')
  await page.getByRole('button', { name: 'Повторить задачу', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(/Задача eligible-job/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.locator('a[href="/operations/admin/retry-operation"]')).toBeVisible()
  expect(requestKey).toMatch(/^[0-9a-f-]{36}$/)
})

test('queued command inspects its job with GET polling and stops after completion', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(timestamp) })
  await mockReadAPI(page)
  let commands = 0
  let jobReads = 0
  await page.route('**/api/v1/connections/core/connection-one/commands/reconcile', (route) => {
    commands += 1
    return route.fulfill({
      status: 202,
      json: {
        operation: {
          ...operation('queued-operation', 'reconcile', 'succeeded', { job_id: 'queued-job' }),
          outcome: 'queued',
        },
      },
    })
  })
  await page.route('**/api/v1/operations/jobs/core/queued-job', (route) => {
    expect(route.request().method()).toBe('GET')
    jobReads += 1
    return route.fulfill({
      json: observation({
        job: {
          id: 'queued-job',
          account_id: accountId,
          installation_id: connectionId,
          type: 'webhook.reconcile',
          status: jobReads === 1 ? 'processing' : 'completed',
          attempts: 1,
          max_attempts: 3,
          updated_at: timestamp,
        },
        attempts: [],
      }),
    })
  })
  await page.goto(connectionPath)
  await page.getByRole('button', { name: 'Восстановить webhook', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText(/Задача поставлена в очередь/)).toBeVisible()
  expect(jobReads).toBe(0)
  await page.getByRole('button', { name: 'Проверить задачу', exact: true }).click()
  await expect(page.getByText('Выполняется', { exact: true })).toBeVisible()
  await page.clock.fastForward(1600)
  await expect(page.getByText('Завершена', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Проверить состояние подключения', exact: true }),
  ).toBeVisible()
  const completedReads = jobReads
  await page.clock.fastForward(5000)
  expect(jobReads).toBe(completedReads)
  expect(commands).toBe(1)
})
