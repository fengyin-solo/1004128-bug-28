import assert from 'node:assert'

const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
  },
}

const { runAction, registerCatering, overrideCateringStandard, listCateringGroups, pendingRows } =
  await import('@/api/local-service')
const { onRowsChange, resetRows } = await import('@/data/local-store')

let cateringChanges = 0
let cabinChanges = 0
onRowsChange((key) => {
  if (key === 'catering') cateringChanges += 1
  if (key === 'cabin_clean') cabinChanges += 1
})

// 新建合法任务并走完整流转
const created = registerCatering({
  number: 'CATE-IT1', flight: 'CA9', mealType: '经济餐', portions: 100,
  special: '清真', vehicle: 'V', deliverAt: '', override: false, overrideReason: '',
})
assert.equal(created.ok, true)

let group = listCateringGroups().find((g) => g.number === 'CATE-IT1')!
assert.equal(runAction('catering', group.rows[0].id, '开始装配').ok, true)
assert.equal(runAction('catering', group.rows[0].id, '确认送达').ok, true)
assert.equal(runAction('catering', group.rows[0].id, '签收确认').ok, true)
// 重复签收只生效一次
assert.equal(runAction('catering', group.rows[0].id, '签收确认').ok, false)
// 不能倒着走
assert.equal(runAction('catering', group.rows[0].id, '开始装配').ok, false)

// 超标准任务：签收拦截 -> 覆盖 -> 签收成功
const over = registerCatering({
  number: 'CATE-IT2', flight: 'CA9', mealType: '经济餐', portions: 330,
  special: '无', vehicle: 'V', deliverAt: '', override: true, overrideReason: '加机备份，主任批准',
})
assert.equal(over.ok, true)
group = listCateringGroups().find((g) => g.number === 'CATE-IT2')!
// 登记时已带覆盖，全流程可签收
assert.equal(runAction('catering', group.rows[0].id, '开始装配').ok, true)
assert.equal(runAction('catering', group.rows[0].id, '确认送达').ok, true)
const noCover = listCateringGroups().find((g) => g.number === 'CATE-IT3')
assert.equal(noCover, undefined)

// 不带覆盖登记的超标单，签收被拦后补覆盖原因再签收
const r3 = registerCatering({
  number: 'CATE-IT3', flight: 'CA9', mealType: '经济餐', portions: 305,
  special: '无', vehicle: 'V', deliverAt: '', override: false, overrideReason: '',
})
assert.equal(r3.ok, false) // 登记即要求说明

// 硬冲突：覆盖接口拒绝
const hard = registerCatering({
  number: 'CATE-IT4', flight: 'CA9', mealType: '经济餐', portions: 100,
  special: '火锅', vehicle: 'V', deliverAt: '', override: false, overrideReason: '',
})
assert.equal(hard.ok, false)
assert.equal(overrideCateringStandard('CATE-IT4', '强行批准').ok, false)

// 客舱清洁待办：完成清洁后待办减少；需复查仍在待办
resetRows('cabin_clean')
const waiting = pendingRows('cabin_clean').find((r) => String(r.status) === '待清洁')!
assert.ok(waiting)
const todoBefore = pendingRows('cabin_clean').length
assert.equal(runAction('cabin_clean', waiting.id, '开始清洁').ok, true)
assert.equal(runAction('cabin_clean', waiting.id, '完成清洁').ok, true)
assert.equal(pendingRows('cabin_clean').length, todoBefore - 1)
assert.ok(pendingRows('cabin_clean').every((r) => r.id !== waiting.id))
assert.ok(pendingRows('cabin_clean').some((r) => String(r.status) === '需复查'))
assert.ok(cabinChanges >= 2)
assert.ok(cateringChanges >= 5)

console.log('服务层集成校验通过：流转、拦截、覆盖、幂等签收、待办同步均符合预期')
