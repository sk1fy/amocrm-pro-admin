import { expect, test } from '@playwright/test'

const origin = process.env.E2E_MANAGER_ORIGIN ?? ''
const email = process.env.E2E_MANAGER_EMAIL ?? ''
const password = process.env.E2E_MANAGER_PASSWORD ?? ''

test('manager direct links require an active authenticated session', async ({ page }) => {
  test.skip(!origin || !email || !password, 'requires the running manager artifact and test staff')

  await page.goto(new URL('/managers?section=staff', origin).href)
  await expect(page.getByRole('heading', { name: 'Кабинет менеджеров' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  const loggedIn = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/managers/auth/login'),
  )
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  expect((await loggedIn).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
  expect(page.url()).toBe(new URL('/managers?section=staff', origin).href)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
})
