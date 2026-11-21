import { sendWorkflowCommand, type WorkflowCommand, type CompanyWorkflow } from './companyApi'
import { apiFetchResponse } from '../src/api/client'
import {
  date,
  integer,
  isAmoAccountId,
  isUUID,
  parseInstallation,
  record,
} from './installationsApi'
import { managerApi } from './session'
import { sendProductCommand, type ProductCommand, type Product } from './productsApi'

export type AccountId = string & { readonly __brand: 'AccountId' }
export function isAccountId(value: unknown): value is AccountId {
  return isUUID(value)
}

function invalid(): never {
  throw new Error('invalid manager account response')
}
function text(value: unknown): string {
  if (typeof value !== 'string') invalid()
  return value
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value)
}
function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value)
}
function array<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) invalid()
  return value.map(parse)
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid()
  return value
}
function uuid(value: unknown): string {
  if (!isUUID(value)) invalid()
  return value
}
export function versionETag(version: number): string {
  return '"' + version + '"'
}
export function assertETag(etag: string | null, version: number) {
  if (versionETag(version) !== etag) invalid()
}

function parseObservation<T>(raw: unknown, parse: (value: unknown) => T) {
  const item = record(raw)
  const state = item.state
  if (
    state !== 'fresh' &&
    state !== 'stale' &&
    state !== 'unknown' &&
    state !== 'unavailable' &&
    state !== 'unsupported'
  )
    invalid()
  return {
    state,
    value: optional(item.value, parse),
    source: text(item.source),
    observed_at: optional(item.observed_at, date),
    fresh_until: optional(item.fresh_until, date),
  }
}
export type AccountObservation<T> = ReturnType<typeof parseObservation<T>>

function parseLicense(raw: unknown) {
  const item = record(raw)
  return {
    license_until: optional(item.license_until, (value) => nullable(value, date)),
    paid_seat_limit: optional(item.paid_seat_limit, (value) =>
      nullable(value, (count) => integer(count, 0)),
    ),
    tariff: optional(item.tariff, (value) => nullable(value, text)),
  }
}

const dataGroups = ['receiving', 'no_data', 'blocked'] as const
export const widgetTariffs = ['FREE', 'TOP', 'PRO', 'trial'] as const

function listedValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  const known = allowed.find((item) => item === value)
  if (!known) invalid()
  return known
}

function parseAccountSummary(raw: unknown) {
  const item = record(raw)
  if (!isAccountId(item.account_id) || !isAmoAccountId(item.amo_account_id)) invalid()
  return {
    account_id: item.account_id,
    amo_account_id: item.amo_account_id,
    current_domain: nullable(item.current_domain, text),
    domain_aliases: nullable(item.domain_aliases, (value) => array(value, text)),
    display_name: nullable(item.display_name, text),
    time_zone: optional(item.time_zone, (value) => nullable(value, text)),
    classification: nullable(item.classification, text),
    partner_name: optional(item.partner_name, (value) => nullable(value, text)),
    widget_tariffs: optional(item.widget_tariffs, (value) =>
      array(value, (tariff) => listedValue(tariff, widgetTariffs)),
    ),
    data_group: optional(item.data_group, (value) => listedValue(value, dataGroups)),
    renewal_channel: optional(item.renewal_channel, (value) =>
      listedValue(value, ['direct', 'partner'] as const),
    ),
    active_products_count: integer(item.active_products_count, 0),
    license: parseObservation(item.license, parseLicense),
    active_users: parseObservation(item.active_users, (value) => integer(value, 0)),
    version: integer(item.version, 1),
  }
}
export type AccountSummary = ReturnType<typeof parseAccountSummary>

function parseOverviewGroup(raw: unknown) {
  const group = record(raw)
  return {
    total: integer(group.total, 0),
    by_classification: Object.fromEntries(
      Object.entries(record(group.by_classification)).map(([name, value]) => [
        name,
        integer(value, 0),
      ]),
    ),
  }
}

function parseOverview(raw: unknown) {
  const overview = record(raw)
  return {
    all: parseOverviewGroup(overview.all),
    receiving: parseOverviewGroup(overview.receiving),
    no_data: parseOverviewGroup(overview.no_data),
    blocked: parseOverviewGroup(overview.blocked),
  }
}
export type AccountOverviewCounts = ReturnType<typeof parseOverview>

function parseAccount(raw: unknown) {
  const item = record(raw)
  return {
    ...parseAccountSummary(item),
    identity_observed_at: optional(item.identity_observed_at, date),
    note: nullable(item.note, text),
    region: nullable(item.region, text),
    time_zone: nullable(item.time_zone, text),
    amostart: parseObservation(item.amostart, date),
    capabilities: array(item.capabilities, (value) => {
      const capability = record(value)
      return { action: text(capability.action), allowed: boolean(capability.allowed) }
    }),
  }
}
export type AccountDetail = ReturnType<typeof parseAccount>

function parsePage<T>(raw: unknown, parse: (value: unknown) => T) {
  const page = record(raw)
  return {
    items: array(page.items, parse),
    next_cursor: nullable(page.next_cursor, text),
    snapshot_at: date(page.snapshot_at),
    query_hash: text(page.query_hash),
  }
}

const accounts = managerApi + '/accounts'
export function accountPath(account: AccountId) {
  return accounts + '/' + account
}

export async function listAccounts(search: string, filter: string | null, signal: AbortSignal) {
  const { data } = await apiFetchResponse<unknown>(
    accounts + (filter ? '/search' : '') + (search ? '?' + search : ''),
    filter ? { signal, method: 'POST', body: '{"portrait_filter":' + filter + '}' } : { signal },
  )
  const page = record(data)
  if (!Array.isArray(page.sources) || page.sources.length !== 1) invalid()
  const source = record(page.sources[0])
  if (source.backend !== 'platform' || source.status !== 'available') invalid()
  const summary = record(page.summary)
  return {
    ...parsePage(page, parseAccountSummary),
    total: integer(summary.total, 0),
    overview: optional(summary.overview, parseOverview),
    source: { backend: source.backend, observed_at: date(source.observed_at) },
  }
}

export async function getAccount(account: AccountId, signal: AbortSignal) {
  const { data, etag } = await apiFetchResponse<unknown>(accountPath(account), { signal })
  const item = parseAccount(data)
  if (item.account_id !== account) invalid()
  assertETag(etag, item.version)
  return item
}

function parseAccess(raw: unknown, account: AccountId, product: unknown) {
  const access = record(raw)
  if (access.account_id !== account || access.product_id !== product) invalid()
  return integer(access.entitlement_version, 1)
}

export type WidgetFilter = { kind: 'allEpisodes' } | { kind: 'currentProduct'; product: string }

export async function listWidgets(
  account: AccountId,
  cursor: string,
  signal: AbortSignal,
  filter: WidgetFilter = { kind: 'allEpisodes' },
) {
  const product = filter.kind === 'currentProduct' ? filter.product : undefined
  const query = new URLSearchParams({ limit: '100' })
  if (cursor) query.set('cursor', cursor)
  if (product) {
    query.set('product_id', product)
    query.set('state', 'current')
  }
  const suffix = query.size > 0 ? '?' + query.toString() : ''
  const { data } = await apiFetchResponse<unknown>(accountPath(account) + '/widgets' + suffix, {
    signal,
  })
  return parsePage(data, (value) => {
    const row = parseInstallation(value)
    const raw = record(value)
    if (
      row.account_id !== account ||
      (product && (raw.product_id !== product || row.lifecycle !== 'current'))
    )
      invalid()
    return {
      ...row,
      product_id: uuid(raw.product_id),
      entitlement_version: parseAccess(raw.access, account, raw.product_id),
    }
  })
}
export type AccountWidget = Awaited<ReturnType<typeof listWidgets>>['items'][number]

export async function listUsers(account: AccountId, signal: AbortSignal) {
  const { data } = await apiFetchResponse<unknown>(accountPath(account) + '/crm-users', { signal })
  return parseObservation(data, (raw) =>
    array(raw, (value) => {
      const item = record(value)
      if (!isAmoAccountId(item.id)) invalid()
      return {
        id: item.id,
        name: text(item.name),
        is_active: boolean(item.is_active),
        is_admin: boolean(item.is_admin),
      }
    }),
  )
}

const portraitPersonRoles = ['decision_maker', 'influencer', 'billing', 'setup', 'partner'] as const

export type PortraitPerson = {
  id: string
  name: string
  phone?: string
  crm_url?: string
  roles: (typeof portraitPersonRoles)[number][]
}

function parsePortraitPerson(raw: unknown): PortraitPerson {
  const person = record(raw)
  const crmUrl = optional(person.crm_url, text)
  const phone = optional(person.phone, text)
  if (
    (crmUrl &&
      !/^https:\/\/rakurscrm\.amocrm\.ru\/contacts\/detail\/[1-9][0-9]{0,18}\/?$/.test(crmUrl)) ||
    (phone && !/^\+?[0-9(). -]*[0-9][0-9(). -]*$/.test(phone))
  )
    invalid()
  return {
    id: uuid(person.id),
    name: text(person.name),
    phone,
    crm_url: crmUrl,
    roles: array(person.roles, (role) => listedValue(role, portraitPersonRoles)),
  }
}

function parseWidgetTier(raw: unknown) {
  const tier = record(raw)
  const working = integer(tier.working, 0)
  const total = integer(tier.total, 0)
  if (working > total) invalid()
  return { working, total }
}

function parseWidgetTiers(raw: unknown) {
  const tiers = record(raw)
  return {
    free_installed: integer(tiers.free_installed, 0),
    top: parseWidgetTier(tiers.top),
    pro: parseWidgetTier(tiers.pro),
  }
}

function parsePortrait(raw: unknown) {
  const item = record(raw)
  const company = record(item.company)
  if (!isAccountId(item.account_id)) invalid()
  return {
    account_id: item.account_id,
    template_version: integer(item.template_version, 1),
    people: optional(item.people, (value) => array(value, parsePortraitPerson)) ?? [],
    widget_tiers: optional(item.widget_tiers, parseWidgetTiers),
    version: integer(item.version, 1),
    company: {
      site: optional(company.site, (value) => nullable(value, text)),
      niche_id: optional(company.niche_id, (value) => nullable(value, uuid)),
      rating: optional(company.rating, (value) => nullable(value, (rating) => integer(rating, 0))),
      work_types: optional(company.work_types, (value) => array(value, text)),
      customer_types: optional(company.customer_types, (value) => array(value, text)),
    },
    maturity_signals: array(item.maturity_signals, (value) => {
      const signal = record(value)
      return {
        id: uuid(signal.id),
        manual: optional(signal.manual, boolean),
        observed: optional(signal.observed, boolean),
        source: optional(signal.source, text),
      }
    }),
    topics: array(item.topics, (value) => {
      const topic = record(value)
      return { id: uuid(topic.id), note: text(topic.note) }
    }),
    audit_dates: array(item.audit_dates, (value) => {
      const audit = record(value)
      const day = text(audit.date)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) invalid()
      return { id: uuid(audit.id), date: day, note: nullable(audit.note, text) }
    }),
  }
}
export type Portrait = ReturnType<typeof parsePortrait>

export async function getPortrait(account: AccountId, signal: AbortSignal) {
  const { data, etag } = await apiFetchResponse<unknown>(accountPath(account) + '/portrait', {
    signal,
  })
  const portrait = parsePortrait(data)
  if (portrait.account_id !== account) invalid()
  assertETag(etag, portrait.version)
  return portrait
}

export type PortraitTemplateTopic = {
  id: string
  title: string
  prompts: string[]
  leader?: string
  market_categories?: string[]
  answer_mode?: 'note' | 'yes_no'
  warmth_steps?: string[]
}

export function parseTemplate(raw: unknown) {
  const item = record(raw)
  return {
    version: integer(item.version, 1),
    topics: array(item.topics, (value): PortraitTemplateTopic => {
      const topic = record(value)
      return {
        id: uuid(topic.id),
        title: text(topic.title),
        prompts: array(topic.prompts, text),
        leader: optional(topic.leader, text),
        market_categories: optional(topic.market_categories, (value) => array(value, text)),
        answer_mode: optional(topic.answer_mode, (value) =>
          listedValue(value, ['note', 'yes_no'] as const),
        ),
        warmth_steps: optional(topic.warmth_steps, (value) => array(value, text)),
      }
    }),
  }
}
export type PortraitTemplate = ReturnType<typeof parseTemplate>

export const templatePath = managerApi + '/portrait-template'
export async function getTemplate(signal: AbortSignal) {
  const { data, etag } = await apiFetchResponse<unknown>(templatePath, { signal })
  const template = parseTemplate(data)
  assertETag(etag, template.version)
  return template
}

export async function listNiches(cursor: string, signal: AbortSignal, search = '') {
  const query = new URLSearchParams({ limit: '100' })
  if (cursor) query.set('cursor', cursor)
  if (search) query.set('q', search)
  const { data } = await apiFetchResponse<unknown>(managerApi + '/portrait-niches?' + query, {
    signal,
  })
  return parsePage(data, (value) => {
    const item = record(value)
    return { id: uuid(item.id), name: text(item.name), version: integer(item.version, 1) }
  })
}

export type AccountCommand =
  | Readonly<{ kind: 'refresh'; account: AccountId; key: string; body: string }>
  | Readonly<{
      kind: 'profile' | 'portrait' | 'audit'
      account: AccountId
      key: string
      body: string
      version: number
    }>
  | Readonly<{
      kind: 'renewal'
      account: AccountId
      product: string
      key: string
      body: string
      version: number
    }>
  | Readonly<{ kind: 'template'; key: string; body: string; version: number }>

const suffixes = {
  refresh: '/refresh',
  profile: '/profile',
  portrait: '/portrait',
  audit: '/portrait/audit-dates',
  renewal: '/renewals',
}

export type ManagerCommand = AccountCommand | ProductCommand | WorkflowCommand

type Result =
  | { kind: 'completed'; product?: Product }
  | { kind: 'workflow-saved'; workflow: CompanyWorkflow }
  | { kind: 'rejected' }
  | { kind: 'pending'; id: string; retryAt?: number; state: string }

function parseOperation(
  data: unknown,
  retryAt: number | undefined,
  command: ManagerCommand,
  expected?: string,
): Result {
  const item = record(data)
  const id = uuid(item.id)
  if (expected && id !== expected) invalid()
  switch (item.state) {
    case 'completed':
      return { kind: 'completed' }
    case 'rejected':
      return { kind: 'rejected' }
    case 'unknown_outcome':
      return { kind: 'pending', id, retryAt, state: item.state }
    case 'platform_operation': {
      const operation = record(item.operation)
      if (
        command.kind !== 'refresh' ||
        command.account !== operation.target_id ||
        operation.kind !== 'account.refresh'
      )
        invalid()
      switch (operation.state) {
        case 'succeeded':
          return { kind: 'completed' }
        case 'failed':
        case 'needs_review':
          return { kind: 'rejected' }
        case 'accepted':
        case 'running':
        case 'waiting_external': {
          const seconds = optional(operation.retry_after_seconds, (value) => integer(value, 0))
          const deadline = seconds === undefined ? 0 : performance.now() + seconds * 1000
          return {
            kind: 'pending',
            id,
            retryAt: Math.max(retryAt ?? 0, deadline),
            state: operation.state,
          }
        }
      }
    }
  }
  invalid()
}

export async function sendAccountCommand(
  command: ManagerCommand,
  signal: AbortSignal,
): Promise<Result> {
  if (command.kind === 'company-workflow') {
    const result = await sendWorkflowCommand(command, signal)
    return result.kind === 'receipt'
      ? parseOperation(result.response.data, result.response.retryNotBefore, command)
      : result
  }
  if (command.kind === 'product-create' || command.kind === 'product-update') {
    const result = await sendProductCommand(command, signal)
    return result.kind === 'receipt'
      ? parseOperation(result.response.data, result.response.retryNotBefore, command)
      : result
  }
  const headers = new Headers({ 'Idempotency-Key': command.key })
  if ('version' in command) headers.set('If-Match', versionETag(command.version))
  const path =
    command.kind === 'template'
      ? templatePath
      : accountPath(command.account) + suffixes[command.kind]
  const method =
    command.kind === 'profile' || command.kind === 'portrait'
      ? 'PATCH'
      : command.kind === 'template'
        ? 'PUT'
        : 'POST'
  const { data, status, etag, retryNotBefore } = await apiFetchResponse<unknown>(path, {
    signal,
    method,
    headers,
    body: command.body,
  })
  if (status === 202) return parseOperation(data, retryNotBefore, command)
  const body = record(data)
  if (command.kind === 'refresh' || ('account' in command && body.account_id !== command.account))
    invalid()
  if (command.kind === 'renewal') {
    if (status !== 201 || command.product !== body.product_id) invalid()
    assertETag(etag, parseAccess(body.access, command.account, command.product))
  } else {
    if (status !== 200) invalid()
    assertETag(etag, integer(body.version, 1))
  }
  return { kind: 'completed' }
}

export async function checkAccountCommand(
  command: ManagerCommand,
  id: string,
  signal: AbortSignal,
) {
  const { data, retryNotBefore } = await apiFetchResponse<unknown>(
    managerApi + '/operations/' + uuid(id),
    { signal },
  )
  return parseOperation(data, retryNotBefore, command, id)
}
