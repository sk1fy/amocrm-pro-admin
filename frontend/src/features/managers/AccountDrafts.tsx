import { createContext, useContext, useState, type ReactNode, type SetStateAction } from 'react'

const Drafts = createContext<{
  values: Record<string, unknown>
  write: (key: string, value: SetStateAction<unknown>) => void
} | null>(null)
const Account = createContext('')
export function AccountDrafts({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  return (
    <Drafts.Provider
      value={{
        values,
        write: (key, value) =>
          setValues((current) => ({
            ...current,
            [key]: typeof value === 'function' ? value(current[key]) : value,
          })),
      }}
    >
      {children}
    </Drafts.Provider>
  )
}
export function DraftAccount({ id, children }: { id: string; children: ReactNode }) {
  return <Account.Provider value={id}>{children}</Account.Provider>
}
export function useReadAccountDraft() {
  const drafts = useContext(Drafts)
  if (!drafts) throw new Error('AccountDrafts required')
  return <T,>(id: string, name: string, fallback: T): T => {
    const key = `${id}:${name}`
    return Object.hasOwn(drafts.values, key) ? (drafts.values[key] as T) : fallback
  }
}

export function useAccountDraft<T>(
  name: string,
  initial: T | (() => T),
): [T, (value: SetStateAction<T>) => void] {
  const drafts = useContext(Drafts)
  const id = useContext(Account)
  const [fallback] = useState(initial)
  if (!drafts) throw new Error('AccountDrafts required')
  const key = name.startsWith('/') ? name : `${id}:${name}`
  const value = Object.hasOwn(drafts.values, key) ? (drafts.values[key] as T) : fallback
  return [
    value,
    (next) =>
      drafts.write(
        key,
        typeof next === 'function'
          ? (current: unknown) =>
              (next as (previous: T) => T)(current === undefined ? fallback : (current as T))
          : next,
      ),
  ]
}
