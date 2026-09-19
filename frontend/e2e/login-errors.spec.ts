import { expect, test } from '@playwright/test'

for (const failure of [401, 429, 500, 'network'] as const) {
  test(`login distinguishes ${failure}`, async ({ page }) => {
    await page.route('**/api/v1/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/v1/auth/login') {
        if (failure === 'network') return route.abort('failed')
        return route.fulfill({
          status: failure,
          json: {
            error: {
              code: 'internal',
              message: 'private detail',
              request_id: 'fixture-request-id',
            },
          },
        })
      }
      return route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } })
    })
    await page.goto('/login')
    await page.locator('input[name="email"]').fill('fixture@example.invalid')
    await page.locator('input[name="password"]').fill('fixture-password')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    const message =
      failure === 401
        ? 'Неверный email или пароль'
        : failure === 429
          ? 'Слишком много попыток'
          : 'временно недоступен'
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.getByRole('alert')).not.toContainText('private detail')
    if (failure === 500) await expect(page.getByRole('alert')).toContainText('fixture-request-id')
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled()
  })
}
