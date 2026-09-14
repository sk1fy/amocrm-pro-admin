import { expect, test, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? 'admin@example.invalid'
const password = process.env.E2E_PASSWORD ?? 'correct-horse-battery'
const connection = 'f1a00000-0000-4000-8000-000000000001'
const settingsPath = `/accounts/91000001/widgets/core/${connection}/settings`

async function login(page: Page, user = email) {
  await page.goto(settingsPath)
  const form = page.getByTestId('login-form')
  await form.locator('input[name="email"]').fill(user)
  await form.locator('input[name="password"]').fill(password)
  await form.getByRole('button', { name: 'Войти', exact: true }).click()
}

test('operator settings, sync polling, stats null vs zero, saved view, viewer hides writes', async ({
  page,
}) => {
  await login(page)
  await expect(page.getByRole('heading', { name: /Настройки Activity/ })).toBeVisible()
  await expect(page.getByTestId('retention-days')).toHaveText('7')

  await page.getByRole('button', { name: 'Сохранить настройки Activity', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[name="retention_days"]').fill('14')
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect(page.getByText('Успех').first()).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('retention-days')).toHaveText('14')

  const conflictResponse = await page.request.post(
    `/api/v1/connections/core/${connection}/commands/activity-configure`,
    {
      data: { initial_days: 2, retention_days: 20, expected_updated_at: 1 },
      headers: {
        'X-Requested-With': 'admin-ui',
        'Idempotency-Key': 'stage3-e2e-conflict',
        Origin: new URL(page.url()).origin,
      },
    },
  )
  const conflict = await conflictResponse.json()
  expect(conflictResponse.status(), JSON.stringify(conflict)).toBe(202)
  expect(conflict.operation.state).toBe('failed')
  expect(conflict.operation.error.code).toBe('conflict')

  await page.getByRole('button', { name: 'Синхронизировать сейчас', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect(page.getByText('Команда выполняется').first()).toBeVisible()
  await expect(page.getByText('Результат появится в истории').first()).toBeVisible()
  await expect(page.getByText('Успех').first()).toBeVisible()

  await page.goto('/')
  await expect(page.getByTestId('stat-Отключения')).toHaveText('0')
  await expect(page.getByTestId('stat-Задержка p50, мс')).toHaveText('—')

  await page.goto('/accounts')
  await page.getByLabel('Имя представления').fill('fixture-reauth')
  await page.getByRole('button', { name: 'Сохранить представление', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Удалить fixture-reauth' })).toBeVisible()
  await page.getByLabel('Сохранённые представления').selectOption({ label: 'fixture-reauth' })

  const created = await page.request.post('/api/v1/system/employees', {
    data: {
      email: 'stage3-viewer@example.invalid',
      name: 'Viewer',
      role: 'viewer',
      password,
    },
    headers: {
      'X-Requested-With': 'admin-ui',
      Origin: new URL(page.url()).origin,
    },
  })
  expect(created.ok() || created.status() === 409).toBeTruthy()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await login(page, 'stage3-viewer@example.invalid')
  await expect(page.getByRole('button', { name: 'Сохранить настройки Activity' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Синхронизировать сейчас' })).toHaveCount(0)
})
