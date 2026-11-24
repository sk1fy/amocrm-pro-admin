import { useState, type FormEvent, type ReactNode } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
import { CommandFeedback, useAccountCommand, VersionConflict } from './accountCommands'
import type { AccountAccess } from './AccountsPage'
import { isUUID } from './installationsApi'
import type { Product } from './productsApi'
import { separateProductLinks } from './productLinks'
import styles from './WidgetSettings.module.css'

const noLinks: Product['links'] = []
function listLinks(links: Product['links']) {
  return links.map(({ label, url }) => `${label} | ${url}`).join('\n')
}

function valuesOf(product: Product | undefined, links: ReturnType<typeof separateProductLinks>) {
  const trial = product?.trial_policy
  return {
    code: product?.code ?? '',
    display_name: product?.display_name ?? '',
    line: product?.line ?? 'FREE',
    availability: product?.availability ?? 'draft',
    tariff_version: product?.tariff_version?.toString() ?? '',
    trial: trial?.kind === 'once' ? String(trial.duration_days) : (trial?.kind ?? 'none'),
    installation_url: links.installation?.url ?? '',
    instruction_url: links.instruction?.url ?? '',
    other_links: listLinks(links.other),
    integration_refs: '',
  }
}

type Fields = ReturnType<typeof valuesOf>
type Link = Product['links'][number]

function parseLinks(value: string): Link[] {
  return value
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const divider = line.indexOf('|')
      return {
        label: divider < 0 ? '' : line.slice(0, divider).trim(),
        url: line.slice(divider + 1).trim(),
      }
    })
}

function applyLinks(
  fields: Fields,
  original: Product['links'],
  parts: ReturnType<typeof separateProductLinks>,
) {
  const installation = {
    label: parts.installation?.label ?? 'Установка',
    url: fields.installation_url.trim(),
  }
  const instruction = {
    label: parts.instruction?.label ?? 'Инструкция',
    url: fields.instruction_url.trim(),
  }
  const remaining =
    fields.other_links === listLinks(parts.other)
      ? [...parts.other]
      : parseLinks(fields.other_links)
  const result = original.flatMap((link) => {
    if (link === parts.installation) return installation.url ? [installation] : []
    if (link === parts.instruction) return instruction.url ? [instruction] : []
    const next = remaining.shift()
    return next ? [next] : []
  })
  if (!parts.installation && installation.url) result.unshift(installation)
  if (!parts.instruction && instruction.url) result.push(instruction)
  return [...result, ...remaining]
}

function validLink(link: Link) {
  try {
    const parsed = new URL(link.url)
    return (
      !parsed.username &&
      !parsed.password &&
      Boolean(link.label) &&
      link.label.length <= 200 &&
      link.url.length <= 2000 &&
      ['http:', 'https:'].includes(parsed.protocol)
    )
  } catch {
    return false
  }
}

const sections = {
  main: { title: 'Основное', icon: 'M4 20l4-.7L20 7l-3-3L4.7 16 4 20ZM14.5 6.5l3 3' },
  links: {
    title: 'Ссылки',
    icon: 'M10 13a3 3 0 0 0 4.2 0l4-4a3 3 0 0 0-4.2-4.2l-2 2m2 4a3 3 0 0 0-4.2 0l-4 4A3 3 0 0 0 10 19l2-2',
  },
  tariffs: { title: 'Тарифы', icon: 'M4 5h16v14H4zM4 9h16' },
}

function EditorSection({
  section,
  description,
  children,
}: {
  section: keyof typeof sections
  description?: string
  children: ReactNode
}) {
  const { title, icon } = sections[section]
  return (
    <section className={styles.box} aria-label={title}>
      <header className={styles.boxHeading}>
        <span className={styles.sectionIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d={icon} />
          </svg>
        </span>
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
      </header>
      <div className={styles.boxBody}>{children}</div>
    </section>
  )
}

export function NewProductEditor({
  onSaved,
  ...access
}: AccountAccess & { onSaved: (product?: Product) => void }) {
  const attempt = useAccountCommand('product:new', { ...access, onSaved })
  return <ProductEditor attempt={attempt} editable />
}

export function ProductEditor({
  product,
  attempt,
  editable,
  formId,
}: {
  product?: Product
  attempt: ReturnType<typeof useAccountCommand>
  editable: boolean
  formId?: string
}) {
  const originalLinks = product?.links ?? noLinks
  const parts = separateProductLinks(originalLinks)
  const initial = valuesOf(product, parts)
  const [error, setError] = useState('')
  const { draft, state } = attempt.entry
  const fields: Fields = { ...initial, ...draft?.values }
  const edit = (name: keyof Fields, value: string) =>
    attempt.edit(name, value, initial, product?.version ?? 0)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || attempt.locked || state.kind === 'conflict' || (product && !draft)) return
    const refs = [
      ...new Set([
        ...(product?.integration_refs ?? []),
        ...fields.integration_refs.split(/\s+/).filter(Boolean),
      ]),
    ]
    const links = applyLinks(fields, originalLinks, parts)
    if (
      refs.length > 100 ||
      refs.some((ref) => !isUUID(ref)) ||
      links.length > 20 ||
      links.some((link) => !validLink(link))
    ) {
      setError('Проверьте ссылки и подтверждённые UUID интеграций.')
      return
    }
    const tariff = fields.tariff_version ? Number(fields.tariff_version) : null
    if (tariff !== null && (!Number.isSafeInteger(tariff) || tariff < 1)) {
      setError('Укажите целую подтверждённую версию тарифа.')
      return
    }
    const trial = fields.trial
    if (
      (trial === 'free' && fields.line !== 'FREE') ||
      (trial === '90' && fields.line !== 'TOP') ||
      (['7', '14'].includes(trial) && fields.line !== 'PRO')
    ) {
      setError('Пробный период не соответствует категории.')
      return
    }
    setError('')
    const body = {
      display_name: fields.display_name,
      line: fields.line,
      availability: fields.availability,
      integration_refs: refs,
      tariff_version: tariff,
      trial_policy: {
        kind: trial === 'none' || trial === 'free' ? trial : 'once',
        duration_days: trial === 'none' || trial === 'free' ? null : Number(trial),
      },
      links,
    }
    const key = createRequestKey()
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
  }

  return (
    <form
      id={formId}
      className={styles.form}
      aria-label={product ? 'Карточка виджета' : 'Создать виджет'}
      onSubmit={submit}
    >
      <fieldset disabled={!editable || attempt.locked}>
        <EditorSection
          section="main"
          description="Категория определяет, входит ли виджет в подписку «Все TOP-виджеты»."
        >
          {!product ? (
            <label>
              Код
              <input
                value={fields.code}
                required
                maxLength={63}
                pattern="[a-z0-9]+((-|_)[a-z0-9]+)*"
                onChange={(event) => edit('code', event.target.value)}
              />
            </label>
          ) : null}
          <label>
            Название
            <input
              value={fields.display_name}
              required
              maxLength={200}
              onChange={(event) => edit('display_name', event.target.value)}
            />
          </label>
          <div className={styles.fieldRow}>
            <label>
              Категория
              <select value={fields.line} onChange={(event) => edit('line', event.target.value)}>
                <option>FREE</option>
                <option>TOP</option>
                <option>PRO</option>
              </select>
            </label>
            <label>
              Пробный период
              <select value={fields.trial} onChange={(event) => edit('trial', event.target.value)}>
                <option value="none">Отключён</option>
                <option value="free" disabled={fields.line !== 'FREE'}>
                  Бесплатный
                </option>
                <option value="7" disabled={fields.line !== 'PRO'}>
                  7 дней
                </option>
                <option value="14" disabled={fields.line !== 'PRO'}>
                  14 дней
                </option>
                <option value="90" disabled={fields.line !== 'TOP'}>
                  90 дней
                </option>
              </select>
            </label>
          </div>
          <label>
            Доступность
            <select
              value={fields.availability}
              onChange={(event) => edit('availability', event.target.value)}
            >
              <option value="draft">Черновик</option>
              <option value="pilot">Пилот</option>
              <option value="active">Доступен</option>
              <option value="archived">Архив</option>
            </select>
            {fields.availability === 'archived' && (
              <small>
                Новые установки закрыты. У ранее подключённых аккаунтов виджет продолжит работать.
              </small>
            )}
          </label>
        </EditorSection>
        <EditorSection section="links">
          {editable ? (
            <>
              <label>
                Ссылка на установку
                <input
                  type="url"
                  value={fields.installation_url}
                  onChange={(event) => edit('installation_url', event.target.value)}
                />
              </label>
              <label>
                Ссылка на инструкцию
                <input
                  type="url"
                  value={fields.instruction_url}
                  onChange={(event) => edit('instruction_url', event.target.value)}
                />
              </label>
              <details>
                <summary>Другие ссылки</summary>
                <label>
                  Другие ссылки, название | URL
                  <textarea
                    value={fields.other_links}
                    onChange={(event) => edit('other_links', event.target.value)}
                  />
                </label>
              </details>
            </>
          ) : originalLinks.length ? (
            <ul>
              {originalLinks.map(({ label, url }, index) => (
                <li key={index}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>Нет ссылок.</p>
          )}
        </EditorSection>
        <EditorSection
          section="tariffs"
          description="Platform проверяет, что версия тарифа подтверждена для этого виджета."
        >
          <label>
            Подтверждённая версия тарифа
            <input
              type="number"
              min="1"
              step="1"
              value={fields.tariff_version}
              onChange={(event) => edit('tariff_version', event.target.value)}
            />
          </label>
        </EditorSection>
        {product ? (
          <details className={styles.details}>
            <summary>Технические данные</summary>
            <dl>
              <dt>Версия карточки</dt>
              <dd>{product.version}</dd>
              <dt>Подтверждённые интеграции</dt>
              <dd>{product.integration_refs.join(', ') || '—'}</dd>
            </dl>
          </details>
        ) : null}
        {editable ? (
          <label className={styles.details}>
            {product ? 'Добавить UUID интеграции Core' : 'Подтверждённые интеграции'}
            <textarea
              value={fields.integration_refs}
              onChange={(event) => edit('integration_refs', event.target.value)}
            />
          </label>
        ) : null}
      </fieldset>
      {editable ? (
        <>
          {error ? <p role="alert">{error}</p> : null}
          <VersionConflict command={attempt} version={product?.version ?? 0} latest={initial}>
            <p>Текущее название: {product?.display_name}</p>
          </VersionConflict>
          <CommandFeedback command={attempt} />
        </>
      ) : (
        <p>Каталог доступен только для чтения.</p>
      )}
      {!product ? (
        <button
          type="submit"
          className={styles.primary}
          disabled={attempt.locked || state.kind === 'conflict'}
        >
          Создать виджет
        </button>
      ) : null}
    </form>
  )
}
