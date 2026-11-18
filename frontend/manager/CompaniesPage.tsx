import { useQuery } from '@tanstack/react-query'
import { StatusBadge } from '../src/components/StatusBadge'
import { accountSearch, ManagerLink } from './accountsLocation'
import {
  AccountsPage,
  ReadFailure,
  useAccountAccessError,
  type AccountAccess,
} from './AccountsPage'
import { getCompany, isCompanyProjectionId, listCompanies, type CompanySummary } from './companyApi'
import { CompanySource } from './CompanySource'
import styles from './Accounts.module.css'

function companySearch(search: string, updates: Record<string, string | null>) {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  params.set('section', 'clients')
  params.set('clients_tab', 'companies')
  params.delete('account')
  return params.toString()
}
export function ClientsPage(
  props: AccountAccess & { search: string; navigate: (search: string) => void },
) {
  const params = new URLSearchParams(props.search),
    companies = params.get('clients_tab') === 'companies' || params.has('company')
  const accounts = new URLSearchParams(props.search)
  accounts.set('clients_tab', 'accounts')
  accounts.delete('company')
  return (
    <>
      <nav className={styles.tabs} aria-label="Вид клиентов">
        <ManagerLink search={accounts.toString()} navigate={props.navigate} current={!companies}>
          Аккаунты
        </ManagerLink>
        <ManagerLink
          search={companySearch(props.search, { company: null })}
          navigate={props.navigate}
          current={companies}
        >
          Компании
        </ManagerLink>
      </nav>
      {companies ? <CompaniesPage {...props} /> : <AccountsPage {...props} />}
    </>
  )
}
function CompanyIdentity({
  company,
  search,
  navigate,
}: {
  company: CompanySummary
  search: string
  navigate: (search: string) => void
}) {
  return (
    <>
      <p>CRM ID компании: {company.crm_company_id}</p>
      <p>
        ID аккаунтов клиента:{' '}
        {company.customer_account_ids.length ? company.customer_account_ids.join(', ') : '—'}
      </p>
      <p>
        <StatusBadge domain="company_claims" state={company.source_resolution} calm /> ·{' '}
        <StatusBadge domain="company_runtime" state={company.runtime_resolution} calm />
      </p>
      {company.runtime_accounts.length ? (
        <ul>
          {company.runtime_accounts.map((link) => (
            <li key={link.account_id}>
              <ManagerLink search={accountSearch(search, link.account_id)} navigate={navigate}>
                Аккаунт {link.customer_account_id}
              </ManagerLink>
            </li>
          ))}
        </ul>
      ) : (
        <p>Подтверждённых доступных аккаунтов для перехода нет.</p>
      )}
    </>
  )
}
function CompaniesPage({
  search,
  navigate,
  ...access
}: AccountAccess & { search: string; navigate: (search: string) => void }) {
  const params = new URLSearchParams(search),
    selected = params.get('company'),
    id = isCompanyProjectionId(selected) ? selected : null
  const query = new URLSearchParams()
  for (const key of ['q', 'cursor', 'limit']) {
    const value = params.get('companies_' + key)
    if (value) query.set(key, value)
  }
  const queryString = query.toString()
  const page = useQuery({
    queryKey: ['managers', 'companies', access.scope, queryString],
    queryFn: ({ signal }) => listCompanies(queryString, signal),
    enabled: !selected,
    retry: false,
  })
  const detail = useQuery({
    queryKey: ['managers', 'company', access.scope, id],
    queryFn: ({ signal }) => {
      if (!id) throw new Error('company missing')
      return getCompany(id, signal)
    },
    enabled: Boolean(id),
    retry: false,
  })
  useAccountAccessError(page.error, access.onExpired, access.onForbidden)
  useAccountAccessError(detail.error, access.onExpired, access.onForbidden)
  if (selected)
    return (
      <section className={styles.workspace}>
        <ManagerLink search={companySearch(search, { company: null })} navigate={navigate}>
          Все компании
        </ManagerLink>
        {!id ? (
          <p role="alert">Некорректный UUID проекции компании.</p>
        ) : detail.isPending ? (
          <p role="status">Загружаем компанию…</p>
        ) : detail.isError ? (
          <ReadFailure error={detail.error} retry={() => void detail.refetch()} />
        ) : (
          <>
            <h1>{detail.data.name}</h1>
            <CompanySource source={detail.data.source} />
            <CompanyIdentity company={detail.data} search={search} navigate={navigate} />
            <section className={styles.panel}>
              <h2>Контакты</h2>
              {detail.data.contacts.length === 0 ? (
                <p>В снимке нет связанных контактов.</p>
              ) : (
                detail.data.contacts.map((contact) => (
                  <article key={contact.id}>
                    <h3>{contact.name}</h3>
                    <p>CRM ID: {contact.id}</p>
                    <ul>
                      {contact.companies.map((link) => (
                        <li key={link.crm_company_id}>
                          {link.company_id ? (
                            <ManagerLink
                              search={companySearch(search, { company: link.company_id })}
                              navigate={navigate}
                            >
                              Компания CRM {link.crm_company_id}
                            </ManagerLink>
                          ) : (
                            <>Неразрешённая связь: CRM {link.crm_company_id}</>
                          )}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))
              )}
              <h3>Неразрешённые связи</h3>
              {detail.data.unresolved_relations.length ? (
                <ul>
                  {detail.data.unresolved_relations.map((link, index) => (
                    <li key={link.crm_company_id + ':' + index}>
                      Компания CRM {link.crm_company_id}; проекция отсутствует.
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Неразрешённых связей в снимке нет.</p>
              )}
            </section>
          </>
        )}
      </section>
    )
  return (
    <section className={styles.workspace}>
      <h1>Компании</h1>
      <form
        className={styles.form}
        key={queryString}
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          navigate(
            companySearch(search, {
              companies_q: String(form.get('q') ?? ''),
              companies_cursor: null,
            }),
          )
        }}
      >
        <label>
          Поиск компаний
          <input name="q" type="search" defaultValue={query.get('q') ?? ''} />
        </label>
        <button>Найти компанию</button>
      </form>
      {page.isPending ? (
        <p role="status">Загружаем компании…</p>
      ) : page.isError ? (
        <>
          <ReadFailure error={page.error} retry={() => void page.refetch()} />
          {query.has('cursor') ? (
            <button onClick={() => navigate(companySearch(search, { companies_cursor: null }))}>
              Первая страница
            </button>
          ) : null}
        </>
      ) : (
        <>
          <CompanySource source={page.data.source} />
          {page.data.items === null ? (
            <p>Полного снимка компаний пока нет.</p>
          ) : page.data.items.length === 0 ? (
            <p>В полном снимке компании не найдены.</p>
          ) : (
            <div className={styles.results}>
              {page.data.items.map((company) => (
                <article className={styles.panel} key={company.id}>
                  <h2>
                    <ManagerLink
                      search={companySearch(search, { company: company.id })}
                      navigate={navigate}
                    >
                      {company.name}
                    </ManagerLink>
                  </h2>
                  <CompanyIdentity company={company} search={search} navigate={navigate} />
                </article>
              ))}
            </div>
          )}
          <div className={styles.actions}>
            {query.has('cursor') ? (
              <button onClick={() => navigate(companySearch(search, { companies_cursor: null }))}>
                Первая страница
              </button>
            ) : null}
            {page.data.next_cursor ? (
              <button
                onClick={() =>
                  navigate(companySearch(search, { companies_cursor: page.data.next_cursor }))
                }
              >
                Следующая страница
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
