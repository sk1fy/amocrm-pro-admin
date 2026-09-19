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

test('login keyboard flow preserves password, pending state and next destination', async ({
  page,
}) => {
  let releaseLogin: (() => void) | undefined
  let authenticated = false
  const me = { id: 'fixture-viewer', name: 'Viewer', role: 'viewer', permissions: [] }
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/login') {
      expect(route.request().postDataJSON()).toEqual({
        email: 'fixture@example.invalid',
        password: 'fixture-password',
      })
      await new Promise<void>((resolve) => {
        releaseLogin = resolve
      })
      authenticated = true
      return route.fulfill({ json: me })
    }
    if (!authenticated)
      return route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } })
    return route.fulfill({ json: path === '/api/v1/me' ? me : { items: [] } })
  })
  await page.goto('/login?next=/system/sessions')
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.invalid')
  const password = page.getByLabel('Пароль', { exact: true })
  await password.fill('fixture-password')
  await password.press('Tab')
  await expect(page.getByRole('button', { name: 'Показать пароль' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('fixture-password')
  await page.keyboard.press('Enter')
  await expect(password).toHaveAttribute('type', 'password')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Выполняется вход…')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeDisabled()
  await expect.poll(() => !!releaseLogin).toBe(true)
  releaseLogin?.()
  await expect(page).toHaveURL(/\/system\/sessions$/)
  await expect(page.getByRole('heading', { name: 'Мои сессии' })).toBeVisible()
})
