<template>
  <div class="editor-pane" ref="editorContainer"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { createEditor, createEditorState } from '@/editor'
import { useEditorStore } from '@/stores/editor'

const editorContainer = ref(null)
const store = useEditorStore()
let editorView = null
const emit = defineEmits(['ready'])

// Shared by the initial state and any document switch so store sync always
// runs through the exact same path.
function handleUpdate(update) {
  if (update.docChanged) store.updateContent(update.state.doc.toString())
  if (update.selectionSet || update.docChanged) {
    const pos = update.state.selection.main.head
    const line = update.state.doc.lineAt(pos)
    store.updateCursor(line.number, pos - line.from + 1)
    store.updateActiveFormats(update.state)
  }
}

onMounted(() => {
  if (!editorContainer.value) return
  editorView = createEditor(editorContainer.value, { onUpdate: handleUpdate })
  // Initial load: populate stats without marking the document dirty.
  store.initContent(editorView.state.doc.toString())
  store.updateActiveFormats(editorView.state)
  emit('ready', editorView)
})

onBeforeUnmount(() => { editorView?.destroy(); editorView = null })

/**
 * Switch to another document. The entire editor state is replaced with a
 * fresh one (new undo history, new selection) and all store-derived UI —
 * stats, dirty dot, active toolbar buttons — is reset, so formatting from
 * one document can never bleed into another.
 */
function loadDocument(text, fileName = 'untitled.md') {
  if (!editorView) return
  editorView.setState(createEditorState({ doc: text, onUpdate: handleUpdate }))
  store.setFileName(fileName)
  store.initContent(text)
  store.updateActiveFormats(editorView.state)
  editorView.focus()
}

defineExpose({
  getView: () => editorView,
  loadDocument,
})
</script>

<style lang="scss" scoped>
.editor-pane {
  flex: 1;
  overflow: hidden;
  background: $bg-editor;
}
</style>
