import {
  ALLOWED_SPECIAL_REQUESTS,
  CATERING_ACTIONS,
  CATERING_FINAL_STATUS,
  CATERING_RULE_VERSION,
  canonicalizeCatering,
  cateringViewById,
  isAllowedSpecialRequest,
  nextCateringStatus,
  validatePortions,
  validateSpecialRequest,
  type CateringView,
} from '@/data/catering-rules'
import { isPendingByStatus } from '@/data/canonical'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function viewToRow(view: CateringView): EntryRow {
  return {
    ...view.row,
    id: view.id,
    status: view.status,
    pending: view.status !== CATERING_FINAL_STATUS,
    abnormal: view.violation !== null,
    配餐编号: view.code,
    关联航班: view.flight,
    餐食类型: view.mealType,
    配餐份数: view.portions,
    特殊需求: view.specialRequest,
    特殊餐份数: view.specialPortions,
    配餐车辆: view.vehicle,
    送达时间: view.deliverTime,
    配餐状态: view.status,
    规则版本: view.ruleVersion,
    规则提示: view.violation ?? '',
  }
}

/** 航食配餐列表：按配餐编号统一口径后再返回，列表与详情永远是同一份结论。 */
export function listCatering(filters: Record<string, string> = {}): PageResult {
  const views = canonicalizeCatering(listRows('catering'))
  const rows = views.map(viewToRow)
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 航食配餐详情：份数、状态全部走统一规则，不再按行内字段另算。 */
export function getCatering(id: number): CateringView | null {
  return cateringViewById(listRows('catering'), id)
}

/**
 * 航食配餐状态流转。
 * - 同一配餐编号的所有行一起推进，共享一个状态。
 * - 只能按 待配餐→装配中→已送达→已签收 顺序推进，跳步/终态都拒绝。
 * - 重复签收只生效一次：已签收后再次签收不再改数据，仅返回提示。
 * - 未通过餐食标准的未结束任务不允许继续流转（冲突时以明确限制为准）。
 */
export function runCateringAction(id: number, action: string): ActionResult {
  if (!CATERING_ACTIONS[action]) {
    return { ok: false, message: `配餐任务没有登记「${action}」这个动作` }
  }
  const rows = listRows('catering')
  const view = cateringViewById(rows, id)
  if (!view) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐任务` }
  }

  if (view.signed) {
    return {
      ok: true,
      deduplicated: true,
      message: `配餐编号 ${view.code} 已签收，重复签收只生效一次`,
    }
  }
  if (view.violation) {
    return { ok: false, message: `未满足餐食标准，不能${action}：${view.violation}` }
  }
  const target = nextCateringStatus(view.status, action)
  if (!target) {
    return {
      ok: false,
      message: `配餐编号 ${view.code} 当前为「${view.status}」，不能直接${action}，请按 待配餐→装配中→已送达→已签收 顺序流转`,
    }
  }

  const next = rows.map((row) => {
    if (String(row['配餐编号'] ?? '').trim() !== view.code) {
      return row
    }
    const updated: EntryRow = {
      ...row,
      status: target,
      pending: target !== CATERING_FINAL_STATUS,
      规则版本: CATERING_RULE_VERSION,
    }
    if (target === CATERING_FINAL_STATUS) {
      // 签收落定：记录签收时间与规则版本，后续规则调整不再回溯这一单。
      updated['签收时间'] = new Date().toISOString().slice(0, 10)
    }
    return updated
  })
  saveRows('catering', next)
  return { ok: true, message: `配餐编号 ${view.code} 已${action}，当前状态「${target}」` }
}

/**
 * 保存特殊需求（含人工覆盖场景）。
 * 超范围需求、份数越界、特殊餐超过总份数一律拒绝——人工覆盖同样不能绕过餐食标准。
 * 已签收是历史结论，不允许再改；未结束任务按当前版本保存，之后即按新口径重判。
 */
export function saveCateringSpecial(
  id: number,
  rawRequest: string,
  rawSpecialPortions: number,
): ActionResult {
  const rows = listRows('catering')
  const view = cateringViewById(rows, id)
  if (!view) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐任务` }
  }
  if (view.signed) {
    return { ok: false, message: `配餐编号 ${view.code} 已签收，历史结论保留，不能修改特殊需求` }
  }

  const request = rawRequest.trim() || '无'
  const specialPortions = Math.trunc(Number(rawSpecialPortions))
  if (!isAllowedSpecialRequest(request)) {
    return {
      ok: false,
      message: `特殊需求「${request}」超出餐食标准，只允许：${ALLOWED_SPECIAL_REQUESTS.join('、')}`,
    }
  }
  if (!Number.isFinite(Number(rawSpecialPortions)) || !Number.isInteger(Number(rawSpecialPortions))) {
    return { ok: false, message: '特殊餐份数必须为整数' }
  }
  const portionError = validatePortions(view.portions) ?? validateSpecialRequest(request, specialPortions, view.portions)
  if (portionError) {
    return { ok: false, message: portionError }
  }

  const next = rows.map((row) =>
    String(row['配餐编号'] ?? '').trim() === view.code
      ? {
          ...row,
          特殊需求: request,
          特殊餐份数: specialPortions,
          规则版本: CATERING_RULE_VERSION,
        }
      : row,
  )
  saveRows('catering', next)
  return { ok: true, message: `配餐编号 ${view.code} 的特殊需求已按餐食标准保存` }
}

/** 其它页面同步客舱清洁待办时调用，口径与客舱清洁页完全一致。 */
export function cabinCleanTodo(): EntryRow[] {
  return listRows('cabin_clean').filter((row) => isPendingByStatus('cabin_clean', row))
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
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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
    if (meta.key === 'catering') {
      // 配餐按编号统一口径后统计：重复编号已签收的不再算待办，超范围等违规即时体现；
      // 历史已签收保留原结论、不计异常。
      const views = canonicalizeCatering(entries)
      return {
        name: meta.name,
        created: entries.length,
        pending: views.filter((view) => view.status !== CATERING_FINAL_STATUS).length,
        abnormal: views.filter((view) => view.violation !== null).length,
      }
    }
    // 其它模块待办按当前状态统一判定，规则调整后未结束任务自动按新口径统计。
    const pending = entries.filter((row) => isPendingByStatus(meta.key, row)).length
    return {
      name: meta.name,
      created: entries.length,
      pending,
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
