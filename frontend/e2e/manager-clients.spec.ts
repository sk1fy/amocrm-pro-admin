import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const origin = process.env.E2E_MANAGER_ORIGIN ?? ''
const writer = process.env.E2E_MANAGER_EMAIL ?? ''
const colleague = process.env.E2E_MANAGER_SECOND_EMAIL ?? ''
const reader = process.env.E2E_MANAGER_READ_ONLY_EMAIL ?? ''
const noRead = process.env.E2E_MANAGER_NO_READ_EMAIL ?? ''
const password = process.env.E2E_MANAGER_PASSWORD ?? ''
const amoAccount = process.env.E2E_MANAGER_AMO_ACCOUNT_ID ?? ''
const phase = process.env.E2E_MANAGER_CLIENTS_PHASE
const firstNote = 'Первый менеджер сохранил заметку'
const colleagueDraft = 'Черновик второго менеджера'
const accountPath = '/api/v1/managers/accounts'

function url(search: string) {
  return new URL('/managers?' + search, origin).href
}

async function signIn(page: Page, email: string, address: string) {
  await page.goto(address)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
}

async function editNote(page: Page, note: string) {
  await page
    .getByRole('region', { name: 'Примечание' })
    .getByRole('button', { name: /^(Добавить|Изменить)$/ })
    .click()
  await page.getByRole('textbox', { name: 'Заметка', exact: true }).fill(note)
}

function portraitRating(page: Page, value: string) {
  return page
    .getByRole('group', { name: 'Деньги', exact: true })
    .getByRole('button', { name: value, exact: true })
}

test('two managers see a saved client profile and a stale draft survives conflict', async ({
  page,
  browser,
}) => {
  test.skip(
    phase !== 'before-restart' ||
      !origin ||
      !writer ||
      !colleague ||
      !reader ||
      !noRead ||
      !password ||
      !amoAccount,
    'requires the isolated A04 Core, Platform, and Admin fixture',
  )
  expect((await page.request.get(new URL(accountPath, origin).href)).status()).toBe(401)
  const list = url('section=clients&clients_q=pilot&clients_limit=1&clients_sort=amo_account_id')
  await signIn(page, writer, list)

  await expect(page.getByText(/^Найдено 3(?: из \d+)?$/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Pilot 1/ })).toBeVisible()
  await page.getByRole('button', { name: 'Следующая страница' }).click()
  await expect(page).toHaveURL(/clients_cursor=/)
  await expect(page.getByText(/^Найдено 3(?: из \d+)?$/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Pilot 2/ })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(list)
  const firstClient = page.getByRole('link', { name: /Pilot 1/ })
  const cardTitle = await firstClient.innerText()
  await firstClient.click()
  await expect(page.getByRole('heading', { name: cardTitle, exact: true })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('account')
  expect(id).toMatch(/^[a-f0-9-]{36}$/)
  const cardPath = new URL(accountPath + '/' + id, origin).href
  const other = await browser.newPage()
  const readonly = await browser.newPage()
  const restricted = await browser.newPage()
  try {
    const install = url('section=installations&q=' + encodeURIComponent(amoAccount))
    await signIn(other, colleague, install)
    await other.getByRole('link', { name: amoAccount, exact: true }).first().click()
    await expect(other).toHaveURL(new RegExp('account=' + id))
    await editNote(other, colleagueDraft)

    await editNote(page, firstNote)
    const saved = page.waitForResponse(
      (response) =>
        response.url() === cardPath + '/profile' && response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const result = await saved
    expect(result.status()).toBe(200)
    expect(result.headers().etag).toMatch(/^"\d+"$/)
    await expect(page.getByRole('definition').filter({ hasText: firstNote })).toBeVisible()

    const conflict = other.waitForResponse(
      (response) =>
        response.url() === cardPath + '/profile' && response.request().method() === 'PATCH',
    )
    await other.getByRole('button', { name: 'Сохранить', exact: true }).click()
    expect((await conflict).status()).toBe(409)
    await expect(other.getByRole('alert')).toContainText('Черновик сохранён')
    await expect(other.getByRole('textbox', { name: 'Заметка', exact: true })).toHaveValue(
      colleagueDraft,
    )
    await expect(other.getByText('Текущая заметка: ' + firstNote, { exact: true })).toBeVisible()

    const link = url('section=clients&account=' + id + '&tab=overview')
    await signIn(readonly, reader, link)
    await expect(readonly.getByRole('definition').filter({ hasText: firstNote })).toBeVisible()
    await expect(readonly.getByRole('textbox', { name: 'Заметка', exact: true })).toHaveCount(0)
    const denied = await readonly.request.patch(cardPath + '/profile', {
      headers: {
        Origin: new URL(origin).origin,
        'X-Requested-With': 'admin-ui',
        'Idempotency-Key': randomUUID(),
        'If-Match': result.headers().etag,
      },
      data: { note: 'Заметка без права записи', reason: 'Проверка разрешения' },
    })
    expect(denied.status()).toBe(403)

    await signIn(restricted, noRead, link)
    await expect(restricted.getByRole('alert')).toContainText('Нет доступа к клиентам')
    expect((await restricted.request.get(cardPath)).status()).toBe(403)

    await readonly.getByRole('link', { name: 'Пользователи' }).click()
    await expect(readonly.getByRole('cell', { name: 'Fixture user 1/0' })).toBeVisible()
    await readonly.getByRole('link', { name: 'История' }).click()
    await expect(readonly.getByRole('heading', { name: 'История аккаунта' })).toBeVisible()

    await page.getByRole('link', { name: 'Портрет клиента' }).click()
    await portraitRating(page, '3').click()
    const portrait = page.waitForResponse(
      (response) =>
        response.url() === cardPath + '/portrait' && response.request().method() === 'PATCH',
    )
    await page
      .getByRole('region', { name: 'Портрет клиента', exact: true })
      .getByRole('button', { name: 'Сохранить', exact: true })
      .click()
    expect((await portrait).status()).toBe(200)

    await page.getByRole('link', { name: 'Наши виджеты' }).click()
    await page.getByText('Продлить', { exact: true }).first().click()
    await page.getByLabel('Продлить до').fill('2090-07-01T12:00')
    await page.getByLabel('Причина продления').fill('Проверка ручного срока')
    const renewal = page.waitForResponse(
      (response) =>
        response.url() === cardPath + '/renewals' && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Продлить доступ' }).click()
    expect((await renewal).status()).toBe(201)
  } finally {
    await Promise.all([other.close(), readonly.close(), restricted.close()])
  }
})

test('saved client changes survive the Admin and Platform restart', async ({ page }) => {
  test.skip(
    phase !== 'after-restart' || !origin || !colleague || !password || !amoAccount,
    'requires a restarted A04 fixture',
  )
  await signIn(page, colleague, url('section=clients&clients_q=' + encodeURIComponent(amoAccount)))
  await page.getByRole('link', { name: /Pilot 1/ }).click()
  await expect(page.getByRole('definition').filter({ hasText: firstNote })).toBeVisible()
  await page.getByRole('link', { name: 'Портрет клиента' }).click()
  await expect(portraitRating(page, '3')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: 'Наши виджеты' }).click()
  await expect(page.getByText('Ручное назначение', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/2090/).first()).toBeVisible()
})
