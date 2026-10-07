<template>
  <section v-if="route.name !== 'cabin_clean'" class="todo-panel">
    <header class="todo-head">
      <span>客舱清洁待办</span>
      <strong class="todo-count">{{ store.count }}</strong>
    </header>
    <ul v-if="store.items.length" class="todo-list">
      <li v-for="item in store.items.slice(0, 4)" :key="item.id">
        <RouterLink class="todo-link" to="/cabin_clean">
          <span class="todo-flight">{{ item['关联航班'] }} · {{ item['清洁类型'] }}</span>
          <span class="todo-status">{{ item.status }}</span>
        </RouterLink>
      </li>
      <li v-if="store.items.length > 4" class="todo-more">
        <RouterLink class="todo-link" to="/cabin_clean">
          还有 {{ store.items.length - 4 }} 条，前往清洁清单处理
        </RouterLink>
      </li>
    </ul>
    <p v-else class="todo-empty">清洁清单暂无待办</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'

import { useCabinTodoStore } from '@/stores/cabin-todo'

// 挂在侧边栏，因此每个页面打开都会看到与清洁清单一致的待办；清洁页自身不重复展示。
const store = useCabinTodoStore()
const route = useRoute()

onMounted(() => {
  store.bind()
})
</script>
