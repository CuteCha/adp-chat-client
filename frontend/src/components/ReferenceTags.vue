<script setup lang="ts">
/**
 * 引用角标：点击拉取引用详情（DescribeRefer）。
 * 详情里有原文片段与文档来源，方便核对回答是否来自正确的文档。
 */
import { ref } from 'vue'
import type { Reference } from '../sse/types'
import { fetchReferenceDetails } from '../api'

const props = defineProps<{ references: Reference[]; applicationId: string }>()

const details = ref<Array<Record<string, any>> | null>(null)
const loading = ref(false)
const open = ref(false)

function idOf(ref: Reference): string {
  return ref.Id ?? ref.DocRefer?.ReferBizId ?? ''
}
function label(ref: Reference): string {
  return ref.Name || ref.DocRefer?.DocName || ref.Url || '引用'
}
function href(ref: Reference): string | null {
  return ref.Url || ref.DocRefer?.Url || ref.WebSearchRefer?.Url || null
}
function detailText(item: Record<string, any>): string {
  return String(item.Content ?? item.Text ?? item.Source ?? '')
}

async function toggle() {
  open.value = !open.value
  if (!open.value || details.value) return
  const ids = props.references.map(idOf).filter(Boolean)
  if (!ids.length) return
  loading.value = true
  try {
    details.value = await fetchReferenceDetails(props.applicationId, ids)
  } catch {
    details.value = []
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="references.length" class="refs">
    <span class="refs-title">引用</span>
    <a
      v-for="(ref, i) in references"
      :key="i"
      class="ref-tag"
      :href="href(ref) || undefined"
      target="_blank"
      rel="noreferrer"
    >
      [{{ ref.Index ?? i + 1 }}] {{ label(ref) }}
    </a>
    <button class="link" @click="toggle">{{ open ? '收起详情' : '查看引用详情' }}</button>

    <div v-if="open" class="detail">
      <div v-if="loading" class="tip">加载中…</div>
      <div v-else-if="!details?.length" class="tip">暂无引用详情</div>
      <div v-for="(item, i) in details ?? []" :key="i" class="detail-item">
        <div class="detail-title">
          {{ item.Name || item.DocName || '来源' }}
          <a v-if="item.Url" :href="item.Url" target="_blank" rel="noreferrer">打开</a>
        </div>
        <div v-if="detailText(item)" class="detail-text">{{ detailText(item) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.refs {
  margin-top: 8px;
  font-size: 12px;
}
.refs-title {
  color: #8a8f99;
  margin-right: 6px;
}
.ref-tag {
  display: inline-block;
  margin-right: 6px;
  background: #f2f4f7;
  border-radius: 4px;
  padding: 2px 8px;
  color: #3b6fd4;
  text-decoration: none;
}
.link {
  border: none;
  background: none;
  color: #2b62d9;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.detail {
  margin-top: 8px;
  border: 1px solid #eceef2;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fafbfc;
}
.detail-item {
  padding: 4px 0;
  border-bottom: 1px dashed #eceef2;
}
.detail-item:last-child {
  border-bottom: none;
}
.detail-title {
  color: #5b6472;
}
.detail-text {
  color: #7a8290;
  white-space: pre-wrap;
}
.tip {
  color: #9aa1ab;
}
</style>
