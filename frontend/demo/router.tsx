import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { ManagersPage } from '../src/features/managers/ManagersPage'
import { managersSearch } from '../src/features/managers/sections'
import { DemoLoginPage } from './DemoLoginPage'

const rootRoute = createRootRoute({ component: Outlet })
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/login' })
  },
})
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: DemoLoginPage,
})
const managersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/managers',
  validateSearch: managersSearch,
  component: ManagersPage,
})
export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, loginRoute, managersRoute]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
