import assert from 'node:assert'

import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'
import { migrateCatering } from '@/domain/migrations'
import {
  CURRENT_RULE_VERSION,
  PORTION_HARD_MAX,
  SIGNED_STATUS,
  applyCateringAction,
  availableActions,
  checkRow,
  overrideStandard,
  registerTask,
  summarizeAll,
} from '@/domain/catering-rules'

let passed = 0
function ok(label: string, fn: () => void) {
  fn()
  passed += 1
  console.log('PASS', label)
}

const initial = JSON.parse(JSON.stringify(SEED_ROWS.catering)) as EntryRow[]
const rows = migrateCatering(initial)

// 1) 同号 pair：历史已签收 + 待配餐 -> 列表与详情统一为已签收，份数合并冻结
const g0901 = summarizeAll(rows).find((g) => g.number === 'CATE-0901')!
ok('同号配餐单统一判定为已签收', () => assert.equal(g0901.status, SIGNED_STATUS))
ok('同号未结束条目归并签收、不再计入待配餐份数', () => {
  assert.equal(g0901.portions, 192) // 180 冻结 + 12 归并
  assert.equal(g0901.basis, 'frozen-signed')
  assert.equal(g0901.merged, true)
  assert.deepEqual(availableActions(g0901), [])
})
ok('历史签收保留 v1 结论，不归当前版本重判', () => assert.equal(g0901.ruleVersion, 1))

// 2) 重复签收只生效一次
const again = applyCateringAction(rows, g0901.rows[0].id, '签收确认')!
ok('重复签收被拒绝', () => assert.equal(again.ok, false))

// 3) 未结束任务按 v2 新口径重判：超范围特殊需求 -> hard 异常
const g0904 = summarizeAll(rows).find((g) => g.number === 'CATE-0904')!
ok('超范围特殊需求按新口径判为硬冲突', () => {
  assert.ok(g0904.hard.some((v) => v.code === 'special-request'))
  assert.equal(rows.find((r) => r.id === 5)!.abnormal, true)
})
ok('硬冲突即使已送达也禁止签收（人工覆盖不能绕过）', () => {
  const sign = applyCateringAction(rows, g0904.rows[0].id, '签收确认')!
  assert.equal(sign.ok, false)
  const cover = overrideStandard(rows, 'CATE-0904', '机长特批')
  assert.equal(cover.ok, false)
})

// 4) 超餐食标准（软阈值）：必须覆盖+原因才能签收
const g0903 = summarizeAll(rows).find((g) => g.number === 'CATE-0903')!
ok('350 份超标准但在硬限制内 -> 软冲突、可覆盖', () => {
  assert.equal(g0903.soft.length, 1)
  assert.equal(g0903.hard.length, 0)
})
ok('未覆盖时签收被拦', () => assert.equal(applyCateringAction(rows, g0903.rows[0].id, '签收确认')!.ok, false))
ok('覆盖缺少原因被拒', () => assert.equal(overrideStandard(rows, 'CATE-0903', ' ').ok, false))
const covered = overrideStandard(rows, 'CATE-0903', '航班满员加配，值班主任批准')
ok('登记原因后覆盖成功', () => {
  assert.equal(covered.ok, true)
  assert.ok(covered.rows)
})
const signed = applyCateringAction(covered.rows!, g0903.rows[0].id, '签收确认')!
ok('覆盖后签收成功并冻结口径、版本为当前', () => {
  assert.equal(signed.ok, true)
  const frozen = summarizeAll(signed.rows!).find((g) => g.number === 'CATE-0903')!
  assert.equal(frozen.portions, 350)
  assert.equal(frozen.basis, 'frozen-signed')
  assert.equal(frozen.ruleVersion, CURRENT_RULE_VERSION)
  assert.equal(applyCateringAction(signed.rows!, frozen.rows[0].id, '签收确认')!.ok, false)
})

// 5) 登记保存：超范围特殊需求 / 越界份数禁止保存
ok('白名单外特殊需求禁止保存', () => {
  const r = registerTask(rows, {
    number: 'CATE-NEW1', flight: 'CA0000', mealType: '经济餐', portions: 100,
    special: '生酮饮食', vehicle: '餐车-1', deliverAt: '', override: false, overrideReason: '',
  })
  assert.equal(r.ok, false)
})
ok(`份数超过硬上限 ${PORTION_HARD_MAX} 禁止保存，覆盖也无效`, () => {
  const r = registerTask(rows, {
    number: 'CATE-NEW2', flight: 'CA0000', mealType: '经济餐', portions: 999,
    special: '无', vehicle: '餐车-1', deliverAt: '', override: true, overrideReason: '特批',
  })
  assert.equal(r.ok, false)
})
ok('超餐食标准登记必须带覆盖原因', () => {
  const r = registerTask(rows, {
    number: 'CATE-NEW3', flight: 'CA0000', mealType: '经济餐', portions: 320,
    special: '无', vehicle: '餐车-1', deliverAt: '', override: false, overrideReason: '',
  })
  assert.equal(r.ok, false)
})
ok('同配餐编号重复登记被拒（已签收的重复签收只生效一次）', () => {
  const r = registerTask(rows, {
    number: 'CATE-0901', flight: 'CA0000', mealType: '经济餐', portions: 10,
    special: '无', vehicle: '', deliverAt: '', override: false, overrideReason: '',
  })
  assert.equal(r.ok, false)
})
ok('合法任务登记成功', () => {
  const r = registerTask(rows, {
    number: 'CATE-NEW4', flight: 'CA0000', mealType: '经济餐', portions: 100,
    special: '无坚果、清真', vehicle: '餐车-2', deliverAt: '', override: false, overrideReason: '',
  })
  assert.equal(r.ok, true)
})

// 6) checkRow：非法份数
ok('非整数份数判硬冲突', () => {
  const { hard } = checkRow({ '餐食类型': '经济餐', '配餐份数': 'abc', '特殊需求': '无' } as EntryRow)
  assert.ok(hard.some((v) => v.code === 'portions-invalid'))
})

// 7) 迁移幂等
ok('迁移幂等', () => {
  const againRows = migrateCatering(rows)
  assert.deepEqual(againRows, rows)
})

console.log(`\n全部 ${passed} 项断言通过`)
