<script setup lang="ts">
/** Markdown 渲染：markdown-it + katex + highlight.js + DOMPurify。
 * 流式期间是「全量重渲染」，同步渲染比组件树 diff 更稳，且与线上表现一致。 */
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { katex } from '@mdit/plugin-katex'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
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

const html = computed(() => DOMPurify.sanitize(md.render(props.source || '')))

/** 正文里的链接（如生成的 Word 文档地址）一律在新标签页打开 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})
</script>

<template>
  <div class="markdown-body" v-html="html" />
</template>
