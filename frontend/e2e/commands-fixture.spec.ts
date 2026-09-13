import { expect, test } from '@playwright/test'

test('fixture command persists a diagnostic result through Admin API and reload', async ({
  page,
}) => {
  const connection = 'f1a00000-0000-4000-8000-000000000001'
  await page.goto(`/accounts/91000001/widgets/core/${connection}`)
  const login = page.getByTestId('login-form')
  await login.locator('input[name="email"]').fill(process.env.E2E_EMAIL ?? 'admin@example.invalid')
  await login
    .locator('input[name="password"]')
    .fill(process.env.E2E_PASSWORD ?? 'correct-horse-battery')
  await login.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(new RegExp(connection))).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect(page.getByText('Ошибка авторизации amoCRM', { exact: true }).first()).toBeVisible()
  await page.getByRole('link', { name: /^Операция [0-9a-f-]{36}$/ }).click()
  await expect(page).toHaveURL(/\/operations\/admin\/[0-9a-f-]{36}$/)
  await page.reload()
  await expect(page.getByText('Ошибка авторизации amoCRM', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Операция / })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Открыть подключение и проверить состояние', exact: true }),
  ).toBeVisible()
  await expect(page.locator('time').first()).toBeVisible()
})
