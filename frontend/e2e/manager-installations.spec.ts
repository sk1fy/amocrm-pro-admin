import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const origin = process.env.E2E_MANAGER_ORIGIN ?? ''
const email = process.env.E2E_MANAGER_EMAIL ?? ''
const password = process.env.E2E_MANAGER_PASSWORD ?? ''
const readerEmail = process.env.E2E_MANAGER_READ_ONLY_EMAIL ?? ''
const noReadEmail = process.env.E2E_MANAGER_NO_READ_EMAIL ?? ''
const accountId = process.env.E2E_MANAGER_AMO_ACCOUNT_ID ?? ''
const productCode = process.env.E2E_MANAGER_PRODUCT_CODE ?? ''
const phase = process.env.E2E_MANAGER_INSTALLATIONS_PHASE
const path = '/api/v1/managers/installations'

function queueUrl(review: 'reviewed' | 'unreviewed'): URL {
  const url = new URL('/managers', origin)
  url.search = new URLSearchParams({ section: 'installations', q: accountId, review }).toString()
  return url
}

async function signIn(page: Page, address: string, url: URL) {
  await page.goto(url.href)
  await expect(page.getByRole('heading', { name: 'Кабинет менеджеров' })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.getByLabel('Email').fill(address)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
  await expect(page).toHaveURL(url.href)
}

function installationRow(page: Page) {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: accountId, exact: true }) })
    .filter({ hasText: productCode })
}

async function openAccount(page: Page) {
  await installationRow(page).getByRole('button', { name: 'Подробнее', exact: true }).click()
  const card = page.getByRole('region', { name: 'Аккаунт amoCRM ' + accountId })
  await expect(card).toBeVisible()
  await expect(card.getByText('Авторизована', { exact: true })).toBeVisible()
  await expect(card.getByText('Нет сведений об активации', { exact: true })).toBeVisible()
  await expect(card.getByText('Пробный период', { exact: true })).toBeVisible()
  await expect(card.getByText('Действует', { exact: true })).toBeVisible()
  await expect(
    card.getByText('Срок доступа', { exact: true }).locator('xpath=following-sibling::dd[1]/time'),
  ).toHaveAttribute('datetime', /T/)
  await expect(card.getByText('Platform · снимок на').locator('time')).toHaveAttribute(
    'datetime',
    /T/,
  )
  return card
}

function installationIdentity(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error('expected installations list')
  }
  const rows: unknown[] = value.items
  const row = rows.find(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'amo_account_id' in item &&
      item.amo_account_id === accountId &&
      'product_code' in item &&
      item.product_code === productCode,
  )
  if (
    typeof row !== 'object' ||
    row === null ||
    !('id' in row) ||
    typeof row.id !== 'string' ||
    !('version' in row) ||
    typeof row.version !== 'number'
  ) {
    throw new Error('missing OAuth installation identity')
  }
  return { id: row.id, version: row.version }
}

test('the live OAuth installation can be reviewed and grants protect direct requests', async ({
  page,
  browser,
}) => {
  test.skip(
    phase !== 'before-restart' ||
      !origin ||
      !email ||
      !password ||
      !readerEmail ||
      !noReadEmail ||
      !accountId ||
      !productCode,
    'requires a running A03 OAuth fixture, three manager accounts, and the before-restart phase',
  )

  const listUrl = new URL(path + '?q=' + encodeURIComponent(accountId), origin).href
  expect((await page.request.get(listUrl)).status()).toBe(401)
  await signIn(page, email, queueUrl('unreviewed'))
  const row = installationRow(page)
  await expect(row.getByText(productCode, { exact: true }).first()).toBeVisible()
  await expect(row.getByText('Не проверена', { exact: true })).toBeVisible()
  await openAccount(page)

  await page
    .getByRole('searchbox', { name: 'Аккаунт или продукт' })
    .fill('a03-no-matching-installation')
  await page.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('Установки не найдены')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('q')).toBe('a03-no-matching-installation')
  await page.goBack()
  await expect(page).toHaveURL(queueUrl('unreviewed').href)
  await expect(row).toBeVisible()

  const put = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/review'),
  )
  await row.getByRole('button', { name: 'Отметить проверенной' }).click()
  const result = await put
  expect(result.status()).toBe(200)
  expect(result.headers().etag).toMatch(/^"\d+"$/)
  await expect(page.getByText('Установки не найдены')).toBeVisible()

  await page.getByRole('button', { name: /^Проверенные/ }).click()
  await expect(row.getByText('Проверена', { exact: true })).toBeVisible()
  const reader = await browser.newPage()
  const limited = await browser.newPage()
  try {
    await signIn(reader, readerEmail, queueUrl('reviewed'))
    await expect(installationRow(reader).getByText('Проверена', { exact: true })).toBeVisible()
    await expect(
      installationRow(reader).getByRole('button', { name: 'Снять отметку' }),
    ).toHaveCount(0)
    const readerList = await reader.request.get(listUrl)
    expect(readerList.status()).toBe(200)
    const { id, version } = installationIdentity(await readerList.json())
    const deniedReview = await reader.request.put(
      new URL(path + '/' + id + '/review', origin).href,
      {
        headers: {
          Origin: new URL(origin).origin,
          'X-Requested-With': 'admin-ui',
          'Idempotency-Key': randomUUID(),
          'If-Match': '"' + version + '"',
        },
        data: { reviewed: false },
      },
    )
    expect(deniedReview.status()).toBe(403)

    await signIn(limited, noReadEmail, queueUrl('reviewed'))
    await expect(limited.getByText('Нет доступа к установкам.')).toBeVisible()
    await expect(installationRow(limited)).toHaveCount(0)
    expect((await limited.request.get(listUrl)).status()).toBe(403)
    await expect(installationRow(page).getByText('Проверена', { exact: true })).toBeVisible()
  } finally {
    await Promise.all([reader.close(), limited.close()])
  }
})

test('the review and account details survive Admin and Platform restart', async ({ page }) => {
  test.skip(
    phase !== 'after-restart' || !origin || !email || !password || !accountId || !productCode,
    'requires a running A03 OAuth fixture and the after-restart phase',
  )

  await signIn(page, email, queueUrl('reviewed'))
  const row = installationRow(page)
  await expect(row.getByText(productCode, { exact: true }).first()).toBeVisible()
  await expect(row.getByText('Проверена', { exact: true })).toBeVisible()
  const card = await openAccount(page)
  await expect(
    card.getByText('ID проверившего', { exact: true }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(/^[a-f0-9-]{36}$/)
  await expect(
    card.getByText('Проверена в', { exact: true }).locator('xpath=following-sibling::dd[1]/time'),
  ).toHaveAttribute('datetime', /T/)

  const put = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/review'),
  )
  await row.getByRole('button', { name: 'Снять отметку' }).click()
  expect((await put).status()).toBe(200)
  await expect(page.getByText('Установки не найдены')).toBeVisible()
  await page.getByRole('button', { name: /^Непроверенные/ }).click()
  await expect(row.getByText('Не проверена', { exact: true })).toBeVisible()
  await page.reload()
  await expect(row.getByText('Не проверена', { exact: true })).toBeVisible()
})
