import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const origin = process.env.E2E_MANAGER_ORIGIN ?? ''
const writer = process.env.E2E_MANAGER_EMAIL ?? ''
const colleague = process.env.E2E_MANAGER_SECOND_EMAIL ?? ''
const reader = process.env.E2E_MANAGER_READ_ONLY_EMAIL ?? ''
const restricted = process.env.E2E_MANAGER_NO_READ_EMAIL ?? ''
const catalog = process.env.E2E_MANAGER_CATALOG_ONLY_EMAIL ?? ''
const stats = process.env.E2E_MANAGER_STATS_ONLY_EMAIL ?? ''
const password = process.env.E2E_MANAGER_PASSWORD ?? ''
const productId = process.env.E2E_MANAGER_PRODUCT_ID ?? ''
const code = process.env.E2E_MANAGER_PRODUCT_CODE ?? ''
const phase = process.env.E2E_MANAGER_WIDGETS_PHASE
const installations = process.env.E2E_MANAGER_EXPECTED_INSTALLATIONS ?? '3'
const active = process.env.E2E_MANAGER_EXPECTED_ACTIVE_ACCESSES ?? '3'
const firstName = 'Виджет сохранён первым менеджером'
const finalName = 'Черновик второго менеджера сохранён'
const path = '/api/v1/managers/products'
function url(search: string) {
  return new URL('/managers?' + search, origin).href
}
function card() {
  return url('section=widgets&product=' + productId)
}
function headers(etag: string) {
  return {
    Origin: new URL(origin).origin,
    'X-Requested-With': 'admin-ui',
    'Idempotency-Key': randomUUID(),
    'If-Match': etag,
  }
}
async function signIn(page: Page, email: string, address: string) {
  await page.goto(address)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
}
async function metric(page: Page, label: string, value: string) {
  const term = page.getByRole('term').filter({ hasText: label })
  await expect(term).toBeVisible()
  await expect(term.locator('xpath=following-sibling::dd[1]')).toHaveText(value)
}

test('widget catalog saves across managers, preserves stale drafts, and keeps navigation filters', async ({
  page,
  browser,
}) => {
  test.skip(
    !productId || phase === 'after-restart',
    'requires the before-restart A05 Platform fixture',
  )
  expect(origin && writer && colleague && password && code).toBeTruthy()
  expect((await page.request.get(new URL(path, origin).href)).status()).toBe(401)
  const list = url(
    'section=widgets&products_q=Pilot%20Widget&products_limit=1&clients_q=pilot&q=fixture',
  )
  await signIn(page, writer, list)
  await expect(page.getByRole('link', { name: 'Pilot Widget', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Следующая страница' }).click()
  await expect(page).toHaveURL(/products_cursor=/)
  await page.goBack()
  await expect(page).toHaveURL(list)
  await page.getByRole('link', { name: 'Pilot Widget', exact: true }).click()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Pilot Widget')
  await expect(page.getByLabel('Пробный период')).toHaveValue('90')
  await expect(page.getByLabel('Подтверждённая версия тарифа')).toHaveValue('')
  await metric(page, 'Подтверждённые установки за период', installations)
  await metric(page, 'Текущие активные доступы', active)
  await metric(page, 'Записанные активации', '0')
  await expect(page.getByText(/Источник активаций G03 пока не подключён/)).toBeVisible()
  const other = await browser.newPage()
  try {
    await signIn(other, colleague, card())
    await other.getByLabel('Название', { exact: true }).fill(finalName)
    await page.getByLabel('Название', { exact: true }).fill(firstName)
    await page.getByLabel('Пробный период').selectOption('none')
    await page.getByLabel('Подтверждённая версия тарифа').fill('2')
    const saved = page.waitForResponse(
      (r) =>
        r.url() === new URL(path + '/' + productId, origin).href &&
        r.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Сохранить виджет' }).click()
    const response = await saved
    expect(response.status()).toBe(200)
    expect(response.headers().etag).toMatch(/^"\d+"$/)
    await expect(page.getByRole('heading', { name: firstName, exact: true })).toBeVisible()
    const conflict = other.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().endsWith('/products/' + productId),
    )
    await other.getByRole('button', { name: 'Сохранить виджет' }).click()
    expect((await conflict).status()).toBe(409)
    await expect(other.getByLabel('Название', { exact: true })).toHaveValue(finalName)
    await expect(other.getByText('Текущее название: ' + firstName)).toBeVisible()
    await other.getByRole('button', { name: 'Применить черновик к текущей версии' }).click()
    const rebased = other.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().endsWith('/products/' + productId),
    )
    await other.getByRole('button', { name: 'Сохранить виджет' }).click()
    expect((await rebased).status()).toBe(200)
    await expect(other.getByRole('heading', { name: finalName, exact: true })).toBeVisible()
    await expect(other.getByLabel('Пробный период')).toHaveValue('none')
    await other.screenshot({ path: test.info().outputPath('widget-rebased.png'), fullPage: true })
    await expect(other.getByLabel('Подтверждённая версия тарифа')).toHaveValue('2')
    await page.getByRole('link', { name: 'Клиенты', exact: true }).click()
    await expect(page).not.toHaveURL(/product=/)
    expect(new URL(page.url()).searchParams.get('clients_q')).toBe('pilot')
    await page.goBack()
    await expect(page).toHaveURL(new RegExp('product=' + productId))
    await page.getByRole('link', { name: 'Все виджеты' }).click()
    expect(new URL(page.url()).searchParams.get('products_q')).toBe('Pilot Widget')
  } finally {
    await other.close()
  }
})

test('independent catalog, reader, stats, and restricted grants work against real Platform', async ({
  browser,
}) => {
  test.skip(
    !productId || phase === 'after-restart',
    'requires the before-restart A05 Platform fixture',
  )
  expect(origin && reader && restricted && catalog && stats && password).toBeTruthy()
  const readonly = await browser.newPage(),
    denied = await browser.newPage(),
    metrics = await browser.newPage(),
    editor = await browser.newPage()
  try {
    await signIn(readonly, reader, card())
    await expect(readonly.getByText('Каталог доступен только для чтения.')).toBeVisible()
    await expect(readonly.getByRole('button', { name: 'Сохранить виджет' })).toHaveCount(0)
    await expect(readonly.getByRole('heading', { name: 'Метрики виджета' })).toHaveCount(0)
    const detail = await readonly.request.get(new URL(path + '/' + productId, origin).href)
    expect(detail.status()).toBe(200)
    expect(
      (
        await readonly.request.patch(new URL(path + '/' + productId, origin).href, {
          headers: headers(detail.headers().etag),
          data: { display_name: 'Нет прав' },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await readonly.request.get(new URL(path + '/' + productId + '/metrics', origin).href)
      ).status(),
    ).toBe(403)
    await signIn(denied, restricted, card())
    expect((await denied.request.get(new URL(path, origin).href)).status()).toBe(403)
    expect((await denied.request.get(new URL(path + '/' + productId, origin).href)).status()).toBe(
      403,
    )
    await expect(denied.getByLabel('Название', { exact: true })).toHaveCount(0)

    const statsReads: string[] = []
    metrics.on('request', (request) => {
      if (request.url().includes(path)) statsReads.push(request.url())
    })
    await signIn(metrics, stats, card())
    await metric(metrics, 'Подтверждённые установки за период', installations)
    await metric(metrics, 'Текущие активные доступы', active)
    await metric(metrics, 'Записанные активации', '0')
    expect(statsReads.length).toBeGreaterThan(0)
    expect(statsReads.every((address) => new URL(address).pathname.endsWith('/metrics'))).toBe(true)
    expect((await metrics.request.get(new URL(path + '/' + productId, origin).href)).status()).toBe(
      403,
    )

    const catalogReads: string[] = [],
      attempts: { key: string | undefined; version: string | undefined; body: string | null }[] = []
    editor.on('request', (request) => {
      if (request.url().includes(path) && request.method() === 'GET')
        catalogReads.push(request.url())
    })
    await signIn(editor, catalog, url('section=widgets&product_new=1'))
    const newCode = 'a05-browser-' + randomUUID().slice(0, 8)
    await editor.getByLabel('Код', { exact: true }).fill(newCode)
    await editor.getByLabel('Название', { exact: true }).fill('Создан только каталогом')
    const created = editor.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path,
    )
    await editor.getByRole('button', { name: 'Создать виджет', exact: true }).click()
    const createResponse = await created
    expect(createResponse.status()).toBe(201)
    const createdBody: unknown = await createResponse.json()
    expect(createdBody).toMatchObject({ code: newCode })
    await expect(editor.getByRole('button', { name: 'Сохранить виджет' })).toBeVisible()
    const createdId = new URL(editor.url()).searchParams.get('product')
    expect(createdId).toMatch(/^[0-9a-f-]{36}$/)
    let inject = true
    await editor.route('**/api/v1/managers/products/' + createdId, async (route) => {
      const request = route.request()
      if (request.method() !== 'PATCH') {
        await route.continue()
        return
      }
      const requestHeaders = request.headers()
      attempts.push({
        key: requestHeaders['idempotency-key'],
        version: requestHeaders['if-match'],
        body: request.postData(),
      })
      await route.continue({
        headers: { ...requestHeaders, ...(inject ? { 'X-A05-Lose-Response': '1' } : {}) },
      })
      inject = false
    })
    await editor.getByLabel('Название', { exact: true }).fill('Точный повтор после потери ответа')
    const lost = editor.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().endsWith('/products/' + createdId),
    )
    await editor.getByRole('button', { name: 'Сохранить виджет' }).click()
    expect((await lost).status()).toBe(502)
    await expect(editor.getByText('Результат команды пока неизвестен.')).toBeVisible()
    await editor.getByRole('button', { name: 'Повторить ту же команду' }).click()
    await expect(
      editor.getByRole('heading', { name: 'Точный повтор после потери ответа', exact: true }),
    ).toBeVisible()
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])
    expect(catalogReads).toEqual([])
    expect((await editor.request.get(new URL(path + '/' + createdId, origin).href)).status()).toBe(
      403,
    )
  } finally {
    await Promise.all([readonly.close(), denied.close(), metrics.close(), editor.close()])
  }
})

test('saved widget metadata and trial rule survive Admin and Platform restart', async ({
  page,
}) => {
  test.skip(!productId || phase !== 'after-restart', 'requires the restarted A05 Platform fixture')
  await signIn(page, colleague, card())
  await expect(page.getByRole('heading', { name: finalName, exact: true })).toBeVisible()
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue(finalName)
  await expect(page.getByLabel('Подтверждённая версия тарифа')).toHaveValue('2')
  await expect(page.getByLabel('Пробный период')).toHaveValue('none')
  await metric(page, 'Подтверждённые установки за период', installations)
  await metric(page, 'Текущие активные доступы', active)
})
