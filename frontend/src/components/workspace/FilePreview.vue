<script setup lang="ts">
/** 工作区文件预览：按扩展名分派渲染方式。
 *  - pdf / 图片 / html：同域代理 URL（Inline=1）直接内联
 *  - 文本类（md/txt/代码/数据）：拉取文本渲染
 *  - Office 文档：浏览器原生无法内联渲染，提示下载查看 */
import { computed, ref, watch } from 'vue'
import { downloadWorkspaceFile, fetchWorkspaceBlob } from '../../api'

const props = defineProps<{
  applicationId: string
  workspaceId: string
  path: string
  /** 外部版本号变化时强制重新加载 */
  version?: number
}>()

const fileName = computed(() => props.path.split('/').pop() || props.path)
const ext = computed(() => {
  const m = fileName.value.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
})

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'])
const TEXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yml', 'yaml', 'log',
  'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'sh', 'sql', 'java', 'go', 'rs', 'c', 'cpp',
])
const OFFICE = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'])

const kind = computed<'pdf' | 'image' | 'html' | 'text' | 'office' | 'unknown'>(() => {
  if (ext.value === 'pdf') return 'pdf'
  if (IMAGE.has(ext.value)) return 'image'
  if (ext.value === 'html' || ext.value === 'htm') return 'html'
  if (TEXT.has(ext.value)) return 'text'
  if (OFFICE.has(ext.value)) return 'office'
  return 'unknown'
})

const textContent = ref('')
const blobUrl = ref('')
const loading = ref(false)
const error = ref('')

let lastBlobUrl = ''
function setBlobUrl(url: string) {
  if (lastBlobUrl && lastBlobUrl !== url) URL.revokeObjectURL(lastBlobUrl)
  lastBlobUrl = url
  blobUrl.value = url
}

async function load() {
  error.value = ''
  textContent.value = ''
  setBlobUrl('')
  // iframe/img 的 src 带不上 X-User-Id 头，预览一律先 fetch 成 blob
  if (kind.value !== 'text') {
    loading.value = true
    try {
      setBlobUrl(
        await fetchWorkspaceBlob(props.applicationId, {
          workspaceId: props.workspaceId,
          path: props.path,
        }),
      )
    } catch (e) {
      error.value = e instanceof Error ? e.message : '读取失败'
    } finally {
      loading.value = false
    }
    return
  }
  loading.value = true
  try {
    const url = await fetchWorkspaceBlob(props.applicationId, {
      workspaceId: props.workspaceId,
      path: props.path,
    })
    const full = await (await fetch(url)).text()
    URL.revokeObjectURL(url)
    // 文本预览截断，避免超大文件卡渲染
    textContent.value = full.length > 400_000 ? full.slice(0, 400_000) + '\n…（内容过长已截断）' : full
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败'
  } finally {
    loading.value = false
  }
}

watch(() => [props.path, props.version, props.workspaceId], load, { immediate: true })

function download() {
  downloadWorkspaceFile(props.applicationId, { workspaceId: props.workspaceId, path: props.path })
}
</script>

<template>
  <div class="fp">
    <div class="fp-head">
      <span class="fp-name" :title="path">{{ fileName }}</span>
      <button class="fp-btn" title="下载" @click="download">⬇</button>
    </div>

    <div v-if="kind === 'pdf'" class="fp-body">
      <iframe :src="blobUrl" class="frame" :key="path + version" />
    </div>

    <div v-else-if="kind === 'image'" class="fp-body img-wrap">
      <img :src="blobUrl" :alt="fileName" :key="path + version" />
    </div>

    <div v-else-if="kind === 'html'" class="fp-body">
      <iframe :src="blobUrl" class="frame" :key="path + version" />
    </div>

    <div v-else-if="kind === 'text'" class="fp-body">
      <div v-if="loading" class="fp-hint">加载中…</div>
      <div v-else-if="error" class="fp-hint err">{{ error }}</div>
      <pre v-else class="code">{{ textContent }}</pre>
    </div>

    <div v-else class="fp-body center">
      <div class="fp-hint">
        该格式暂不支持在线预览
        <button class="dl" @click="download">下载查看</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.fp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #e6e9ef;
}
.fp-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #2b3240;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: #5b6472;
}
.fp-btn:hover {
  color: #2b62d9;
}
.fp-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fafbfc;
}
.img-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.img-wrap img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.code {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  color: #2b3240;
}
.center {
  display: flex;
  align-items: center;
  justify-content: center;
}
.fp-hint {
  color: #9aa1ab;
  font-size: 13px;
  text-align: center;
  padding: 12px;
}
.fp-hint.err {
  color: #d64541;
}
.dl {
  display: block;
  margin: 10px auto 0;
  padding: 6px 14px;
  border: 1px solid #c9d4e8;
  border-radius: 8px;
  background: #fff;
  color: #2b62d9;
  cursor: pointer;
  font-size: 13px;
}
.dl:hover {
  background: #f0f4fd;
}
</style>
