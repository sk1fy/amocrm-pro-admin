import { useState } from 'react'
import { CommandFeedback, useAccountCommand, VersionConflict } from './accountCommands'
import type { AccountAccess } from './AccountsPage'
import { isUUID } from './installationsApi'
import type { Product } from './productsApi'
import styles from './Accounts.module.css'

function valuesOf(p?: Product) {
  return {
    code: p?.code ?? '',
    display_name: p?.display_name ?? '',
    line: p?.line ?? 'FREE',
    availability: p?.availability ?? 'draft',
    tariff_version: p?.tariff_version?.toString() ?? '',
    trial: p
      ? p.trial_policy.kind === 'once'
        ? String(p.trial_policy.duration_days)
        : p.trial_policy.kind
      : 'none',
    links: p?.links.map((l) => l.label + ' | ' + l.url).join('\n') ?? '',
    integration_refs: p?.integration_refs.join('\n') ?? '',
  }
}
function validLink(link: { label: string; url: string }) {
  try {
    const parsed = new URL(link.url)
    return (
      !parsed.username &&
      !parsed.password &&
      Boolean(link.label) &&
      link.label.length <= 200 &&
      link.url.length <= 2048 &&
      ['http:', 'https:'].includes(parsed.protocol)
    )
  } catch {
    return false
  }
}

export function ProductEditor({
  product,
  onSaved,
  ...access
}: AccountAccess & { product?: Product; onSaved: (product?: Product) => void }) {
  const initial = valuesOf(product)
  const [error, setError] = useState('')
  const attempt = useAccountCommand('product:' + (product?.id ?? 'new'), { ...access, onSaved })
  const { draft, state } = attempt.entry
  const fields = draft?.values ?? initial
  const edit = (name: string, value: string) =>
    attempt.edit(name, value, initial, product?.version ?? 0)
  return (
    <section className={styles.panel} aria-label="Редактор виджета">
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          const refs =
            product?.integration_refs ?? fields.integration_refs.split(/\s+/).filter(Boolean)
          const links = fields.links
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => {
              const i = l.indexOf('|')
              return { label: i < 0 ? '' : l.slice(0, i).trim(), url: l.slice(i + 1).trim() }
            })
          if (
            refs.length > 100 ||
            refs.some((r) => !isUUID(r)) ||
            links.length > 20 ||
            links.some((l) => !validLink(l))
          ) {
            setError('Проверьте ссылки и подтверждённые UUID интеграций.')
            return
          }
          if (
            fields.tariff_version &&
            (!Number.isSafeInteger(Number(fields.tariff_version)) ||
              Number(fields.tariff_version) < 1)
          ) {
            setError('Укажите целую подтверждённую версию тарифа.')
            return
          }
          const trial = fields.trial
          if (
            (trial === 'free' && fields.line !== 'FREE') ||
            (trial === '90' && fields.line !== 'TOP') ||
            (['7', '14'].includes(trial) && fields.line !== 'PRO')
          ) {
            setError('Пробный период не соответствует линейке.')
            return
          }
          setError('')
          const body = {
            display_name: fields.display_name,
            line: fields.line,
            availability: fields.availability,
            integration_refs: refs,
            tariff_version: fields.tariff_version ? Number(fields.tariff_version) : null,
            trial_policy: {
              kind: ['none', 'free'].includes(trial) ? trial : 'once',
              duration_days: ['none', 'free'].includes(trial) ? null : Number(trial),
            },
            links,
          }
          const key = crypto.randomUUID()
          attempt.start(
            product
              ? {
                  kind: 'product-update',
                  product: product.id,
                  version: draft?.base ?? product.version,
                  key,
                  body: JSON.stringify(body),
                }
              : {
                  kind: 'product-create',
                  code: fields.code,
                  key,
                  body: JSON.stringify({ code: fields.code, ...body }),
                },
          )
        }}
      >
        <p className={styles.meta}>
          Версия карточки {draft?.base ?? product?.version ?? 'новая'}. Версия тарифа задаётся
          отдельно.
        </p>
        <fieldset className={styles.fields} disabled={attempt.locked}>
          <legend>{product ? 'Изменить виджет' : 'Создать виджет'}</legend>
          <label>
            Код
            <input
              value={fields.code}
              disabled={Boolean(product)}
              required
              maxLength={63}
              pattern="[a-z0-9]+((-|_)[a-z0-9]+)*"
              onChange={(e) => edit('code', e.target.value)}
            />
          </label>
          <label>
            Название
            <input
              value={fields.display_name}
              required
              maxLength={200}
              onChange={(e) => edit('display_name', e.target.value)}
            />
          </label>
          <label>
            Линейка
            <select value={fields.line} onChange={(e) => edit('line', e.target.value)}>
              {['FREE', 'TOP', 'PRO'].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            Доступность
            <select
              value={fields.availability}
              onChange={(e) => edit('availability', e.target.value)}
            >
              <option value="draft">Черновик</option>
              <option value="pilot">Пилот</option>
              <option value="active">Доступен</option>
              <option value="archived">Архив</option>
            </select>
          </label>
          <label>
            Подтверждённая версия тарифа
            <input
              type="number"
              min="1"
              step="1"
              value={fields.tariff_version}
              onChange={(e) => edit('tariff_version', e.target.value)}
            />
          </label>
          <label>
            Пробный период
            <select value={fields.trial} onChange={(e) => edit('trial', e.target.value)}>
              <option value="none">Отключён</option>
              <option value="free">Бесплатный</option>
              <option value="7">7 дней</option>
              <option value="14">14 дней</option>
              <option value="90">90 дней</option>
            </select>
          </label>
          <label>
            Ссылки, название | URL
            <textarea value={fields.links} onChange={(e) => edit('links', e.target.value)} />
          </label>
          <label>
            Подтверждённые интеграции
            <textarea
              readOnly={Boolean(product)}
              value={fields.integration_refs}
              onChange={(e) => edit('integration_refs', e.target.value)}
            />
          </label>
        </fieldset>
        <p className={styles.meta}>
          Версию тарифа и пробное правило проверяет Platform. Пустая версия снимает выбор. Новый код
          может не иметь интеграций. Для принятия существующего технического кода нужен полный
          подтверждённый набор UUID интеграций из эксплуатационного источника.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <button
          disabled={attempt.locked || state.kind === 'conflict' || (Boolean(product) && !draft)}
        >
          {product ? 'Сохранить виджет' : 'Создать виджет'}
        </button>
      </form>
      <VersionConflict command={attempt} version={product?.version ?? 0} latest={initial}>
        <p>Текущее название: {product?.display_name}</p>
      </VersionConflict>
      <CommandFeedback command={attempt} />
    </section>
  )
}
