import { useEffect } from 'react'
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isUnauthorized, setUnauthorizedHandler } from '../api/client'
import { fetchMe, keys } from '../api/queries'
import { AppLayout } from './layout'
import { LoginPage } from '../features/auth/LoginPage'
import { OverviewPage } from '../features/overview/OverviewPage'
import { AccountsPage } from '../features/accounts/AccountsPage'
import { AccountLayout } from '../features/accounts/AccountLayout'
import { AccountOverview } from '../features/accounts/AccountOverview'
import { AccountWidgets } from '../features/accounts/AccountWidgets'
import { ConnectionPage } from '../features/connections/ConnectionPage'
import { AccountOperationsPage } from '../features/operations/AccountOperationsPage'
import { AccountHistoryPage } from '../features/operations/AccountHistoryPage'
import { OperationsPage } from '../features/operations/OperationsPage'
import { AdminOperationsPage } from '../features/operations/AdminOperationsPage'
import { OperationPage } from '../features/operations/OperationPage'
import { WidgetsPage } from '../features/integrations/WidgetsPage'
import { IntegrationPage } from '../features/integrations/IntegrationPage'
import { SystemPage } from '../features/system/SystemPage'
import { EmployeesPage } from '../features/system/EmployeesPage'
import { SessionsPage } from '../features/system/SessionsPage'
import { AuditPage } from '../features/system/AuditPage'
import { accountsSearch, cursorSearch } from './search'
import { clearSession } from './session'

export type RouterContext = {
  queryClient: QueryClient
}

function RootComponent() {
  const router = useRouter()
  const queryClient = useQueryClient()
  useEffect(() => {
    setUnauthorizedHandler((next) => {
      if (router.state.location.pathname === '/login') {
        return
      }
      clearSession(queryClient)
      void router.navigate({ to: '/login', search: { next } })
    })
    return () => setUnauthorizedHandler(null)
  }, [router, queryClient])
  return <Outlet />
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: ({ error }) => (
    <pre role="alert">{error instanceof Error ? error.message : String(error)}</pre>
  ),
  beforeLoad: async ({ location, context }) => {
    if (location.pathname === '/login') {
      return
    }
    const next = `${location.pathname}${location.searchStr}`
    if (!context.queryClient) {
      return redirect({ to: '/login', search: { next } })
    }
    try {
      await context.queryClient.ensureQueryData({ queryKey: keys.me, queryFn: fetchMe })
    } catch (error) {
      if (isUnauthorized(error)) {
        clearSession(context.queryClient)
        return redirect({ to: '/login', search: { next } })
      }
      throw error
    }
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === 'string' ? search.next : undefined,
  }),
  component: LoginPage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authenticated',
  component: AppLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: OverviewPage,
})

const accountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/accounts',
  validateSearch: accountsSearch,
  component: AccountsPage,
})

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/accounts/$accountId',
  component: AccountLayout,
})

const accountIndexRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/',
  component: AccountOverview,
})

const accountWidgetsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: 'widgets',
  component: AccountWidgets,
})

const connectionRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: 'widgets/$backend/$connectionId',
  component: ConnectionPage,
})

const accountOperationsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: 'operations',
  validateSearch: cursorSearch,
  component: AccountOperationsPage,
})

const accountHistoryRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: 'history',
  validateSearch: cursorSearch,
  component: AccountHistoryPage,
})

const widgetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/widgets',
  validateSearch: cursorSearch,
  component: WidgetsPage,
})

const integrationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/widgets/$backend/$integrationId',
  component: IntegrationPage,
})

const operationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/operations',
  validateSearch: cursorSearch,
  component: OperationsPage,
})

const adminOperationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/operations/admin',
  validateSearch: cursorSearch,
  component: AdminOperationsPage,
})
const adminOperationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/operations/admin/$operationId',
  component: OperationPage,
})

const systemRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/system',
  component: SystemPage,
})

const employeesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/system/employees',
  component: EmployeesPage,
})

const sessionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/system/sessions',
  component: SessionsPage,
})

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/system/audit',
  validateSearch: cursorSearch,
  component: AuditPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    accountsRoute,
    accountRoute.addChildren([
      accountIndexRoute,
      accountWidgetsRoute,
      connectionRoute,
      accountOperationsRoute,
      accountHistoryRoute,
    ]),
    widgetsRoute,
    integrationRoute,
    operationsRoute,
    adminOperationsRoute,
    adminOperationRoute,
    systemRoute,
    employeesRoute,
    sessionsRoute,
    auditRoute,
  ]),
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
