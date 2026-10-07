import { defineStore } from 'pinia'

import { pendingRows } from '@/api/local-service'
import { onRowsChange } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const CABIN_KEY = 'cabin_clean'

/**
 * 客舱清洁待办：在系统任意页面都保持同步。
 * 订阅本地数据变更，清洁页面完成/复查后其它页面立即更新。
 */
export const useCabinTodoStore = defineStore('cabinTodo', {
  state: () => ({
    items: [] as EntryRow[],
    // 初始化时先取一次快照，bind() 之后才订阅变更
    ...(typeof window !== 'undefined'
      ? { items: pendingRows(CABIN_KEY) }
      : {}),
    unsubscribe: null as null | (() => void),
  }),
  getters: {
    count: (state) => state.items.length,
  },
  actions: {
    refresh() {
      this.items = pendingRows(CABIN_KEY)
    },
    bind() {
      if (this.unsubscribe) {
        return
      }
      this.refresh()
      this.unsubscribe = onRowsChange((key) => {
        if (key === CABIN_KEY) {
          this.refresh()
        }
      })
    },
  },
})
