/**
 * Skills / 工具 / 连接器 / 知识库 四个按钮共用的面板。
 *
 * 统一模式：进面板先 ensureAgentId + DescribeAgentDetail 拿到「已安装集合」，
 * 然后从广场搜索「候选集合」，安装 = 追加，卸载 = 移除，最后整体写回上游。
 * 所有读写都作用于应用自身的 Agent，没有副本漂移，无需平台同步。
 */
import { useEffect, useState } from 'react'
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
} from '../state/agent'
import { invalidateInstalledSkills } from '../state/installedSkills'
import './agent-panel.css'

type Tab = 'skill' | 'tool' | 'connector' | 'knowledge'
const TABS: { key: Tab; label: string }[] = [
  { key: 'skill', label: 'Skills' },
  { key: 'tool', label: '工具' },
  { key: 'connector', label: '连接器' },
  { key: 'knowledge', label: '知识库' },
]

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
/** 已安装插件/工具的 PluginId（可能藏在 Config 子对象里） */
function extractPluginId(item: Record<string, any>): string {
  const direct = item?.PluginId ?? item?.pluginId
  if (direct) return String(direct)
  const config = item?.Config ?? item?.config
  return String(config?.PluginId ?? config?.pluginId ?? '')
}
/** 连接器 = PluginList 里 PluginClass === 1 的条目（PluginClass=0 是工具） */
const isConnector = (item: Record<string, any>) => Number(item?.PluginClass) === 1

export default function AgentPanel({
  applicationId,
  initialTab = 'skill',
  onClose,
}: {
  applicationId: string
  /** 打开时默认停留的能力页签 */
  initialTab?: Tab
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [agentId, setAgentId] = useState('')
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')

  const [keyword, setKeyword] = useState('')
  const [skillItems, setSkillItems] = useState<Record<string, any>[]>([])
  const [categories, setCategories] = useState<{ key: string; name: string }[]>([])
  const [pluginItems, setPluginItems] = useState<Record<string, any>[]>([])
  const [knowledgeItems, setKnowledgeItems] = useState<{ id: string; name: string; desc: string }[]>([])

  const installedSkillIds = (detail?.skills ?? []).map((s) => String(s.SkillId ?? '')).filter(Boolean)
  /** 连接器 Tab「已安装」列：只列连接器，工具不混进来 */
  const installedConnectorItems = (detail?.plugins ?? []).filter(isConnector)
  const installedConnectorIds = (detail?.plugins ?? []).filter(isConnector).map(extractPluginId).filter(Boolean)
  const installedToolIds = (detail?.plugins ?? []).filter((p) => !isConnector(p)).map(extractPluginId).filter(Boolean)

  /** 广场条目是否已绑定（连接器 Tab 比连接器，工具 Tab 比工具） */
  function isPluginInstalled(item: Record<string, any>): boolean {
    const id = idOf(item)
    if (!id) return false
    return tab === 'connector' ? installedConnectorIds.includes(id) : installedToolIds.includes(id)
  }

  const knowledgeTool = (detail?.tools ?? []).find((t) => (t.Name ?? t.name) === KNOWLEDGE_TOOL) ?? null
  const knowledgeScope = knowledgeTool
    ? parseKnowledgeScope(knowledgeTool)
    : { allKnowledge: true, ids: [] as string[] }
  const enabledKnowledgeIds = knowledgeScope.allKnowledge
    ? knowledgeItems.map((k) => k.id)
    : knowledgeScope.ids

  async function refreshDetail() {
    setLoading(true)
    setError('')
    try {
      const id = await ensureAgentId(applicationId)
      setAgentId(id)
      setDetail(await describeAgent(applicationId, id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function searchSkills() {
    const { list } = await listSkillSummary(applicationId, keyword)
    setSkillItems(list)
  }

  async function searchPlugins() {
    const pluginClass = tab === 'connector' ? PLUGIN_CLASS.Connector : PLUGIN_CLASS.Tool
    const { list } = await listPlugins(applicationId, pluginClass, keyword)
    setPluginItems(list)
  }

  async function searchKnowledge() {
    setKnowledgeItems(await listKnowledge(applicationId))
  }

  async function refreshTabData() {
    setError('')
    try {
      if (tab === 'skill') {
        if (!categories.length) setCategories(await listSkillCategories(applicationId))
        await searchSkills()
      } else if (tab === 'knowledge') {
        await searchKnowledge()
      } else {
        await searchPlugins()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }

  // 切换 Tab / 打开面板：拉一遍已安装集合与候选集合
  useEffect(() => {
    void refreshTabData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, applicationId])

  useEffect(() => {
    void refreshDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId])

  async function run(label: string, fn: () => Promise<void>) {
    setWorking(label)
    setError('')
    try {
      await fn()
      await refreshDetail()
      await refreshTabData()
      // 安装/卸载改变了已安装集合，让 Sender 侧的 Skills 快选 / @ 菜单缓存失效
      invalidateInstalledSkills(applicationId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setWorking('')
    }
  }

  function toggleSkill(item: Record<string, any>) {
    const id = idOf(item)
    const installed = installedSkillIds.includes(id)
    const next = installed ? installedSkillIds.filter((i) => i !== id) : [...installedSkillIds, id]
    return run(nameOf(item), async () => {
      await setSkillList(applicationId, agentId, next)
    })
  }

  function togglePlugin(item: Record<string, any>, installed: boolean) {
    const pluginId = idOf(item) || extractPluginId(item)
    if (!pluginId) return
    return run(nameOf(item), async () => {
      if (installed) await unbindTool(applicationId, agentId, pluginId)
      else await bindTool(applicationId, agentId, pluginId)
    })
  }

  async function removeTool(tool: Record<string, any>) {
    const pluginId = extractPluginId(tool) || String(tool?.PluginId ?? '')
    const toolId = String(tool?.ToolId ?? tool?.toolId ?? '')
    if (!pluginId) return
    await run(nameOf(tool), async () => {
      await unbindTool(applicationId, agentId, pluginId, toolId)
    })
  }

  function isKnowledgeEnabled(id: string): boolean {
    return knowledgeScope.allKnowledge || knowledgeScope.ids.includes(id)
  }

  function toggleKnowledge(item: { id: string; name: string }) {
    const nextIds = isKnowledgeEnabled(item.id)
      ? enabledKnowledgeIds.filter((i) => i !== item.id)
      : [...new Set([...enabledKnowledgeIds, item.id])]
    return run(item.id, async () => {
      if (!knowledgeTool) return
      await setKnowledgeScope(applicationId, agentId, knowledgeTool, false, nextIds)
    })
  }

  function toggleAllKnowledge() {
    return run('全部知识库', async () => {
      if (!knowledgeTool) return
      await setKnowledgeScope(applicationId, agentId, knowledgeTool, !knowledgeScope.allKnowledge, [])
    })
  }

  return (
    <div className="ap-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ap-panel">
        <header className="ap-head">
          <div className="ap-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'ap-active' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ap-head-right">
            <span className="ap-agent">AgentId: {agentId || '未就绪'}</span>
            <button className="ap-ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div className="ap-toolbar">
          <input
            className="ap-search"
            placeholder="搜索…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyUp={(e) => e.key === 'Enter' && void refreshTabData()}
          />
          <button className="ap-ghost" onClick={() => void refreshTabData()}>
            搜索
          </button>
          {working && <span className="ap-working">{working} 处理中…</span>}
        </div>

        {error && <div className="ap-err">{error}</div>}
        {loading && !detail && <div className="ap-loading">加载中…</div>}

        <section className="ap-body">
          {/* Skills */}
          {tab === 'skill' && (
            <div className="ap-grid">
              {skillItems.map((item) => (
                <div key={idOf(item)} className="ap-card">
                  <div className="ap-card-title">{nameOf(item)}</div>
                  <div className="ap-card-desc">{descOf(item)}</div>
                  <button
                    className={`ap-act${installedSkillIds.includes(idOf(item)) ? ' ap-installed' : ''}`}
                    onClick={() => void toggleSkill(item)}
                  >
                    {installedSkillIds.includes(idOf(item)) ? '卸载' : '安装'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 工具 / 连接器 */}
          {tab === 'tool' || tab === 'connector' ? (
            <div className="ap-cols">
              <div className="ap-col">
                <h4>
                  已安装（{tab === 'tool' ? (detail?.tools ?? []).length : installedConnectorItems.length}）
                </h4>
                {tab === 'tool' ? (
                  (detail?.tools ?? []).map((tool) => (
                    <div key={nameOf(tool)} className="ap-row">
                      <div>
                        <div className="ap-row-title">{nameOf(tool)}</div>
                        <div className="ap-row-desc">{descOf(tool)}</div>
                      </div>
                      <button className="ap-act ap-danger" onClick={() => void removeTool(tool)}>
                        移除
                      </button>
                    </div>
                  ))
                ) : (
                  installedConnectorItems.map((plugin) => (
                    <div key={extractPluginId(plugin)} className="ap-row">
                      <div>
                        <div className="ap-row-title">{nameOf(plugin)}</div>
                        <div className="ap-row-desc">{descOf(plugin)}</div>
                      </div>
                      <button className="ap-act ap-danger" onClick={() => void togglePlugin(plugin, true)}>
                        解绑
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="ap-col">
                <h4>可添加</h4>
                {pluginItems.map((item) => (
                  <div key={idOf(item) || nameOf(item)} className="ap-row">
                    <div>
                      <div className="ap-row-title">{nameOf(item)}</div>
                      <div className="ap-row-desc">{descOf(item)}</div>
                    </div>
                    <button
                      className={`ap-act${isPluginInstalled(item) ? ' ap-installed' : ''}`}
                      disabled={isPluginInstalled(item)}
                      onClick={() => void togglePlugin(item, false)}
                    >
                      {isPluginInstalled(item) ? '已绑定' : '绑定'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 知识库 */}
          {tab === 'knowledge' && (
            <div className="ap-know">
              {!knowledgeTool ? (
                <div className="ap-hint">当前 Agent 未启用 {KNOWLEDGE_TOOL} 工具，无法配置知识库。</div>
              ) : (
                <>
                  <div className="ap-row">
                    <div>
                      <div className="ap-row-title">全部知识库</div>
                      <div className="ap-row-desc">开启后忽略下方单选，检索范围包含全部知识库</div>
                    </div>
                    <button
                      className={`ap-act${knowledgeScope.allKnowledge ? ' ap-installed' : ''}`}
                      onClick={() => void toggleAllKnowledge()}
                    >
                      {knowledgeScope.allKnowledge ? '已开启' : '开启'}
                    </button>
                  </div>
                  {knowledgeItems.map((item) => (
                    <div key={item.id} className="ap-row">
                      <div>
                        <div className="ap-row-title">{item.name}</div>
                        <div className="ap-row-desc">{item.desc}</div>
                      </div>
                      <button
                        className={`ap-act${isKnowledgeEnabled(item.id) ? ' ap-installed' : ''}`}
                        disabled={knowledgeScope.allKnowledge}
                        onClick={() => void toggleKnowledge(item)}
                      >
                        {isKnowledgeEnabled(item.id) ? '停用' : '启用'}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
