import type { EntryRow } from '@/data/types'

/**
 * 航食配餐统一规则（唯一判定口径）
 *
 * 列表入口与详情页的状态、份数都从这里取数，不允许各写一套：
 * - 配餐编号相同的任务视为同一配餐单：状态统一判定、份数统一合计、签收统一生效
 * - 已签收是历史结论：按签收时冻结的口径份数展示，不再用新规则重判
 * - 未结束任务始终按当前规则（CURRENT_RULE_VERSION）重判
 * - 硬限制（明确限制）冲突时一律拦截，人工覆盖也不能绕过；餐食标准这类软阈值
 *   允许人工覆盖，但必须登记覆盖原因
 */

export const CATERING_KEY = 'catering'

export const CURRENT_RULE_VERSION = 2

export const CATERING_STATUSES = ['待配餐', '装配中', '已送达', '已签收'] as const
const STATUS_RANK: Record<string, number> = {
  待配餐: 0,
  装配中: 1,
  已送达: 2,
  已签收: 3,
}
export const SIGNED_STATUS = '已签收'

// 硬阈值：明确限制，任何情况下都不可越过
export const PORTION_HARD_MIN = 1
export const PORTION_HARD_MAX = 500
// 餐食标准阈值：软阈值，超出需登记人工覆盖原因才能继续流转
export const PORTION_STANDARD_MAX = 300

export const MEAL_TYPES = ['经济餐', '头等餐', '商务餐', '机组餐', '素食餐', '儿童餐', '轻食']

// 特殊需求采用白名单制：白名单之外一律不允许保存
export const SPECIAL_REQUESTS = ['无', '素食', '清真', '无麸质', '低糖', '儿童餐', '婴儿餐', '无坚果']
const EMPTY_SPECIAL_TOKENS = ['', '无', '无特殊需求']

export type ViolationLevel = 'hard' | 'soft'

export type Violation = {
  level: ViolationLevel
  code: string
  message: string
}

export type CateringDraft = {
  number: string
  flight: string
  mealType: string
  portions: number
  special: string
  vehicle: string
  deliverAt: string
  override: boolean
  overrideReason: string
}

export type CateringGroupSummary = {
  number: string
  rows: EntryRow[]
  status: string
  /** 配餐单合计份数：已签收按冻结口径，未结束按当前规则计算 */
  portions: number
  basis: 'frozen-signed' | 'current'
  ruleVersion: number | null
  flight: string
  mealTypes: string[]
  specials: string[]
  vehicles: string[]
  deliverAt: string
  hard: Violation[]
  soft: Violation[]
  /** 存在软阈值冲突时，是否全部已登记人工覆盖 */
  overridden: boolean
  merged: boolean
  signed: boolean
}

export type DomainActionOutcome = {
  ok: boolean
  message: string
  rows?: EntryRow[]
}

function isNumericPortions(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 解析登记份数；非法（非数字/越界标记由校验补充）返回 null */
export function parsePortions(value: unknown): number | null {
  if (isNumericPortions(value)) {
    return Number.isInteger(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && Number.isInteger(parsed)) {
      return parsed
    }
  }
  return null
}

export function splitSpecialRequests(value: unknown): string[] {
  return String(value ?? '')
    .split(/[、,，;；+/\s]+/)
    .map((token) => token.trim())
    .filter((token) => !EMPTY_SPECIAL_TOKENS.includes(token))
}

/** 单条未结束任务的规则校验；已签收任务不再重判，调用方需先排除 */
export function checkRow(row: Partial<EntryRow>): { hard: Violation[]; soft: Violation[] } {
  const hard: Violation[] = []
  const soft: Violation[] = []

  const mealType = String(row['餐食类型'] ?? '').trim()
  if (!MEAL_TYPES.includes(mealType)) {
    hard.push({
      level: 'hard',
      code: 'meal-type',
      message: `餐食类型「${mealType}」不在允许范围：${MEAL_TYPES.join('、')}`,
    })
  }

  const portions = parsePortions(row['配餐份数'])
  if (portions === null) {
    hard.push({
      level: 'hard',
      code: 'portions-invalid',
      message: `配餐份数必须为整数（明确限制 ${PORTION_HARD_MIN}~${PORTION_HARD_MAX} 份）`,
    })
  } else if (portions < PORTION_HARD_MIN || portions > PORTION_HARD_MAX) {
    hard.push({
      level: 'hard',
      code: 'portions-range',
      message: `配餐份数 ${portions} 超出明确限制 ${PORTION_HARD_MIN}~${PORTION_HARD_MAX} 份，禁止保存与流转`,
    })
  } else if (portions > PORTION_STANDARD_MAX) {
    soft.push({
      level: 'soft',
      code: 'portions-standard',
      message: `配餐份数 ${portions} 超出餐食标准 ${PORTION_STANDARD_MAX} 份，须登记人工覆盖原因后方可继续`,
    })
  }

  for (const token of splitSpecialRequests(row['特殊需求'])) {
    if (!SPECIAL_REQUESTS.includes(token)) {
      hard.push({
        level: 'hard',
        code: 'special-request',
        message: `特殊需求「${token}」超出允许范围，允许：${SPECIAL_REQUESTS.filter((item) => item !== '无').join('、')}`,
      })
    }
  }

  return { hard, soft }
}

export function isOverStandard(portions: number): boolean {
  return portions > PORTION_STANDARD_MAX && portions <= PORTION_HARD_MAX
}

export function groupByNumber(rows: EntryRow[]): Map<string, EntryRow[]> {
  const map = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const number = String(row['配餐编号'] ?? '').trim()
    const bucket = map.get(number)
    if (bucket) {
      bucket.push(row)
    } else {
      map.set(number, [row])
    }
  }
  return map
}

function rowComputedPortions(row: EntryRow): number {
  if (String(row.status) === SIGNED_STATUS) {
    const frozen = parsePortions(row['签收口径份数'])
    if (frozen !== null) {
      return frozen
    }
  }
  return parsePortions(row['配餐份数']) ?? 0
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))]
}

/** 统一判定：同配餐编号的状态、份数、校验结论都收敛到这一个结果上 */
export function summarizeGroup(number: string, groupRows: EntryRow[]): CateringGroupSummary {
  const signedRows = groupRows.filter((row) => String(row.status) === SIGNED_STATUS)
  const openRows = groupRows.filter((row) => String(row.status) !== SIGNED_STATUS)
  const signed = signedRows.length > 0

  const status = signed
    ? SIGNED_STATUS
    : CATERING_STATUSES[Math.max(...groupRows.map((row) => STATUS_RANK[String(row.status)] ?? 0))]

  const hard: Violation[] = []
  const soft: Violation[] = []
  for (const row of openRows) {
    const result = checkRow(row)
    hard.push(...result.hard)
    soft.push(...result.soft)
  }

  const softRows = openRows.filter((row) => checkRow(row).soft.length > 0)
  const overridden =
    softRows.length > 0 && softRows.every((row) => row['人工覆盖'] === true)

  return {
    number,
    rows: groupRows,
    status,
    portions: groupRows.reduce((sum, row) => sum + rowComputedPortions(row), 0),
    basis: signed ? 'frozen-signed' : 'current',
    ruleVersion: signed
      ? Math.min(...signedRows.map((row) => Number(row['规则版本']) || CURRENT_RULE_VERSION))
      : CURRENT_RULE_VERSION,
    flight: String(groupRows[0]?.['关联航班'] ?? ''),
    mealTypes: unique(groupRows.map((row) => String(row['餐食类型'] ?? ''))),
    specials: unique(
      groupRows.flatMap((row) => splitSpecialRequests(row['特殊需求'])),
    ),
    vehicles: unique(groupRows.map((row) => String(row['配餐车辆'] ?? ''))),
    deliverAt: groupRows.map((row) => String(row['送达时间'] ?? '')).sort().at(-1) ?? '',
    hard,
    soft,
    overridden,
    merged: groupRows.some((row) => row['同号归并'] === '是'),
    signed,
  }
}

export function summarizeAll(rows: EntryRow[]): CateringGroupSummary[] {
  return [...groupByNumber(rows)].map(([number, groupRows]) => summarizeGroup(number, groupRows))
}

export function availableActions(summary: CateringGroupSummary): string[] {
  if (summary.signed) {
    return []
  }
  switch (summary.status) {
    case '待配餐':
      return ['开始装配']
    case '装配中':
      return ['确认送达']
    case '已送达':
      return ['签收确认']
    default:
      return []
  }
}

const ACTION_TARGET: Record<string, string> = {
  开始装配: '装配中',
  确认送达: '已送达',
  签收确认: '已签收',
}

function patchGroup(
  rows: EntryRow[],
  groupRows: EntryRow[],
  produce: (row: EntryRow) => EntryRow,
): EntryRow[] {
  const ids = new Set(groupRows.map((row) => row.id))
  return rows.map((row) => (ids.has(row.id) ? produce(row) : row))
}

/** 配餐动作：按配餐编号整组生效，重复签收只生效一次 */
export function applyCateringAction(
  rows: EntryRow[],
  id: number,
  action: string,
): DomainActionOutcome | null {
  const target = rows.find((row) => Number(row.id) === id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐任务` }
  }
  const nextStatus = ACTION_TARGET[action]
  if (!nextStatus) {
    return null
  }
  const number = String(target['配餐编号'] ?? '').trim()
  const groupRows = groupByNumber(rows).get(number) ?? [target]
  const summary = summarizeGroup(number, groupRows)

  if (summary.status === nextStatus) {
    return {
      ok: false,
      message:
        nextStatus === SIGNED_STATUS
          ? `配餐单 ${number} 已签收，重复签收只生效一次`
          : `配餐单 ${number} 当前已是「${nextStatus}」，无需重复操作`,
    }
  }
  if (STATUS_RANK[summary.status] + 1 !== STATUS_RANK[nextStatus]) {
    return { ok: false, message: `配餐单 ${number} 需先完成上一环节，不能直接${action}` }
  }

  if (nextStatus === SIGNED_STATUS) {
    if (summary.hard.length > 0) {
      return {
        ok: false,
        message: `签收被明确限制拦截：${summary.hard.map((item) => item.message).join('；')}`,
      }
    }
    if (summary.soft.length > 0 && !summary.overridden) {
      return {
        ok: false,
        message: `份数超出餐食标准，须先登记人工覆盖原因：${summary.soft
          .map((item) => item.message)
          .join('；')}`,
      }
    }
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const next = patchGroup(rows, groupRows, (row) => ({
      ...row,
      status: SIGNED_STATUS,
      配餐状态: SIGNED_STATUS,
      pending: false,
      abnormal: false,
      // 签收即冻结口径：历史结论不再随后续规则调整变化
      签收口径份数: parsePortions(row['配餐份数']) ?? 0,
      规则版本: CURRENT_RULE_VERSION,
      签收时间: now,
    }))
    return { ok: true, message: `配餐单 ${number} 已签收，份数口径已冻结`, rows: next }
  }

  const next = patchGroup(rows, groupRows, (row) => ({
    ...row,
    status: nextStatus,
    配餐状态: nextStatus,
    pending: true,
  }))
  return { ok: true, message: `配餐单 ${number} 已${action}，当前状态「${nextStatus}」`, rows: next }
}

/** 人工覆盖：只能覆盖餐食标准（软阈值），必须登记原因；硬限制一律不受理 */
export function overrideStandard(
  rows: EntryRow[],
  number: string,
  reason: string,
): DomainActionOutcome {
  const groupRows = groupByNumber(rows).get(number)
  if (!groupRows) {
    return { ok: false, message: `没有找到配餐单 ${number}` }
  }
  const summary = summarizeGroup(number, groupRows)
  if (summary.signed) {
    return { ok: false, message: `配餐单 ${number} 已签收，结论冻结，不能再覆盖` }
  }
  if (summary.hard.length > 0) {
    return {
      ok: false,
      message: `存在明确限制冲突，人工覆盖不能绕过：${summary.hard
        .map((item) => item.message)
        .join('；')}`,
    }
  }
  if (summary.soft.length === 0) {
    return { ok: false, message: `配餐单 ${number} 未超出餐食标准，无需覆盖` }
  }
  const trimmed = reason.trim()
  if (trimmed.length < 2) {
    return { ok: false, message: '人工覆盖必须登记覆盖原因（至少 2 个字）' }
  }
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const softIds = new Set(
    groupRows.filter((row) => checkRow(row).soft.length > 0).map((row) => row.id),
  )
  const next = rows.map((row) =>
    softIds.has(row.id)
      ? { ...row, 人工覆盖: true, 覆盖原因: trimmed, 覆盖时间: now }
      : row,
  )
  return { ok: true, message: `配餐单 ${number} 已登记人工覆盖，可继续签收`, rows: next }
}

/** 登记新配餐任务：超范围特殊需求等硬冲突直接禁止保存 */
export function registerTask(
  rows: EntryRow[],
  draft: CateringDraft,
): DomainActionOutcome & { row?: EntryRow } {
  const number = draft.number.trim()
  const flight = draft.flight.trim()
  if (!number || !flight) {
    return { ok: false, message: '配餐编号与关联航班必须填写' }
  }
  const existed = summarizeAll(rows).find((group) => group.number === number)
  if (existed) {
    return {
      ok: false,
      message: existed.signed
        ? `配餐编号 ${number} 已签收，不能重复登记或重复签收`
        : `配餐编号 ${number} 已有未结束任务，同编号任务统一判定`,
    }
  }

  const candidate: EntryRow = {
    id: rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
    status: '待配餐',
    pending: true,
    abnormal: false,
    配餐编号: number,
    关联航班: flight,
    餐食类型: draft.mealType,
    配餐份数: draft.portions,
    特殊需求: draft.special.trim() || '无',
    配餐车辆: draft.vehicle.trim(),
    送达时间: draft.deliverAt.trim(),
    配餐状态: '待配餐',
    规则版本: CURRENT_RULE_VERSION,
    人工覆盖: false,
    同号归并: '否',
  }
  const result = checkRow(candidate)
  if (result.hard.length > 0) {
    return { ok: false, message: result.hard.map((item) => item.message).join('；') }
  }
  if (result.soft.length > 0) {
    // 软阈值可覆盖，但勾选覆盖就必须留下原因；不允许只覆盖不留痕
    if (!draft.override) {
      return {
        ok: false,
        message: `${result.soft[0].message}；如确需超出，请勾选人工覆盖并登记原因`,
      }
    }
    const reason = draft.overrideReason.trim()
    if (reason.length < 2) {
      return { ok: false, message: '人工覆盖必须登记覆盖原因（至少 2 个字）' }
    }
    candidate['人工覆盖'] = true
    candidate['覆盖原因'] = reason
    candidate['覆盖时间'] = new Date().toISOString().slice(0, 16).replace('T', ' ')
  }

  return { ok: true, message: `配餐单 ${number} 已登记`, rows: [...rows, candidate], row: candidate }
}
