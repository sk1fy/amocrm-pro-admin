import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const origin = process.env.E2E_MANAGER_ORIGIN ?? ''
const technical = process.env.E2E_TECHNICAL_ORIGIN ?? ''
const manager = process.env.E2E_MANAGER_EMAIL ?? ''
const colleague = process.env.E2E_MANAGER_SECOND_EMAIL ?? ''
const reader = process.env.E2E_MANAGER_READ_ONLY_EMAIL ?? ''
const staffOnly = process.env.E2E_MANAGER_STAFF_ONLY_EMAIL ?? ''
const auditor = process.env.E2E_MANAGER_AUDIT_ONLY_EMAIL ?? ''
const password = process.env.E2E_MANAGER_PASSWORD ?? ''
const phase = process.env.E2E_MANAGER_WIDGETS_PHASE
const fixture = process.env.A05_TEST_FIXTURE_DIR ?? ''
const stateFile = fixture + '/staff-state.json'
const api = '/api/v1/managers'
const invitedEmail = 'a07-invited@example.invalid'
const invitedName = 'A07 приглашённый сотрудник'

type Staff = { id: string; version: number; grants: string[]; changed_by: string | null }
function url(search = 'section=staff') {
  return new URL('/managers?' + search, origin).href
}
function endpoint(path: string) {
  return new URL(api + path, origin).href
}
function headers(key = randomUUID(), version?: number) {
  return {
    Origin: new URL(origin).origin,
    'X-Requested-With': 'admin-ui',
    'Idempotency-Key': key,
    ...(version === undefined ? {} : { 'If-Match': '"' + version + '"' }),
  }
}
async function signIn(page: Page, email: string, search = 'section=staff') {
  await page.context().clearCookies()
  await page.goto(url(search))
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
}
async function accept(page: Page, link: string) {
  await page.goto(link)
  await expect(
    page.getByRole('heading', { name: 'Приглашение в кабинет менеджеров' }),
  ).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  await page.getByLabel('Новый пароль', { exact: true }).fill(password)
  await page.getByLabel('Повторите пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Установить пароль', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Перейти ко входу' })).toBeVisible()
}

test('staff invite, identity isolation, grants and session revocation persist with Platform offline', async ({
  page,
  browser,
}) => {
  test.skip(!fixture || !technical, 'requires isolated A07 Admin fixture')
  expect((await page.request.get(endpoint('/staff'))).status()).toBe(401)
  await signIn(page, manager)
  await expect(
    page.getByRole('navigation', { name: 'Кабинет менеджеров' }).getByRole('link'),
  ).toHaveCount(5)
  await expect(page.getByRole('heading', { name: 'Сотрудники', exact: true })).toBeVisible()
  if (phase === 'after-restart') {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as { id: string }
    await page.goto(url('section=staff&staff_id=' + saved.id))
    await expect(page.getByRole('heading', { name: invitedName, exact: true })).toBeVisible()
    const response = await page.request.get(endpoint('/staff/' + saved.id))
    expect(response.status()).toBe(200)
    const staff = (await response.json()) as Staff
    expect(staff.grants).toEqual(['clients.read'])
    expect(staff.changed_by).toBeTruthy()
    return
  }
  await page.getByRole('button', { name: 'Пригласить сотрудника', exact: true }).click()
  const form = page.locator('#staff-invitation')
  await form.getByLabel('Email', { exact: true }).fill(invitedEmail)
  await form.getByLabel('Имя', { exact: true }).fill(invitedName)
  await form.getByLabel('Просмотр клиентов', { exact: true }).check()
  await form.getByLabel('Лента событий', { exact: true }).check()
  const created = page.waitForResponse(
    (response) => response.url() === endpoint('/staff') && response.request().method() === 'POST',
  )
  await form.getByRole('button', { name: 'Создать приглашение' }).click()
  const createdResponse = await created
  expect(createdResponse.status()).toBe(201)
  const result = (await createdResponse.json()) as { staff: Staff }
  const id = result.staff.id
  const link = await page.getByLabel('Ссылка приглашения').inputValue()
  expect(new URL(link).hash.startsWith('#invitation=')).toBe(true)
  const invited = await browser.newPage()
  try {
    await accept(invited, link)
    await invited.getByRole('button', { name: 'Перейти ко входу' }).click()
    await invited.getByLabel('Email', { exact: true }).fill(invitedEmail)
    await invited.getByLabel('Пароль', { exact: true }).fill(password)
    await invited.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(invited.getByRole('button', { name: 'Выйти' })).toBeVisible()
    expect((await invited.request.get(endpoint('/me'))).status()).toBe(200)
    const core = await invited.request.post(new URL('/api/v1/auth/login', technical).href, {
      headers: { Origin: new URL(technical).origin, 'X-Requested-With': 'admin-ui' },
      data: { email: invitedEmail, password },
    })
    expect(core.status()).toBe(401)
    await page.goto(url('section=staff&staff_id=' + id))
    await expect(page.getByRole('heading', { name: invitedName, exact: true })).toBeVisible()
    await page.getByRole('switch', { name: 'Лента событий', exact: true }).uncheck()
    const updated = page.waitForResponse(
      (response) =>
        response.url() === endpoint('/staff/' + id) && response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Сохранить права', exact: true }).click()
    expect((await updated).status()).toBe(200)
    expect([401, 403]).toContain((await invited.request.get(endpoint('/feed'))).status())
    await signIn(invited, invitedEmail)
    await page.getByRole('button', { name: 'Завершить менеджерские сеансы' }).click()
    const revoked = page.waitForResponse(
      (response) => response.url() === endpoint('/staff/' + id + '/sessions/revoke'),
    )
    await page.getByRole('button', { name: 'Подтвердить завершение' }).click()
    expect((await revoked).status()).toBe(200)
    expect((await invited.request.get(endpoint('/me'))).status()).toBe(401)
    writeFileSync(stateFile, JSON.stringify({ id }))
  } finally {
    await invited.close()
  }
})

test('staff, identity and audit grants are independent and manager revoke preserves Core session', async ({
  browser,
}) => {
  test.skip(!fixture || !technical, 'requires isolated A07 Admin fixture')
  const pages = await Promise.all([
    browser.newPage(),
    browser.newPage(),
    browser.newPage(),
    browser.newPage(),
  ])
  const [limited, audit, operator, second] = pages
  try {
    await signIn(limited, reader)
    expect((await limited.request.get(endpoint('/staff'))).status()).toBe(403)
    expect((await limited.request.get(endpoint('/security/audit'))).status()).toBe(403)
    await signIn(audit, auditor)
    await expect(audit.getByRole('heading', { name: 'Аудит безопасности' })).toHaveCount(0)
    expect((await audit.request.get(endpoint('/staff'))).status()).toBe(403)
    const auditResponse = await audit.request.get(endpoint('/security/audit?limit=1'))
    expect(auditResponse.status()).toBe(200)
    const history = (await auditResponse.json()) as {
      items: { action: string }[]
      next_cursor: string | null
    }
    expect(history.items.length).toBe(1)
    expect(
      history.items.every(
        (event) =>
          event.action.startsWith('manager.') ||
          ['auth.login', 'auth.login_failed', 'auth.logout'].includes(event.action),
      ),
    ).toBe(true)
    await signIn(operator, staffOnly)
    expect((await operator.request.get(endpoint('/staff'))).status()).toBe(200)
    expect(
      (
        await operator.request.post(endpoint('/staff'), {
          headers: headers(),
          data: { email: 'a07-denied@example.invalid', name: 'Denied', grants: ['clients.read'] },
        })
      ).status(),
    ).toBe(403)
    await signIn(second, colleague)
    const me = (await (await second.request.get(endpoint('/me'))).json()) as { id: string }
    const core = await second.request.post(new URL('/api/v1/auth/login', technical).href, {
      headers: { Origin: new URL(technical).origin, 'X-Requested-With': 'admin-ui' },
      data: { email: colleague, password },
    })
    expect(core.status()).toBe(200)
    await signIn(limited, manager)
    expect(
      (
        await limited.request.post(endpoint('/staff/' + me.id + '/sessions/revoke'), {
          headers: headers(),
          data: {},
        })
      ).status(),
    ).toBe(200)
    expect((await second.request.get(endpoint('/me'))).status()).toBe(401)
    expect((await second.request.get(new URL('/api/v1/me', technical).href)).status()).toBe(200)
  } finally {
    await Promise.all(pages.map((page) => page.close()))
  }
})

test('lost invitation response returns a safe exact receipt and requires explicit pending reissue', async ({
  page,
  browser,
}) => {
  test.skip(!fixture || phase === 'after-restart', 'requires before-restart isolated Admin fixture')
  await signIn(page, manager)
  const key = randomUUID()
  const body = {
    email: 'a07-lost@example.invalid',
    name: 'A07 потерянный ответ',
    grants: ['clients.read'],
  }
  const lost = await page.request.post(endpoint('/staff'), {
    headers: { ...headers(key), 'X-A07-Lose-Response': '1' },
    data: body,
  })
  expect(lost.status()).toBe(502)
  const repeated = await page.request.post(endpoint('/staff'), {
    headers: headers(key),
    data: body,
  })
  expect(repeated.status()).toBe(201)
  const outcome = (await repeated.json()) as {
    staff: Staff
    invitation_url?: string
    link_unavailable: boolean
  }
  expect(outcome.link_unavailable).toBe(true)
  expect(outcome.invitation_url).toBeUndefined()
  await page.goto(url('section=staff&staff_id=' + outcome.staff.id))
  await expect(page.getByRole('heading', { name: body.name, exact: true })).toBeVisible()
  const reissued = page.waitForResponse((response) =>
    response.url().endsWith('/invitation/reissue'),
  )
  await page.getByRole('button', { name: 'Перевыпустить приглашение' }).click()
  expect((await reissued).status()).toBe(200)
  const link = await page.getByLabel('Ссылка приглашения').inputValue()
  const recipient = await browser.newPage()
  try {
    await accept(recipient, link)
  } finally {
    await recipient.close()
  }
})
