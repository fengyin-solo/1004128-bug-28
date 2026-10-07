import { DOMAIN_MIGRATIONS } from '@/domain/migrations'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'

// 数据变更订阅：其它页面（如全局待办）据此同步，不直接依赖具体业务页面。
type StoreListener = (key: string) => void
const listeners = new Set<StoreListener>()

export function onRowsChange(listener: StoreListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitChange(key: string): void {
  listeners.forEach((listener) => listener(key))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function migrateAll(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  let changed = false
  const next = { ...data }
  for (const [key, migrate] of Object.entries(DOMAIN_MIGRATIONS)) {
    if (next[key]) {
      const migrated = migrate(next[key])
      if (migrated !== next[key]) {
        next[key] = migrated
        changed = true
      }
    }
  }
  return changed ? next : data
}

function readStorage(): Record<string, EntryRow[]> {
  let source = clone(SEED_ROWS)
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        source = { ...source, ...(JSON.parse(raw) as Record<string, EntryRow[]>) }
      } catch {
        // 存储损坏时回落到示例数据，沿用原行为
      }
    }
  }
  const migrated = migrateAll(source)
  if (migrated !== source && typeof window !== 'undefined' && window.localStorage) {
    // 新口径重判结果落盘，保证下次打开结论一致；迁移本身幂等
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
  }
  return migrated
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  emitChange(key)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
