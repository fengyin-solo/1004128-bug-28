import type { EntryRow } from './types'

/**
 * 航食配餐领域规则：配餐状态、配餐份数阈值、特殊需求白名单都在这里统一判定。
 * 列表页、详情页、本地数据服务只引用这里的结论，不再各自按字段猜，
 * 避免「列表已签收、详情还按待配餐算份数」这类同一编号两种口径的问题。
 */

// 当前生效的餐食规则版本。调整规则后只升这个版本：
// 未结束（非已签收）的任务按新口径重判，历史已签收的结论不动。
export const CATERING_RULE_VERSION = 2

export const CATERING_STATUSES = ['待配餐', '装配中', '已送达', '已签收'] as const
export type CateringStatus = (typeof CATERING_STATUSES)[number]

/** 已签收是终态：一旦签收不再参与任何重判，也不允许再改。 */
export const CATERING_FINAL_STATUS: CateringStatus = '已签收'

// 同一编号下的行按这个顺序取「最靠后」的状态作为共享口径。
const STATUS_RANK: Record<string, number> = {
  待配餐: 0,
  装配中: 1,
  已送达: 2,
  已签收: 3,
}

/** 状态只能沿着 待配餐 → 装配中 → 已送达 → 已签收 推进，冲突时以这个明确限制为准。 */
const NEXT_STATUS: Record<string, CateringStatus> = {
  待配餐: '装配中',
  装配中: '已送达',
  已送达: '已签收',
}

export const CATERING_ACTIONS: Record<string, CateringStatus> = {
  开始装配: '装配中',
  确认送达: '已送达',
  签收确认: '已签收',
}

/** 配餐份数硬阈值：任何登记、人工覆盖都不得越过这条线。 */
export const CATERING_PORTION_MIN = 1
export const CATERING_PORTION_MAX = 500

/**
 * 餐食标准允许的特殊需求。超范围（不在白名单内）的特殊需求一律拒绝保存，
 * 人工覆盖同样不能把超出餐食标准的需求写进来。
 */
export const ALLOWED_SPECIAL_REQUESTS = ['无', '素食餐', '清真餐', '低糖餐', '儿童餐', '无麸质餐'] as const
export type SpecialRequest = (typeof ALLOWED_SPECIAL_REQUESTS)[number]

/** 特殊餐（非「无」）的配餐份数同样落在总份数阈值内，且不能超过总份数。 */
export const SPECIAL_PORTION_MIN = 0

/** 列表/详情统一使用的规范视图，份数永远是数字，避免字符串参与计算。 */
export type CateringView = {
  row: EntryRow
  id: number
  code: string
  status: CateringStatus
  flight: string
  mealType: string
  portions: number
  specialRequest: string
  specialPortions: number
  vehicle: string
  deliverTime: string
  /** 仍需配出的份数：只有「待配餐」计入，其余（含已签收）都是 0。 */
  pendingPortions: number
  signed: boolean
  /** 不通过餐食标准时给出的明确限制说明；历史已签收为 null，保留原结论。 */
  violation: string | null
  ruleVersion: number
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeStatus(value: unknown): CateringStatus {
  const text = String(value ?? '').trim()
  return (CATERING_STATUSES as readonly string[]).includes(text)
    ? (text as CateringStatus)
    : '待配餐'
}

function textOf(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

/** 配餐份数阈值校验，人工覆盖与登记共用同一条明确限制。 */
export function validatePortions(portions: number): string | null {
  if (!Number.isInteger(portions)) {
    return '配餐份数必须为整数'
  }
  if (portions < CATERING_PORTION_MIN || portions > CATERING_PORTION_MAX) {
    return `配餐份数超出限制：只允许 ${CATERING_PORTION_MIN}-${CATERING_PORTION_MAX} 份`
  }
  return null
}

/** 特殊需求是否在餐食标准范围内。 */
export function isAllowedSpecialRequest(request: string): boolean {
  return (ALLOWED_SPECIAL_REQUESTS as readonly string[]).includes(request)
}

/**
 * 特殊需求 + 特殊餐份数的餐食标准校验。
 * 超范围需求、份数越界、特殊餐超过总份数都会被明确拒绝，人工覆盖不能绕过。
 */
export function validateSpecialRequest(
  request: string,
  specialPortions: number,
  totalPortions: number,
): string | null {
  const trimmed = request.trim()
  if (trimmed === '' || trimmed === '无') {
    if (specialPortions !== 0) {
      return '未登记特殊需求时，特殊餐份数必须为 0'
    }
    return null
  }
  if (!isAllowedSpecialRequest(trimmed)) {
    return `特殊需求「${trimmed}」超出餐食标准，只允许：${ALLOWED_SPECIAL_REQUESTS.join('、')}`
  }
  if (!Number.isInteger(specialPortions)) {
    return '特殊餐份数必须为整数'
  }
  if (specialPortions < SPECIAL_PORTION_MIN) {
    return '特殊餐份数不能为负数'
  }
  if (specialPortions > totalPortions) {
    return `特殊餐份数（${specialPortions}）不能超过配餐总份数（${totalPortions}）`
  }
  return null
}

/** 动作是否允许在当前状态下执行；终态与跳步都会被挡住。 */
export function nextCateringStatus(current: CateringStatus, action: string): CateringStatus | null {
  if (current === CATERING_FINAL_STATUS) {
    return null
  }
  const target = CATERING_ACTIONS[action]
  if (!target) {
    return null
  }
  return NEXT_STATUS[current] === target ? target : null
}

function baseView(row: EntryRow): Omit<CateringView, 'status' | 'signed' | 'pendingPortions' | 'violation'> {
  return {
    row,
    id: Number(row.id),
    code: textOf(row, '配餐编号'),
    flight: textOf(row, '关联航班'),
    mealType: textOf(row, '餐食类型'),
    portions: toInt(row['配餐份数'], 0),
    specialRequest: textOf(row, '特殊需求') || '无',
    specialPortions: toInt(row['特殊餐份数'], 0),
    vehicle: textOf(row, '配餐车辆'),
    deliverTime: textOf(row, '送达时间'),
    ruleVersion: toInt(row['规则版本'], CATERING_RULE_VERSION),
  }
}

function evaluate(view: Pick<CateringView, 'portions' | 'specialRequest' | 'specialPortions'>): string | null {
  const portionError = validatePortions(view.portions)
  if (portionError) {
    return portionError
  }
  return validateSpecialRequest(view.specialRequest, view.specialPortions, view.portions)
}

/**
 * 按配餐编号分组统一重判（共享根因的核心修复）：
 * - 同一配餐编号只允许一个共享口径；组内任一行已签收，整个编号都按已签收（重复签收只生效一次）。
 * - 未签收时取组内最靠后的状态，列表入口与详情页拿到的状态、份数完全一致。
 * - 未结束的任务按当前规则版本重判；历史已签收保留原结论，不回溯、不重判。
 */
export function canonicalizeCatering(rows: EntryRow[]): CateringView[] {
  const groups = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const code = textOf(row, '配餐编号')
    const bucket = groups.get(code)
    if (bucket) {
      bucket.push(row)
    } else {
      groups.set(code, [row])
    }
  }

  const views: CateringView[] = []
  for (const bucket of groups.values()) {
    const stored = bucket.map((row) => normalizeStatus(row.status))
    const signed = stored.includes(CATERING_FINAL_STATUS)
    const sharedStatus: CateringStatus = signed
      ? CATERING_FINAL_STATUS
      : stored.reduce<CateringStatus>((acc, status) =>
          STATUS_RANK[status] > STATUS_RANK[acc] ? status : acc,
        '待配餐')

    for (const row of bucket) {
      const base = baseView(row)
      views.push({
        ...base,
        status: sharedStatus,
        signed,
        pendingPortions: sharedStatus === '待配餐' ? base.portions : 0,
        // 历史已签收保留原结论：整组共享签收结论，不用新规则翻旧账；
        // 只有未结束的任务才按当前规则重判违规与否。
        violation: signed ? null : evaluate(base),
      })
    }
  }
  return views.sort((a, b) => a.id - b.id)
}

/** 取单个配餐编号的共享口径。 */
export function cateringViewByCode(rows: EntryRow[], code: string): CateringView | null {
  const target = code.trim()
  return canonicalizeCatering(rows).find((view) => view.code === target) ?? null
}

export function cateringViewById(rows: EntryRow[], id: number): CateringView | null {
  return canonicalizeCatering(rows).find((view) => view.id === id) ?? null
}
