<script setup lang="ts">
/** 工作区文件树：懒加载逐层展开（ListDir depth=1），点击文件向外发 select。
 *  目录展开时渲染自身（递归组件），子层自己拉取目录数据。 */
import { onMounted, ref, watch } from 'vue'
import { listWorkspaceDir, type WorkspaceDirEntry } from '../../api'

defineOptions({ name: 'FileTree' })

const props = defineProps<{
  applicationId: string
  workspaceId: string
  /** 选中高亮的文件路径 */
  activePath?: string
  /** 外部刷新信号（版本号变化即重拉根目录） */
  refreshKey?: number
  rootPath?: string
  /** 是否根层（空态文案不同） */
  isRoot?: boolean
}>()
const emit = defineEmits<{ (e: 'select', path: string): void }>()

const ROOT = '/workdir'
const loading = ref(false)
const error = ref('')
const entries = ref<TreeNode[]>([])

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  expanded: boolean
}

function sortEntries(list: WorkspaceDirEntry[]): WorkspaceDirEntry[] {
  return [...list].sort((a, b) => {
    const da = a.type === 'FILE_TYPE_DIRECTORY' ? 0 : 1
    const db = b.type === 'FILE_TYPE_DIRECTORY' ? 0 : 1
    if (da !== db) return da - db
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN')
  })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const parent = props.rootPath || ROOT
    const list = await listWorkspaceDir(props.applicationId, {
      workspaceId: props.workspaceId,
      path: parent,
      depth: 1,
    })
    entries.value = sortEntries(list).map((e) => ({
      name: String(e.name ?? ''),
      path: e.path || `${parent.replace(/\/$/, '')}/${e.name}`,
      isDir: e.type === 'FILE_TYPE_DIRECTORY',
      expanded: false,
    }))
  } catch (e) {
    error.value = e instanceof Error ? e.message : '目录加载失败'
  } finally {
    loading.value = false
  }
}

function toggle(node: TreeNode) {
  if (!node.isDir) {
    emit('select', node.path)
    return
  }
  node.expanded = !node.expanded
}

onMounted(load)
watch(
  () => [props.applicationId, props.workspaceId, props.refreshKey],
  () => load(),
)
</script>

<template>
  <div class="tree">
    <div v-if="loading" class="hint">加载中…</div>
    <div v-else-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="!entries.length" class="hint">
      {{ isRoot ? '工作区还没有文件' : '（空目录）' }}
    </div>
    <template v-else>
      <div v-for="n in entries" :key="n.path">
        <div
          class="row"
          :class="{ active: n.path === activePath }"
          @click="toggle(n)"
        >
          <span class="tw" :class="{ open: n.isDir && n.expanded }">{{ n.isDir ? '▸' : '' }}</span>
          <span class="ico">{{ n.isDir ? '📁' : '📄' }}</span>
          <span class="name" :title="n.path">{{ n.name }}</span>
        </div>
        <div v-if="n.isDir && n.expanded" class="sub">
          <FileTree
            :applicationId="applicationId"
            :workspaceId="workspaceId"
            :activePath="activePath"
            :rootPath="n.path"
            @select="(p) => emit('select', p)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree {
  font-size: 13px;
}
.sub {
  padding-left: 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  color: #37414f;
  white-space: nowrap;
}
.row:hover {
  background: #f0f3f8;
}
.row.active {
  background: #e8effc;
  color: #2b62d9;
}
.tw {
  flex: 0 0 10px;
  font-size: 10px;
  color: #9aa1ab;
  transition: transform 0.15s;
}
.tw.open {
  transform: rotate(90deg);
}
.ico {
  font-size: 12px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.hint {
  color: #9aa1ab;
  font-size: 12px;
  padding: 6px;
}
.hint.err {
  color: #d64541;
}
</style>
