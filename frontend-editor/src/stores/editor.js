import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getActiveFormats } from '@/editor/format-commands'

export const useEditorStore = defineStore('editor', () => {
  const content = ref('')
  const fileName = ref('untitled.md')
  const isDirty = ref(false)
  const wordCount = ref(0)
  const charCount = ref(0)
  const lineCount = ref(0)
  const cursorLine = ref(1)
  const cursorCol = ref(1)
  // Format ids active at the current selection, e.g. ['bold', 'bullet-list']
  const activeFormats = ref([])

  const statusText = computed(() => {
    return `Ln ${cursorLine.value}, Col ${cursorCol.value} | ${wordCount.value} words | ${charCount.value} chars`
  })

  function updateContent(newContent) {
    content.value = newContent
    isDirty.value = true
    // Update stats
    charCount.value = newContent.length
    lineCount.value = newContent.split('\n').length
    wordCount.value = newContent.trim() ? newContent.trim().split(/\s+/).length : 0
  }

  /**
   * Load a document (initial mount or switching files). Stats are refreshed but
   * the document starts clean, so loading can never show a false save prompt.
   */
  function initContent(newContent) {
    content.value = newContent
    isDirty.value = false
    charCount.value = newContent.length
    lineCount.value = newContent.split('\n').length
    wordCount.value = newContent.trim() ? newContent.trim().split(/\s+/).length : 0
  }

  function updateCursor(line, col) {
    cursorLine.value = line
    cursorCol.value = col
  }

  /**
   * Refresh the format indicators. Derived purely from the passed-in
   * CodeMirror state, so it never carries state across documents.
   */
  function updateActiveFormats(viewOrState) {
    if (!viewOrState) {
      activeFormats.value = []
      return
    }
    const state = viewOrState.state || viewOrState
    activeFormats.value = getActiveFormats(state)
  }

  function setFileName(name) {
    fileName.value = name
  }

  function markSaved() {
    isDirty.value = false
  }

  return {
    content,
    fileName,
    isDirty,
    wordCount,
    charCount,
    lineCount,
    cursorLine,
    cursorCol,
    activeFormats,
    statusText,
    updateContent,
    initContent,
    updateCursor,
    updateActiveFormats,
    setFileName,
    markSaved
  }
})
