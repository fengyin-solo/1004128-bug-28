<template>
  <section class="page" data-module="catering">
    <header class="page-head">
      <div>
        <h2>航食配餐管理</h2>
        <p class="page-desc">同配餐编号统一判定状态与份数；超范围特殊需求禁止保存，人工覆盖仅限餐食标准且须登记原因。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记配餐任务</button>
        <button class="btn" type="button" @click="exportRows">导出航食配餐清单</button>
      </div>
    </header>

    <p class="rule-banner">
      当前配餐规则版本 v{{ CURRENT_RULE_VERSION }}：份数明确限制
      {{ PORTION_HARD_MIN }}~{{ PORTION_HARD_MAX }} 份；餐食标准 {{ PORTION_STANDARD_MAX }}
      份以内；特殊需求限白名单（{{ SPECIAL_REQUESTS.filter((item) => item !== '无').join('、') }}）。
      规则调整后未结束任务按新口径重判，已签收任务保留签收时冻结结论，重复签收只生效一次。
    </p>

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
          <th>统一状态</th>
          <th>判定与份数</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="group in groups" :key="group.number">
          <td>
            <RouterLink class="link" :to="`/catering/${encodeURIComponent(group.number)}`">
              {{ group.number }}
            </RouterLink>
            <span v-if="group.merged" class="tag info">同号 {{ group.rows.length }} 条归并</span>
          </td>
          <td>{{ group.flight }}</td>
          <td>{{ group.mealTypes.join('、') }}</td>
          <td>
            <strong>{{ group.portions }}</strong> 份
            <span class="tag" :class="group.signed ? 'frozen' : 'ok'">
              {{ group.signed ? '签收口径冻结' : '按当前规则' }}
            </span>
          </td>
          <td>
            <span v-if="!group.specials.length">无</span>
            <span v-else>{{ group.specials.join('、') }}</span>
            <span v-for="item in group.hard" :key="item.code" class="tag hard">限制冲突</span>
            <span v-if="group.soft.length" class="tag" :class="group.overridden ? 'ok' : 'soft'">
              {{ group.overridden ? '已人工覆盖' : '超餐食标准' }}
            </span>
          </td>
          <td>{{ group.vehicles.join('、') || '—' }}</td>
          <td>{{ group.deliverAt || '—' }}</td>
          <td>
            {{ group.status }}
            <span v-if="group.signed" class="tag frozen">v{{ group.ruleVersion }}</span>
            <span v-if="group.rows.some((row) => row.abnormal)" class="tag hard">异常</span>
          </td>
          <td>
            <div class="row-actions">
              <button
                v-for="action in availableActions(group)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, group)"
              >
                {{ action }}
              </button>
              <button
                v-if="canOverride(group)"
                class="link"
                type="button"
                @click="openOverride(group)"
              >
                人工覆盖
              </button>
              <span v-if="!availableActions(group).length && !canOverride(group)" class="tag frozen">
                已结束
              </span>
            </div>
          </td>
        </tr>
        <tr v-if="!groups.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无航食配餐数据，可先登记配餐任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 个配餐单（{{ rowTotal }} 条任务记录）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记配餐任务 -->
    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="modal-card">
        <h3 class="modal-title">登记配餐任务</h3>
        <p class="modal-tip">
          特殊需求超出白名单、份数超出 {{ PORTION_HARD_MIN }}~{{ PORTION_HARD_MAX }}
          份等明确限制一律不能保存；份数超餐食标准 {{ PORTION_STANDARD_MAX }}
          份可人工覆盖，但必须登记原因。
        </p>
        <div class="form-grid">
          <label for="catering-number">配餐编号</label>
          <input id="catering-number" v-model.trim="draft.number" placeholder="如 CATE-0100" />
          <label for="catering-flight">关联航班</label>
          <input id="catering-flight" v-model.trim="draft.flight" placeholder="如 CA1831" />
          <label for="catering-meal">餐食类型</label>
          <select id="catering-meal" v-model="draft.mealType">
            <option v-for="item in MEAL_TYPES" :key="item" :value="item">{{ item }}</option>
          </select>
          <label for="catering-portions">配餐份数</label>
          <input id="catering-portions" v-model.number="draft.portions" type="number" min="1" max="500" />
          <label for="catering-special">特殊需求</label>
          <input
            id="catering-special"
            v-model.trim="draft.special"
            list="special-options"
            :placeholder="`白名单：${SPECIAL_REQUESTS.filter((item) => item !== '无').join('、')}；多个用顿号`"
          />
          <datalist id="special-options">
            <option v-for="item in SPECIAL_REQUESTS" :key="item" :value="item" />
          </datalist>
          <label for="catering-vehicle">配餐车辆</label>
          <input id="catering-vehicle" v-model.trim="draft.vehicle" placeholder="如 餐车-07" />
          <label for="catering-deliver">计划送达</label>
          <input id="catering-deliver" v-model.trim="draft.deliverAt" type="datetime-local" />
          <template v-if="portionsOverStandard">
            <span></span>
            <label class="form-check">
              <input v-model="draft.override" type="checkbox" />
              份数 {{ draft.portions }} 超出餐食标准 {{ PORTION_STANDARD_MAX }} 份，确认人工覆盖
            </label>
            <template v-if="draft.override">
              <label for="catering-reason">覆盖原因</label>
              <textarea
                id="catering-reason"
                v-model.trim="draft.overrideReason"
                placeholder="必填：说明为何超出餐食标准，覆盖仅限此软阈值，不能越过明确限制"
              ></textarea>
            </template>
          </template>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">保存配餐任务</button>
        </div>
      </div>
    </div>

    <!-- 人工覆盖餐食标准 -->
    <div v-if="overrideTarget" class="modal-mask" @click.self="overrideTarget = null">
      <div class="modal-card">
        <h3 class="modal-title">人工覆盖餐食标准</h3>
        <p class="modal-tip">
          配餐单 {{ overrideTarget.number }}（{{ overrideTarget.flight }}）份数
          {{ overrideTarget.portions }} 超出餐食标准 {{ PORTION_STANDARD_MAX }}
          份。覆盖仅对该软阈值生效；明确限制冲突不能通过覆盖绕过。
        </p>
        <div class="form-grid">
          <label for="override-reason">覆盖原因</label>
          <textarea
            id="override-reason"
            v-model.trim="overrideReason"
            placeholder="必填：登记人工覆盖原因，至少 2 个字"
          ></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="overrideTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitOverride">确认覆盖</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listCateringGroups,
  moduleMeta,
  overrideCateringStandard,
  registerCatering,
  runAction as applyAction,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import {
  CURRENT_RULE_VERSION,
  MEAL_TYPES,
  PORTION_HARD_MAX,
  PORTION_HARD_MIN,
  PORTION_STANDARD_MAX,
  SPECIAL_REQUESTS,
  availableActions,
  isOverStandard,
  parsePortions,
  type CateringDraft,
  type CateringGroupSummary,
} from '@/domain/catering-rules'

const meta = moduleMeta('catering')
const columns = ['配餐编号', '关联航班', '餐食类型', '配餐份数', '特殊需求', '配餐车辆', '送达时间']
const statuses = ['待配餐', '装配中', '已送达', '已签收']
const filterFields = ['配餐编号', '关联航班', '餐食类型']

const groups = ref<CateringGroupSummary[]>([])
const total = ref(0)
const rowTotal = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: groups.value.filter((group) => group.status === status).length,
  })),
)

const stats = computed(() => [
  { label: '待配餐配餐单', value: statusSummary.value[0].count + statusSummary.value[1].count },
  { label: '待签收配餐单', value: statusSummary.value[2].count },
  { label: '已签收配餐单', value: statusSummary.value[3].count },
])

const showCreate = ref(false)
const draft = ref<CateringDraft>({
  number: '',
  flight: '',
  mealType: MEAL_TYPES[0],
  portions: 100,
  special: '无',
  vehicle: '',
  deliverAt: '',
  override: false,
  overrideReason: '',
})
const portionsOverStandard = computed(
  () => isOverStandard(Number(draft.value.portions)) && parsePortions(draft.value.portions) !== null,
)

const overrideTarget = ref<CateringGroupSummary | null>(null)
const overrideReason = ref('')

function canOverride(group: CateringGroupSummary): boolean {
  return !group.signed && group.soft.length > 0 && !group.overridden
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  draft.value = {
    number: '',
    flight: '',
    mealType: MEAL_TYPES[0],
    portions: 100,
    special: '无',
    vehicle: '',
    deliverAt: '',
    override: false,
    overrideReason: '',
  }
  showCreate.value = true
}

function submitCreate() {
  const result = registerCatering(draft.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  showCreate.value = false
  reload()
}

function openOverride(group: CateringGroupSummary) {
  errorMessage.value = ''
  overrideTarget.value = group
  overrideReason.value = ''
}

function submitOverride() {
  if (!overrideTarget.value) {
    return
  }
  const result = overrideCateringStandard(overrideTarget.value.number, overrideReason.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  overrideTarget.value = null
  reload()
}

function runAction(action: string, group: CateringGroupSummary) {
  errorMessage.value = ''
  // 动作以配餐编号整组生效，传组内任一任务 id 即可，服务端按编号统一处理
  const result = applyAction(meta.key, Number(group.rows[0].id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    groups.value = listCateringGroups(filters.value)
    total.value = groups.value.length
    rowTotal.value = listRows(meta.key).length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '航食配餐列表读取失败'
  }
}

onMounted(reload)
</script>
