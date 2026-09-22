<template>
  <div class="editor-pane" ref="editorContainer"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { createEditor, createEditorState } from '@/editor'
import { getActiveFormats } from '@/editor/commands'
import { useEditorStore } from '@/stores/editor'

const editorContainer = ref(null)
const store = useEditorStore()
let editorView = null
const emit = defineEmits(['ready'])

// 所有文档/选区变更统一走这里：字数、脏标记、光标位置、按钮激活态保持同源同步
function handleUpdate(update) {
  if (update.docChanged) store.updateContent(update.state.doc.toString())
  if (update.selectionSet || update.docChanged) {
    const pos = update.state.selection.main.head
    const line = update.state.doc.lineAt(pos)
    store.updateCursor(line.number, pos - line.from + 1)
    store.setActiveFormats(getActiveFormats(update.state))
  }
}

onMounted(() => {
  if (!editorContainer.value) return
  editorView = createEditor(editorContainer.value, {
    onUpdate: handleUpdate
  })
  store.loadDocument(editorView.state.doc.toString(), store.fileName)
  store.setActiveFormats(getActiveFormats(editorView.state))
  emit('ready', editorView)
})

onBeforeUnmount(() => { editorView?.destroy(); editorView = null })

/**
 * 整体替换文稿：用全新的 EditorState 替换（含全新 history 与装饰插件状态），
 * 上一份文稿的撤销栈、选区、激活格式不会污染新文稿。
 */
function loadDocument(doc = '', name = 'untitled.md') {
  if (!editorView) return
  editorView.setState(createEditorState(doc, handleUpdate))
  store.loadDocument(editorView.state.doc.toString(), name)
  editorView.focus()
}

defineExpose({
  getView: () => editorView,
  loadDocument
})
</script>

<style lang="scss" scoped>
.editor-pane {
  flex: 1;
  overflow: hidden;
  background: $bg-editor;
}
</style>
