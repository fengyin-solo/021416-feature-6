import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useEditorStore = defineStore('editor', () => {
  const content = ref('')
  const fileName = ref('untitled.md')
  const isDirty = ref(false)
  const wordCount = ref(0)
  const charCount = ref(0)
  const lineCount = ref(0)
  const cursorLine = ref(1)
  const cursorCol = ref(1)
  // 当前光标/选区下激活的格式（工具栏按钮高亮），切换文稿时必须清空
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

  function updateCursor(line, col) {
    cursorLine.value = line
    cursorCol.value = col
  }

  /** 仅在激活格式变化时更新，避免每次选区更新都触发工具栏重渲染 */
  function setActiveFormats(list) {
    if (
      list.length === activeFormats.value.length &&
      list.every((id, i) => id === activeFormats.value[i])
    ) {
      return
    }
    activeFormats.value = list
  }

  function setFileName(name) {
    fileName.value = name
  }

  function markSaved() {
    isDirty.value = false
  }

  /**
   * 切换/新建文稿时的统一重置入口：
   * 内容、统计、脏标记、光标、激活格式全部归位，不残留上一份文稿的状态。
   */
  function loadDocument(newContent, name = 'untitled.md') {
    content.value = newContent
    fileName.value = name
    isDirty.value = false
    charCount.value = newContent.length
    lineCount.value = newContent.split('\n').length
    wordCount.value = newContent.trim() ? newContent.trim().split(/\s+/).length : 0
    cursorLine.value = 1
    cursorCol.value = 1
    activeFormats.value = []
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
    updateCursor,
    setActiveFormats,
    setFileName,
    markSaved,
    loadDocument
  }
})
