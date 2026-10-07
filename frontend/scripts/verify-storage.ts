import assert from 'node:assert'
import { afterEach, beforeEach, test } from 'node:test'

// 最小 localStorage + window 垫片，模拟老用户浏览器里已存在的旧口径数据
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
  },
}

const STORAGE_KEY = 'airport-ground-handling:entries'

beforeEach(() => {
  store.clear()
  // 老用户数据：无规则版本字段；同编号一条已签收、一条仍按待配餐；份数为越界字符串
  store.set(
    STORAGE_KEY,
    JSON.stringify({
      catering: [
        {
          id: 1, status: '已签收', pending: false, abnormal: false,
          '配餐编号': 'CATE-X1', '关联航班': 'CA1', '餐食类型': '经济餐', '配餐份数': 210,
          '特殊需求': '无', '配餐车辆': 'V1', '送达时间': 't', '配餐状态': '已签收',
        },
        {
          id: 2, status: '待配餐', pending: true, abnormal: false,
          '配餐编号': 'CATE-X1', '关联航班': 'CA1', '餐食类型': '头等餐', '配餐份数': 8,
          '特殊需求': '清真', '配餐车辆': 'V1', '送达时间': 't', '配餐状态': '待配餐',
        },
        {
          id: 3, status: '装配中', pending: true, abnormal: false,
          '配餐编号': 'CATE-X2', '关联航班': 'CA2', '餐食类型': '经济餐', '配餐份数': 600,
          '特殊需求': '无', '配餐车辆': 'V2', '送达时间': 't', '配餐状态': '装配中',
        },
      ],
      cabin_clean: [
        { id: 9, status: '需复查', pending: false, abnormal: true, '清洁编号': 'C1' },
      ],
    }),
  )
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window
})

test('老用户数据载入时按新口径迁移：同号统一、历史冻结、未结束重判', async () => {
  const { allRows } = await import('@/data/local-store')
  const { listCateringGroups, pendingRows } = await import('@/api/local-service')

  const groups = listCateringGroups()
  const x1 = groups.find((g) => g.number === 'CATE-X1')!
  assert.equal(x1.status, '已签收')
  assert.equal(x1.portions, 218) // 210 冻结 + 8 归并
  assert.equal(x1.ruleVersion, 1)
  assert.equal(x1.rows[0]['签收口径份数'], 210)

  const x2 = groups.find((g) => g.number === 'CATE-X2')!
  assert.equal(x2.status, '装配中')
  assert.ok(x2.hard.some((v) => v.code === 'portions-range'))
  assert.equal(allRows().catering[2].abnormal, true)
  assert.equal(allRows().catering[2]['规则版本'], 2)

  // 迁移结果已落盘，二次读取一致（幂等）
  const persisted = JSON.parse(store.get(STORAGE_KEY)!)
  assert.equal(persisted.catering[0]['签收口径份数'], 210)

  // 客舱清洁「需复查」仍是待办
  assert.equal(pendingRows('cabin_clean').length, 1)
})
