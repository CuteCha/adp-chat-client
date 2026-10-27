<script setup lang="ts">
/**
 * 输入区（对齐官方样式）：圆角卡片 + 底部能力按钮行 + 右下角圆形发送键。
 *
 * 附件流程与线上一致：上传拿 URL → 非图片还要走一次实时文档解析拿 doc_id，
 * 最终以 { Type: 'file', File: { DocId, ... } } 随消息上行。
 * Skills / 工具 / 连接器按钮：弹出对应种类的「已安装」快选浮层（选中即把 @名称 插入
 * 输入框，与官方 @ 效果一致；底部「管理」进管理面板），知识库按钮直接唤起面板。
 * 输入框里输入 @ 唤起两层菜单：一级「技能 / 工具 / 连接器」，二级是具体条目。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { parseFile, uploadFile } from '../api'
import type { AttachedFile } from '../composables/useChat'
import {
  loadInstalledSkills,
  useInstalledSkills,
  type CapabilityKind,
  type InstalledItem,
} from '../composables/useInstalledSkills'

export type PanelTab = 'skill' | 'tool' | 'connector' | 'knowledge'

const props = defineProps<{
  streaming: boolean
  disabled?: boolean
  applicationId: string
  /** claw 应用需要把文件传进公有桶，否则 Agent 侧下载不到 */
  mode?: 'standard' | 'claw'
}>()
const emit = defineEmits<{
  (e: 'send', text: string, files: AttachedFile[]): void
  (e: 'stop'): void
  (e: 'panel', tab: PanelTab): void
}>()

const { installedSkills, installedTools, installedConnectors, loadingSkills, loadInstalledSkills: loadSkills } =
  useInstalledSkills()

const text = ref('')
const files = ref<AttachedFile[]>([])
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)

function submit() {
  if (props.streaming || props.disabled) return
  if (!text.value.trim() && !files.value.length) return
  emit('send', text.value, files.value)
  text.value = ''
  files.value = []
  mention.value = null
  pickerOpen.value = false
}

// ---------------------------------------------------------------------------
// @ 唤起两层菜单：一级「技能 / 工具 / 连接器」，二级是该分类下已安装的条目
//   光标前紧跟 @关键词 时弹出，回车/点击把候选替换进去
// ---------------------------------------------------------------------------

const MENTION_GROUPS: { key: CapabilityKind; label: string }[] = [
  { key: 'skill', label: '技能' },
  { key: 'tool', label: '工具' },
  { key: 'connector', label: '连接器' },
]

const mention = ref<{ start: number; query: string } | null>(null)
/** 0 = 焦点在一级分类，1 = 焦点在二级条目 */
const mentionLayer = ref<0 | 1>(0)
const mentionGroup = ref<CapabilityKind>('skill')
const mentionActive = ref(0)

/** 某个分类下的已安装条目 */
function itemsOf(kind: CapabilityKind): InstalledItem[] {
  if (kind === 'skill') return installedSkills.value
  if (kind === 'tool') return installedTools.value
  return installedConnectors.value
}

function filterItems(items: InstalledItem[], q: string): InstalledItem[] {
  if (!q) return items
  return items.filter(
    (i) => i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q),
  )
}

/** 每个分类下按当前关键词过滤后的条目 */
const mentionGroups = computed(() =>
  MENTION_GROUPS.map((g) => ({
    ...g,
    items: filterItems(itemsOf(g.key), (mention.value?.query ?? '').trim().toLowerCase()),
  })),
)

/** 当前展开的分类：当前分类为空时回退到第一个有内容的分类 */
const mentionCurrent = computed(() => {
  const hit = mentionGroups.value.find((g) => g.key === mentionGroup.value)
  if (hit && hit.items.length) return hit
  return mentionGroups.value.find((g) => g.items.length) ?? mentionGroups.value[0]
})

/** 三个分类都没有候选时不弹菜单 */
const mentionVisible = computed(() => !!mention.value && mentionGroups.value.some((g) => g.items.length > 0))

/** 光标前是否是「@关键词」片段，是则记录片段起点并打开菜单 */
function updateMention() {
  const el = textarea.value
  if (!el) return
  const pos = el.selectionStart ?? text.value.length
  const before = text.value.slice(0, pos)
  const m = before.match(/(^|\s)@([^\s@]*)$/)
  if (!m) {
    mention.value = null
    return
  }
  if (mention.value === null) {
    mentionLayer.value = 0
    mentionActive.value = 0
  }
  mention.value = { start: pos - m[2].length - 1, query: m[2] }
  loadSkills(props.applicationId)
  // 当前分类没命中时自动切到第一个有内容的分类
  if (!mentionCurrent.value || !mentionCurrent.value.items.length) {
    const first = mentionGroups.value.find((g) => g.items.length)
    if (first) mentionGroup.value = first.key
  }
  if (mentionActive.value >= (mentionCurrent.value?.items.length ?? 0)) mentionActive.value = 0
}

/** 一级：悬停 / 点击切换分类并展开二级 */
function pickGroup(key: CapabilityKind) {
  mentionGroup.value = key
  mentionLayer.value = 1
  mentionActive.value = 0
}

/** 一级上下键：跳过没有候选的分类 */
function moveGroup(step: number) {
  const groups = mentionGroups.value
  const n = groups.length
  const idx = groups.findIndex((g) => g.key === mentionGroup.value)
  for (let i = 1; i <= n; i++) {
    const g = groups[(idx + step * i + n * n) % n]
    if (g.items.length) {
      mentionGroup.value = g.key
      mentionActive.value = 0
      return
    }
  }
}

function setCaret(pos: number) {
  nextTick(() => {
    const el = textarea.value
    if (!el) return
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

/** 选中条目：把「@关键词」替换成「@名称 」，效果与官方 @ 一致 */
function applyMention(item: InstalledItem) {
  const m = mention.value
  const insert = `@${item.name} `
  if (m) {
    text.value = text.value.slice(0, m.start) + insert + text.value.slice(m.start + 1 + m.query.length)
    setCaret(m.start + insert.length)
  } else {
    text.value += insert
    setCaret(text.value.length)
  }
  mention.value = null
}

// ---------------------------------------------------------------------------
// 快选浮层：按种类列出已安装条目，点击即指定它做任务（官方同款形态）
// ---------------------------------------------------------------------------

const pickerOpen = ref(false)
const pickerKind = ref<CapabilityKind>('skill')
const pickerQuery = ref('')
const pickerItems = computed(() => itemsOf(pickerKind.value))
const pickerFiltered = computed(() =>
  filterItems(pickerItems.value, pickerQuery.value.trim().toLowerCase()),
)
const pickerLabel = computed(
  () => MENTION_GROUPS.find((g) => g.key === pickerKind.value)?.label ?? '技能',
)

function togglePicker(kind: CapabilityKind) {
  const reopen = pickerOpen.value && pickerKind.value === kind
  pickerOpen.value = !reopen
  pickerKind.value = kind
  pickerQuery.value = ''
  if (pickerOpen.value) loadSkills(props.applicationId)
}

/** 浮层里点条目：在光标处插入 @名称（若正在 @ 输入则替换该片段） */
function insertMention(item: InstalledItem) {
  mention.value = null
  pickerOpen.value = false
  const el = textarea.value
  const pos = el?.selectionStart ?? text.value.length
  const before = text.value.slice(0, pos)
  const m = before.match(/(^|\s)@([^\s@]*)$/)
  const insert = `@${item.name} `
  if (m) {
    const start = pos - m[2].length - 1
    text.value = text.value.slice(0, start) + insert + text.value.slice(pos)
    setCaret(start + insert.length)
  } else {
    const prefix = before && !/\s$/.test(before) ? ' ' : ''
    text.value = before + prefix + insert + text.value.slice(pos)
    setCaret(before.length + prefix.length + insert.length)
  }
}

function openManage(tab: PanelTab) {
  pickerOpen.value = false
  emit('panel', tab)
}

function onKeydown(e: KeyboardEvent) {
  // @ 菜单打开时，方向键 / 回车 / Tab 先用于在两层之间导航与选择
  if (mentionVisible.value) {
    const items = mentionCurrent.value?.items ?? []
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      mentionLayer.value = 0
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (items.length) {
        mentionLayer.value = 1
        mentionActive.value = 0
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (mentionLayer.value === 0) {
        moveGroup(1)
      } else if (items.length) {
        mentionActive.value = (mentionActive.value + 1) % items.length
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (mentionLayer.value === 0) {
        moveGroup(-1)
      } else if (items.length) {
        mentionActive.value = (mentionActive.value - 1 + items.length) % items.length
      }
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      // 焦点还在一级时，回车直接取当前分类的第一项（与官方一致）
      if (mentionLayer.value === 0) {
        if (items.length) applyMention(items[0])
      } else if (items.length) {
        applyMention(items[mentionActive.value])
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      mention.value = null
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}

/** 输入框随内容自动增高（对齐官方单行起步、多行展开）+ 刷新 @ 菜单 */
function onInput(e: Event) {
  autoGrow(e)
  updateMention()
}

/** 输入框随内容自动增高（对齐官方单行起步、多行展开） */
function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`
}

function pickFiles() {
  fileInput.value?.click()
}

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

/** 上传相关的用户可见错误提示（短暂展示后自动消失） */
const uploadError = ref('')
let uploadErrorTimer: ReturnType<typeof setTimeout> | undefined
function showUploadError(msg: string) {
  uploadError.value = msg
  clearTimeout(uploadErrorTimer)
  uploadErrorTimer = setTimeout(() => (uploadError.value = ''), 6000)
}

onUnmounted(() => clearTimeout(uploadErrorTimer))

onMounted(() => loadSkills(props.applicationId))
watch(
  () => props.applicationId,
  (id) => {
    pickerOpen.value = false
    mention.value = null
    loadSkills(id)
  },
)

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

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
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

  uploading.value = true
  for (const { file, mime } of valid) {
    try {
      const ext = file.name.split('.').pop() ?? ''
      let uploaded = await uploadFile(file, props.applicationId, props.mode ?? 'standard', mime)
      let docId = '0'
      let parseFailed = false
      // 2) 只有 standard 模式的非图片需要 docParse（claw 模式靠 URL 让 Agent 自己下载）
      //    且必须带上上传时 COS 返回的 ETag，否则上游解析失败拿不到 doc_id
      if (!mime.startsWith('image/') && (props.mode ?? 'standard') === 'standard') {
        try {
          const response = await parseFile({
            ApplicationId: props.applicationId,
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
          uploaded = await uploadFile(file, props.applicationId, props.mode ?? 'standard', mime, true)
        }
      }
      files.value.push({
        name: file.name,
        size: file.size,
        url: uploaded.Url,
        ext,
        docId,
      })
      if (parseFailed) {
        showUploadError(`「${file.name}」解析未完成，将以文件链接方式发送`)
      }
    } catch (e) {
      console.error('[Sender] upload failed', e)
      showUploadError(`「${file.name}」上传失败，请重试`)
    }
  }
  uploading.value = false
}

function removeFile(index: number) {
  files.value.splice(index, 1)
}
</script>

<template>
  <div class="sender-wrap">
    <div v-if="pickerOpen" class="pop-backdrop" @click="pickerOpen = false" />

    <div v-if="files.length" class="chips">
      <span v-for="(file, i) in files" :key="i" class="chip">
        {{ file.name }}
        <button @click="removeFile(i)">×</button>
      </span>
    </div>

    <div v-if="uploadError" class="upload-error" role="alert">{{ uploadError }}</div>

    <div class="card">
      <textarea
        v-model="text"
        ref="textarea"
        rows="1"
        :disabled="disabled"
        placeholder="支持上传图片 / PDF / Office 文档等提问，输入@唤起已安装的技能/工具/连接器"
        @keydown="onKeydown"
        @input="onInput"
      />

      <!-- @ 唤起：一级分类（独立浮层，高度由分类数决定） -->
      <div v-if="mentionVisible" class="mention-side">
        <button
          v-for="g in mentionGroups"
          :key="g.key"
          class="mp-cat"
          :class="{ on: mentionGroup === g.key }"
          :disabled="!g.items.length"
          @mouseenter="pickGroup(g.key)"
          @mousedown.prevent="pickGroup(g.key)"
        >
          <span class="mp-cat-label">{{ g.label }}</span>
          <span class="mp-arrow">›</span>
        </button>
      </div>

      <!-- @ 唤起：二级条目（独立浮层，高度由条目数决定） -->
      <div v-if="mentionVisible && (mentionCurrent?.items.length ?? 0) > 0" class="mention-sub">
        <button
          v-for="(s, i) in mentionCurrent?.items ?? []"
          :key="s.id"
          class="pop-item"
          :class="{ active: mentionLayer === 1 && i === mentionActive }"
          :title="s.desc"
          @mousedown.prevent="applyMention(s)"
          @mouseenter="mentionLayer = 1; mentionActive = i"
        >
          <img v-if="s.icon" class="pop-ico" :src="s.icon" alt="" />
          <span v-else class="pop-ico fallback">✦</span>
          <span class="pop-name">{{ s.name }}</span>
        </button>
      </div>

      <!-- 快选浮层：按种类列出已安装条目，点击即指定它做任务 -->
      <div v-if="pickerOpen" class="picker-pop">
        <input
          v-model="pickerQuery"
          class="pop-search"
          :placeholder="`搜索已安装的${pickerLabel}`"
          @keydown.enter.prevent="pickerFiltered[0] && insertMention(pickerFiltered[0])"
        />
        <div class="pop-list">
          <div v-if="!pickerFiltered.length" class="pop-empty">
            {{ loadingSkills ? '加载中…' : `暂无已安装的${pickerLabel}，点下方「管理${pickerLabel}」去安装` }}
          </div>
          <button
            v-for="s in pickerFiltered"
            :key="s.id"
            class="pop-item"
            :title="s.desc"
            @click="insertMention(s)"
          >
            <img v-if="s.icon" class="pop-ico" :src="s.icon" alt="" />
            <span v-else class="pop-ico fallback">✦</span>
            <span class="pop-name">{{ s.name }}</span>
          </button>
        </div>
        <button class="pop-manage" @click="openManage(pickerKind)">⚙ 管理{{ pickerLabel }}</button>
      </div>

      <div class="actions">
        <div class="left">
          <button class="cap" :disabled="disabled || uploading" :title="uploading ? '上传中…' : '上传附件'" @click="pickFiles">
            <span class="ico plus">+</span>
            <span v-if="uploading" class="lbl">上传中…</span>
          </button>
          <button class="cap" :class="{ on: pickerOpen && pickerKind === 'skill' }" @click="togglePicker('skill')"><span class="ico">✦</span>Skills</button>
          <button class="cap" :class="{ on: pickerOpen && pickerKind === 'connector' }" @click="togglePicker('connector')"><span class="ico">⇄</span>连接器</button>
          <button class="cap" :class="{ on: pickerOpen && pickerKind === 'tool' }" @click="togglePicker('tool')"><span class="ico">⚙</span>工具</button>
          <button class="cap" @click="emit('panel', 'knowledge')"><span class="ico">▤</span>知识库</button>
        </div>

        <button v-if="streaming" class="round stop" title="停止生成" @click="emit('stop')">■</button>
        <button
          v-else
          class="round send"
          title="发送"
          :disabled="disabled || (!text.trim() && !files.length)"
          @click="submit"
        >
          ↑
        </button>
      </div>
    </div>

    <input ref="fileInput" type="file" multiple hidden :accept="FILE_ACCEPT" @change="onFiles" />
  </div>
</template>

<style scoped>
.sender-wrap {
  padding: 4px 16px 14px;
  background: #fff;
}
.card {
  position: relative;
  border: 1px solid #e3e6ec;
  border-radius: 14px;
  padding: 10px 12px 8px;
  background: #fff;
  transition: border-color 0.15s;
}
.card:focus-within {
  border-color: #2b62d9;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  border: none;
  outline: none;
  resize: none;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 2px 2px 6px;
  max-height: 132px;
  overflow-y: auto;
}
textarea::placeholder {
  color: #a8afba;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
}
.cap {
  border: none;
  background: transparent;
  color: #5b6472;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.cap:hover {
  background: #f2f4f8;
  color: #2b3240;
}
.cap:disabled {
  color: #b0b6c0;
  cursor: not-allowed;
}
.cap.on {
  background: #eef3ff;
  color: #2b62d9;
}

/* ---------- @ 菜单 / Skills 快选浮层（对齐官方：图标 + 名称 + 管理） ---------- */
.pop-backdrop {
  position: fixed;
  inset: 0;
  z-index: 29;
}
.mention-side,
.mention-sub,
.picker-pop {
  position: absolute;
  bottom: calc(100% - 2px);
  left: 0;
  z-index: 30;
  background: #fff;
  border: 1px solid #e3e6ec;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14);
  overflow: hidden;
}
/* @ 两层菜单：两个独立浮层，高度各自随内容 */
.mention-side {
  width: 132px;
  padding: 4px;
}
.mention-sub {
  left: 140px;
  min-width: 240px;
  max-width: 380px;
  max-height: 300px;
  overflow-y: auto;
  padding: 4px;
}
.mp-cat {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #2b3240;
}
.mp-cat:hover {
  background: #f2f4f8;
}
.mp-cat.on {
  background: #eef3ff;
  color: #2b62d9;
}
.mp-cat:disabled {
  color: #b0b6c0;
  cursor: not-allowed;
}
.mp-cat-label {
  flex: 1;
  text-align: left;
}
.mp-arrow {
  color: #a8afba;
}
.picker-pop {
  width: 320px;
  display: flex;
  flex-direction: column;
  max-height: 340px;
}
.pop-search {
  margin: 8px;
  border: 1px solid #e3e6ec;
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
  font-size: 13px;
  outline: none;
}
.pop-search:focus {
  border-color: #2b62d9;
}
.pop-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 4px;
}
.pop-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #2b3240;
}
.pop-item.active,
.pop-item:hover {
  background: #f2f5fb;
}
.pop-ico {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  object-fit: cover;
}
.pop-ico.fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #eef3ff;
  color: #2b62d9;
  font-size: 11px;
}
.pop-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pop-empty {
  padding: 14px 10px;
  font-size: 12px;
  color: #9aa1ab;
  text-align: center;
}
.pop-manage {
  border: none;
  border-top: 1px solid #f0f2f6;
  background: #fff;
  padding: 9px 12px;
  font-size: 13px;
  color: #5b6472;
  cursor: pointer;
  text-align: left;
}
.pop-manage:hover {
  background: #f7f9fc;
  color: #2b62d9;
}
.ico {
  font-size: 12px;
  color: #8a93a3;
}
.ico.plus {
  font-size: 16px;
  line-height: 1;
}
.round {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.round.send {
  background: #2b62d9;
  color: #fff;
}
.round.send:disabled {
  background: #e3e6ec;
  color: #fff;
  cursor: not-allowed;
}
.round.stop {
  background: #2b62d9;
  color: #fff;
  font-size: 11px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.upload-error {
  margin-bottom: 6px;
  padding: 6px 10px;
  border: 1px solid #ffd7d5;
  background: #fff5f5;
  border-radius: 8px;
  color: #c0392b;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}
.chip {
  font-size: 12px;
  background: #eef3ff;
  border: 1px solid #dbe6ff;
  border-radius: 4px;
  padding: 2px 8px;
  color: #2b62d9;
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.chip button {
  border: none;
  background: none;
  cursor: pointer;
  color: #5b6472;
}
</style>
