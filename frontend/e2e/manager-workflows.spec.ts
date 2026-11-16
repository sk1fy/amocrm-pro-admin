import { expect, test } from '@playwright/test'

const navName = 'Разделы менеджеров'
test('invoice reserves bonuses, settles once, and remains visible across account and boards', async ({
  page,
}) => {
  let requests = 0
  await page.route('**/api/**', (route) => {
    requests++
    return route.abort()
  })
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

test('partner has seven scoped views and PRO purchase changes its own balance', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('radio', { name: 'partners' }).check()
  await page.getByRole('link', { name: 'Открыть демо для партнёров' }).click()
  const nav = page.getByRole('navigation', { name: 'Разделы партнёра' })
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

test('market mapping reaches only matching portrait topics and client presence filter', async ({
  page,
}) => {
  await page.goto('/managers?section=market')
  const row = page.getByRole('row').filter({ hasText: 'Телефония' })
  await row.getByRole('button', { name: 'Изменить' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Тема портрета').selectOption('calls')
  await drawer.getByLabel('Отметка').selectOption('Конкурент')
  await drawer.getByRole('button', { name: 'Сохранить сопоставление' }).click()
  await row.getByRole('link', { name: 'Показать клиентов' }).click()
  await expect(page).toHaveURL(/market=market-1/)
  await page.getByRole('link', { name: '91001001', exact: true }).click()
  await page.getByRole('button', { name: /^Портрет клиента/ }).click()
  await expect(page.getByRole('region', { name: 'Звонки', exact: true })).toContainText(
    'Телефония · Конкурент',
  )
})
