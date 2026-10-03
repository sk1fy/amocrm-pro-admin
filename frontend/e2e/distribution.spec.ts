import { expect, test, type Page } from '@playwright/test'
const connection = 'f1a00000-0000-4000-8000-000000000004'
const path = `/accounts/91000002/widgets/core/${connection}?section=distribution`
const email = process.env.E2E_EMAIL ?? 'admin@example.invalid'
const password = process.env.E2E_PASSWORD ?? 'correct-horse-battery'
async function login(page: Page) {
  await page.goto(path)
  const form = page.getByTestId('login-form')
  await form.locator('input[name="email"]').fill(email)
  await form.locator('input[name="password"]').fill(password)
  await form.getByRole('button', { name: 'Войти', exact: true }).click()
}
test('distribution fixture observations, URL pages, exact frozen message and pause receipt', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page)
  await expect(
    page.getByRole('link', { name: 'Распределение сделок', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('тестовые данные').first()).toBeVisible()
  await expect(page.getByText('— источник Core её не наблюдает', { exact: false })).toBeVisible()
  await expect(page.getByText('Исход назначения неизвестен').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить доставку', exact: true })).toBeVisible()
  if (process.env.E2E_ARTIFACTS_DIR)
    await page.screenshot({
      path: `${process.env.E2E_ARTIFACTS_DIR}/rs09-admin-1440.png`,
      fullPage: true,
    })
  await page.getByLabel('Строк на странице').selectOption('1')
  await expect(page).toHaveURL(/distribution_limit=1/)
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click()
  await expect(page).toHaveURL(/distribution_cursor=MQ/)
  await expect(
    page.getByRole('button', { name: 'Проверить результат назначения', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click()
  await expect(page).toHaveURL(/distribution_cursor=Mg/)
  const requestPromise = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/commands/distribution-delivery-retry'),
  )
  await page.getByRole('button', { name: 'Повторить доставку', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  const request = await requestPromise
  expect(request.postDataJSON()).toEqual({
    kind: 'results',
    message_id: 'd1500000-0000-4000-8000-000000000003',
    expected_attempts: 3,
  })
  const ref = page.getByLabel('ID события, операции или запроса')
  await ref.fill('d1500000-0000-4000-8000-000000000002')
  await page.getByRole('button', { name: 'Найти цепочку', exact: true }).click()
  await expect(page).toHaveURL(/reference=d1500000/)
  await page.goBack()
  await expect(ref).toHaveValue('')
  const pauseResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/commands/distribution-pause'),
  )
  await page.getByRole('button', { name: 'Приостановить новые назначения', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Правила TeamOS и принятые операции сохраняются',
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  const admitted = await pauseResponse
  expect(admitted.status()).toBe(202)
  expect((await admitted.json()).operation.state).toBe('succeeded')
  await expect(page.getByText('Успех').first()).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Возобновить новые назначения', exact: true }),
  ).toBeVisible()
})
test('distribution mobile keyboard and source failure do not show empty success', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await expect(page.getByRole('button', { name: 'Повторить доставку', exact: true })).toBeVisible()
  if (process.env.E2E_ARTIFACTS_DIR)
    await page.screenshot({
      path: `${process.env.E2E_ARTIFACTS_DIR}/rs09-admin-390.png`,
      fullPage: true,
    })
  await page.getByLabel('ID события, операции или запроса').focus()
  await page.keyboard.type('d1500000-0000-4000-8000-000000000009')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByText('В этой установке связанных записей не найдено.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.route('**/api/v1/connections/core/*/distribution', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'core',
        observed_at: new Date().toISOString(),
        freshness: 'unavailable',
        error: { code: 'backend_timeout', message: 'Источник распределения недоступен' },
      }),
    }),
  )
  await page.reload()
  await expect(page.getByText('Источник распределения недоступен')).toBeVisible()
  await expect(page.getByText('Источник подтвердил отсутствие записей.')).toHaveCount(0)
})
