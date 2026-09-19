import { backendIntervals, visibleInterval } from '../../api/queryClient'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { fetchAdminOperation, fetchConnection, keys } from '../../api/queries'
import type { AdminOperation } from '../../api/types'
import { CopyableId } from '../../components/CopyableId'
import { ErrorState } from '../../components/ErrorState'
import page from '../../components/page.module.css'
import { CommandAction } from './CommandAction'
import { connectionCommand, operationPending } from './commands'
import { OperationView } from './OperationView'
import { OperationsNav } from './OperationsNav'

function OperationTarget({ operation }: { operation: AdminOperation }) {
  const connection = useQuery({
    queryKey: keys.connection(operation.backend, operation.target_id),
    queryFn: () => fetchConnection(operation.backend, operation.target_id),
    enabled: operation.target_type === 'installation',
  })
  const accountId = connection.data?.connection.data?.account_id
  if (operation.target_type === 'integration') {
    const id =
      operation.target_id === 'new' && typeof operation.result.integration_id === 'string'
        ? operation.result.integration_id
        : operation.target_id
    return id !== 'new' ? (
      <Link
        to="/widgets/$backend/$integrationId"
        params={{ backend: operation.backend, integrationId: id }}
      >
        Открыть интеграцию и проверить состояние
      </Link>
    ) : (
      <Link to="/widgets">Проверить список интеграций</Link>
    )
  }
  if (accountId)
    return (
      <Link
        to="/accounts/$accountId/widgets/$backend/$connectionId"
        params={{ accountId, backend: operation.backend, connectionId: operation.target_id }}
      >
        Открыть подключение и проверить состояние
      </Link>
    )
  if (connection.error)
    return <ErrorState error={connection.error} onRetry={() => void connection.refetch()} />
  return (
    <Link to="/operations" search={{ backend: operation.backend }}>
      Проверить задачи бекенда
    </Link>
  )
}

export function OperationPage() {
  const { operationId } = useRouteParams<{ operationId: string }>()
  const query = useQuery({
    queryKey: keys.adminOperation(operationId),
    queryFn: () => fetchAdminOperation(operationId),
    refetchInterval: (query) =>
      operationPending(query.state.data?.operation.state)
        ? visibleInterval(backendIntervals.operation)
        : visibleInterval(backendIntervals.detail),
  })
  const operation = query.data?.operation
  return (
    <div className={page.page}>
      <h1>Операция {operationId}</h1>
      <OperationsNav />
      {query.isPending ? <div className={page.skeleton} /> : null}
      {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {operation ? (
        <>
          <p className={page.row}>
            {operation.command} · {operation.backend} · {operation.target_type}{' '}
            <CopyableId value={operation.target_id} label="объекта" />
          </p>
          <p>
            <CopyableId value={operation.id} label="операции" />
          </p>
          <OperationView operation={operation} link={false} />
          <OperationTarget operation={operation} />
          <button type="button" onClick={() => void query.refetch()}>
            Обновить результат
          </button>
          {operation.state === 'partial' &&
          operation.target_type === 'installation' &&
          operation.command === 'uninstall' ? (
            <CommandAction
              spec={{
                ...connectionCommand(operation.backend, operation.target_id, 'uninstall'),
                label: 'Повторить удаление',
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
