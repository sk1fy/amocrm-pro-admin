import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? 'admin@example.invalid'
const password = process.env.E2E_PASSWORD ?? 'correct-horse-battery'
const connection = 'f1a00000-0000-4000-8000-000000000001'
const integration = '0f1a0001-0000-4000-8000-000000000001'
const oauthUUID = '0f1acafe-0000-4000-8000-000000000001'

test('activity product links account installation to its OAuth integration', async ({ page }) => {
  await page.route(`**/api/v1/integrations/core/${integration}`, async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { data: { client_id: string } }
    body.data.client_id = oauthUUID
    await route.fulfill({ response, json: body })
  })
  await page.goto('/accounts/91000001/widgets')
  const form = page.getByTestId('login-form')
  await form.locator('input[name="email"]').fill(email)
  await form.locator('input[name="password"]').fill(password)
  await form.getByRole('button', { name: 'Войти', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'Контроль активности 2.0' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Пилот включён')
  await expect(row).toContainText('Нет учётных данных')
  await row.getByRole('link', { name: 'fixture-widget-a', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/widgets/core/${connection}$`))
  await page
    .getByRole('navigation', { name: 'Разделы подключения' })
    .getByRole('link', { name: 'Обзор', exact: true })
    .click()
  const identity = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Идентификация$/ }) })
  if ((await identity.getAttribute('open')) === null) await identity.locator('summary').click()
  const integrationLink = identity.locator(`a[href="/widgets/core/${integration}"]`)
  await expect(integrationLink).toHaveText('fixture-widget-a')
  await integrationLink.click()
  await expect(page).toHaveURL(new RegExp(`/widgets/core/${integration}$`))
  await expect(page.getByText('Контроль активности 2.0')).toBeVisible()
  await expect(page.locator('dt').filter({ hasText: 'OAuth UUID (client_id)' })).toBeVisible()
  await expect(
    page.locator('dt').filter({ hasText: 'Идентификатор интеграции Core' }),
  ).toBeVisible()
  await expect(
    page.locator('dt').filter({ hasText: 'OAuth UUID (client_id)' }).locator('+ dd code'),
  ).toHaveAttribute('title', oauthUUID)
  await expect(
    page.locator('dt').filter({ hasText: 'Идентификатор интеграции Core' }).locator('+ dd code'),
  ).toHaveAttribute('title', integration)
})

test('unavailable account source is not an empty integration installation list', async ({
  page,
}) => {
  await page.route('**/api/v1/accounts?**', async (route) => {
    await route.fulfill({
      json: {
        items: [],
        next_cursor: null,
        sources: [
          {
            backend: 'core',
            status: 'unavailable',
            error: { code: 'backend_unavailable', message: 'fixture source unavailable' },
          },
        ],
      },
    })
  })
  await page.goto(`/widgets/core/${integration}`)
  const form = page.getByTestId('login-form')
  await form.locator('input[name="email"]').fill(email)
  await form.locator('input[name="password"]').fill(password)
  await form.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByText('Источник недоступен', { exact: true })).toBeVisible()
  await expect(page.getByText('Нет подключений', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Контроль активности 2.0')).toBeVisible()
})
