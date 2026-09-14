import { expect, test, type Page } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'
const adminEmail = process.env.E2E_EMAIL ?? 'admin@example.invalid'
const adminPassword = process.env.E2E_PASSWORD ?? 'correct-horse-battery'

const coreConnection = 'f1a00000-0000-4000-8000-000000000001'
const moduleConnection = 'f2a00000-0000-4000-8000-000000000003'

const viewerEmail = 'stage4-viewer@example.invalid'
const viewerPassword = 'stage4-viewer-passphrase'

function mutationHeaders(page: Page) {
  return { 'X-Requested-With': 'admin-ui', Origin: new URL(page.url()).origin }
}

async function login(page: Page, target = '/', email = adminEmail, password = adminPassword) {
  await page.goto(target)
  const form = page.getByTestId('login-form')
  await form.locator('input[name="email"]').fill(email)
  await form.locator('input[name="password"]').fill(password)
  await form.getByRole('button', { name: 'Войти', exact: true }).click()
}

test('registry lists both backends with names, state, contract and capabilities', async ({
  page,
}) => {
  await login(page, '/system')
  await expect(page.getByRole('heading', { name: 'Система' })).toBeVisible()
  const table = page.getByRole('table')
  const coreRow = table.getByRole('row').filter({ hasText: 'Fixture Core' })
  const moduleRow = table.getByRole('row').filter({ hasText: 'Fixture module' })
  await expect(coreRow).toHaveCount(1)
  await expect(moduleRow).toHaveCount(1)
  await expect(coreRow).toContainText('Доступен')
  await expect(moduleRow).toContainText('Доступен')
  await expect(coreRow).toContainText('v1')
  await expect(moduleRow).toContainText('v1')
  await expect(coreRow.locator('time')).toBeVisible()
  await expect(moduleRow.locator('time')).toBeVisible()
})

test('known subscription shows plan, active state, expiry, capabilities and source', async ({
  page,
}) => {
  await login(page, '/accounts/91000001')
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Подписка' }) })
  await expect(section.getByText('Профи', { exact: true })).toBeVisible()
  await expect(section.getByTestId('subscription-badge')).toHaveText('Активна')
  await expect(section.getByText(/Действует до:/)).toContainText(/\d{2}\.\d{2}\.\d{4}/)
  await expect(section.getByText(/Возможности:/)).toContainText('lead-status, activity')
  await expect(section.getByText('источник: core')).toBeVisible()
  await expect(section.locator('time').first()).toBeVisible()
})

test('subscription without facts shows unavailable data, not an error or no-subscription', async ({
  page,
}) => {
  await login(page, '/accounts/91000004')
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Подписка' }) })
  await expect(section.getByText('Данные подписки недоступны', { exact: true })).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
  await expect(section.getByText(/нет подписки/i)).toHaveCount(0)
})

test('merged account shows connections from both backends with fixture origin', async ({
  page,
}) => {
  await login(page, '/accounts/91000002')
  const moduleLink = page.locator(
    `a[href="/accounts/91000002/widgets/fixture/${moduleConnection}"]`,
  )
  await expect(moduleLink).toBeVisible()
  await expect(
    page.locator('a[href="/accounts/91000002/widgets/core/f1a00000-0000-4000-8000-000000000003"]'),
  ).toBeVisible()
  await expect(
    page.locator('a[href="/accounts/91000002/widgets/core/f1a00000-0000-4000-8000-000000000004"]'),
  ).toBeVisible()
  await expect(page.getByText('источник: fixture')).toBeVisible()
  await expect(page.getByText('источник: core').first()).toBeVisible()
  await expect(page.getByText('тестовые данные', { exact: true })).toBeVisible()

  await moduleLink.click()
  await expect(page).toHaveURL(new RegExp(`/widgets/fixture/${moduleConnection}$`))
  await page
    .getByRole('navigation', { name: 'Разделы подключения' })
    .getByRole('link', { name: 'Обзор', exact: true })
    .click()
  await page.locator('summary').filter({ hasText: 'Идентификация' }).click()
  await expect(page.locator('dt:has-text("Происхождение") + dd')).toHaveText('тестовые данные')
})

test('module connection hides settings while activity settings still open', async ({ page }) => {
  await login(page, `/accounts/91000002/widgets/fixture/${moduleConnection}`)
  await expect(page.getByRole('heading', { name: /Подключение/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Настройки/ })).toHaveCount(0)

  await page.goto(`/accounts/91000002/widgets/fixture/${moduleConnection}/settings`)
  await expect(page.getByText(/Для этого модуля настройки недоступны/)).toBeVisible()

  await page.goto(`/accounts/91000001/widgets/core/${coreConnection}/settings`)
  await expect(page.getByRole('heading', { name: /Настройки Activity/ })).toBeVisible()
  await expect(page.getByTestId('retention-days')).toBeVisible()
})

test('roles, session revocation and audit end to end', async ({ page, browser }) => {
  await login(page, '/system/employees')
  await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible()

  // /system/employees has no create form yet: the documented API is the fallback.
  const created = await page.request.post('/api/v1/system/employees', {
    data: { email: viewerEmail, name: 'Stage 4 Viewer', role: 'viewer', password: viewerPassword },
    headers: mutationHeaders(page),
  })
  let viewerId = ''
  if (created.status() === 409) {
    const list = await page.request.get('/api/v1/system/employees')
    const body = (await list.json()) as { items: Array<{ id: string; email: string }> }
    viewerId = body.items.find((item) => item.email === viewerEmail)?.id ?? ''
  } else {
    expect(created.status()).toBe(201)
    viewerId = ((await created.json()) as { id: string }).id
  }
  expect(viewerId).not.toBe('')

  await page.reload()
  const viewerRow = page.getByRole('row').filter({ hasText: viewerEmail })
  await expect(viewerRow).toContainText('Наблюдатель')

  const viewerContext = await browser.newContext({ baseURL })
  const viewerPage = await viewerContext.newPage()
  await login(viewerPage, '/system', viewerEmail, viewerPassword)
  await expect(viewerPage.getByRole('table')).toBeVisible()
  await expect(viewerPage.getByRole('row').filter({ hasText: 'Fixture Core' })).toBeVisible()
  await expect(viewerPage.getByRole('link', { name: 'Сотрудники', exact: true })).toHaveCount(0)

  await viewerPage.goto('/system/employees')
  await expect(viewerPage.getByText('Недостаточно прав', { exact: true })).toBeVisible()
  await expect(viewerPage.getByRole('button', { name: /Создать/ })).toHaveCount(0)

  await viewerPage.goto(`/accounts/91000001/widgets/core/${coreConnection}`)
  await expect(viewerPage.getByRole('heading', { name: /Подключение/ })).toBeVisible()
  for (const label of ['Проверить подключение', 'Отключить подключение', 'Удалить подключение']) {
    await expect(viewerPage.getByRole('button', { name: label, exact: true })).toHaveCount(0)
  }

  // Employee rows have no session action yet: revoke sessions through the API.
  const revoked = await page.request.post(`/api/v1/system/employees/${viewerId}/sessions/revoke`, {
    headers: mutationHeaders(page),
  })
  expect(revoked.ok()).toBeTruthy()

  await viewerPage.goto('/accounts')
  await expect(viewerPage).toHaveURL(/\/login/)
  await expect(viewerPage.getByTestId('login-form')).toBeVisible()
  await viewerContext.close()

  await page.goto('/system/audit?action=employee.create')
  const createEntry = page
    .getByRole('row')
    .filter({ has: page.locator(`code[title="employee:${viewerId}"]`) })
    .first()
  await expect(createEntry).toContainText('employee.create')
  await expect(createEntry).toContainText(adminEmail)

  await page.goto('/system/audit?action=employee.sessions.revoke')
  const revokeEntry = page
    .getByRole('row')
    .filter({ has: page.locator(`code[title="employee:${viewerId}"]`) })
    .first()
  await expect(revokeEntry).toContainText('employee.sessions.revoke')
  await expect(revokeEntry).toContainText(adminEmail)
})
