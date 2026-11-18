import { expect, test } from '@playwright/test'

const navName = 'Разделы менеджеров'
test('invoice reserves bonuses, settles once, and remains visible across account and boards', async ({
  page,
}) => {
  let requests = 0
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      requests++
      return route.abort()
    },
  )
  await page.goto('/managers?section=clients&client=91001001')
  await page.getByRole('button', { name: /^Счета и компании/ }).click()
  await page.getByRole('button', { name: /Выставить счёт/ }).click()
  await page.getByLabel('За что', { exact: true }).fill('Продление тестового счёта')
  await page.getByLabel('Сумма, ₽', { exact: true }).fill('1800')
  await page.getByLabel('Использовать бонусы').fill('600')
  await page.getByRole('button', { name: 'Выставить демо-счёт' }).click()
  await page
    .getByRole('navigation', { name: navName })
    .getByRole('link', { name: 'Счета', exact: true })
    .click()
  const row = page.getByRole('row').filter({ hasText: 'Продление тестового счёта' })
  await expect(row).toContainText('Ждём оплату')
  await row.getByRole('button', { name: 'Открыть счёт' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toContainText('К оплате: 1 200 ₽')
  await drawer.getByRole('button', { name: 'Подтвердить демо-оплату' }).click()
  await expect(drawer.getByRole('heading', { name: 'Квитанция' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Подтвердить демо-оплату' })).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: 'Аннулировать счёт' })).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: /^Оплачены/ }).click()
  await expect(row).toContainText('Оплачен')
  await row.getByRole('link', { name: 'Север Логистик' }).click()
  await page
    .getByRole('group', { name: 'Разделы карточки' })
    .getByRole('button', { name: /^История/ })
    .click()
  await expect(page.getByRole('row').filter({ hasText: 'Счёт оплачен' })).toContainText('Максим')
  expect(requests).toBe(0)
})

test('renewal, contact and portrait edits survive account navigation and finance cannot edit contacts', async ({
  page,
}) => {
  await page.goto('/managers?section=clients&client=91001001')
  await page
    .getByRole('textbox', { name: /^Телефон,/ })
    .first()
    .fill('+7 (000) 000-99-99')
  await page.getByRole('button', { name: 'Продлить', exact: true }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Как изменить дату').selectOption('manual')
  await drawer.getByLabel('Продлить до').fill('2027-08-22')
  await drawer.getByLabel('ID сделки или ссылка').fill('880099')
  await drawer.getByRole('button', { name: 'Подтвердить продление' }).click()
  await page.getByRole('button', { name: /^Портрет клиента/ }).click()
  await page.getByLabel('Ниша', { exact: true }).fill('Производство')
  await page
    .getByRole('navigation', { name: navName })
    .getByRole('link', { name: 'Клиенты', exact: true })
    .click()
  await page.getByRole('link', { name: '91001001', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /^Телефон,/ }).first()).toHaveValue(
    '+7 (000) 000-99-99',
  )
  await expect(page.getByRole('table')).toContainText('22.08.2027')
  await page.getByRole('button', { name: /^Портрет клиента/ }).click()
  await expect(page.getByLabel('Ниша', { exact: true })).toHaveValue('Производство')
  await page.getByLabel('Демо-сотрудник').selectOption('olga')
  await page.getByRole('button', { name: /^Наши виджеты/ }).click()
  await expect(page.getByRole('textbox', { name: /^Телефон,/ }).first()).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Продлить', exact: true }).first()).toBeEnabled()
  await expect(
    page
      .getByRole('navigation', { name: navName })
      .getByRole('link', { name: 'Клиенты', exact: true }),
  ).toHaveCount(0)
})

test('partner demo opens the handoff cabinet and extends a widget test once', async ({ page }) => {
  const requests: string[] = []
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      requests.push(route.request().url())
      return route.abort()
    },
  )

  await page.goto('/login')
  await page.getByRole('radio', { name: 'partners' }).check()
  await page.getByRole('link', { name: 'Открыть демо для партнёров' }).click()
  await expect(page.getByRole('heading', { name: 'Кабинет партнёра' })).toBeVisible()
  await expect(page.getByLabel('Демо-партнёр')).toHaveValue('directory-1')
  await expect(page.getByText('5 000 ₽', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/PRO закончился 27\.10\.2026/)).toBeVisible()

  const table = page.getByRole('table')
  await expect(table.locator('tbody tr')).toHaveCount(7)
  await expect(table.getByRole('row').filter({ hasText: 'stroykomplekt' })).toContainText(
    'запрос отправлен 05.11.2026',
  )
  const search = page.getByRole('searchbox', { name: 'Поиск по аккаунту' })
  await search.fill('31642103')
  const row = table.getByRole('row').filter({ hasText: 'remtehnika-ekb' })
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await expect(row).toContainText('04.01.2027')
  await row.getByRole('button', { name: 'Тест +7 дн.' }).click()
  await expect(row).toContainText('11.01.2027')
  await expect(row.getByRole('button', { name: 'Тест +7 дн.' })).toHaveCount(0)
  await search.fill('')
  await expect(table.locator('tbody tr')).toHaveCount(7)

  await page.setViewportSize({ width: 375, height: 850 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  expect(requests).toEqual([])
})

test('partner has seven scoped views and PRO purchase changes its own balance', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('radio', { name: 'partners' }).check()
  await page.getByRole('link', { name: 'Открыть демо для партнёров' }).click()
  const nav = page.getByRole('navigation', { name: 'Разделы партнёра' })
  await page.getByLabel('Демо-партнёр').selectOption('partner-1')
  await expect(nav.getByRole('link')).toHaveCount(7)
  await nav.getByRole('link', { name: 'Мои клиенты', exact: true }).click()
  await expect(page.getByRole('table')).toContainText('atlas-studio')
  await expect(page.getByRole('table')).not.toContainText('sever-logistics')
  await nav.getByRole('link', { name: 'Бонусы и операции', exact: true }).click()
  await page.getByRole('button', { name: 'Продлить PRO за бонусы' }).click()
  await expect(page.getByRole('heading', { name: 'PRO до 31.03.2028' })).toBeVisible()
  await nav.getByRole('link', { name: 'Бонусы и операции', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Бонусный баланс 36 200 ₽' })).toBeVisible()
  await page.getByLabel('Демо-партнёр').selectOption('partner-3')
  await nav.getByRole('link', { name: 'Мои клиенты', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Нужен PRO' })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 850 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await expect(nav.getByRole('link', { name: 'Уведомления', exact: true })).toBeVisible()
})

test('market filters, client drilldown and portrait use the same widget settings', async ({
  page,
}) => {
  await page.goto('/managers?section=market')
  const market = page.getByRole('region', { name: 'amoМаркет' })
  const search = market.getByRole('searchbox', { name: 'Поиск виджета' })
  await search.fill('amo_wazzup')
  const row = market.getByRole('row').filter({ hasText: 'amo_wazzup' })
  const portraitSwitch = row.getByRole('switch', { name: 'В портрет: Wazzup' })
  await expect(portraitSwitch).toBeChecked()
  await row.getByRole('button', { name: 'Неизвестно', exact: true }).click()
  await expect(portraitSwitch).toHaveCount(0)
  await row.getByRole('button', { name: 'Партнёрский', exact: true }).click()
  await expect(portraitSwitch).toBeChecked()

  await row.getByLabel('Категория: Wazzup').fill('Телефония')
  await row.getByLabel('Категория: Wazzup').press('Tab')
  await market.getByLabel('Категория', { exact: true }).selectOption('Мессенджеры')
  await expect(row).toHaveCount(0)
  await market.getByLabel('Категория', { exact: true }).selectOption('Телефония')
  await row.getByRole('link', { name: /Показать клиентов с виджетом Wazzup/ }).click()
  await expect(page).toHaveURL(/market=amo_wazzup/)
  await page.getByRole('link', { name: '31421329', exact: true }).click()
  await page.getByRole('button', { name: /^Портрет клиента/ }).click()
  await expect(page.getByRole('region', { name: 'Телефония', exact: true })).toContainText(
    'Wazzup · Партнёрский',
  )
  await expect(page.getByRole('region', { name: 'Мессенджеры', exact: true })).not.toContainText(
    'Wazzup',
  )
  await expect(page.getByRole('region', { name: 'Партнёрские виджеты у клиента' })).toContainText(
    'Wazzup',
  )
})
