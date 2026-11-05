/**
 * 输入区（对齐官方样式）：圆角卡片 + 底部能力按钮行 + 右下角圆形发送键。
 *
 * 附件流程与线上一致：上传拿 URL → 非图片还要走一次实时文档解析拿 doc_id，
 * 最终以 { Type: 'file', File: { DocId, ... } } 随消息上行。
 * Skills / 工具 / 连接器按钮：弹出对应种类的「已安装」快选浮层（选中即把 @名称 插入
 * 输入框，与官方 @ 效果一致；底部「管理」进管理面板），知识库按钮直接唤起面板。
 * 输入框里输入 @ 唤起两层菜单：一级「技能 / 工具 / 连接器」，二级是具体条目。
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { parseFile, uploadFile } from '../api'
import type { AttachedFile } from '../state/chat'
import {
  loadInstalledSkills,
  useInstalledSkills,
  type CapabilityKind,
  type InstalledItem,
} from '../state/installedSkills'
import './sender.css'

export type PanelTab = 'skill' | 'tool' | 'connector' | 'knowledge'

const MENTION_GROUPS: { key: CapabilityKind; label: string }[] = [
  { key: 'skill', label: '技能' },
  { key: 'tool', label: '工具' },
  { key: 'connector', label: '连接器' },
]

// ---------------------------------------------------------------------------
// 附件白名单 / 大小限制（对齐官方）：MIME 优先，浏览器识别不出时按扩展名兜底
// ---------------------------------------------------------------------------

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp',
  webp: 'image/webp', gif: 'image/gif', tiff: 'image/tiff',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
}
const ALLOWED_TYPES = new Set(Object.values(EXT_TO_MIME))
/** 文件选择框过滤 + 错误提示里展示的支持范围 */
const FILE_ACCEPT = Object.keys(EXT_TO_MIME).map((e) => `.${e}`).join(',')
/** 图片 10MB / 文档 15MB（与官方一致） */
const FILE_SIZE_LIMITS: Record<'image' | 'document', number> = {
  image: 10 * 1024 * 1024,
  document: 15 * 1024 * 1024,
}

/**
 * 解析文件的 MIME：file.type 可信（在白名单内）时直接用；
 * 否则按扩展名兜底（浏览器/系统未注册该格式时 file.type 为空，
 * 直接透传会退化成 octet-stream，导致下游识别不出真实格式）。
 * 返回 '' 表示不支持。
 */
function resolveMime(file: File): string {
  if (file.type && ALLOWED_TYPES.has(file.type)) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_MIME[ext] ?? ''
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / 1024 / 1024)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/** 读取 docParse SSE，直到拿到 doc_id */
async function readDocId(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let buffer = ''
  let docId = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      try {
        const payload = JSON.parse(line.slice(5).trim()).payload ?? {}
        if (payload.doc_id && payload.doc_id !== '0') docId = String(payload.doc_id)
        if (String(payload.status ?? '').endsWith('SUCCESS') || payload.status === 'FAILED') {
          await reader.cancel()
          return docId
        }
      } catch {
        /* 忽略半包 */
      }
    }
  }
  return docId
}

function filterItems(items: InstalledItem[], q: string): InstalledItem[] {
  if (!q) return items
  return items.filter(
    (i) => i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q),
  )
}

export default function Sender({
  streaming,
  disabled,
  applicationId,
  mode = 'standard',
  onSend,
  onStop,
  onPanel,
}: {
  streaming: boolean
  disabled?: boolean
  applicationId: string
  /** claw 应用需要把文件传进公有桶，否则 Agent 侧下载不到 */
  mode?: 'standard' | 'claw'
  onSend: (text: string, files: AttachedFile[]) => void
  onStop: () => void
  onPanel: (tab: PanelTab) => void
}) {
  const { installedSkills, installedTools, installedConnectors, loadingSkills } = useInstalledSkills()

  const [text, setText] = useState('')
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerKind, setPickerKind] = useState<CapabilityKind>('skill')
  const [pickerQuery, setPickerQuery] = useState('')

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  /** 0 = 焦点在一级分类，1 = 焦点在二级条目 */
  const [mentionLayer, setMentionLayer] = useState<0 | 1>(0)
  const [mentionGroup, setMentionGroup] = useState<CapabilityKind>('skill')
  const [mentionActive, setMentionActive] = useState(0)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const uploadErrorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** 某个分类下的已安装条目 */
  const itemsOf = (kind: CapabilityKind): InstalledItem[] => {
    if (kind === 'skill') return installedSkills
    if (kind === 'tool') return installedTools
    return installedConnectors
  }

  /** 每个分类下按关键词过滤后的条目 */
  const buildGroups = (query: string) =>
    MENTION_GROUPS.map((g) => ({
      ...g,
      items: filterItems(itemsOf(g.key), query.trim().toLowerCase()),
    }))

  const mentionGroups = buildGroups(mention?.query ?? '')
  /** 当前展开的分类：当前分类为空时回退到第一个有内容的分类 */
  const mentionCurrent =
    mentionGroups.find((g) => g.key === mentionGroup && g.items.length) ??
    mentionGroups.find((g) => g.items.length) ??
    mentionGroups[0]
  /** 三个分类都没有候选时不弹菜单 */
  const mentionVisible = !!mention && mentionGroups.some((g) => g.items.length > 0)

  const pickerLabel = MENTION_GROUPS.find((g) => g.key === pickerKind)?.label ?? '技能'
  const pickerFiltered = useMemo(
    () => filterItems(itemsOf(pickerKind), pickerQuery.trim().toLowerCase()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickerKind, pickerQuery, installedSkills, installedTools, installedConnectors],
  )

  useEffect(() => {
    setPickerOpen(false)
    setMention(null)
    void loadInstalledSkills(applicationId)
  }, [applicationId])

  useEffect(() => () => clearTimeout(uploadErrorTimer.current), [])

  function showUploadError(msg: string) {
    setUploadError(msg)
    clearTimeout(uploadErrorTimer.current)
    uploadErrorTimer.current = setTimeout(() => setUploadError(''), 6000)
  }

  function setCaret(pos: number) {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  function submit() {
    if (streaming || disabled) return
    if (!text.trim() && !files.length) return
    onSend(text, files)
    setText('')
    setFiles([])
    setMention(null)
    setPickerOpen(false)
    const el = textareaRef.current
    if (el) el.style.height = 'auto'
  }

  // -------------------------------------------------------------------------
  // @ 唤起两层菜单：一级「技能 / 工具 / 连接器」，二级是该分类下已安装的条目
  //   光标前紧跟 @关键词 时弹出，回车/点击把候选替换进去
  // -------------------------------------------------------------------------

  /** 光标前是否是「@关键词」片段，是则记录片段起点并打开菜单 */
  function syncMention(el: HTMLTextAreaElement) {
    const value = el.value
    const pos = el.selectionStart ?? value.length
    const before = value.slice(0, pos)
    const m = before.match(/(^|\s)@([^\s@]*)$/)
    if (!m) {
      setMention(null)
      return
    }
    const query = m[2]
    if (mention === null) {
      setMentionLayer(0)
      setMentionActive(0)
    }
    setMention({ start: pos - query.length - 1, query })
    void loadInstalledSkills(applicationId)
    // 当前分类没命中时自动切到第一个有内容的分类
    const groupsNow = buildGroups(query)
    const current =
      groupsNow.find((g) => g.key === mentionGroup && g.items.length) ??
      groupsNow.find((g) => g.items.length) ??
      groupsNow[0]
    if (!current || !current.items.length) {
      const first = groupsNow.find((g) => g.items.length)
      if (first) setMentionGroup(first.key)
    }
    if (mentionActive >= (current?.items.length ?? 0)) setMentionActive(0)
  }

  /** 一级：悬停 / 点击切换分类并展开二级 */
  function pickGroup(key: CapabilityKind) {
    setMentionGroup(key)
    setMentionLayer(1)
    setMentionActive(0)
  }

  /** 一级上下键：跳过没有候选的分类 */
  function moveGroup(step: number) {
    const groups = mentionGroups
    const n = groups.length
    const idx = groups.findIndex((g) => g.key === mentionGroup)
    for (let i = 1; i <= n; i++) {
      const g = groups[(idx + step * i + n * n) % n]
      if (g.items.length) {
        setMentionGroup(g.key)
        setMentionActive(0)
        return
      }
    }
  }

  /** 选中条目：把「@关键词」替换成「@名称 」，效果与官方 @ 一致 */
  function applyMention(item: InstalledItem) {
    const insert = `@${item.name} `
    if (mention) {
      const next = text.slice(0, mention.start) + insert + text.slice(mention.start + 1 + mention.query.length)
      setText(next)
      setCaret(mention.start + insert.length)
    } else {
      const next = text + insert
      setText(next)
      setCaret(next.length)
    }
    setMention(null)
  }

  // -------------------------------------------------------------------------
  // 快选浮层：按种类列出已安装条目，点击即指定它做任务（官方同款形态）
  // -------------------------------------------------------------------------

  function togglePicker(kind: CapabilityKind) {
    const reopen = pickerOpen && pickerKind === kind
    setPickerOpen(!reopen)
    setPickerKind(kind)
    setPickerQuery('')
    if (!reopen) void loadInstalledSkills(applicationId)
  }

  /** 浮层里点条目：在光标处插入 @名称（若正在 @ 输入则替换该片段） */
  function insertMention(item: InstalledItem) {
    setMention(null)
    setPickerOpen(false)
    const el = textareaRef.current
    const pos = el?.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const m = before.match(/(^|\s)@([^\s@]*)$/)
    const insert = `@${item.name} `
    if (m) {
      const start = pos - m[2].length - 1
      const next = text.slice(0, start) + insert + text.slice(pos)
      setText(next)
      setCaret(start + insert.length)
    } else {
      const prefix = before && !/\s$/.test(before) ? ' ' : ''
      const next = before + prefix + insert + text.slice(pos)
      setText(next)
      setCaret(before.length + prefix.length + insert.length)
    }
  }

  function openManage(tab: PanelTab) {
    setPickerOpen(false)
    onPanel(tab)
  }

  function onKeydown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // @ 菜单打开时，方向键 / 回车 / Tab 先用于在两层之间导航与选择
    if (mentionVisible) {
      const items = mentionCurrent?.items ?? []
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setMentionLayer(0)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (items.length) {
          setMentionLayer(1)
          setMentionActive(0)
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (mentionLayer === 0) {
          moveGroup(1)
        } else if (items.length) {
          setMentionActive((prev) => (prev + 1) % items.length)
        }
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (mentionLayer === 0) {
          moveGroup(-1)
        } else if (items.length) {
          setMentionActive((prev) => (prev - 1 + items.length) % items.length)
        }
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        // 焦点还在一级时，回车直接取当前分类的第一项（与官方一致）
        if (mentionLayer === 0) {
          if (items.length) applyMention(items[0])
        } else if (items.length) {
          applyMention(items[mentionActive >= items.length ? 0 : mentionActive])
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  /** 输入框随内容自动增高（对齐官方单行起步、多行展开）+ 刷新 @ 菜单 */
  function onInput(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value)
    autoGrow(e.target)
    syncMention(e.target)
  }

  /** 输入框随内容自动增高（对齐官方单行起步、多行展开） */
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const selected = Array.from(input.files ?? [])
    input.value = ''
    if (!selected.length) return

    // 1) 白名单 + 大小校验，不合法的文件直接给出明确提示（不再静默失败）
    const valid: { file: File; mime: string }[] = []
    for (const file of selected) {
      const mime = resolveMime(file)
      if (!mime) {
        showUploadError(`「${file.name}」格式不支持，支持：${FILE_ACCEPT}`)
        continue
      }
      const limit = mime.startsWith('image/') ? FILE_SIZE_LIMITS.image : FILE_SIZE_LIMITS.document
      if (file.size > limit) {
        showUploadError(`「${file.name}」超过 ${formatSize(limit)} 大小限制`)
        continue
      }
      valid.push({ file, mime })
    }
    if (!valid.length) return

    setUploading(true)
    for (const { file, mime } of valid) {
      try {
        const ext = file.name.split('.').pop() ?? ''
        let uploaded = await uploadFile(file, applicationId, mode, mime)
        let docId = '0'
        let parseFailed = false
        // 2) 只有 standard 模式的非图片需要 docParse（claw 模式靠 URL 让 Agent 自己下载）
        //    且必须带上上传时 COS 返回的 ETag，否则上游解析失败拿不到 doc_id
        if (!mime.startsWith('image/') && mode === 'standard') {
          try {
            const response = await parseFile({
              ApplicationId: applicationId,
              FileName: file.name,
              FileType: ext,
              CosBucket: uploaded.CosBucket,
              CosUrl: uploaded.CosUrl,
              FileUrl: uploaded.Url,
              ETag: uploaded.ETag ?? '',
              Size: String(file.size),
            })
            docId = (await readDocId(response)) || '0'
          } catch (e) {
            console.warn('[Sender] docParse failed, fallback to public FileUrl', e)
          }
          parseFailed = docId === '0'
          // 3) 解析失败时兜底：私有桶地址不可直接下载，改传公开桶，
          //    保证文件仍以可读 URL 发送（FileUrl 模式）
          if (parseFailed) {
            uploaded = await uploadFile(file, applicationId, mode, mime, true)
          }
        }
        const next: AttachedFile = {
          name: file.name,
          size: file.size,
          url: uploaded.Url,
          ext,
          docId,
        }
        setFiles((prev) => [...prev, next])
        if (parseFailed) {
          showUploadError(`「${file.name}」解析未完成，将以文件链接方式发送`)
        }
      } catch (e) {
        console.error('[Sender] upload failed', e)
        showUploadError(`「${file.name}」上传失败，请重试`)
      }
    }
    setUploading(false)
  }

  return (
    <div className="snd-wrap">
      {pickerOpen && <div className="snd-pop-backdrop" onClick={() => setPickerOpen(false)} />}

      {files.length > 0 && (
        <div className="snd-chips">
          {files.map((file, i) => (
            <span key={i} className="snd-chip">
              {file.name}
              <button
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {uploadError && (
        <div className="snd-upload-error" role="alert">
          {uploadError}
        </div>
      )}

      <div className="snd-card">
        <textarea
          ref={textareaRef}
          className="snd-textarea"
          rows={1}
          disabled={disabled}
          value={text}
          placeholder="支持上传图片 / PDF / Office 文档等提问，输入@唤起已安装的技能/工具/连接器"
          onKeyDown={onKeydown}
          onChange={onInput}
        />

        {/* @ 唤起：一级分类（独立浮层，高度由分类数决定） */}
        {mentionVisible && (
          <div className="snd-mention-side">
            {mentionGroups.map((g) => (
              <button
                key={g.key}
                className={`snd-mp-cat${mentionGroup === g.key ? ' snd-on' : ''}`}
                disabled={!g.items.length}
                onMouseEnter={() => pickGroup(g.key)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickGroup(g.key)
                }}
              >
                <span className="snd-mp-cat-label">{g.label}</span>
                <span className="snd-mp-arrow">›</span>
              </button>
            ))}
          </div>
        )}

        {/* @ 唤起：二级条目（独立浮层，高度由条目数决定） */}
        {mentionVisible && (mentionCurrent?.items.length ?? 0) > 0 && (
          <div className="snd-mention-sub">
            {(mentionCurrent?.items ?? []).map((s, i) => (
              <button
                key={s.id}
                className={`snd-pop-item${mentionLayer === 1 && i === mentionActive ? ' snd-active' : ''}`}
                title={s.desc}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyMention(s)
                }}
                onMouseEnter={() => {
                  setMentionLayer(1)
                  setMentionActive(i)
                }}
              >
                {s.icon ? (
                  <img className="snd-pop-ico" src={s.icon} alt="" />
                ) : (
                  <span className="snd-pop-ico snd-fallback">✦</span>
                )}
                <span className="snd-pop-name">{s.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* 快选浮层：按种类列出已安装条目，点击即指定它做任务 */}
        {pickerOpen && (
          <div className="snd-picker-pop">
            <input
              className="snd-pop-search"
              placeholder={`搜索已安装的${pickerLabel}`}
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (pickerFiltered[0]) insertMention(pickerFiltered[0])
              }}
            />
            <div className="snd-pop-list">
              {!pickerFiltered.length && (
                <div className="snd-pop-empty">
                  {loadingSkills
                    ? '加载中…'
                    : `暂无已安装的${pickerLabel}，点下方「管理${pickerLabel}」去安装`}
                </div>
              )}
              {pickerFiltered.map((s) => (
                <button key={s.id} className="snd-pop-item" title={s.desc} onClick={() => insertMention(s)}>
                  {s.icon ? (
                    <img className="snd-pop-ico" src={s.icon} alt="" />
                  ) : (
                    <span className="snd-pop-ico snd-fallback">✦</span>
                  )}
                  <span className="snd-pop-name">{s.name}</span>
                </button>
              ))}
            </div>
            <button className="snd-pop-manage" onClick={() => openManage(pickerKind)}>
              ⚙ 管理{pickerLabel}
            </button>
          </div>
        )}

        <div className="snd-actions">
          <div className="snd-left">
            <button
              className="snd-cap"
              disabled={disabled || uploading}
              title={uploading ? '上传中…' : '上传附件'}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="snd-ico snd-plus">+</span>
              {uploading && <span className="snd-lbl">上传中…</span>}
            </button>
            <button
              className={`snd-cap${pickerOpen && pickerKind === 'skill' ? ' snd-on' : ''}`}
              onClick={() => togglePicker('skill')}
            >
              <span className="snd-ico">✦</span>Skills
            </button>
            <button
              className={`snd-cap${pickerOpen && pickerKind === 'connector' ? ' snd-on' : ''}`}
              onClick={() => togglePicker('connector')}
            >
              <span className="snd-ico">⇄</span>连接器
            </button>
            <button
              className={`snd-cap${pickerOpen && pickerKind === 'tool' ? ' snd-on' : ''}`}
              onClick={() => togglePicker('tool')}
            >
              <span className="snd-ico">⚙</span>工具
            </button>
            <button className="snd-cap" onClick={() => onPanel('knowledge')}>
              <span className="snd-ico">▤</span>知识库
            </button>
          </div>

          {streaming ? (
            <button className="snd-round snd-stop" title="停止生成" onClick={onStop}>
              ■
            </button>
          ) : (
            <button
              className="snd-round snd-send"
              title="发送"
              disabled={disabled || (!text.trim() && !files.length)}
              onClick={submit}
            >
              ↑
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept={FILE_ACCEPT}
        onChange={onFiles}
      />
    </div>
  )
}
