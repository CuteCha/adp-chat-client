<script setup lang="ts">
/** 助手回复末尾的产物卡片：从回复文本中提取 /workdir/... 产物文件，
 *  统一展示并支持逐个下载 / 全部下载 / 点击预览。 */
import { computed } from 'vue'
import { downloadWorkspaceFile } from '../../api'
import { ensureWorkspaceId, previewFile, useWorkspace } from '../../composables/useWorkspace'

const props = defineProps<{ text: string }>()
const ws = useWorkspace()

export interface Artifact {
  path: string
  name: string
}

/** 从 markdown 文本中提取工作区产物路径（去重） */
const artifacts = computed<Artifact[]>(() => {
  const found: string[] = []
  const re = /\/workdir\/[^\s)\]}>（），。；：、"']+/gi
  for (const m of props.text.matchAll(re)) {
    // 去掉尾部可能被 markdown/标点带上的符号（含行内代码的反引号）
    found.push(m[0].replace(/[.,;:!?'"`]+$/, ''))
  }
  const seen = new Set<string>()
  const out: Artifact[] = []
  for (const path of found) {
    const lower = path.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push({ path, name: path.split('/').pop() || path })
  }
  return out
})

function preview(path: string) {
  previewFile(path)
}

async function downloadOne(path: string) {
  const workspaceId = await ensureWorkspaceId()
  await downloadWorkspaceFile(ws.applicationId, { workspaceId, path })
}

async function downloadAll() {
  for (const a of artifacts.value) {
    await downloadOne(a.path)
  }
}
</script>

<template>
  <div v-if="artifacts.length" class="arts">
    <div class="arts-head">
      <span class="label">产物（{{ artifacts.length }}）</span>
      <button v-if="artifacts.length > 1" class="dl-all" @click="downloadAll">全部下载</button>
    </div>
    <div v-for="a in artifacts" :key="a.path" class="card" @click="preview(a.path)">
      <span class="ico">📄</span>
      <span class="name" :title="a.path">{{ a.name }}</span>
      <span class="ops">
        <button class="op" title="预览" @click.stop="preview(a.path)">预览</button>
        <button class="op" title="下载" @click.stop="downloadOne(a.path)">⬇ 下载</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.arts {
  margin: 10px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.arts-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.label {
  font-size: 12px;
  color: #9aa1ab;
}
.dl-all {
  border: 1px solid #c9d4e8;
  border-radius: 999px;
  background: #fff;
  color: #2b62d9;
  font-size: 12px;
  padding: 2px 10px;
  cursor: pointer;
}
.dl-all:hover {
  background: #f0f4fd;
}
.card {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 460px;
  padding: 8px 12px;
  border: 1px solid #e2e7f0;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
}
.card:hover {
  border-color: #b9c8e8;
  background: #f7f9fd;
}
.ico {
  font-size: 15px;
}
.name {
  flex: 1;
  font-size: 13px;
  color: #2b3240;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ops {
  display: flex;
  gap: 4px;
}
.op {
  border: none;
  background: transparent;
  color: #2b62d9;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  white-space: nowrap;
}
.op:hover {
  background: #eef3fd;
}
</style>
