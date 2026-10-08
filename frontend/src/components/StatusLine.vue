<script lang="ts">
/** 默认轮播文案（普通 script 块导出，供 withDefaults 默认值引用） */
export const DEFAULT_PHRASES = [
  '我先把目标捋顺，马上开工…',
  '正在翻翻上下文，看看你真正需要什么…',
  '正在整理思路，组织答案…',
  '正在检索相关资料…',
  '正在生成内容，请稍候…',
]
</script>

<script setup lang="ts">
/** 执行中动态提示：转圈 + 轮播文案，避免长时间无可见输出时"看似卡住" */
import { onMounted, onUnmounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{ phrases?: string[]; interval?: number }>(),
  { phrases: () => DEFAULT_PHRASES, interval: 4000 },
)

const idx = ref(0)
let timer: number | undefined
onMounted(() => {
  timer = window.setInterval(() => {
    idx.value = (idx.value + 1) % props.phrases.length
  }, props.interval)
})
onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <div class="status-line">
    <span class="spinner" aria-hidden="true" />
    <span class="text">{{ phrases[idx] }}</span>
  </div>
</template>

<style scoped>
.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9aa1ab;
  font-size: 13px;
  padding: 2px 0;
}
.spinner {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border: 2px solid #d9e2ef;
  border-top-color: #34a853;
  border-radius: 50%;
  animation: status-spin 0.9s linear infinite;
}
@keyframes status-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
