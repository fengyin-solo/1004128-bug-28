<template>
  <section class="page" data-module="catering">
    <header class="page-head">
      <div>
        <h2>航食配餐管理</h2>
        <p class="page-desc">维护配餐任务，围绕配餐编号、关联航班、餐食类型、配餐份数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记配餐任务</button>
        <button class="btn" type="button" @click="exportRows">导出航食配餐清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-violation': row.abnormal }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <div v-if="row.abnormal" class="error-text cell-hint">{{ row['规则提示'] }}</div>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in availableActions(String(row.status))"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!availableActions(String(row.status)).length" class="muted-text">已终结</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无航食配餐数据，可先登记配餐任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条航食配餐记录 · 待配餐份数合计 {{ pendingPortionTotal }} 份</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 详情抽屉：状态、份数全部取统一规则，与列表入口是同一份结论 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>配餐详情 · {{ detail.code }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>

        <dl class="detail-grid">
          <div><dt>配餐编号</dt><dd>{{ detail.code }}</dd></div>
          <div><dt>关联航班</dt><dd>{{ detail.flight || '—' }}</dd></div>
          <div><dt>餐食类型</dt><dd>{{ detail.mealType || '—' }}</dd></div>
          <div><dt>当前状态</dt><dd>{{ detail.status }}</dd></div>
          <div><dt>配餐份数</dt><dd>{{ detail.portions }} 份</dd></div>
          <!-- 修复点：详情页与列表同一口径，已签收/装配中/已送达不再按待配餐累计份数 -->
          <div><dt>待配餐份数</dt><dd>{{ detail.pendingPortions }} 份</dd></div>
          <div><dt>特殊需求</dt><dd>{{ detail.specialRequest }}</dd></div>
          <div><dt>特殊餐份数</dt><dd>{{ detail.specialPortions }} 份</dd></div>
          <div><dt>规则版本</dt><dd>v{{ detail.ruleVersion }}</dd></div>
          <div v-if="detail.row['签收时间']"><dt>签收时间</dt><dd>{{ detail.row['签收时间'] }}</dd></div>
        </dl>

        <p v-if="detail.violation" class="error-text detail-violation">餐食标准限制：{{ detail.violation }}</p>
        <p v-else-if="detail.signed" class="muted-text">历史已签收，保留原结论，规则调整不再回溯本单。</p>

        <fieldset class="override-box" :disabled="detail.signed">
          <legend>特殊需求登记 / 人工覆盖</legend>
          <label class="filter-item">
            <span>特殊需求（仅限餐食标准白名单）</span>
            <select v-model="form.request">
              <option v-for="option in allowedRequests" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="filter-item">
            <span>特殊餐份数（不超过配餐总份数 {{ detail.portions }}）</span>
            <input v-model.number="form.specialPortions" type="number" min="0" :max="detail.portions" />
          </label>
          <button class="btn primary" type="button" @click="saveSpecial">按餐食标准保存</button>
          <p v-if="detail.signed" class="muted-text">已签收任务为历史结论，不允许覆盖。</p>
        </fieldset>

        <div class="drawer-actions">
          <button
            v-for="action in availableActions(detail.status)"
            :key="action"
            class="btn"
            type="button"
            @click="runAction(action, detail.row)"
          >
            {{ action }}
          </button>
          <span v-if="!availableActions(detail.status).length" class="muted-text">该任务已终结</span>
        </div>

        <p v-if="detailMessage" class="error-text">{{ detailMessage }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  getCatering,
  listCatering,
  moduleMeta,
  runCateringAction,
  saveCateringSpecial,
} from '@/api/local-service'
import {
  ALLOWED_SPECIAL_REQUESTS,
  CATERING_STATUSES,
  type CateringView,
} from '@/data/catering-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('catering')
const columns = ['配餐编号', '关联航班', '餐食类型', '配餐份数', '特殊需求', '配餐车辆', '送达时间', '配餐状态']
const statuses = [...CATERING_STATUSES]
// 状态只能顺序推进：列表与详情都只暴露当前状态唯一的下一个动作，签收后无动作（不重复签收）。
const nextActionByStatus: Record<string, string[]> = {
  待配餐: ['开始装配'],
  装配中: ['确认送达'],
  已送达: ['签收确认'],
  已签收: [],
}
const allowedRequests = [...ALLOWED_SPECIAL_REQUESTS]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const detail = ref<CateringView | null>(null)
const detailMessage = ref('')
const form = reactive<{ request: string; specialPortions: number }>({ request: '无', specialPortions: 0 })

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待配餐航班', value: rows.value.filter((row) => String(row.status) === '待配餐').length },
  { label: '装配中航班', value: rows.value.filter((row) => String(row.status) === '装配中').length },
  { label: '已签收航班', value: rows.value.filter((row) => String(row.status) === '已签收').length },
  { label: '待配餐份数', value: pendingPortionTotal.value },
])

const pendingPortionTotal = computed(() =>
  rows.value
    .filter((row) => String(row.status) === '待配餐')
    .reduce((sum, row) => sum + Number(row['配餐份数'] || 0), 0),
)

function availableActions(status: string): string[] {
  return nextActionByStatus[status] ?? []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '配餐任务登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  detailMessage.value = ''
  const view = getCatering(Number(row.id))
  if (!view) {
    errorMessage.value = '配餐详情读取失败'
    return
  }
  detail.value = view
  form.request = view.specialRequest
  form.specialPortions = view.specialPortions
}

function closeDetail() {
  detail.value = null
  detailMessage.value = ''
}

function refreshDetail() {
  if (!detail.value) {
    return
  }
  const view = getCatering(detail.value.id)
  if (view) {
    detail.value = view
    form.request = view.specialRequest
    form.specialPortions = view.specialPortions
  } else {
    detail.value = null
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  detailMessage.value = ''
  const result = runCateringAction(Number(row.id), action)
  if (!result.ok) {
    if (detail.value) {
      detailMessage.value = result.message
    } else {
      errorMessage.value = result.message
    }
    return
  }
  reload()
}

function saveSpecial() {
  if (!detail.value) {
    return
  }
  detailMessage.value = ''
  const result = saveCateringSpecial(detail.value.id, form.request, Number(form.specialPortions))
  if (!result.ok) {
    detailMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 列表、详情、统计全部走统一规则重判。
    const payload = listCatering(filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshDetail()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '航食配餐列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.muted-text { color: var(--muted); font-size: 12px; }
.cell-hint { font-size: 12px; margin-top: 2px; }
.row-violation { background: #fff7f5; }
.drawer-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); display: flex; justify-content: flex-end; z-index: 50; }
.drawer { width: 420px; max-width: 92vw; background: #fff; height: 100%; padding: 16px 18px; overflow-y: auto; }
.drawer-head { display: flex; justify-content: space-between; align-items: center; }
.drawer-head h3 { margin: 0; font-size: 16px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 12px 0; }
.detail-grid dt { font-size: 12px; color: var(--muted); }
.detail-grid dd { margin: 2px 0 0; font-size: 13px; }
.detail-violation { font-size: 13px; }
.override-box { border: 1px dashed var(--border); border-radius: 8px; padding: 10px 12px; margin: 12px 0; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.override-box legend { padding: 0 6px; font-size: 12px; color: var(--muted); }
.drawer-actions { display: flex; gap: 8px; align-items: center; }
</style>
