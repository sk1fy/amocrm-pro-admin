import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_EMAIL ?? 'admin@example.invalid'
const adminPassword = process.env.E2E_PASSWORD ?? 'correct-horse-battery'

async function login(page: Page, target: string) {
  await page.goto(target)
  const form = page.getByTestId('login-form')
  await form.locator('input[name="email"]').fill(adminEmail)
  await form.locator('input[name="password"]').fill(adminPassword)
  await form.getByRole('button', { name: 'Войти', exact: true }).click()
}

function usersSection(page: Page) {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Пользователи amoCRM' }) })
}

test('users tab shows the snapshot and keeps its rows after expiry', async ({ page }) => {
  await page.clock.install()
  const usersRequests: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.endsWith('/crm-users')) usersRequests.push(pathname)
  })
  await login(page, '/accounts/91000001')
  await page.getByRole('navigation', { name: 'Вкладки аккаунта' }).getByText('Пользователи').click()
  await expect(page).toHaveURL(/\/accounts\/91000001\/users$/)
  const section = usersSection(page)
  await expect(section.getByTestId('crm-users-state')).toHaveText('Список получен')
  await expect(section.getByText('Всего: 3')).toBeVisible()
  const table = section.getByRole('table')
  const admin = table.getByRole('row').filter({ hasText: 'Fixture User A' })
  await expect(admin).toContainText('501')
  await expect(admin).toContainText('Активен')
  await expect(admin).toContainText('Да')
  await expect(table.getByRole('row').filter({ hasText: 'Fixture User G' })).toContainText(
    'Неактивен',
  )
  await expect(
    section.locator(
      'a[href="/accounts/91000001/widgets/core/f1a00000-0000-4000-8000-000000000001"]',
    ),
  ).toBeVisible()
  await expect(section.getByText(/@/)).toHaveCount(0)

  await expect(section.getByText('Актуально')).toBeVisible()
  await page.clock.fastForward('05:01')
  await expect(section.getByText('Данные устарели')).toBeVisible()
  await expect(admin).toBeVisible()
  expect(usersRequests).toEqual(['/api/v1/accounts/91000001/crm-users'])
})

test('rate limit keeps the list unknown and shows the retry hint', async ({ page }) => {
  await login(page, '/accounts/91000002/users')
  const section = usersSection(page)
  await expect(section.getByTestId('crm-users-state')).toHaveText('Лимит запросов amoCRM')
  await expect(section.getByText('Список пользователей неизвестен')).toBeVisible()
  await expect(section.getByText(/Повторите через 30 сек/)).toBeVisible()
  await expect(section.getByRole('table')).toHaveCount(0)
  await expect(section.getByText('В аккаунте нет пользователей')).toHaveCount(0)
})

test('account without an authorized connection is not shown as empty', async ({ page }) => {
  await login(page, '/accounts/91000003/users')
  const section = usersSection(page)
  await expect(section.getByTestId('crm-users-state')).toHaveText('Нет авторизованного подключения')
  await expect(section.getByText('Список пользователей неизвестен')).toBeVisible()
  await expect(section.getByText('В аккаунте нет пользователей')).toHaveCount(0)
})
