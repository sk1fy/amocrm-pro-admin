import { apiFetch, apiSend, isUnauthorized } from '../src/api/client'

type Manager = {
  id: string
  email: string
  name: string
  grants: string[]
}

type Credentials = {
  email: string
  password: string
}

export const managerApi = '/api/v1/managers'

function parseManager(value: unknown): Manager {
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'email' in value &&
    typeof value.email === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'grants' in value &&
    Array.isArray(value.grants) &&
    value.grants.length > 0 &&
    value.grants.every((grant: unknown): grant is string => typeof grant === 'string')
  ) {
    return { id: value.id, email: value.email, name: value.name, grants: value.grants }
  }
  throw new Error('invalid manager profile')
}

export async function fetchManager(signal: AbortSignal): Promise<Manager | null> {
  try {
    return parseManager(await apiFetch<unknown>(`${managerApi}/me`, { signal }))
  } catch (error) {
    if (isUnauthorized(error)) return null
    throw error
  }
}

export async function loginManager(credentials: Credentials): Promise<Manager> {
  return parseManager(await apiSend<unknown>(`${managerApi}/auth/login`, 'POST', credentials))
}

export async function logoutManager(): Promise<void> {
  try {
    await apiSend<unknown>(`${managerApi}/auth/logout`, 'POST')
  } catch (error) {
    if (!isUnauthorized(error)) throw error
  }
}
