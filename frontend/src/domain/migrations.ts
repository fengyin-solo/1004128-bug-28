import type { EntryRow } from '@/data/types'
import {
  CATERING_KEY,
  CURRENT_RULE_VERSION,
  SIGNED_STATUS,
  checkRow,
  groupByNumber,
  parsePortions,
} from './catering-rules'

/**
 * 配餐规则迁移
 *
 * 规则调整后：
 * - 历史已签收任务保留原结论：签收口径份数冻结，规则版本停留在签收时版本，不重判
 * - 未结束任务一律按当前版本（CURRENT_RULE_VERSION）重判；触发明确限制的标为异常
 * - 同配餐编号里只要有一条已签收，其余未结束条目并入该已签收配餐单，
 *   消除「列表已签收、详情仍按待配餐计份」的共享根因
 */
export function migrateCatering(rows: EntryRow[]): EntryRow[] {
  const groups = groupByNumber(rows)
  return rows.map((row) => {
    const number = String(row['配餐编号'] ?? '').trim()
    const group = groups.get(number) ?? [row]
    const signedInGroup = group.find((item) => String(item.status) === SIGNED_STATUS)

    if (signedInGroup && String(row.status) !== SIGNED_STATUS) {
      // 同号已有历史签收：并入签收结论，份数按该条目登记值冻结进签收口径
      return {
        ...row,
        status: SIGNED_STATUS,
        配餐状态: SIGNED_STATUS,
        pending: false,
        abnormal: false,
        签收口径份数: parsePortions(row['签收口径份数'] ?? row['配餐份数']) ?? 0,
        规则版本: Number(signedInGroup['规则版本']) || 1,
        同号归并: '是',
      }
    }

    if (String(row.status) === SIGNED_STATUS) {
      // 历史已签收：冻结口径、保留原结论；只补齐缺漏的冻结字段，不改动份数
      return {
        ...row,
        pending: false,
        abnormal: false,
        签收口径份数: parsePortions(row['签收口径份数'] ?? row['配餐份数']) ?? 0,
        规则版本: Number(row['规则版本']) || 1,
        同号归并: row['同号归并'] ?? '否',
      }
    }

    if (Number(row['规则版本']) === CURRENT_RULE_VERSION) {
      return row
    }

    // 未结束任务：按新口径重判，触发明确限制的在列表上以异常态暴露
    const { hard } = checkRow(row)
    return {
      ...row,
      规则版本: CURRENT_RULE_VERSION,
      abnormal: hard.length > 0,
      同号归并: row['同号归并'] ?? '否',
    }
  })
}

export const DOMAIN_MIGRATIONS: Record<string, (rows: EntryRow[]) => EntryRow[]> = {
  [CATERING_KEY]: migrateCatering,
}
