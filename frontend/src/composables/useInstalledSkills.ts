/**
 * 已安装技能的共享状态：Sender 的 @ 唤起菜单与 Skills 快选浮层共用一份。
 * 数据来自复制出来的 Agent（DescribeAgentDetail → Agent.SkillList），
 * 条目自带 DisplayName / DisplayDescription / IconUrl，可直接渲染。
 */
import { ref } from 'vue'
import { describeAgent, ensureAgentId } from './useAgent'

export interface InstalledSkill {
  id: string
  name: string
  desc: string
  icon: string
}

/** 共享列表：@ 菜单 / Skills 快选浮层读同一份 */
const installedSkills = ref<InstalledSkill[]>([])
const loadingSkills = ref(false)

const cache = new Map<string, InstalledSkill[]>()

function normalize(skills: Record<string, any>[]): InstalledSkill[] {
  return skills
    .map((s) => ({
      id: String(s?.SkillId ?? ''),
      name: String(s?.DisplayName ?? s?.Name ?? '未命名技能'),
      desc: String(s?.DisplayDescription ?? s?.Description ?? ''),
      icon: String(s?.IconUrl ?? ''),
    }))
    .filter((s) => s.id)
}

export async function loadInstalledSkills(applicationId: string): Promise<void> {
  if (!applicationId || loadingSkills.value) return
  const cached = cache.get(applicationId)
  if (cached) {
    installedSkills.value = cached
    return
  }
  loadingSkills.value = true
  try {
    const agentId = await ensureAgentId(applicationId)
    const detail = await describeAgent(applicationId, agentId)
    const list = normalize(detail.skills ?? [])
    cache.set(applicationId, list)
    installedSkills.value = list
  } catch (e) {
    console.error('[useInstalledSkills] load failed', e)
  } finally {
    loadingSkills.value = false
  }
}

/** 管理面板安装/卸载后调用，让缓存失效，下次打开快选时重新拉取 */
export function invalidateInstalledSkills(applicationId?: string): void {
  if (applicationId) cache.delete(applicationId)
  else cache.clear()
}

export function useInstalledSkills() {
  return { installedSkills, loadingSkills, loadInstalledSkills, invalidateInstalledSkills }
}
