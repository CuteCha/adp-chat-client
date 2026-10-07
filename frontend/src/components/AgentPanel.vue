<script setup lang="ts">
/**
 * Skills / 工具 / 连接器 / 知识库 四个按钮共用的面板。
 *
 * 统一模式：进面板先 ensureAgentId + DescribeAgentDetail 拿到「已安装集合」，
 * 然后从广场搜索「候选集合」，安装 = 追加，卸载 = 移除，最后整体写回上游。
 */
import { computed, ref, watch } from 'vue'
import {
  KNOWLEDGE_TOOL,
  PLUGIN_CLASS,
  type AgentDetail,
  bindTool,
  describeAgent,
  ensureAgentId,
  listKnowledge,
  listPlugins,
  listSkillCategories,
  listSkillSummary,
  parseKnowledgeScope,
  setKnowledgeScope,
  setSkillList,
  unbindTool,
} from '../composables/useAgent'
import { invalidateInstalledSkills } from '../composables/useInstalledSkills'

const props = defineProps<{
  applicationId: string
  /** 打开时默认停留的能力页签 */
  initialTab?: Tab
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

type Tab = 'skill' | 'tool' | 'connector' | 'knowledge'
const TABS: { key: Tab; label: string }[] = [
  { key: 'skill', label: 'Skills' },
  { key: 'tool', label: '工具' },
  { key: 'connector', label: '连接器' },
  { key: 'knowledge', label: '知识库' },
]

const tab = ref<Tab>(props.initialTab ?? 'skill')
const agentId = ref('')
const detail = ref<AgentDetail | null>(null)
const loading = ref(false)
const working = ref('')
const error = ref('')

const keyword = ref('')
const skillItems = ref<Record<string, any>[]>([])
const categories = ref<{ key: string; name: string }[]>([])
const pluginItems = ref<Record<string, any>[]>([])
const knowledgeItems = ref<{ id: string; name: string; desc: string }[]>([])

const installedSkillIds = computed(() =>
  (detail.value?.skills ?? []).map((s) => String(s.SkillId ?? '')).filter(Boolean),
)

/** 已安装插件/工具的 PluginId（可能藏在 Config 子对象里） */
function extractPluginId(item: Record<string, any>): string {
  const direct = item?.PluginId ?? item?.pluginId
  if (direct) return String(direct)
  const config = item?.Config ?? item?.config
  return String(config?.PluginId ?? config?.pluginId ?? '')
}

const installedPluginIds = computed(() =>
  (detail.value?.plugins ?? []).map(extractPluginId).filter(Boolean),
)

const knowledgeTool = computed(
  () => (detail.value?.tools ?? []).find((t) => (t.Name ?? t.name) === KNOWLEDGE_TOOL) ?? null,
)
const knowledgeScope = computed(() =>
  knowledgeTool.value ? parseKnowledgeScope(knowledgeTool.value) : { allKnowledge: true, ids: [] as string[] },
)
const enabledKnowledgeIds = computed(() =>
  knowledgeScope.value.allKnowledge ? knowledgeItems.value.map((k) => k.id) : knowledgeScope.value.ids,
)

async function refreshDetail() {
  loading.value = true
  error.value = ''
  try {
    agentId.value = await ensureAgentId(props.applicationId)
    detail.value = await describeAgent(props.applicationId, agentId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function searchSkills() {
  const { list } = await listSkillSummary(props.applicationId, keyword.value)
  skillItems.value = list
}

async function searchPlugins() {
  const pluginClass = tab.value === 'connector' ? PLUGIN_CLASS.Connector : PLUGIN_CLASS.Tool
  const { list } = await listPlugins(props.applicationId, pluginClass, keyword.value)
  pluginItems.value = list
}

async function searchKnowledge() {
  knowledgeItems.value = await listKnowledge(props.applicationId)
}

async function refreshTabData() {
  error.value = ''
  try {
    if (tab.value === 'skill') {
      if (!categories.value.length) categories.value = await listSkillCategories(props.applicationId)
      await searchSkills()
    } else if (tab.value === 'knowledge') {
      await searchKnowledge()
    } else {
      await searchPlugins()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  }
}

// 切换 Tab / 打开面板：拉一遍已安装集合与候选集合
watch([tab, () => props.applicationId], () => {
  refreshTabData()
})
watch(
  () => props.applicationId,
  () => refreshDetail(),
  { immediate: true },
)
refreshTabData()

/** 广场条目的名称/描述在 Profile 嵌套里（DescribeSkillSummaryList / DescribePluginSummaryList） */
function nameOf(item: Record<string, any>, fallback = '未命名'): string {
  const p = item?.Profile ?? {}
  return String(p?.DisplayName ?? p?.Name ?? item?.DisplayName ?? item?.Name ?? item?.Title ?? fallback)
}
function descOf(item: Record<string, any>): string {
  const p = item?.Profile ?? {}
  return String(p?.DisplayDescription ?? p?.Description ?? item?.DisplayDescription ?? item?.Description ?? item?.Desc ?? '')
}
function idOf(item: Record<string, any>): string {
  return String(item?.SkillId ?? item?.skillId ?? item?.PluginId ?? item?.pluginId ?? '')
}

async function run(label: string, fn: () => Promise<void>) {
  working.value = label
  error.value = ''
  try {
    await fn()
    await refreshDetail()
    await refreshTabData()
    // 安装/卸载改变了已安装集合，让 Sender 侧的 Skills 快选 / @ 菜单缓存失效
    invalidateInstalledSkills(props.applicationId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    working.value = ''
  }
}

function toggleSkill(item: Record<string, any>) {
  const id = idOf(item)
  const installed = installedSkillIds.value.includes(id)
  const next = installed
    ? installedSkillIds.value.filter((i) => i !== id)
    : [...installedSkillIds.value, id]
  return run(nameOf(item), async () => {
    await setSkillList(props.applicationId, agentId.value, next)
  })
}

function togglePlugin(item: Record<string, any>, installed: boolean) {
  const pluginId = idOf(item) || extractPluginId(item)
  if (!pluginId) return
  return run(nameOf(item), async () => {
    if (installed) await unbindTool(props.applicationId, agentId.value, pluginId)
    else await bindTool(props.applicationId, agentId.value, pluginId)
  })
}

async function removeTool(tool: Record<string, any>) {
  const pluginId = extractPluginId(tool) || String(tool?.PluginId ?? '')
  const toolId = String(tool?.ToolId ?? tool?.toolId ?? '')
  if (!pluginId) return
  await run(nameOf(tool), async () => {
    await unbindTool(props.applicationId, agentId.value, pluginId, toolId)
  })
}

function isKnowledgeEnabled(id: string): boolean {
  return knowledgeScope.value.allKnowledge || knowledgeScope.value.ids.includes(id)
}

function toggleKnowledge(item: { id: string; name: string }) {
  const nextIds = isKnowledgeEnabled(item.id)
    ? enabledKnowledgeIds.value.filter((i) => i !== item.id)
    : [...new Set([...enabledKnowledgeIds.value, item.id])]
  return run(item.id, async () => {
    if (!knowledgeTool.value) return
    await setKnowledgeScope(props.applicationId, agentId.value, knowledgeTool.value, false, nextIds)
  })
}

function toggleAllKnowledge() {
  return run('全部知识库', async () => {
    if (!knowledgeTool.value) return
    await setKnowledgeScope(props.applicationId, agentId.value, knowledgeTool.value, !knowledgeScope.value.allKnowledge, [])
  })
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="panel">
      <header class="head">
        <div class="tabs">
          <button
            v-for="t in TABS"
            :key="t.key"
            :class="{ active: tab === t.key }"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="head-right">
          <span class="agent">AgentId: {{ agentId || '未就绪' }}</span>
          <button class="ghost" @click="emit('close')">关闭</button>
        </div>
      </header>

      <div class="toolbar">
        <input v-model="keyword" class="search" placeholder="搜索…" @keyup.enter="refreshTabData" />
        <button class="ghost" @click="refreshTabData">搜索</button>
        <span v-if="working" class="working">{{ working }} 处理中…</span>
      </div>

      <div v-if="error" class="err">{{ error }}</div>
      <div v-if="loading && !detail" class="loading">加载中…</div>

      <section class="body">
        <!-- Skills -->
        <div v-if="tab === 'skill'" class="grid">
          <div v-for="item in skillItems" :key="idOf(item)" class="card">
            <div class="card-title">{{ nameOf(item) }}</div>
            <div class="card-desc">{{ descOf(item) }}</div>
            <button
              class="act"
              :class="{ installed: installedSkillIds.includes(idOf(item)) }"
              @click="toggleSkill(item)"
            >
              {{ installedSkillIds.includes(idOf(item)) ? '卸载' : '安装' }}
            </button>
          </div>
        </div>

        <!-- 工具 / 连接器 -->
        <div v-else-if="tab === 'tool' || tab === 'connector'" class="cols">
          <div class="col">
            <h4>已安装（{{ tab === 'tool' ? (detail?.tools ?? []).length : (detail?.plugins ?? []).length }}）</h4>
            <template v-if="tab === 'tool'">
              <div v-for="tool in detail?.tools ?? []" :key="nameOf(tool)" class="row">
                <div>
                  <div class="row-title">{{ nameOf(tool) }}</div>
                  <div class="row-desc">{{ descOf(tool) }}</div>
                </div>
                <button class="act danger" @click="removeTool(tool)">移除</button>
              </div>
            </template>
            <template v-else>
              <div v-for="plugin in detail?.plugins ?? []" :key="extractPluginId(plugin)" class="row">
                <div>
                  <div class="row-title">{{ nameOf(plugin) }}</div>
                  <div class="row-desc">{{ descOf(plugin) }}</div>
                </div>
                <button class="act danger" @click="togglePlugin(plugin, true)">解绑</button>
              </div>
            </template>
          </div>
          <div class="col">
            <h4>可添加</h4>
            <div v-for="item in pluginItems" :key="idOf(item) || nameOf(item)" class="row">
              <div>
                <div class="row-title">{{ nameOf(item) }}</div>
                <div class="row-desc">{{ descOf(item) }}</div>
              </div>
              <button class="act" @click="togglePlugin(item, false)">绑定</button>
            </div>
          </div>
        </div>

        <!-- 知识库 -->
        <div v-else class="know">
          <div v-if="!knowledgeTool" class="hint">当前 Agent 未启用 {{ KNOWLEDGE_TOOL }} 工具，无法配置知识库。</div>
          <template v-else>
            <div class="row">
              <div>
                <div class="row-title">全部知识库</div>
                <div class="row-desc">开启后忽略下方单选，检索范围包含全部知识库</div>
              </div>
              <button class="act" :class="{ installed: knowledgeScope.allKnowledge }" @click="toggleAllKnowledge">
                {{ knowledgeScope.allKnowledge ? '已开启' : '开启' }}
              </button>
            </div>
            <div v-for="item in knowledgeItems" :key="item.id" class="row">
              <div>
                <div class="row-title">{{ item.name }}</div>
                <div class="row-desc">{{ item.desc }}</div>
              </div>
              <button
                class="act"
                :class="{ installed: isKnowledgeEnabled(item.id) }"
                :disabled="knowledgeScope.allKnowledge"
                @click="toggleKnowledge(item)"
              >
                {{ isKnowledgeEnabled(item.id) ? '停用' : '启用' }}
              </button>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.panel {
  width: min(900px, 92vw);
  height: min(620px, 88vh);
  background: #fff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #eceef2;
}
.tabs {
  display: flex;
  gap: 6px;
}
.tabs button,
.act,
.ghost {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}
.tabs button.active {
  border-color: #2b62d9;
  color: #2b62d9;
  background: #f3f7ff;
}
.head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.agent {
  font-size: 12px;
  color: #9aa1ab;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #f2f4f7;
}
.search {
  flex: 1;
  border: 1px solid #dfe3ea;
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
}
.working {
  font-size: 12px;
  color: #2b62d9;
}
.err {
  margin: 8px 16px 0;
  padding: 8px 12px;
  background: #fdecea;
  color: #b3261e;
  border-radius: 6px;
  font-size: 13px;
}
.loading,
.hint {
  padding: 16px;
  color: #9aa1ab;
  font-size: 13px;
}
.body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.card {
  border: 1px solid #eceef2;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card-title,
.row-title {
  font-size: 13px;
  font-weight: 600;
}
.card-desc,
.row-desc {
  font-size: 12px;
  color: #8a8f99;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.col h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #5b6472;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #f2f4f7;
}
.row > div:first-child {
  flex: 1;
  min-width: 0;
}
.act.installed {
  border-color: #2b62d9;
  color: #2b62d9;
  background: #f3f7ff;
}
.act.danger {
  color: #d93026;
  border-color: #f3c9c4;
}
</style>
