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

test('account tabs show distinct demo panels and preserve a company draft', async ({ page }) => {
  let apiRequests = 0
  await page.route('**/api/**', (route) => {
    apiRequests++
    return route.abort()
  })
  await page.goto('/managers?section=installs&client=91001001')
  const tabs = page.getByRole('group', { name: 'Разделы карточки' })
  await expect(page.getByRole('heading', { name: 'Наши виджеты', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Оплачен до' })).toBeVisible()
  const phone = page.getByRole('textbox', { name: /^Телефон,/ }).first()
  await phone.fill('+7 (000) 000-00-01')

  await tabs.getByRole('button', { name: /^Портрет клиента/ }).click()
  await expect(page.getByRole('heading', { name: 'Портрет клиента', exact: true })).toBeVisible()
  await expect(page.getByLabel('Ниша', { exact: true })).toBeVisible()

  await tabs.getByRole('button', { name: /^Аудит/ }).click()
  await expect(page.getByRole('heading', { name: 'Аудит клиента' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Дубли контактов' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Воронки amoCRM' })).toBeVisible()
  await page.getByRole('button', { name: 'Проверить дубли' }).click()
  await expect(page.getByText(/^Демо-проверка:/)).toBeVisible()
  await page.getByRole('button', { name: 'Загрузить по периоду' }).click()
  await expect(page.getByText(/01\.11\.2026.*30\.11\.2026.*сделок/)).toBeVisible()

  await tabs.getByRole('button', { name: /^История/ }).click()
  await expect(page.getByRole('heading', { name: 'История', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Событие' })).toBeVisible()

  await tabs.getByRole('button', { name: /^Счета и компании/ }).click()
  await expect(page.getByRole('heading', { name: 'Счета клиента' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Компании', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Выставить счёт/ }).click()
  await page.getByLabel('За что', { exact: true }).fill('Демо-подписка')
  await page.getByLabel('Сумма, ₽', { exact: true }).fill('1200')
  await page.getByRole('button', { name: 'Создать демо-черновик' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Демо-подписка' })).toContainText('Черновик')
  await page.getByLabel('ИНН', { exact: true }).fill('9900000008')
  await page.getByLabel('Название', { exact: true }).fill('ООО Демо')
  await tabs.getByRole('button', { name: /^Наши виджеты/ }).click()
  await expect(phone).toHaveValue('+7 (000) 000-00-01')
  await tabs.getByRole('button', { name: /^Счета и компании/ }).click()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('ООО Демо')
  await page.getByRole('button', { name: 'Добавить компанию' }).click()
  await expect(page.getByText('ООО Демо', { exact: true })).toBeVisible()

  await tabs.getByRole('button', { name: /^Пользователи/ }).click()
  await expect(page.getByRole('heading', { name: 'Пользователи amoCRM' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Права' })).toBeVisible()
  await page.getByRole('button', { name: /^Активные/ }).click()
  await expect(page.getByRole('cell', { name: 'Деактивирован', exact: true })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Активен', exact: true }).first()).toBeVisible()

  await tabs.getByRole('button', { name: /^Установленные виджеты/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Установленные виджеты', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Впервые увидели' })).toBeVisible()
  await page.getByRole('button', { name: /^Пропали/ }).click()
  await expect(page.getByRole('cell', { name: 'Стоит', exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 375, height: 850 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  expect(apiRequests).toBe(0)
})
