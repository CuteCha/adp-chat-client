<script setup lang="ts">
import type { ConversationItem } from '../api'

const props = defineProps<{
  items: ConversationItem[]
  activeId: string
  /** 会话Id → 本地标题（用户首条提问前 10 字），覆盖上游为空的 Title */
  titles?: Record<string, string>
  /** 当前查看的会话正在流式输出 → 标题旁转圈 */
  streaming?: boolean
  /** 所有正在流式的会话 Id（含后台任务）→ 条目转圈 */
  streamingIds?: string[]
  /** 新任务发送中、会话还没出现在列表里 → 顶部临时条目带转圈 */
  pendingTitle?: string
  /** 首条提问流式期间、本地标题尚未落位 → active 条目临时显示它 */
  activeStreamTitle?: string
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create'): void
  (e: 'delete', id: string): void
}>()

/** 上游的「新对话」字面量视同无标题 */
function titleFor(item: ConversationItem, titles?: Record<string, string>): string {
  const local = titles?.[item.Id]
  if (local) return local
  if (item.Title && item.Title !== '新对话') return item.Title
  return '新任务'
}

function formatTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="list">
    <button class="new" @click="emit('create')">+ 新建任务</button>
    <div v-if="!items.length && !pendingTitle" class="empty">暂无会话</div>

    <!-- 进行中的新任务：会话列表尚未刷新出该会话，先占位显示 -->
    <div v-if="pendingTitle" class="item active">
      <div class="title-row">
        <span class="title">{{ pendingTitle }}</span>
        <span class="spinner" title="任务进行中" />
      </div>
    </div>

    <div
      v-for="item in items"
      :key="item.Id"
      class="item"
      :class="{ active: item.Id === activeId }"
      @click="emit('select', item.Id)"
    >
      <div class="title-row">
        <span class="title">{{
          streaming && item.Id === activeId && activeStreamTitle
            ? activeStreamTitle
            : titleFor(item, props.titles)
        }}</span>
        <span
          v-if="streamingIds?.includes(item.Id) || (streaming && item.Id === activeId)"
          class="spinner"
          title="任务进行中"
        />
      </div>
      <div class="row">
        <span class="time">{{ formatTime(item.LastActiveAt) }}</span>
        <button class="del" @click.stop="emit('delete', item.Id)">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
}
.new {
  border: 1px dashed #c9d2e0;
  background: #fff;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  color: #2b62d9;
}
.item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.item:hover {
  background: #eef1f6;
}
.item.active {
  background: #e4ecff;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.title {
  font-size: 13px;
  color: #2b3240;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.spinner {
  flex: 0 0 12px;
  width: 12px;
  height: 12px;
  border: 2px solid #dbe6ff;
  border-top-color: #2b62d9;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.time {
  font-size: 11px;
  color: #9aa1ab;
}
.del {
  border: none;
  background: transparent;
  color: #b0b6c0;
  cursor: pointer;
  font-size: 11px;
}
.del:hover {
  color: #d93026;
}
.empty {
  color: #9aa1ab;
  font-size: 12px;
  text-align: center;
  padding: 12px 0;
}
</style>
