<template>
  <div class="app">
    <Toolbar @action="handleToolbarAction" />
    <EditorPane ref="editorPane" @ready="onEditorReady" />
    <StatusBar />
    <Transition name="toast">
      <div v-if="toast.visible" :class="['toast', `toast--${toast.type}`]">
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import Toolbar from '@/components/Toolbar.vue'
import EditorPane from '@/components/EditorPane.vue'
import StatusBar from '@/components/StatusBar.vue'
import { runFormatCommand } from '@/editor/format-commands'
import { useEditorStore } from '@/stores/editor'

const editorPane = ref(null)
let editorView = null
const store = useEditorStore()

const toast = reactive({ visible: false, message: '', type: 'info' })
let toastTimer = null

function showToast(msg, type = 'info') {
  toast.message = msg; toast.type = type; toast.visible = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.visible = false }, 2000)
}

function onEditorReady(view) { editorView = view }

// Command ids understood by the format engine. Anything else is unknown and
// must leave the document untouched.
const KNOWN_COMMANDS = new Set([
  'bold', 'italic', 'strikethrough', 'code', 'link', 'image',
  'blockquote', 'bullet-list', 'ordered-list', 'hr',
])

function handleToolbarAction(action) {
  if (!editorView) return
  if (!KNOWN_COMMANDS.has(action)) {
    showToast(`未知操作: ${action}`, 'warning')
    return
  }
  runFormatCommand(editorView, action)
  // Re-sync button state right away (the update listener covers the rest:
  // word count, dirty dot, cursor pos, live decorations).
  store.updateActiveFormats(editorView.state)
  editorView.focus()
}
</script>

<style lang="scss" scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg;
}

.toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: $sp-2 $sp-5;
  border-radius: $r-full;
  font-size: $fs-sm;
  color: #fff;
  z-index: $z-toast;
  box-shadow: $shadow-lg;
  pointer-events: none;
  font-family: $font-ui;

  &--info { background: $accent; }
  &--success { background: $success; }
  &--warning { background: $warning; }
  &--error { background: $error; }
}

.toast-enter-active,
.toast-leave-active {
  transition: all $t-slow $ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
