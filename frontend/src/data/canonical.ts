import { MODULE_BY_KEY } from './modules'
import type { EntryRow } from './types'

/**
 * 各模块「任务是否还没结束」的统一口径。
 * 规则调整后，未结束任务按新口径重判；是否待办只看当前状态，不再相信历史写入的 pending 标记，
 * 这样客舱清洁清单在任何页面看到的待办数都和清洁页本身一致。
 */

// 模块的终态集合：到达这些状态后任务即结束，不再计入待办。
// 客舱清洁的「需复查」属于异常分支，任务并未结束，仍然要挂在待办里。
const TERMINAL_STATUSES: Record<string, string[]> = {
  cabin_clean: ['已完成'],
}

export function terminalStatuses(key: string): string[] {
  const custom = TERMINAL_STATUSES[key]
  if (custom) {
    return custom
  }
  const meta = MODULE_BY_KEY.get(key)
  return meta ? [meta.statuses[meta.statuses.length - 1]] : []
}

/** 这条记录按当前状态是否仍属于待办。 */
export function isPendingByStatus(key: string, row: Pick<EntryRow, 'status'>): boolean {
  return !terminalStatuses(key).includes(String(row.status))
}

export function pendingRows(key: string, rows: EntryRow[]): EntryRow[] {
  return rows.filter((row) => isPendingByStatus(key, row))
}

/** 客舱清洁待办清单：供其它页面同步展示，口径与客舱清洁页完全相同。 */
export function cabinCleanPending(rows: EntryRow[]): EntryRow[] {
  return pendingRows('cabin_clean', rows)
}
