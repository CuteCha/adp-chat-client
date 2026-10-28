<script setup lang="ts">
/** 右侧工作区面板：文件树 + 预览。
 *  全局唯一实例，由 useWorkspace 的 state 驱动（顶部文件夹图标 /
 *  消息内文件链接 / 产物卡片三个入口共用）。 */
import { computed, ref, watch } from 'vue'
import { ensureWorkspaceId, closeWorkspace, useWorkspace } from '../../composables/useWorkspace'
import FileTree from './FileTree.vue'
import FilePreview from './FilePreview.vue'

const ws = useWorkspace()
const workspaceId = ref('')
const refreshKey = ref(0)
const loadingWs = ref(false)

const hasContext = computed(() => !!ws.applicationId && !!ws.conversationId)

async function loadWorkspaceId() {
  if (!hasContext.value) return
  loadingWs.value = true
  try {
    workspaceId.value = await ensureWorkspaceId()
  } finally {
    loadingWs.value = false
  }
}

watch(
  () => [ws.open, ws.applicationId, ws.conversationId],
  () => {
    if (ws.open) loadWorkspaceId()
  },
  { immediate: true },
)

function refresh() {
  refreshKey.value++
  loadWorkspaceId()
}

function onSelect(path: string) {
  ws.previewPath = path
  ws.version++
}
</script>

<template>
  <aside v-if="ws.open" class="panel">
    <header class="head">
      <span class="title">工作区</span>
      <button class="ico-btn" title="刷新" @click="refresh">⟳</button>
      <button class="ico-btn" title="关闭" @click="closeWorkspace">✕</button>
    </header>

    <div v-if="!hasContext" class="empty">当前没有进行中的会话，无法读取工作区。</div>

    <div v-else class="body" :class="{ 'no-preview': !ws.previewPath }">
      <div class="tree-col">
        <div v-if="loadingWs" class="ws-hint">正在连接工作区…</div>
        <div v-else-if="!workspaceId" class="ws-hint">未能获取工作区，请刷新重试。</div>
        <FileTree
          v-else
          :applicationId="ws.applicationId"
          :workspaceId="workspaceId"
          :activePath="ws.previewPath"
          :refreshKey="refreshKey"
          :isRoot="true"
          @select="onSelect"
        />
      </div>

      <div v-if="ws.previewPath" class="preview-col">
        <FilePreview
          :applicationId="ws.applicationId"
          :workspaceId="workspaceId"
          :path="ws.previewPath"
          :version="ws.version"
          :key="ws.previewPath"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  position: fixed;
  top: 56px;
  right: 12px;
  bottom: 12px;
  width: min(680px, calc(100vw - 40px));
  background: #fff;
  border: 1px solid #e2e7f0;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(31, 45, 71, 0.14);
  display: flex;
  flex-direction: column;
  z-index: 60;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid #e6e9ef;
}
.title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #2b3240;
}
.ico-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: #5b6472;
  padding: 4px 6px;
  border-radius: 6px;
}
.ico-btn:hover {
  background: #f0f3f8;
  color: #2b62d9;
}
.empty {
  padding: 24px;
  color: #9aa1ab;
  font-size: 13px;
  text-align: center;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.tree-col {
  flex: 0 0 230px;
  border-right: 1px solid #e6e9ef;
  overflow: auto;
  padding: 8px 6px;
}
.body.no-preview .tree-col {
  flex: 1;
  border-right: none;
}
.preview-col {
  flex: 1;
  min-width: 0;
}
.ws-hint {
  color: #9aa1ab;
  font-size: 12px;
  padding: 10px 8px;
}
</style>
