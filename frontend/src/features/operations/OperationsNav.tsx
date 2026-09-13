import { Link, useRouterState } from '@tanstack/react-router'
import page from '../../components/page.module.css'

export function OperationsNav() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  return (
    <nav className={page.tabs} aria-label="Виды операций">
      <Link
        to="/operations"
        className={path === '/operations' ? `${page.tab} ${page.tabActive}` : page.tab}
      >
        Задачи бекендов
      </Link>
      <Link
        to="/operations/admin"
        className={
          path.startsWith('/operations/admin') ? `${page.tab} ${page.tabActive}` : page.tab
        }
      >
        Команды сотрудников
      </Link>
    </nav>
  )
}
