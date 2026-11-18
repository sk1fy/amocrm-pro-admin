import { useQuery } from '@tanstack/react-query'
import { createRequestKey } from '../src/features/operations/intents'
import { formatTime } from '../src/lib/format'
import { CommandFeedback, useAccountCommand, VersionConflict } from './accountCommands'
import { ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { getCompanyWorkflow, getWorkflowMetadata, type CompanyWorkflow } from './companyApi'
import { CompanySource } from './CompanySource'
import type { ProductId } from './productsApi'
import styles from './Accounts.module.css'

export function CompanyWorkflowPanel({
  productId,
  ...access
}: AccountAccess & { productId: ProductId }) {
  const workflow = useQuery({
    queryKey: ['managers', 'company-workflow', access.scope, productId],
    queryFn: ({ signal }) => getCompanyWorkflow(productId, signal),
    retry: false,
  })
  const metadata = useQuery({
    queryKey: ['managers', 'company-workflow-metadata', access.scope],
    queryFn: ({ signal }) => getWorkflowMetadata(signal),
    retry: false,
  })
  useAccountAccessError(workflow.error, access.onExpired, access.onForbidden)
  useAccountAccessError(metadata.error, access.onExpired, access.onForbidden)
  const refresh = () => {
    void workflow.refetch()
    void metadata.refetch()
  }
  const saved = (_value: CompanyWorkflow) => refresh()
  const attempt = useAccountCommand('company-workflow:' + productId, {
    ...access,
    onSaved: refresh,
    onWorkflowSaved: saved,
  })
  const config = workflow.data?.configuration
  const initial = { pipeline: config?.pipeline_id ?? '', stage: config?.initial_stage_id ?? '' }
  const { draft, state } = attempt.entry,
    fields = draft?.values ?? initial
  const meta = metadata.data
  const pipeline = meta?.pipelines?.find((p) => p.id === fields.pipeline)
  const stage = pipeline?.stages.find((s) => s.id === fields.stage)
  const ready =
    meta?.source.state === 'fresh' &&
    meta.source.complete &&
    meta.generation_id !== null &&
    meta.pipelines !== null
  const invalidSelection = Boolean((fields.pipeline && !pipeline) || (fields.stage && !stage))
  return (
    <section className={styles.panel} aria-label="CRM workflow">
      <h2>Воронка и начальный этап CRM</h2>
      <p>Сохранённая настройка виджета. Создание сделок пока не включено.</p>
      {workflow.isPending ? (
        <p role="status">Загружаем настройку…</p>
      ) : workflow.isError ? (
        <ReadFailure error={workflow.error} retry={refresh} />
      ) : (
        <>
          <p className={styles.meta}>
            Версия настройки: {workflow.data.version}. Версия карточки виджета независима.
          </p>
          {config ? (
            <p>
              Сохранены воронка {config.pipeline_id}, этап {config.initial_stage_id}. Проверено{' '}
              {formatTime(config.validated_at)}.
            </p>
          ) : (
            <p>Настройка ещё не сохранена.</p>
          )}
        </>
      )}
      {metadata.isPending ? (
        <p role="status">Загружаем воронки…</p>
      ) : metadata.isError ? (
        <ReadFailure error={metadata.error} retry={refresh} />
      ) : (
        <CompanySource source={metadata.data.source} />
      )}
      {meta?.pipelines === null ? (
        <p>Полного снимка воронок пока нет.</p>
      ) : meta?.pipelines.length === 0 ? (
        <p>В полном снимке нет воронок.</p>
      ) : null}
      {invalidSelection ? (
        <p role="alert">
          Выбранная воронка или этап отсутствует в текущем снимке. Черновик сохранён: выберите
          подтверждённые значения.
        </p>
      ) : null}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          if (
            !workflow.data ||
            !meta ||
            !ready ||
            !stage ||
            !meta.source.source_account_id ||
            !meta.source.binding_revision
          )
            return
          attempt.start({
            kind: 'company-workflow',
            product: productId,
            key: createRequestKey(),
            version: draft?.base ?? workflow.data.version,
            body: JSON.stringify({
              source_account_id: meta.source.source_account_id,
              binding_revision: meta.source.binding_revision,
              metadata_generation_id: meta.generation_id,
              pipeline_id: fields.pipeline,
              initial_stage_id: fields.stage,
            }),
          })
        }}
      >
        <fieldset disabled={attempt.locked || !workflow.data || !ready} className={styles.fields}>
          <legend>Настройка CRM для виджета {productId}</legend>
          <label>
            Воронка
            <select
              value={fields.pipeline}
              onChange={(e) => {
                attempt.edit('pipeline', e.target.value, initial, workflow.data?.version ?? 1)
                attempt.edit('stage', '', initial, workflow.data?.version ?? 1)
              }}
            >
              <option value="">Выберите воронку</option>
              {fields.pipeline && !pipeline ? (
                <option value={fields.pipeline}>Недоступная воронка {fields.pipeline}</option>
              ) : null}
              {meta?.pipelines?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Начальный этап
            <select
              value={fields.stage}
              onChange={(e) =>
                attempt.edit('stage', e.target.value, initial, workflow.data?.version ?? 1)
              }
            >
              <option value="">Выберите этап</option>
              {fields.stage && !stage ? (
                <option value={fields.stage}>Недоступный этап {fields.stage}</option>
              ) : null}
              {pipeline?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.id}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <button
          disabled={
            attempt.locked ||
            state.kind === 'conflict' ||
            !ready ||
            !stage ||
            !workflow.data ||
            !draft
          }
        >
          Сохранить настройку CRM
        </button>
        <button type="button" onClick={refresh}>
          Обновить настройку и метаданные
        </button>
      </form>
      <VersionConflict command={attempt} version={workflow.data?.version ?? 0} latest={initial}>
        <p>Проверьте текущий источник и значения перед применением черновика.</p>
      </VersionConflict>
      <CommandFeedback command={attempt} />
    </section>
  )
}
