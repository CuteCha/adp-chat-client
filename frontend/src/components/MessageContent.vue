<script setup lang="ts">
/** 单条 Message 的渲染分发：reply / thought / tool_call / task_execution / 其它 */
import { computed, ref } from 'vue'
import type { Message } from '../sse/types'
import Markdown from './Markdown.vue'
import ReferenceTags from './ReferenceTags.vue'
import StatusLine from './StatusLine.vue'

const props = defineProps<{ message: Message; applicationId?: string }>()

const text = computed(() =>
  (props.message.Contents ?? [])
    .filter((c) => c.Type === 'text' || c.Type === 'json_text')
    .map((c) => c.Text ?? '')
    .join(''),
)
const references = computed(() =>
  (props.message.Contents ?? []).flatMap((c) => c.References ?? []),
)

const isThought = computed(() => props.message.Type === 'thought')
const isTool = computed(
  () => props.message.Type === 'tool_call' || props.message.Type === 'task_execution',
)
const collapsed = ref(isThought.value || isTool.value)

const title = computed(() => {
  if (isThought.value) return '思考过程'
  if (isTool.value) return props.message.Name || props.message.Title || '工具调用'
  return props.message.Title || ''
})
const running = computed(() => props.message.Status === 'processing')
/** 工具/思考执行中的轮播提示（折叠时显示在块下方） */
const EXEC_PHRASES = ['正在执行…', '正在调用工具处理…', '正在等待执行结果…', '快好了，请稍候…']
</script>

<template>
  <div class="msg">
    <!-- 正文：流式 markdown -->
    <div v-if="!isThought && !isTool" class="reply">
      <Markdown :source="text" />
      <ReferenceTags :references="references" :application-id="applicationId || ''" />
    </div>

    <!-- 思考 / 工具调用：默认折叠 -->
    <div v-else class="collapse">
      <button class="collapse-head" @click="collapsed = !collapsed">
        <span v-if="running" class="mini-spin" aria-hidden="true" />
        <span class="arrow">{{ collapsed ? '▸' : '▾' }}</span>
        <span class="name">{{ title }}</span>
        <span v-if="running" class="status">进行中…</span>
        <span v-else-if="message.Status === 'success'" class="status done">
          {{ message.ExtraInfo?.Elapsed ? message.ExtraInfo.Elapsed + 'ms' : '完成' }}
        </span>
      </button>
      <div v-show="!collapsed" class="collapse-body">
        <Markdown v-if="text" :source="text" />
        <div v-else class="placeholder">{{ message.StatusDesc || '等待数据…' }}</div>
        <ReferenceTags :references="references" :application-id="applicationId || ''" />
      </div>
    </div>
    <!-- 执行中且折叠：块下方给"正在执行…"动态提示，避免看似无输出 -->
    <StatusLine v-if="running && collapsed" :phrases="EXEC_PHRASES" class="running-line" />
  </div>
</template>

<style scoped>
.msg {
  margin: 8px 0;
}
.collapse-head {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: #5b6472;
  padding: 2px 0;
}
.collapse-head:hover {
  color: #2b62d9;
}
.arrow {
  font-size: 10px;
}
.mini-spin {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  border: 2px solid #d9e2ef;
  border-top-color: #34a853;
  border-radius: 50%;
  animation: mc-spin 0.9s linear infinite;
}
@keyframes mc-spin {
  to {
    transform: rotate(360deg);
  }
}
.running-line {
  margin: 2px 0 2px 14px;
}
.status {
  color: #9aa1ab;
  font-size: 12px;
}
.status.done {
  color: #7cb342;
}
.collapse-body {
  padding: 6px 0 6px 14px;
  border-left: 2px solid #e6e9ef;
  margin-left: 4px;
}
.placeholder {
  color: #9aa1ab;
  font-size: 13px;
}
</style>
