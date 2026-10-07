<template>
  <div v-if="todos.length" class="todo-banner">
    <div class="todo-banner-head">
      <strong>客舱清洁待办（同步）</strong>
      <span class="todo-banner-count">{{ todos.length }} 项未结束</span>
      <RouterLink class="todo-link" to="/cabin_clean">前往处理</RouterLink>
      <button class="todo-refresh" type="button" @click="reload">刷新同步</button>
    </div>
    <ul class="todo-banner-list">
      <li v-for="item in todos" :key="String(item.id)">
        {{ item['清洁编号'] }} · {{ item['关联航班'] }} · {{ item.status }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { cabinCleanTodo } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

// 客舱清洁清单在所有「其它页面」共用同一份待办口径；
// 路由切换时重新读取，保证在清洁页处理完后，跳到任何页面看到的待办都已同步。
const route = useRoute()
const todos = ref<EntryRow[]>([])

function reload() {
  todos.value = cabinCleanTodo()
}

onMounted(reload)
watch(() => route.path, reload)
</script>

<style scoped>
.todo-banner { background: #fff; border: 1px solid var(--border); border-left: 4px solid var(--brand); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
.todo-banner-head { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.todo-banner-count { color: var(--brand); font-size: 12px; }
.todo-link { font-size: 12px; }
.todo-refresh { margin-left: auto; border: none; background: none; color: var(--muted); cursor: pointer; font-size: 12px; }
.todo-banner-list { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 16px; }
.todo-banner-list li { list-style: disc; }
</style>
