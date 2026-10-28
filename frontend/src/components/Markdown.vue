<script setup lang="ts">
/** Markdown 渲染：markdown-it + katex + highlight.js + DOMPurify。
 * 流式期间是「全量重渲染」，同步渲染比组件树 diff 更稳，且与线上表现一致。
 * 正文里的 /workdir/... 文件链接被拦截为「预览」交互而不是导航。 */
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { katex } from '@mdit/plugin-katex'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import { previewFile } from '../composables/useWorkspace'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'

const props = defineProps<{ source: string }>()

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        return `<pre class="hljs"><code class="language-${lang}">${html}</code></pre>`
      } catch {
        /* 落到下面的兜底分支 */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`
  },
}).use(katex)

const html = computed(() => DOMPurify.sanitize(md.render(linkifyWorkdir(props.source || ''))))

/**
 * 正文里的 /workdir/... 产物路径未必是 markdown 链接（上游常写成纯文本或
 * 行内代码）。这里在「行内代码 / 现有链接目标」之外把它们补成链接，
 * 点击即可在右侧工作区预览。
 */
function linkifyWorkdir(src: string): string {
  // 上游有时会把产物写成「沙箱直链」：
  //   [/workdir/output/x.pdf](https://sandbox.adp.cloud.tencent.com/files?file_ticket=...&path=%2Fworkdir%2F...)
  // 这种带 ticket 的长 URL 不该展示给用户，统一改写回 /workdir 路径，
  // 点击后走右侧工作区预览。
  src = src.replace(
    /\]\(\s*https?:\/\/[^\s)]*\bpath=([^)\s]*)\s*\)/gi,
    (_, enc: string) => {
      try {
        const decoded = decodeURIComponent(enc)
        if (decoded.startsWith('/workdir/')) return `](${decoded})`
      } catch {
        /* 解不出来就交给下面的兜底 */
      }
      return `](${enc})`
    },
  )
  // 兜底：链接目标仍是沙箱 /files 直链（没有可解析的 path 参数）时，
  // 直接去掉链接只保留文字，避免把长 URL 展示出来
  src = src.replace(
    /\[([^\]\n]*)\]\(\s*https?:\/\/[^\s)]*\/files[^\s)]*\s*\)/gi,
    (_, text: string) => text,
  )
  const parts = src.split(/(`[^`\n]*`|\]\([^)\n]*\))/g)
  return parts
    .map((part) =>
      part.startsWith('`') || part.startsWith('](')
        ? part
        : part.replace(
            /(\/workdir\/[^\s`)\]}>（），。；：、"']*)(?!\]\()/g,
            (path) => `[${path}](${path})`,
          ),
    )
    .join('')
}

/** 正文里的链接（如生成的 Word 文档地址）一律在新标签页打开 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** 点击消息里的 /workdir/... 链接 → 打开右侧工作区预览（不导航） */
function onClick(e: MouseEvent) {
  const el = (e.target as HTMLElement | null)?.closest?.('a')
  if (!el) return
  const href = el.getAttribute('href') ?? ''
  let path = ''
  try {
    path = decodeURIComponent(href)
  } catch {
    path = href
  }
  if (!/^\/workdir\//i.test(path) && !path.includes('/workdir/')) return
  e.preventDefault()
  previewFile(path.slice(path.indexOf('/workdir/')))
}
</script>

<template>
  <div class="markdown-body" v-html="html" @click="onClick" />
</template>

<style scoped>
.markdown-body :deep(a) {
  color: #2b62d9;
  text-decoration: underline;
  cursor: pointer;
}
</style>
