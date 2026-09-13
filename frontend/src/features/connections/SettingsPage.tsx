import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useRouteParams } from '../../app/hooks'
import { fetchBackends, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import page from '../../components/page.module.css'
import { ActivitySettingsPage } from './modules/activity/ActivitySettingsPage'
import { resolveConnectionModule } from './modules/registry'

export function SettingsPage() {
  const { accountId, backend, connectionId } = useRouteParams<{
    accountId: string
    backend: string
    connectionId: string
  }>()
  const registry = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })

  if (registry.isPending) {
    return <div className={page.skeleton} />
  }
  if (registry.error) {
    return <ErrorState error={registry.error} onRetry={() => void registry.refetch()} />
  }
  if (resolveConnectionModule(backend, registry.data?.items).kind === 'activity') {
    return <ActivitySettingsPage />
  }
  return (
    <div className={page.page}>
      <p>
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId"
          params={{ accountId, backend, connectionId }}
        >
          Назад к подключению
        </Link>
      </p>
      <h2>Настройки модуля</h2>
      <EmptyState
        title="Настройки недоступны"
        description="Для этого модуля настройки недоступны."
      />
    </div>
  )
}
