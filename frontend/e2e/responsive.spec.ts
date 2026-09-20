import { expect, test, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? 'admin@example.invalid'
const password = process.env.E2E_PASSWORD ?? 'correct-horse-battery'
const connectionPath = '/accounts/91000001/widgets/core/f1a00000-0000-4000-8000-000000000001'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByTestId('login-form').locator('input[name="email"]').fill(email)
  await page.getByTestId('login-form').locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Обзор', exact: true })).toBeVisible()
}

async function expectContained(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
}

for (const width of [375, 768, 1440]) {
  test(`operator cards stay within the viewport at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    await expect(page.getByTestId('overview-stats')).toBeVisible()
    await expectContained(page)
    await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true })

    await page.goto('/accounts?origin=fixture')
    await expect(page.getByRole('link', { name: '91000001', exact: true })).toBeVisible()
    await expect(page.getByLabel('Имя представления')).toHaveCount(0)
    await page.getByRole('button', { name: 'Сохранить вид', exact: true }).click()
    await expect(page.getByLabel('Имя представления')).toBeVisible()
    await expectContained(page)
    await page.screenshot({ path: testInfo.outputPath(`accounts-${width}.png`), fullPage: true })

    await page.goto(`${connectionPath}?section=webhook`)
    await expect(page.getByRole('heading', { name: 'Подключение fixture-widget-a' })).toBeVisible()
    await expect(page.getByText('Адресов в локальном реестре:', { exact: false })).toBeVisible()
    await expectContained(page)
    await page.screenshot({ path: testInfo.outputPath(`connection-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Результат операции' })).toBeVisible()
    await expectContained(page)
    await page.screenshot({ path: testInfo.outputPath(`operation-${width}.png`), fullPage: true })

    await page.goto('/accounts/91000002')
    await expect(page.getByTestId('connection-badge')).toHaveCount(3)
    await expectContained(page)
    await page.screenshot({
      path: testInfo.outputPath(`account-cards-${width}.png`),
      fullPage: true,
    })

    await page.goto(`${connectionPath}/settings`)
    await expect(
      page.getByRole('heading', { name: 'Настройки Activity и lead-status' }),
    ).toBeVisible()
    await expect(page.getByTestId('retention-days')).toBeVisible()
    await expectContained(page)
    await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`), fullPage: true })

    await page.goto('/system')
    await page.locator('tbody tr').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectContained(page)
    const dialog = page.getByRole('dialog')
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`backend-detail-${width}.png`),
      fullPage: true,
    })
  })
}

test('account origin is real by default, explicit filters survive reload and history', async ({
  page,
}) => {
  await login(page)
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/accounts?') &&
      new URL(r.url()).searchParams.get('origin') === 'real',
  )
  await page.goto('/accounts')
  await response
  await expect(page.getByLabel('Происхождение')).toHaveValue('real')
  await expect(page.getByText('Нет реальных аккаунтов', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Показать все аккаунты, включая тестовые' }),
  ).toBeVisible()
  await page.getByLabel('Происхождение').selectOption('fixture')
  await expect(page).toHaveURL(/origin=fixture/)
  await expect(page.getByRole('link', { name: '91000001', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Происхождение')).toHaveValue('fixture')
  await page.getByLabel('Происхождение').selectOption('all')
  await expect(page).toHaveURL(/origin=all/)
  await page.goBack()
  await expect(page.getByLabel('Происхождение')).toHaveValue('fixture')
})
