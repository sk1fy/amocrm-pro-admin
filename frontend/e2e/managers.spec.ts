import { expect, test } from '@playwright/test'

test('workspace choice opens the manager demo without sending credentials', async ({ page }) => {
  let apiRequests = 0
  await page.route('**/api/**', (route) => {
    apiRequests++
    return route.abort()
  })

  await page.goto('/login?next=/accounts/91000001')
  await expect(page.getByRole('radio', { name: 'core-admin' })).toBeChecked()
  await expect(page.getByTestId('login-form')).toBeVisible()
  await page.getByRole('radio', { name: 'partners' }).check()
  await expect(page.getByText('Кабинет партнёров готовится.')).toBeVisible()
  await expect(page.getByTestId('login-form')).toHaveCount(0)
  await page.getByRole('radio', { name: 'managers' }).check()
  await page.getByRole('link', { name: 'Открыть демо для менеджеров' }).click()

  await expect(page.getByRole('heading', { name: 'Установки' })).toBeVisible()
  await expect(page.getByText('Демо-данные.', { exact: false })).toBeVisible()
  const unchecked = page.getByRole('button', { name: /^Непроверенные/ })
  const checked = page.getByRole('button', { name: /^Проверенные/ })
  const installation = page
    .getByRole('row')
    .filter({ hasText: 'sever-logistics' })
    .filter({ hasText: 'Сделки клиента' })
  await expect(installation).toBeVisible()
  await installation.getByRole('button', { name: 'Проверен' }).click()
  await expect(installation).toHaveCount(0)
  await checked.click()
  await installation.getByRole('button', { name: 'Вернуть' }).click()
  await unchecked.click()
  await expect(installation).toBeVisible()
  await installation.getByRole('button', { name: 'Проверен' }).click()
  await page.reload()
  await expect(installation).toBeVisible()

  await page.getByRole('link', { name: 'Сменить кабинет' }).click()
  await expect(page.getByRole('radio', { name: 'core-admin' })).toBeChecked()
  await expect(page.getByTestId('login-form')).toBeVisible()
  expect(apiRequests).toBe(0)
})

test('manager sections have test data and client cards can be opened directly', async ({
  page,
}) => {
  await page.goto('/managers?section=clients&client=91001001')
  await expect(page.getByRole('heading', { name: 'sever-logistics' })).toBeVisible()
  await page.getByRole('button', { name: 'Счета и компании' }).click()
  await expect(page.getByRole('table').getByText('РК-1064')).toBeVisible()

  const navigation = page.getByRole('navigation', { name: 'Разделы менеджеров' })
  for (const section of [
    'Клиенты',
    'Виджеты',
    'amoМаркет',
    'Партнёры',
    'Счета',
    'Оплаты',
    'Статистика',
    'Лента событий',
    'Сотрудники',
  ]) {
    await navigation.getByRole('link', { name: section, exact: true }).click()
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible()
  }

  await page.setViewportSize({ width: 375, height: 850 })
  await page.getByRole('button', { name: 'Меню', exact: true }).click()
  await navigation.getByRole('link', { name: 'Клиенты', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('атлас')
  await expect(page.getByRole('table').getByText('atlas-studio')).toBeVisible()
  await expect(page.getByRole('table').getByText('sever-logistics')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
})

test('desktop menu toggles and installation links open the same account profile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/managers?section=installs')

  const navigation = page.getByRole('navigation', { name: 'Разделы менеджеров' })
  const sidebar = page.getByRole('complementary')
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(232)
  await page.getByRole('button', { name: 'Свернуть меню', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Развернуть меню', exact: true })).toBeVisible()
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(60)
  await expect(navigation.getByRole('link', { name: 'Установки', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Развернуть меню', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Свернуть меню', exact: true })).toBeVisible()

  const table = page.getByRole('table')
  await table
    .getByRole('link', { name: /sever-logistics/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'sever-logistics', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Оплачен до' })).toBeVisible()
  await expect(page.getByRole('table').getByRole('row').nth(2)).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Хлебные крошки' })
    .getByRole('link', { name: 'Установки' })
    .click()
  await table.getByRole('link', { name: '91001001', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'sever-logistics', exact: true })).toBeVisible()
})

test('installation phone search and date filters narrow the demo list together', async ({
  page,
}) => {
  await page.goto('/managers?section=installs')
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('0000001001')
  const rows = page.getByRole('table').getByRole('row').filter({ hasText: 'sever-logistics' })
  await expect(rows).toHaveCount(2)
  await expect(page.getByRole('table').getByText('atlas-studio')).toHaveCount(0)
  await page.locator('input[type="date"]').first().fill('2026-11-16')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('Копирование в один клик')
})
