import type { Observation } from '../api/types'
import { explainError, isCoreAdminAuthError } from './labels'

export const CORE_AUTH_INCIDENT_ID = 'core-admin-auth'

export type IncidentScope = 'activity' | 'sync' | 'employees' | 'panels' | 'settings' | 'connection'

export type CoreAuthIncident = {
  id: typeof CORE_AUTH_INCIDENT_ID
  title: string
  action: string
  affects: string
  technical: string
  firstAt?: string
  lastAt?: string
  scopes: IncidentScope[]
}

type Candidate = {
  scope: IncidentScope
  observation: Observation<unknown>
}

function observationTime(observation: Observation<unknown>): string | undefined {
  return observation.observed_at || observation.error?.message ? observation.observed_at : undefined
}

export function collectCoreAuthIncident(candidates: Candidate[]): CoreAuthIncident | null {
  const matched = candidates.filter(
    (item) =>
      (item.observation.freshness === 'unavailable' || item.observation.freshness === 'unknown') &&
      isCoreAdminAuthError(item.observation.error?.message),
  )
  if (matched.length === 0) {
    return null
  }
  const first = matched[0]
  const explained = explainError(first.observation.error?.message, first.observation.error?.code)
  const times = matched
    .map((item) => observationTime(item.observation))
    .filter((value): value is string => Boolean(value))
    .sort()
  return {
    id: CORE_AUTH_INCIDENT_ID,
    title:
      explained?.title ??
      'Сервис не смог получить данные Activity: внутренняя авторизация бекенда завершилась ошибкой.',
    action: explained?.action ?? 'Повторите запрос.',
    affects: explained?.affects ?? '',
    technical: explained?.technical ?? first.observation.error?.message ?? '',
    firstAt: times[0],
    lastAt: times[times.length - 1],
    scopes: [...new Set(matched.map((item) => item.scope))],
  }
}

export function observationDependsOnIncident(
  observation: Observation<unknown>,
  incident: CoreAuthIncident | null,
): boolean {
  if (!incident) {
    return false
  }
  return (
    (observation.freshness === 'unavailable' || observation.freshness === 'unknown') &&
    isCoreAdminAuthError(observation.error?.message)
  )
}
