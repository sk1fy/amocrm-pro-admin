import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
import { CommandFeedback, useAccountCommand, VersionConflict } from './accountCommands'
import { isUUID } from './installationsApi'
import type { Product } from './productsApi'
import { ProductTariffs, tariffDraft, tariffOptions } from './ProductTariffs'
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
    trial_extension_days: String(product?.trial_extension_days ?? 7),
    tariff_version: product?.tariff_version?.toString() ?? '',
    tariff_options: tariffDraft(product?.tariff_options ?? []),
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

export function ProductEditor({
  product,
  attempt,
  editable,
  formId,
  showTechnical,
}: {
  product?: Product
  attempt: ReturnType<typeof useAccountCommand>
  editable: boolean
  showTechnical: boolean
  formId: string
}) {
  const hint = useId()
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
    const tariffs = tariffOptions(fields.tariff_options)
    if (!tariffs) {
      setError(
        'Проверьте название, срок и цену каждого тарифа. Цена указывается с точностью до копейки.',
      )
      return
    }
    const trial =
      fields.line === 'FREE'
        ? product?.line === 'FREE' && product.trial_policy.kind === 'none'
          ? 'none'
          : 'free'
        : fields.trial === 'free'
          ? 'none'
          : fields.trial
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
      tariff_version: fields.tariff_version ? Number(fields.tariff_version) : null,
      ...(fields.trial_extension_days !== initial.trial_extension_days
        ? { trial_extension_days: Number(fields.trial_extension_days) }
        : {}),
      ...(fields.tariff_options !== initial.tariff_options ? { tariff_options: tariffs } : {}),
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
              <select
                disabled={fields.line === 'FREE'}
                value={
                  fields.line === 'FREE' ? 'free' : fields.trial === 'free' ? 'none' : fields.trial
                }
                onChange={(event) => edit('trial', event.target.value)}
              >
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
            Продление теста, дней
            <input
              aria-describedby={hint + '-extension'}
              type="number"
              min="1"
              max="365"
              step="1"
              required
              disabled={fields.line === 'FREE'}
              value={fields.trial_extension_days}
              onChange={(e) => edit('trial_extension_days', e.target.value)}
            />
          </label>
          <small className={styles.hint} id={hint + '-extension'}>
            Шаг кнопки «Тест +N дней» в карточке клиента. По умолчанию 7 дней.
          </small>
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
        <EditorSection section="links" description="Адреса для установки виджета и его инструкции.">
          {editable ? (
            <>
              <label>
                Ссылка на установку
                <input
                  type="url"
                  aria-describedby={hint + '-install'}
                  value={fields.installation_url}
                  onChange={(event) => edit('installation_url', event.target.value)}
                />
              </label>
              <small className={styles.hint} id={hint + '-install'}>
                По этой ссылке клиент переходит к установке виджета в amoCRM.
              </small>
              <label>
                Ссылка на инструкцию
                <input
                  type="url"
                  aria-describedby={hint + '-guide'}
                  value={fields.instruction_url}
                  onChange={(event) => edit('instruction_url', event.target.value)}
                />
              </label>
              <small className={styles.hint} id={hint + '-guide'}>
                По кнопке «Инструкция» открывается руководство по работе с виджетом.
              </small>
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
          description="Стоимость за весь срок в месяцах. Для расчёта за каждого пользователя отметьте «за польз.»."
        >
          <ProductTariffs
            draft={fields.tariff_options}
            editable={editable}
            onChange={(value) => edit('tariff_options', value)}
          />
        </EditorSection>
        {showTechnical ? (
          <details className={styles.details}>
            <summary>Технические данные</summary>
            <label>
              Подтверждённая версия тарифа
              <input
                type="number"
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                step={1}
                value={fields.tariff_version}
                onChange={(e) => edit('tariff_version', e.target.value)}
              />
            </label>
            {product && (
              <dl>
                <dt>Версия карточки</dt>
                <dd>{product.version}</dd>
                <dt>Подтверждённые интеграции</dt>
                <dd>{product.integration_refs.join(', ') || '—'}</dd>
              </dl>
            )}
          </details>
        ) : null}
        {showTechnical && editable ? (
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
    </form>
  )
}
