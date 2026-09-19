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
  await expect(badges).toHaveCount(3)
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

test('an active account list refreshes fixture state after ninety seconds', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/login')
  await page.getByTestId('login-form').locator('input[name="email"]').fill(email)
  await page.getByTestId('login-form').locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Обзор', exact: true })).toBeVisible()
  let changed = false
  let reads = 0
  await page.clock.install()
  await page.bringToFront()
  await page.route('**/api/v1/accounts?**', async (route) => {
    reads++
    const response = await route.fetch()
    const body = (await response.json()) as { items: { domains: string[] }[] }
    if (changed && body.items.length) body.items[0].domains = ['changed-fixture.amocrm.test']
    await route.fulfill({ response, json: body })
  })
  await page.goto('/accounts')
  await expect(page.getByTestId('accounts-search')).toBeVisible()
  await expect(page.getByRole('link', { name: '91000002' })).toBeVisible()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  const refresh = page.getByRole('button', { name: 'Обновить', exact: true })
  const refreshed = page.waitForResponse((response) => response.url().includes('/api/v1/accounts?'))
  await refresh.click()
  await (await refreshed).finished()
  await page.clock.runFor(0)
  await expect(refresh).toBeEnabled()
  changed = true
  const baseline = reads
  await page.clock.fastForward(89_999)
  expect(reads).toBe(baseline)
  const updated = page.waitForResponse((response) => response.url().includes('/api/v1/accounts?'))
  await page.clock.fastForward(1)
  await (await updated).finished()
  await page.clock.runFor(0)
  await expect(page.getByText('changed-fixture.amocrm.test').first()).toBeVisible()
})

test('empty bounded verification page allows continuing the search', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-form').locator('input[name="email"]').fill(email)
  await page.getByTestId('login-form').locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Обзор', exact: true })).toBeVisible()
  await page.route('**/api/v1/accounts?**', async (route) => {
    const original = new URL(route.request().url())
    const upstream = new URL(original)
    upstream.searchParams.delete('cursor')
    const response = await route.fetch({ url: upstream.toString() })
    const body = (await response.json()) as { items: unknown[]; next_cursor: string | null }
    if (!original.searchParams.has('cursor')) {
      body.items = []
      body.next_cursor = 'fixture-next'
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto('/accounts?verification=unknown')
  await expect(page.getByText('Поиск ещё не завершён.', { exact: false })).toBeVisible()
  await expect(page.getByText('Ничего не найдено')).not.toBeVisible()
  await page.getByRole('button', { name: 'Продолжить поиск' }).click()
  await expect(page).toHaveURL(/cursor=fixture-next/)
  await expect(page.getByRole('link', { name: '91000002' })).toBeVisible()
})
