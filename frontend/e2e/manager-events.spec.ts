import { expect, test, type Page } from '@playwright/test'

const origin = process.env.E2E_MANAGER_ORIGIN ?? ''
const writer = process.env.E2E_MANAGER_EMAIL ?? ''
const reader = process.env.E2E_MANAGER_READ_ONLY_EMAIL ?? ''
const feedReader = process.env.E2E_MANAGER_NO_READ_EMAIL ?? ''
const password = process.env.E2E_MANAGER_PASSWORD ?? ''
const account = process.env.E2E_MANAGER_ACCOUNT_ID ?? ''
const episode = process.env.E2E_MANAGER_EPISODE_ID ?? ''
const review = process.env.E2E_MANAGER_REVIEW_EVENT_ID ?? ''
const profile = process.env.E2E_MANAGER_PROFILE_EVENT_ID ?? ''
const renewal = process.env.E2E_MANAGER_RENEWAL_EVENT_ID ?? ''

function url(query: string) {
  return new URL('/managers?' + query, origin).href
}

async function signIn(page: Page, email: string, query: string) {
  await page.goto(url(query))
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
}

test('durable events retain identity, filtered snapshots and exact closed episode links', async ({
  page,
}) => {
  test.skip(!account || !episode || !review || !profile || !renewal, 'requires actual A06 fixture')
  expect(origin && writer && password).toBeTruthy()
  const endpoint = new URL('/api/v1/managers/feed', origin).href
  expect((await page.request.get(endpoint)).status()).toBe(401)
  const filter = 'feed_account_id=' + account + '&feed_kind=installation_reviewed&feed_limit=1'
  await signIn(page, writer, 'section=feed&' + filter)
  await expect(page.getByText('ID события ' + review, { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Установка ' + episode, exact: true }).click()
  await expect(page).toHaveURL(new RegExp('episode=' + episode))
  await expect(page.getByText('ID установки ' + episode, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продлить доступ' })).toHaveCount(0)
  await page.goBack()
  await expect(page.getByText('ID события ' + review, { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Продукт', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pilot Widget', exact: true })).toBeVisible()
  await page.goBack()
  await page.getByRole('link', { name: 'Аккаунт', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('account=' + account))
  await page.goto(
    url('section=clients&account=' + account + '&tab=history&history_kind=installation_reviewed'),
  )
  await expect(page.getByText('ID события ' + review, { exact: false })).toBeVisible()
  await page.goto(
    url('section=clients&account=' + account + '&tab=history&history_kind=account_profile_updated'),
  )
  await expect(page.getByText('ID события ' + profile, { exact: false })).toBeVisible()
  await page.goto(url('section=feed&feed_account_id=' + account + '&feed_kind=access_renewed'))
  await expect(page.getByText('ID события ' + renewal, { exact: false })).toBeVisible()
  await page.goto(url('section=feed&feed_account_id=' + account + '&feed_limit=1'))
  await page.getByLabel('С (Москва)', { exact: true }).fill('2020-01-01')
  await page.getByLabel('По (Москва)', { exact: true }).fill('2099-12-31')
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page).toHaveURL(/feed_from=2020-01-01/)
  await page.getByRole('button', { name: 'Следующая страница' }).click()
  await expect(page).toHaveURL(/feed_cursor=/)
  const second = page.url()
  await page.goBack()
  await expect(page).not.toHaveURL(/feed_cursor=/)
  await page.goForward()
  await expect(page).toHaveURL(second)
  const refreshed = page.waitForResponse((response) => {
    const address = new URL(response.url())
    return address.pathname === '/api/v1/managers/feed' && !address.searchParams.has('cursor')
  })
  await page.getByRole('button', { name: 'Обновить события' }).click()
  expect((await refreshed).status()).toBe(200)
  await expect(page).not.toHaveURL(/feed_cursor=/)
  await page.getByLabel('Виды событий').selectOption('activated')
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.getByText('Событий по выбранным условиям нет.')).toBeVisible()
})

test('feed and account-history grants remain independent through BFF', async ({
  page,
  browser,
}) => {
  test.skip(!reader || !feedReader || !account, 'requires independent actual managers')
  await signIn(page, reader, 'section=feed')
  await expect(page.getByRole('alert')).toContainText('Нет доступа к ленте')
  expect((await page.request.get(new URL('/api/v1/managers/feed', origin).href)).status()).toBe(403)
  const history = new URL(
    '/api/v1/managers/accounts/' + account + '/history?kind=installation_reviewed',
    origin,
  ).href
  expect((await page.request.get(history)).status()).toBe(200)
  await page.goto(url('section=clients&account=' + account + '&tab=history'))
  await expect(page.getByRole('heading', { name: 'История аккаунта' })).toBeVisible()
  const other = await browser.newPage()
  try {
    await signIn(other, feedReader, 'section=feed')
    await expect(other.getByRole('heading', { name: 'Лента событий' })).toBeVisible()
    expect((await other.request.get(history)).status()).toBe(403)
    const feed = await other.request.get(
      new URL('/api/v1/managers/feed?kind=installation_reviewed', origin).href,
    )
    expect(feed.status()).toBe(200)
    const records = (await feed.json()) as { items: { id: string; related_refs: unknown[] }[] }
    expect(records.items.some((event) => event.id === review)).toBe(true)
    expect(records.items.every((event) => event.related_refs.length === 0)).toBe(true)
    await expect(other.getByRole('link', { name: 'Аккаунт', exact: true })).toHaveCount(0)
    await other.goto(url('section=clients&account=' + account + '&tab=history'))
    await expect(other.getByRole('alert')).toContainText('Нет доступа к клиентам')
  } finally {
    await other.close()
  }
})
