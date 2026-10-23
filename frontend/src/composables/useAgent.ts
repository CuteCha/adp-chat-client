/**
 * M3：Skills / 工具 / 连接器 / 知识库四个按钮的数据层。
 *
 * 所有写操作都作用于「复制出来的 Agent」，因此第一步必须是 ensureAgentId：
 * 库里有缓存就复用，没有才调 CopyAgentFromApp（后端已做幂等）。
 * 读写都走后端 /adp/{action} 转发，由 action_version 决定 service / version。
 */

import { forward, getAgentId } from '../api'

const agentIdCache = new Map<string, string>()

export async function ensureAgentId(applicationId: string): Promise<string> {
  const cached = agentIdCache.get(applicationId)
  if (cached) return cached
  const agentId = await getAgentId(applicationId)
  agentIdCache.set(applicationId, agentId)
  return agentId
}

export function clearAgentCache(applicationId?: string): void {
  if (applicationId) agentIdCache.delete(applicationId)
  else agentIdCache.clear()
}

type Any = Record<string, any>

function pick(obj: Any | undefined, ...keys: string[]): any {
  if (!obj) return undefined
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key]
  }
  return undefined
}

export interface AgentDetail {
  skills: Any[]
  plugins: Any[]
  tools: Any[]
}

/** DescribeAgentDetail：一次拿全 SkillList / PluginList / ToolList */
export async function describeAgent(applicationId: string, agentId: string): Promise<AgentDetail> {
  const data = await forward('DescribeAgentDetail', applicationId, {
    AppId: applicationId,
    AgentId: agentId,
    Domain: 2,
  })
  return normalizeAgent(data)
}

/**
 * 平台侧（应用线上 Agent）当前配置：DescribeAgentDetail 不传 AgentId、
 * 只传 AppId 时，上游返回的是应用自身在腾讯云 ADP 平台上的那份配置。
 *
 * 面板里增删改用的是「复制出来的 Agent」（它是复制时刻的快照，之后平台上的
 * 新增连接器 / 工具 / 技能不会自动跟过来），所以要用它做同步基准。
 */
export async function describePlatformAgent(applicationId: string): Promise<AgentDetail> {
  const data = await forward('DescribeAgentDetail', applicationId, {
    AppId: applicationId,
    Domain: 2,
  })
  return normalizeAgent(data)
}

function normalizeAgent(data: Any): AgentDetail {
  const agent = pick(data, 'Agent') ?? {}
  return {
    skills: pick(agent, 'SkillList', 'skill_list') ?? [],
    plugins: pick(agent, 'PluginList', 'plugin_list') ?? [],
    tools: pick(agent, 'ToolList', 'tool_list') ?? [],
  }
}

/** 插件/连接器/工具的 PluginId：可能藏在 Config 子对象里 */
export function pluginIdOf(item: Any): string {
  const direct = pick(item, 'PluginId', 'pluginId')
  if (direct) return String(direct)
  const config = pick(item, 'Config', 'config') ?? {}
  return String(pick(config, 'PluginId', 'pluginId') ?? '')
}

function skillIdOf(item: Any): string {
  return String(pick(item, 'SkillId', 'skillId') ?? '')
}

export interface SyncResult {
  /** 本次补绑的连接器 / 工具名称 */
  plugins: string[]
  /** 本次补充的技能数 */
  skills: number
}

/**
 * 把平台侧的新增能力同步到复制 Agent：只补不删。
 *
 * 不删是因为复制 Agent 上还可能有「只在面板里装过」的能力（平台那份上没有），
 * 以平台为准做全量覆盖会把它们误删。
 */
export async function syncFromPlatform(
  applicationId: string,
  agentId: string,
): Promise<SyncResult> {
  const [platform, copy] = await Promise.all([
    describePlatformAgent(applicationId),
    describeAgent(applicationId, agentId),
  ])

  const owned = new Set(copy.plugins.map(pluginIdOf).filter(Boolean))
  const added: string[] = []
  for (const plugin of platform.plugins) {
    const pluginId = pluginIdOf(plugin)
    if (!pluginId || owned.has(pluginId)) continue
    try {
      await bindTool(applicationId, agentId, pluginId)
      owned.add(pluginId)
      added.push(pick(plugin, 'Name', 'name') ?? pluginId)
    } catch {
      // 单个绑定失败不阻断其余同步（例如该插件已下线）
    }
  }

  const copySkillIds = copy.skills.map(skillIdOf).filter(Boolean)
  const platformSkillIds = platform.skills.map(skillIdOf).filter(Boolean)
  const merged = [...new Set([...copySkillIds, ...platformSkillIds])]
  let skills = 0
  if (merged.length !== copySkillIds.length) {
    await setSkillList(applicationId, agentId, merged)
    skills = merged.length - copySkillIds.length
  }

  return { plugins: added, skills }
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function listSkillCategories(applicationId: string) {
  const data = await forward('DescribeSkillCategoryList', applicationId, {})
  const raw = pick(data, 'Categories', 'CategoryList', 'categories') ?? []
  return raw.map((c: Any) => ({
    key: pick(c, 'CategoryKey', 'category_key'),
    name: pick(c, 'CategoryName', 'category_name'),
  }))
}

export async function listSkillSummary(applicationId: string, query = '', pageNumber = 0, pageSize = 12) {
  const data = await forward('DescribeSkillSummaryList', applicationId, {
    SpaceId: '',
    Query: query,
    FilterList: [],
    FavoriteOnly: false,
    PageSize: pageSize,
    PageNumber: pageNumber,
  })
  return {
    list: pick(data, 'SkillSummaryList', 'SkillList', 'skill_list') ?? [],
    total: pick(data, 'TotalCount', 'total_count') ?? 0,
  }
}

/** 整体覆盖 skill_list（安装/卸载都是同一个入口） */
export async function setSkillList(applicationId: string, agentId: string, skillIds: string[]) {
  await forward('ModifyAgent', applicationId, {
    AppId: applicationId,
    AgentId: agentId,
    Agent: { SkillList: skillIds.map((SkillId) => ({ SkillId })) },
    UpdateMask: { Paths: ['skill_list'] },
  })
}

// ---------------------------------------------------------------------------
// 工具（PluginClass=0）/ 连接器（PluginClass=1）
// ---------------------------------------------------------------------------

export const PLUGIN_CLASS = { Tool: 0, Connector: 1 } as const

export async function listPlugins(applicationId: string, pluginClass: 0 | 1, query = '') {
  const data = await forward('DescribePluginSummaryList', applicationId, {
    Query: query,
    Module: 0,
    FilterList: [{ Name: 'PluginClass', ValueList: [String(pluginClass)], Operator: 0 }],
    PageSize: 20,
    PageNumber: 0,
  })
  return {
    list: pick(data, 'PluginSummaryList', 'PluginList', 'List', 'list') ?? [],
    total: pick(data, 'TotalCount', 'total_count') ?? 0,
  }
}

export async function bindTool(applicationId: string, agentId: string, pluginId: string) {
  await forward('BindAgentTool', applicationId, {
    AppId: applicationId,
    AgentId: agentId,
    PluginId: pluginId,
    ToolSource: 0,
  })
}

export async function unbindTool(
  applicationId: string,
  agentId: string,
  pluginId: string,
  toolId = '',
) {
  await forward('UnbindAgentTool', applicationId, {
    AppId: applicationId,
    AgentId: agentId,
    PluginId: pluginId,
    ToolId: toolId,
  })
}

// ---------------------------------------------------------------------------
// 知识库：开关写在 KnowledgeRetrievalAnswer 工具的 KnowledgeScope 入参里
// ---------------------------------------------------------------------------

export const KNOWLEDGE_TOOL = 'KnowledgeRetrievalAnswer'

export async function listKnowledge(applicationId: string) {
  const data = await forward('ListReferShareKnowledge', applicationId, { AppBizId: applicationId })
  const raw = pick(data, 'list', 'List', 'KnowledgeList') ?? []
  return raw
    .map((item: Any) => ({
      id: pick(item, 'KnowledgeBizId', 'knowledge_biz_id'),
      name: pick(item, 'KnowledgeName', 'knowledge_name'),
      desc: pick(item, 'KnowledgeDescription', 'knowledge_description', 'Description', 'description') ?? '',
    }))
    .filter((item: Any) => !!item.id)
}

/** 解析 KnowledgeScope：是否为「全部知识库」，以及按知识库模式下已开启的 id 列表 */
export function parseKnowledgeScope(tool: Any): { allKnowledge: boolean; ids: string[] } {
  const config = pick(tool, 'Config', 'config') ?? {}
  const inputList = pick(config, 'InputList', 'input_list', 'inputs') ?? []
  const scope = inputList.find((node: Any) => pick(node, 'Name', 'name') === 'KnowledgeScope')
  if (!scope) return { allKnowledge: true, ids: [] }

  const subs = pick(scope, 'SubParameterList', 'sub_parameter_list', 'sub_params') ?? []
  const readValue = (node: Any): string => {
    const input = pick(node, 'Input', 'input') ?? {}
    const value = pick(input, 'UserInputValue', 'user_input_value') ?? {}
    const list = pick(value, 'ValueList', 'value_list', 'values') ?? []
    return list[0] ?? ''
  }

  let explicit: boolean | null = null
  let ids: string[] = []
  for (const sub of subs) {
    const name = pick(sub, 'Name', 'name')
    if (name === 'AllKnowledge') {
      const value = readValue(sub)
      if (value !== '') explicit = value === 'true'
    } else if (name === 'KnowledgeList') {
      const items = pick(sub, 'SubParameterList', 'sub_parameter_list', 'sub_params') ?? []
      ids = items
        .map((it: Any) => {
          const itemSubs = pick(it, 'SubParameterList', 'sub_parameter_list', 'sub_params') ?? []
          return readValue(itemSubs.find((n: Any) => pick(n, 'Name', 'name') === 'KnowledgeBizId'))
        })
        .filter(Boolean)
    }
  }
  return { allKnowledge: explicit !== null ? explicit : ids.length === 0, ids }
}

function buildKnowledgeScopeNode(all: boolean, ids: string[]) {
  const stringInput = (value: string) => ({ InputType: 1, UserInputValue: { ValueList: [value] } })
  return {
    Name: 'KnowledgeScope',
    Type: 4,
    SubParameterList: [
      { Name: 'AllKnowledge', Type: 1, Input: stringInput(all ? 'true' : 'false'), SubParameterList: [] },
      {
        Name: 'KnowledgeList',
        Type: 5,
        SubParameterList: ids.map((id, index) => ({
          Name: `item ${index}`,
          Type: 4,
          SubParameterList: [
            { Name: 'KnowledgeBizId', Type: 1, Input: stringInput(id), SubParameterList: [] },
          ],
        })),
      },
    ],
  }
}

/** ModifyAgentToolList 不接受 null 与展示派生字段，提交前需要清理 */
const REJECTED_KEYS = new Set(['IsHidden', 'RenderMode'])
function stripRejected<T>(value: T): T {
  if (value === null) return undefined as unknown as T
  if (Array.isArray(value)) return value.map((item) => stripRejected(item)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Any = {}
    for (const [key, val] of Object.entries(value as Any)) {
      if (val === null || REJECTED_KEYS.has(key)) continue
      out[key] = stripRejected(val)
    }
    return out as unknown as T
  }
  return value
}

/** 把新的 KnowledgeScope 写回 KnowledgeRetrievalAnswer 工具 */
export async function setKnowledgeScope(
  applicationId: string,
  agentId: string,
  tool: Any,
  all: boolean,
  ids: string[],
) {
  const config = pick(tool, 'Config', 'config') ?? {}
  const inputList = pick(config, 'InputList', 'input_list', 'inputs') ?? []
  const newScope = buildKnowledgeScopeNode(all, ids)
  const nextInputList = inputList.filter((node: Any) => pick(node, 'Name', 'name') !== 'KnowledgeScope')
  nextInputList.push(newScope)

  await forward('ModifyAgentToolList', applicationId, {
    AppId: applicationId,
    AgentId: agentId,
    PluginIdList: [],
    ToolIdList: [pick(tool, 'ToolId', 'tool_id') ?? ''],
    PluginList: [],
    ToolList: [
      stripRejected({
        ...tool,
        Config: { ...config, InputList: nextInputList },
      }),
    ],
  })
}
