import { expect, test, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? 'admin@example.invalid'
const password = process.env.E2E_PASSWORD ?? 'correct-horse-battery'

async function searchAccount(page: Page, query: string) {
  await page.goto('/accounts')
  await page.getByTestId('accounts-search').fill(query)
  await page.getByRole('button', { name: 'Найти' }).click()
  await expect(page.getByRole('link', { name: '91000002' })).toBeVisible()
}

test('login next, two connection states and search formats', async ({ page }) => {
  await page.goto('/accounts/91000002')
  await expect(page.getByTestId('login-form')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  expect(page.url()).toMatch(/next=/)

  await page.getByTestId('login-form').locator('input[name="email"]').fill(email)
  await page.getByTestId('login-form').locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/accounts\/91000002/)
  const badges = page.getByTestId('connection-badge')
  await expect(badges).toHaveCount(2)
  const labels = await badges.allTextContents()
  expect(labels.some((text) => text.includes('повторн'))).toBeTruthy()
  expect(labels.some((text) => text.includes('Активно'))).toBeTruthy()
  expect(labels[0]).not.toEqual(labels[1])

  await searchAccount(page, '91000002')
  await searchAccount(page, 'fixture-two')
  await searchAccount(page, 'https://fixture-two.amocrm.test/leads/detail/123')

  await page.getByRole('link', { name: '91000002' }).click()
  await page.getByRole('link', { name: /fixture-widget-a/ }).click()
  await expect(page).toHaveURL(
    /\/accounts\/91000002\/widgets\/core\/f1a00000-0000-4000-8000-000000000003/,
  )
  await expect(page.getByText('тестовые данные').first()).toBeVisible()
  await expect(page.locator('time').first()).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(
    /\/accounts\/91000002\/widgets\/core\/f1a00000-0000-4000-8000-000000000003/,
  )
  await expect(page.getByText('тестовые данные').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /Подключение/ })).toBeVisible()
})
