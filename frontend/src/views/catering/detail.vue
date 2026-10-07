<template>
  <section class="page" data-module="catering-detail">
    <RouterLink class="back-link" to="/catering">← 返回航食配餐列表</RouterLink>
    <header class="page-head">
      <div>
        <h2>配餐单 {{ number }}</h2>
        <p class="page-desc">状态与份数与列表入口共用同一判定口径；已签收按签收冻结口径展示，不再重判。</p>
      </div>
    </header>

    <div v-if="!group" class="rule-banner error-text">没有找到配餐编号 {{ number }} 的任务。</div>

    <template v-else>
      <dl class="detail-grid">
        <dt>统一状态</dt>
        <dd>
          <strong>{{ group.status }}</strong>
          <span v-if="group.signed" class="tag frozen">已签收 · 结论冻结（规则 v{{ group.ruleVersion }}）</span>
          <span v-else class="tag ok">按当前规则 v{{ CURRENT_RULE_VERSION }} 判定</span>
          <span v-if="group.merged" class="tag info">同编号 {{ group.rows.length }} 条归并</span>
        </dd>
        <dt>关联航班</dt>
        <dd>{{ group.flight }}</dd>
        <dt>餐食类型</dt>
        <dd>{{ group.mealTypes.join('、') }}</dd>
        <dt>配餐份数</dt>
        <dd>
          <strong>{{ group.portions }}</strong> 份（{{ group.rows.length }}
          条任务合计），口径：{{ group.basis === 'frozen-signed' ? '签收时冻结份数' : '按当前规则计算' }}
        </dd>
        <dt>特殊需求</dt>
        <dd>{{ group.specials.length ? group.specials.join('、') : '无' }}</dd>
        <dt>配餐车辆</dt>
        <dd>{{ group.vehicles.join('、') || '—' }}</dd>
        <dt>计划/实际送达</dt>
        <dd>{{ group.deliverAt || '—' }}</dd>
        <dt>规则校验</dt>
        <dd>
          <span v-if="group.signed" class="tag frozen">历史签收结论保留，不再重判</span>
          <template v-else>
            <span v-if="!group.hard.length && !group.soft.length" class="tag ok">符合全部限制与标准</span>
            <span v-for="item in group.hard" :key="item.code" class="tag hard">
              明确限制冲突：{{ item.message }}
            </span>
            <span v-for="item in group.soft" :key="item.code" class="tag" :class="group.overridden ? 'ok' : 'soft'">
              餐食标准：{{ item.message }}
            </span>
            <span v-if="group.overridden" class="tag ok">已人工覆盖并登记原因</span>
          </template>
        </dd>
      </dl>

      <div class="detail-block">
        <h3>同编号任务明细</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>记录ID</th>
              <th>关联航班</th>
              <th>餐食类型</th>
              <th>登记份数</th>
              <th>签收口径份数</th>
              <th>特殊需求</th>
              <th>配餐车辆</th>
              <th>状态</th>
              <th>规则版本</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="row.id">
              <td>{{ row.id }}</td>
              <td>{{ row['关联航班'] }}</td>
              <td>{{ row['餐食类型'] }}</td>
              <td>{{ row['配餐份数'] }}</td>
              <td>{{ row['签收口径份数'] ?? '—' }}</td>
              <td>{{ row['特殊需求'] }}</td>
              <td>{{ row['配餐车辆'] || '—' }}</td>
              <td>{{ row.status }}</td>
              <td>v{{ Number(row['规则版本']) || CURRENT_RULE_VERSION }}</td>
              <td>
                <span v-if="row['同号归并'] === '是'" class="tag info">按历史签收归并</span>
                <span v-else-if="String(row.status) === '已签收'" class="tag frozen">历史签收</span>
                <span v-else-if="row.abnormal" class="tag hard">新口径判定异常</span>
                <span v-else class="tag ok">新口径通过</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="rule-banner">
        口径说明：未结束任务始终按当前规则（v{{ CURRENT_RULE_VERSION }}）重判份数与限制；
        已签收任务按签收时冻结的份数与规则版本展示，规则调整不改变历史结论；同配餐编号重复签收只生效一次。
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { listRows } from '@/data/local-store'
import { CURRENT_RULE_VERSION, summarizeAll } from '@/domain/catering-rules'

const route = useRoute()
const number = decodeURIComponent(String(route.params.number ?? ''))

const group = computed(() =>
  summarizeAll(listRows('catering')).find((item) => item.number === number) ?? null,
)
</script>
