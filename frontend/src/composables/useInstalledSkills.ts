/**
 * 已安装能力的共享状态：Sender 的 @ 唤起菜单与快选浮层共用一份。
 * 数据来自复制出来的 Agent（DescribeAgentDetail），按官方 @ 菜单分三类：
 *   - skills：Agent.SkillList（DisplayName / DisplayDescription / IconUrl）
 *   - connectors：Agent.PluginList 里 PluginClass === 1 的条目（PluginId 藏
 *     在 Config 里），@ 召唤用的就是它的 Name
 *   - tools：Agent.ToolList（含连接器下挂的 MCP 工具）
 * 三类都用同一个 InstalledItem 结构，渲染与插入 @ 的逻辑可以完全复用。
 */
import { ref } from 'vue'
import { describeAgent, ensureAgentId, resetPlatformSync, syncPlatformOnce } from './useAgent'

export interface InstalledItem {
  id: string
  name: string
  desc: string
  icon: string
}

/** 兼容旧命名的别名 */
export type InstalledSkill = InstalledItem

/** @ 菜单一级分类 / 快选浮层种类 */
export type CapabilityKind = 'skill' | 'tool' | 'connector'

interface CapabilitySet {
  skills: InstalledItem[]
  tools: InstalledItem[]
  connectors: InstalledItem[]
}

/** 共享列表：@ 菜单 / 快选浮层读同一份 */
const installedSkills = ref<InstalledItem[]>([])
const installedTools = ref<InstalledItem[]>([])
const installedConnectors = ref<InstalledItem[]>([])
const loadingSkills = ref(false)

const cache = new Map<string, CapabilitySet>()

/** 取第一个非空字符串，用于兼容上游字段命名差异 */
function text(...values: unknown[]): string {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return ''
}

function normalizeSkills(skills: Record<string, any>[]): InstalledItem[] {
  return skills
    .map((s) => ({
      id: text(s?.SkillId),
      name: text(s?.DisplayName, s?.Name, '未命名技能'),
      desc: text(s?.DisplayDescription, s?.Description),
      icon: text(s?.IconUrl),
    }))
    .filter((s) => s.id)
}

/** 连接器：PluginList 里 PluginClass === 1 的条目 */
function normalizeConnectors(plugins: Record<string, any>[]): InstalledItem[] {
  return plugins
    .filter((p) => Number(p?.PluginClass) === 1)
    .map((p) => ({
      id: text(p?.Config?.PluginId, p?.PluginId, p?.pluginId),
      name: text(p?.Name, p?.DisplayName, '未命名连接器'),
      desc: text(p?.Description, p?.DisplayDescription),
      icon: text(p?.IconUrl),
    }))
    .filter((p) => p.id)
}

function normalizeTools(tools: Record<string, any>[]): InstalledItem[] {
  return tools
    .map((t) => ({
      id: text(t?.Config?.ToolId, t?.ToolId, t?.toolId),
      name: text(t?.Name, t?.DisplayName, '未命名工具'),
      desc: text(t?.Description, t?.DisplayDescription),
      icon: text(t?.IconUrl),
    }))
    .filter((t) => t.id)
}

/**
 * 与平台侧对齐：把平台上新装的能力补到复制 Agent 上。
 * 有新增时清掉本地缓存，让本次读取拿到最新集合。
 */
async function syncWithPlatform(applicationId: string): Promise<void> {
  try {
    const result = await syncPlatformOnce(applicationId)
    if (result && (result.plugins.length || result.skills)) cache.delete(applicationId)
  } catch (e) {
    console.error('[useInstalledSkills] platform sync failed', e)
  }
}

export async function loadInstalledSkills(applicationId: string): Promise<void> {
  if (!applicationId || loadingSkills.value) return
  const cached = cache.get(applicationId)
  if (cached) {
    installedSkills.value = cached.skills
    installedTools.value = cached.tools
    installedConnectors.value = cached.connectors
    // 命中缓存也要对齐一次平台：新增的 Skills / 连接器不能等到刷新页面才出现
    void syncWithPlatform(applicationId)
    return
  }
  loadingSkills.value = true
  try {
    // 先与平台侧对齐，再读副本，保证 @ 菜单 / 快选看到的是最新已安装集合
    await syncWithPlatform(applicationId)
    const agentId = await ensureAgentId(applicationId)
    const detail = await describeAgent(applicationId, agentId)
    const next: CapabilitySet = {
      skills: normalizeSkills(detail.skills ?? []),
      tools: normalizeTools(detail.tools ?? []),
      connectors: normalizeConnectors(detail.plugins ?? []),
    }
    cache.set(applicationId, next)
    installedSkills.value = next.skills
    installedTools.value = next.tools
    installedConnectors.value = next.connectors
  } catch (e) {
    console.error('[useInstalledSkills] load failed', e)
  } finally {
    loadingSkills.value = false
  }
}

/** 管理面板安装/卸载后调用，让缓存失效，下次打开快选时重新拉取 */
export function invalidateInstalledSkills(applicationId?: string): void {
  if (applicationId) {
    cache.delete(applicationId)
    resetPlatformSync(applicationId)
  } else {
    cache.clear()
    resetPlatformSync()
  }
}

export function useInstalledSkills() {
  return {
    installedSkills,
    installedTools,
    installedConnectors,
    loadingSkills,
    loadInstalledSkills,
    invalidateInstalledSkills,
  }
}
