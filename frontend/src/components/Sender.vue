<script setup lang="ts">
/**
 * 输入区（对齐官方样式）：圆角卡片 + 底部能力按钮行 + 右下角圆形发送键。
 *
 * 附件流程与线上一致：上传拿 URL → 非图片还要走一次实时文档解析拿 doc_id，
 * 最终以 { Type: 'file', File: { DocId, ... } } 随消息上行。
 * Skills / 工具 / 连接器 / 知识库按钮：Skills 弹出「已安装技能」快选浮层
 * （选中即把 @技能名 插入输入框，与官方 @ 技能效果一致；「管理 Skills」进管理面板），
 * 其余按钮唤起能力面板。输入框里输入 @ 同样唤起已安装技能菜单。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { parseFile, uploadFile } from '../api'
import type { AttachedFile } from '../composables/useChat'
import { loadInstalledSkills, useInstalledSkills, type InstalledSkill } from '../composables/useInstalledSkills'

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

const { installedSkills, loadingSkills, loadInstalledSkills: loadSkills } = useInstalledSkills()

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
// @ 唤起已安装技能：光标前紧跟 @关键词 时弹出菜单，回车/点击把候选替换进去
// ---------------------------------------------------------------------------

const mention = ref<{ start: number; query: string } | null>(null)
const mentionActive = ref(0)
const mentionFiltered = computed(() => {
  const q = (mention.value?.query ?? '').trim().toLowerCase()
  if (!q) return installedSkills.value
  return installedSkills.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q),
  )
})

/** 光标前是否是「@关键词」片段，是则记录片段起点并打开菜单 */
function updateMention() {
  const el = textarea.value
  if (!el) return
  const pos = el.selectionStart ?? text.value.length
  const before = text.value.slice(0, pos)
  const m = before.match(/(^|\s)@([^\s@]*)$/)
  if (m) {
    if (!installedSkills.value.length) loadSkills(props.applicationId)
    mention.value = { start: pos - m[2].length - 1, query: m[2] }
    if (mentionActive.value >= mentionFiltered.value.length) mentionActive.value = 0
  } else {
    mention.value = null
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

/** 选中技能：把「@关键词」替换成「@技能名 」，效果与官方 @ 技能一致 */
function applyMention(skill: InstalledSkill) {
  const m = mention.value
  const insert = `@${skill.name} `
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
// Skills 快选浮层：列出已安装技能，点击即指定该技能做任务
// ---------------------------------------------------------------------------

const pickerOpen = ref(false)
const pickerQuery = ref('')
const pickerFiltered = computed(() => {
  const q = pickerQuery.value.trim().toLowerCase()
  if (!q) return installedSkills.value
  return installedSkills.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q),
  )
})

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
  pickerQuery.value = ''
  if (pickerOpen.value) loadSkills(props.applicationId)
}

/** 浮层里点技能：在光标处插入 @技能名（若正在 @ 输入则替换该片段） */
function insertSkillMention(skill: InstalledSkill) {
  mention.value = null
  pickerOpen.value = false
  const el = textarea.value
  const pos = el?.selectionStart ?? text.value.length
  const before = text.value.slice(0, pos)
  const m = before.match(/(^|\s)@([^\s@]*)$/)
  const insert = `@${skill.name} `
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

function openManage() {
  pickerOpen.value = false
  emit('panel', 'skill')
}

function onKeydown(e: KeyboardEvent) {
  // @ 菜单打开时，方向键 / 回车 / Tab 先用于选择技能
  if (mention.value && mentionFiltered.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mentionActive.value = (mentionActive.value + 1) % mentionFiltered.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      mentionActive.value =
        (mentionActive.value - 1 + mentionFiltered.value.length) % mentionFiltered.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      applyMention(mentionFiltered.value[mentionActive.value])
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

  uploading.value = true
  for (const file of selected) {
    try {
      const ext = file.name.split('.').pop() ?? ''
      const uploaded = await uploadFile(file, props.applicationId, props.mode ?? 'standard')
      let docId = '0'
      if (!file.type.startsWith('image/')) {
        const response = await parseFile({
          ApplicationId: props.applicationId,
          FileName: file.name,
          FileType: ext,
          CosBucket: uploaded.CosBucket,
          CosUrl: uploaded.CosUrl,
          FileUrl: uploaded.Url,
          Size: String(file.size),
        })
        docId = (await readDocId(response)) || '0'
      }
      files.value.push({
        name: file.name,
        size: file.size,
        url: uploaded.Url,
        ext,
        docId,
      })
    } catch (e) {
      console.error('[Sender] upload failed', e)
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

    <div class="card">
      <textarea
        v-model="text"
        ref="textarea"
        rows="1"
        :disabled="disabled"
        placeholder="支持上传图片或文件进行提问，输入@唤起安装的Skills/工具/知识库"
        @keydown="onKeydown"
        @input="onInput"
      />

      <!-- @ 唤起：已安装技能菜单 -->
      <div v-if="mention && mentionFiltered.length" class="mention-pop">
        <button
          v-for="(s, i) in mentionFiltered"
          :key="s.id"
          class="pop-item"
          :class="{ active: i === mentionActive }"
          :title="s.desc"
          @mousedown.prevent="applyMention(s)"
          @mousemove="mentionActive = i"
        >
          <img v-if="s.icon" class="pop-ico" :src="s.icon" alt="" />
          <span v-else class="pop-ico fallback">✦</span>
          <span class="pop-name">{{ s.name }}</span>
        </button>
      </div>

      <!-- Skills 快选浮层：已安装技能，点击即指定该技能做任务 -->
      <div v-if="pickerOpen" class="picker-pop">
        <input
          v-model="pickerQuery"
          class="pop-search"
          placeholder="搜索已安装的 Skills"
          @keydown.enter.prevent="pickerFiltered[0] && insertSkillMention(pickerFiltered[0])"
        />
        <div class="pop-list">
          <div v-if="!pickerFiltered.length" class="pop-empty">
            {{ loadingSkills ? '加载中…' : '暂无已安装的技能，点下方「管理 Skills」去安装' }}
          </div>
          <button
            v-for="s in pickerFiltered"
            :key="s.id"
            class="pop-item"
            :title="s.desc"
            @click="insertSkillMention(s)"
          >
            <img v-if="s.icon" class="pop-ico" :src="s.icon" alt="" />
            <span v-else class="pop-ico fallback">✦</span>
            <span class="pop-name">{{ s.name }}</span>
          </button>
        </div>
        <button class="pop-manage" @click="openManage">⚙ 管理 Skills</button>
      </div>

      <div class="actions">
        <div class="left">
          <button class="cap" :disabled="disabled || uploading" :title="uploading ? '上传中…' : '上传附件'" @click="pickFiles">
            <span class="ico plus">+</span>
            <span v-if="uploading" class="lbl">上传中…</span>
          </button>
          <button class="cap" :class="{ on: pickerOpen }" @click="togglePicker"><span class="ico">✦</span>Skills</button>
          <button class="cap" @click="emit('panel', 'connector')"><span class="ico">⇄</span>连接器</button>
          <button class="cap" @click="emit('panel', 'tool')"><span class="ico">⚙</span>工具</button>
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

    <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
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
.mention-pop,
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
.mention-pop {
  min-width: 260px;
  max-width: 340px;
  max-height: 264px;
  overflow-y: auto;
  padding: 4px;
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
