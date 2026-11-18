import { useState } from 'react'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { BrandLogo } from '../../components/BrandLogo'
import { Panel } from './AccountPanel'
import { useAccountDraft } from './AccountDrafts'
import { dateLabel } from './fixtures'
import { findDemoClient } from './clientDirectory'
import {
  partnerDirectoryDate,
  partnerPaymentRequests,
  seedPartners,
  type Partner,
} from './partnerDirectory'
import {
  cabinetDatePlus,
  cabinetHeldBonuses,
  cabinetInstallations,
  cabinetPrice,
  cabinetProPrice,
  cabinetPromoClients,
  cabinetYearPlus,
  cancelCabinetOrder,
  completeCabinetOrder,
  createCabinetOrder,
  defaultCabinetPartner,
  requiresPartnerRequest,
  type CabinetInstall,
} from './partnerCabinetState'
import { money, today, useDemo } from './DemoSession'
import {
  PartnerCheckout,
  PartnerOrderDetails,
  PartnerProDetails,
  type CabinetQuote,
} from './PartnerCabinetCheckout'
import { PartnerCabinetHome, PartnerIcon } from './PartnerCabinetHome'
import {
  PartnerAccounts,
  PartnerCatalog,
  PartnerClients,
  PartnerNotifications,
  PartnerOperations,
  PartnerPromos,
} from './PartnerCabinetPages'
import styles from './PartnerCabinet.module.css'
import page from './ManagersPage.module.css'

export type { Partner } from './partnerDirectory'

export function usePartners() {
  return useAccountDraft<Partner[]>('/partners', seedPartners)
}

export function usePartnerPaymentRequests() {
  return useAccountDraft('/partnerPaymentRequests', partnerPaymentRequests)
}

const views = [
  ['Мои виджеты', 'установки с вашими номерами', 'widgets'],
  ['Аккаунты', 'все аккаунты с вашими виджетами, бонус TOP', 'accounts'],
  ['Мои клиенты', 'пришли по вашим промокодам · PRO', 'clients'],
  ['Промокоды', 'до 10 кодов и статистика · PRO', 'promo'],
  ['Наши виджеты', 'каталог: описание, цены, установка', 'catalog'],
  ['Уведомления', 'Telegram и Max', 'notify'],
  ['Бонусы и операции', 'начисления, скидки, счета', 'balance'],
] as const

type CabinetView = (typeof views)[number][0]
type Dialog =
  | { kind: 'pro' }
  | { kind: 'checkout'; quote: CabinetQuote }
  | { kind: 'order'; id: string }

export function PartnerEntry() {
  const { partner: requestedPartner } = useSearch({ from: '/managers' })
  const [partners] = usePartners()
  const partner =
    partners.find((entry) => entry.id === requestedPartner) ??
    partners.find((entry) => entry.id === defaultCabinetPartner)
  return partner ? <PartnerWorkspace key={partner.id} partner={partner} /> : null
}

function PartnerWorkspace({ partner }: { partner: Partner }) {
  const { state, selectActor } = useDemo()
  const { view, partnerCabinet = {} } = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const [partners, setPartners] = usePartners()
  const [requests, setRequests] = usePartnerPaymentRequests()
  const [menuOpen, setMenuOpen] = useState(() => window.innerWidth >= 1440)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(true)
  const [dialog, setDialog] = useState<Dialog>()
  const [message, setMessage] = useState('')
  const selectedPartner = partner.id
  const legacy = selectedPartner.startsWith('partner-')
  const currentView = views.find(([name]) => name === view)?.[0] ?? 'Мои виджеты'
  const asOf = legacy ? today : partnerDirectoryDate
  const pro = partner.proTill >= asOf
  const ownRequests = requests.filter((request) => request.partner === selectedPartner)
  const cabinetOptions = partners.filter(
    ({ id }) => id === selectedPartner || id === defaultCabinetPartner || id.startsWith('partner-'),
  )
  const installs = cabinetInstallations(partner, state.rows)
  const held = cabinetHeldBonuses(partner)
  const available = partner.bonus - held
  const openPro = partner.cabinetOrders?.find(
    ({ target, state }) => target === 'pro' && state === 'open',
  )
  const selectedOrder =
    dialog?.kind === 'order' &&
    partner.cabinetOrders?.find(({ id, state }) => id === dialog.id && state === 'open')
  const proQuote = {
    target: 'pro',
    title: 'PRO-кабинет на год',
    price: legacy ? 12000 : cabinetProPrice,
    until: cabinetYearPlus(pro ? partner.proTill : asOf),
  } satisfies CabinetQuote
  const counts: Partial<Record<CabinetView, number>> = {
    'Мои виджеты': installs.length,
    Аккаунты: new Set(installs.map(({ account }) => account)).size,
    'Мои клиенты':
      selectedPartner === defaultCabinetPartner
        ? cabinetPromoClients.filter(({ id }) => partner.accounts.includes(id)).length
        : partner.accounts.length,
    Промокоды: partner.promos.length,
  }

  function linkSearch(next: CabinetView, id = selectedPartner) {
    return {
      section: 'partners' as const,
      mode: 'partner' as const,
      client: undefined,
      view: next,
      partner: id,
      partnerCabinet: id === selectedPartner ? partnerCabinet : undefined,
    }
  }

  function update(apply: (current: Partner) => Partner) {
    setPartners((current) =>
      current.map((entry) => (entry.id === selectedPartner ? apply(entry) : entry)),
    )
  }

  function patch(values: Partial<Partner>) {
    update((current) => ({ ...current, ...values }))
  }

  function extendTest(install: CabinetInstall) {
    if (!partner.approved || install.tier !== 'TOP') return
    const until = cabinetDatePlus(install.until > asOf ? install.until : asOf, 7)
    update((current) => {
      const last = current.cabinetRenewals?.[install.id]
      if (
        !current.approved ||
        last?.tested ||
        current.cabinetOrders?.some(
          ({ target, state }) => target === install.id && state === 'open',
        )
      )
        return current
      return {
        ...current,
        cabinetRenewals: {
          ...current.cabinetRenewals,
          [install.id]: { until, coverage: 'тест +7 дней', paid: install.paid, tested: true },
        },
      }
    })
    setMessage(`Тест продлён до ${dateLabel(until)}`)
  }

  function requestPayment(install: CabinetInstall) {
    if (!partner.approved || !requiresPartnerRequest(install)) return
    setRequests((current) =>
      current.some(
        (entry) =>
          entry.partner === selectedPartner &&
          entry.account === install.account &&
          entry.widget === install.name,
      )
        ? current
        : [
            ...current,
            {
              id: `partner-payment-${current.length + 1}`,
              partner: selectedPartner,
              account: install.account,
              widget: install.name,
              created: asOf,
              status: 'pending',
              previousAmount: install.account === '30025824' ? 10000 : 120000,
              previousDate: install.account === '30025824' ? '2026-09-03' : '2026-11-01',
              previousSource: 'Сделка rakurscrm',
            },
          ],
    )
    setMessage('Запрос отправлен на демо-проверку')
  }

  function openCheckout(install: CabinetInstall) {
    const request = ownRequests.find(
      ({ account, widget }) => account === install.account && widget === install.name,
    )
    if (
      !partner.approved ||
      install.tier !== 'TOP' ||
      (request ? request.status !== 'allowed' : requiresPartnerRequest(install))
    )
      return
    setDialog({
      kind: 'checkout',
      quote: {
        target: install.id,
        title: `${install.name} · ${findDemoClient(install.account)?.domain ?? install.account}`,
        until: cabinetYearPlus(install.until > asOf ? install.until : asOf),
        price: cabinetPrice(install),
      },
    })
  }

  function proDetails() {
    setDialog(openPro ? { kind: 'order', id: openPro.id } : { kind: 'pro' })
  }

  function closeDialog() {
    setDialog(undefined)
  }

  return (
    <div
      className={`${page.shell} ${styles.shell}`}
      data-overview="true"
      data-partner="true"
      data-menu-open={menuOpen}
      data-mobile-open={mobileMenuOpen}
    >
      <header className={page.topbar}>
        <button
          type="button"
          className={page.mobileMenuButton}
          aria-controls="partner-nav"
          aria-expanded={mobileMenuOpen}
          aria-label="Меню партнёра"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <Link
          className={`${page.brand} ${styles.brand}`}
          to="/login"
          search={{ next: undefined }}
          aria-label="Ракурс — сменить кабинет"
        >
          <BrandLogo /> Ракурс
        </Link>
        <span className={page.product}>Сервер виджетов</span>
        <div className={`${page.profile} ${styles.accountProfile}`}>
          <span>Вы вошли как</span>
          <label className={styles.accountSelect}>
            <select
              aria-label="Демо-партнёр"
              value={selectedPartner}
              onChange={(event) => {
                void navigate({ search: linkSearch(currentView, event.target.value) })
              }}
            >
              {cabinetOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <span>· партнёр</span>
          </label>
          <Link
            to="/managers"
            className={styles.loginLink}
            search={{ section: 'partners', client: undefined }}
            onClick={() => selectActor('max')}
          >
            Войти как Максим · админ (демо)
          </Link>
        </div>
        <span className={page.demoServer} title="Статус в демо-данных">
          w.rkrs.ru · работает
        </span>
      </header>
      <aside id="partner-nav" className={page.sidebar}>
        <button
          type="button"
          className={page.menuButton}
          onClick={() => setMenuOpen((open) => !open)}
          aria-controls="partner-views"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Свернуть меню' : 'Развернуть меню'}
        >
          <span aria-hidden="true">{menuOpen ? '‹' : '›'}</span>
          {menuOpen ? 'Свернуть меню' : null}
        </button>
        <nav id="partner-views" className={page.menu} aria-label="Разделы партнёра">
          {views.map(([name, hint, icon]) => (
            <Link
              key={name}
              to="/managers"
              search={linkSearch(name)}
              aria-label={name}
              title={name}
              aria-current={currentView === name ? 'page' : undefined}
              onClick={() => setMessage('')}
            >
              <PartnerIcon name={icon} />
              <span className={page.menuLabel}>
                {name}
                <small>{hint}</small>
              </span>
              {counts[name] !== undefined ? (
                <span className={page.menuCount} aria-hidden="true">
                  {counts[name]}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className={styles.department}>
          <strong>Партнёрский отдел</strong>
          <a href="tel:+79214377886">+7 (921) 437-78-86</a>
          <span>
            <a href="https://t.me/+79214377886" target="_blank" rel="noreferrer">
              Telegram
            </a>{' '}
            ·{' '}
            <a
              href="https://max.ru/u/f9LHodD0cOKGsdNZ1wo62jq1Vc9g9x8nEG5LqNwpXJVaDLosI7e00Zfh9lU"
              target="_blank"
              rel="noreferrer"
            >
              Max
            </a>
          </span>
        </div>
      </aside>
      <main className={page.main}>
        <div className={page.demo}>
          Демо-данные: виджеты, компании, партнёры, люди и телефоны выдуманы. Правки и кнопки
          работают только в этой вкладке и ничего не сохраняют.
        </div>
        <section className={styles.probar} data-active={pro} aria-label="Тариф кабинета">
          <span className={styles.plan}>{pro ? 'PRO' : 'Простой кабинет'}</span>
          <span>
            {pro ? (
              <>
                {partner.proTrial ? 'Тестовый PRO' : 'PRO-кабинет'} до{' '}
                <b>{dateLabel(partner.proTill)}</b>
              </>
            ) : partner.proTill ? (
              `PRO закончился ${dateLabel(partner.proTill)} — промокоды сейчас не работают`
            ) : (
              'Контакты администраторов, данные amoCRM, промокоды и «Мои клиенты» — в PRO'
            )}
          </span>
          <div className={styles.proActions}>
            <button
              type="button"
              className={styles.help}
              aria-label="Что даёт PRO"
              onClick={() => setDialog({ kind: 'pro' })}
            >
              ?
            </button>
            <button type="button" data-variant="primary" onClick={proDetails}>
              {openPro
                ? 'Открыть демо-оплату PRO'
                : pro
                  ? 'Продлить PRO'
                  : `Подключить PRO — ${money(proQuote.price)}/год`}
            </button>
          </div>
        </section>
        {message ? (
          <p className={styles.message} role="status">
            {message}
          </p>
        ) : null}

        {currentView === 'Мои виджеты' ? (
          <>
            <PartnerCabinetHome
              partner={partner}
              installs={installs}
              held={held}
              filters={partnerCabinet}
              setFilters={(filters) =>
                void navigate({
                  replace: true,
                  search: (previous) => ({ ...previous, partnerCabinet: filters }),
                })
              }
              requests={ownRequests}
              operationLink={
                <Link
                  className={styles.outlineLink}
                  to="/managers"
                  search={linkSearch('Бонусы и операции')}
                >
                  Операции
                </Link>
              }
              accountsLink={
                <Link to="/managers" search={linkSearch('Аккаунты')}>
                  «Аккаунты»
                </Link>
              }
              onTest={extendTest}
              onPay={openCheckout}
              onRequest={requestPayment}
              onReview={({ id }) => setDialog({ kind: 'order', id })}
            />
            {legacy ? (
              <Panel title="Доступ TOP">
                <p>
                  {partner.approved ? 'Заявка одобрена' : partner.request || 'Заявка не подана'}
                </p>
                {!partner.approved ? (
                  <button
                    type="button"
                    disabled={!!partner.request}
                    onClick={() => {
                      patch({ request: 'Доступ TOP' })
                      setMessage('Заявка отправлена на демо-проверку')
                    }}
                  >
                    Запросить доступ TOP
                  </button>
                ) : null}
              </Panel>
            ) : null}
          </>
        ) : null}
        {currentView === 'Аккаунты' ? (
          <PartnerAccounts installs={installs} active={pro} details={proDetails} />
        ) : null}
        {currentView === 'Мои клиенты' ? (
          <PartnerClients partner={partner} active={pro} details={proDetails} />
        ) : null}
        {currentView === 'Промокоды' ? (
          <PartnerPromos
            partner={partner}
            active={pro}
            canCreate={(code) => !partners.some((entry) => entry.promos.includes(code))}
            add={(code) =>
              setPartners((current) =>
                current.some((entry) => entry.promos.includes(code))
                  ? current
                  : current.map((entry) =>
                      entry.id === selectedPartner && entry.promos.length < 10
                        ? { ...entry, promos: [...entry.promos, code] }
                        : entry,
                    ),
              )
            }
            toggle={(code) =>
              update((current) => ({
                ...current,
                inactivePromos: current.inactivePromos?.includes(code)
                  ? current.inactivePromos.filter((value) => value !== code)
                  : [...(current.inactivePromos ?? []), code],
              }))
            }
          />
        ) : null}
        {currentView === 'Наши виджеты' ? <PartnerCatalog /> : null}
        {currentView === 'Уведомления' ? (
          <PartnerNotifications
            partner={partner}
            active={pro}
            requests={ownRequests}
            update={patch}
          />
        ) : null}
        {currentView === 'Бонусы и операции' ? (
          <PartnerOperations
            partner={partner}
            available={available}
            held={held}
            active={pro}
            details={proDetails}
            review={({ id }) => setDialog({ kind: 'order', id })}
            legacyPro={
              legacy
                ? () => {
                    if (available < proQuote.price) return
                    update((current) =>
                      createCabinetOrder(
                        current,
                        { ...proQuote, method: 'invoice', bonus: proQuote.price },
                        asOf,
                      ),
                    )
                    setMessage('PRO продлён в демо')
                  }
                : undefined
            }
          />
        ) : null}
      </main>
      {dialog?.kind === 'pro' ? (
        <PartnerProDetails
          active={pro}
          price={proQuote.price}
          available={available}
          canTry={!pro && !partner.proTrial && !partner.proTrialUsed && !openPro}
          until={proQuote.until}
          close={closeDialog}
          trial={() => {
            const proTill = cabinetDatePlus(asOf, 14)
            update((current) =>
              current.proTill >= asOf ||
              current.proTrialUsed ||
              current.proTrial ||
              current.cabinetOrders?.some(
                ({ target, state }) => target === 'pro' && state === 'open',
              )
                ? current
                : { ...current, proTill, proTrial: true, proTrialUsed: true },
            )
            setMessage(`Пробный PRO включён до ${dateLabel(proTill)}`)
            closeDialog()
          }}
          buy={() =>
            setDialog(
              openPro ? { kind: 'order', id: openPro.id } : { kind: 'checkout', quote: proQuote },
            )
          }
        />
      ) : null}
      {dialog?.kind === 'checkout' ? (
        <PartnerCheckout
          quote={dialog.quote}
          available={available}
          close={closeDialog}
          submit={(bonus, method) => {
            const { quote } = dialog
            update((current) => createCabinetOrder(current, { ...quote, bonus, method }, asOf))
            setMessage(
              bonus === quote.price
                ? `Оплачено бонусами до ${dateLabel(quote.until)}`
                : 'Демо-оплата создана. Откройте её в «Бонусах и операциях».',
            )
            closeDialog()
          }}
        />
      ) : null}
      {selectedOrder ? (
        <PartnerOrderDetails
          order={selectedOrder}
          close={closeDialog}
          cancel={() => {
            update((current) => cancelCabinetOrder(current, selectedOrder.id))
            setMessage('Демо-оплата отменена, бонусы снова доступны')
            closeDialog()
          }}
          settle={() => {
            update((current) => completeCabinetOrder(current, selectedOrder.id, asOf))
            setMessage(`Демо-оплата подтверждена до ${dateLabel(selectedOrder.until)}`)
            closeDialog()
          }}
        />
      ) : null}
    </div>
  )
}
