import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  CATERING_KEY,
  applyCateringAction,
  overrideStandard,
  registerTask,
  summarizeAll,
  type CateringDraft,
} from '@/domain/catering-rules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 终态判定：客舱清洁只有「已完成」算结束，「需复查」仍是待办（与全局清洁待办一致）。
const TERMINAL_STATUS: Record<string, string> = {
  cabin_clean: '已完成',
}

function isTerminal(key: string, status: string): boolean {
  const meta = moduleMeta(key)
  const terminal = TERMINAL_STATUS[key] ?? meta.statuses[meta.statuses.length - 1]
  return status === terminal
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)

  if (key === CATERING_KEY) {
    const outcome = applyCateringAction(rows, id, action)
    if (!outcome) {
      return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
    }
    if (outcome.ok && outcome.rows) {
      saveRows(key, outcome.rows)
    }
    return { ok: outcome.ok, message: outcome.message }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !isTerminal(key, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function registerCatering(draft: CateringDraft): ActionResult {
  const outcome = registerTask(listRows(CATERING_KEY), draft)
  if (outcome.ok && outcome.rows) {
    saveRows(CATERING_KEY, outcome.rows)
  }
  return { ok: outcome.ok, message: outcome.message }
}

export function overrideCateringStandard(number: string, reason: string): ActionResult {
  const outcome = overrideStandard(listRows(CATERING_KEY), number, reason)
  if (outcome.ok && outcome.rows) {
    saveRows(CATERING_KEY, outcome.rows)
  }
  return { ok: outcome.ok, message: outcome.message }
}

export function listCateringGroups(filters: Record<string, string> = {}) {
  const groups = summarizeAll(listRows(CATERING_KEY))
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return groups
  }
  return groups.filter((group) =>
    pairs.every(([field, keyword]) => {
      const haystack: string[] =
        field === '配餐编号'
          ? [group.number]
          : field === '关联航班'
            ? [group.flight]
            : field === '餐食类型'
              ? group.mealTypes
              : group.rows.map((row) => String(row[field] ?? ''))
      return haystack.some((text) => text.includes(keyword.trim()))
    }),
  )
}

/** 待办判定：客舱清洁的已完成视为完结，其余非已完成（含需复查）都在待办里同步 */
export function pendingRows(key: string): EntryRow[] {
  return listRows(key).filter((row) => !isTerminal(key, String(row.status)))
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: pendingRows(meta.key).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
