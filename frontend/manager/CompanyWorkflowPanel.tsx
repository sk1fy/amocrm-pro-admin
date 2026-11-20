import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createRequestKey } from '../src/features/operations/intents'
import { formatTime } from '../src/lib/format'
import { CommandFeedback, useAccountCommand, VersionConflict } from './accountCommands'
import { ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { getCompanyWorkflow, getWorkflowMetadata, type CompanyWorkflow } from './companyApi'
import { CompanySource } from './CompanySource'
import styles from './Accounts.module.css'
import dialogStyles from './InstallationsPage.module.css'

export function InstallationDealSettings(access: AccountAccess) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
        }}
      >
        Настройка сделок
      </button>
      <dialog
        ref={dialog}
        className={dialogStyles.settingsDialog}
        aria-labelledby={title}
        onClose={() => setOpen(false)}
      >
        <div className={dialogStyles.heading}>
          <h2 id={title}>Настройка сделок</h2>
          <button type="button" onClick={() => dialog.current?.close()}>
            Закрыть
          </button>
        </div>
        {open ? <CompanyWorkflowPanel {...access} /> : null}
      </dialog>
    </>
  )
}

function CompanyWorkflowPanel(access: AccountAccess) {
  const workflow = useQuery({
    queryKey: ['managers', 'company-workflow', access.scope],
    queryFn: ({ signal }) => getCompanyWorkflow(signal),
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
  const attempt = useAccountCommand('installation-deal-settings', {
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
  const sameSource =
    !config ||
    (config.source_account_id === meta?.source.source_account_id &&
      config.binding_revision === meta.source.binding_revision)
  const ready =
    !workflow.isError &&
    !metadata.isError &&
    sameSource &&
    meta?.source.state === 'fresh' &&
    meta.source.complete &&
    meta.generation_id !== null &&
    meta.pipelines !== null
  const invalidSelection = Boolean((fields.pipeline && !pipeline) || (fields.stage && !stage))
  return (
    <div>
      <p>Настройка применяется ко всем новым сделкам по установкам наших виджетов в rakurscrm.</p>
      {workflow.isPending ? (
        <p role="status">Загружаем настройку…</p>
      ) : workflow.isError ? (
        <ReadFailure error={workflow.error} retry={refresh} />
      ) : (
        <>
          {config ? (
            <p className={styles.meta}>Последнее сохранение {formatTime(config.validated_at)}.</p>
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
      {!sameSource && meta ? (
        <p role="alert">Подключение amoCRM изменилось. Обновите данные, чтобы продолжить.</p>
      ) : null}
      {invalidSelection && ready ? (
        <p role="alert">
          Выбранная воронка или этап отсутствует в текущем снимке. Выберите подтверждённые значения.
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
        <fieldset
          aria-label="Место создания сделки"
          disabled={attempt.locked || !workflow.data || !ready}
          className={styles.fields}
        >
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
              disabled={!pipeline}
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
        <div className={dialogStyles.dialogActions}>
          <button type="button" onClick={refresh}>
            Обновить данные
          </button>
          <button
            className={dialogStyles.saveSettings}
            disabled={
              attempt.locked ||
              state.kind === 'conflict' ||
              !ready ||
              !stage ||
              !workflow.data ||
              !draft
            }
          >
            Сохранить настройку
          </button>
        </div>
      </form>
      <VersionConflict command={attempt} version={workflow.data?.version ?? 0} latest={initial}>
        <p>Проверьте текущий источник и значения перед применением черновика.</p>
      </VersionConflict>
      <CommandFeedback command={attempt} />
    </div>
  )
}
