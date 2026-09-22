import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { editorBaseTheme } from './theme'
import { markdownDecorationPlugin } from './decoration-plugin'
import { runFormatCommand } from './commands'

const defaultContent = `# Welcome to MD Live Editor

This is a **live rendering** markdown editor. Try clicking on any formatted text to see the raw syntax.

## Features

- **Bold text** and *italic text* render inline
- ~~Strikethrough~~ is supported too
- \`inline code\` looks great
- Links like [Google](https://www.google.com) are clickable

### Code Blocks

\`\`\`javascript
function greet(name) {
  console.log(\`Hello, \${name}!\`)
}
greet('World')
\`\`\`

### Blockquotes

> This is a blockquote. It has a nice left border and subtle background.
> You can write multiple lines here.

### Task Lists

- [x] Build the markdown parser
- [x] Implement decoration plugin
- [ ] Add more syntax support
- [ ] Polish the UI

### Images

![Placeholder](https://via.placeholder.com/600x200/e8f0fe/1a73e8?text=MD+Live+Editor)

---

### Table-like content

The editor focuses on **inline rendering** — what you see is what you get, but you can always click to edit the raw markdown.

Happy writing! ✨
`

/**
 * 创建编辑器状态（独立于 DOM，切换文稿时可整体替换以隔离历史/装饰/选区）。
 * @param {string} [doc] - 初始文档内容
 * @param {function} [onUpdate] - updateListener 回调
 * @returns {EditorState}
 */
export function createEditorState(doc, onUpdate) {
  const extensions = [
    // Core
    history(),
    drawSelection(),
    dropCursor(),
    highlightActiveLine(),
    bracketMatching(),
    EditorView.lineWrapping,

    // Keymaps（默认 + 撤销重做 + 格式化快捷键，全部走同一命令入口，
    // 因此按钮、快捷键、撤销混用行为完全一致）
    keymap.of([
      { key: 'Mod-b', run: view => runFormatCommand(view, 'bold') },
      { key: 'Mod-i', run: view => runFormatCommand(view, 'italic') },
      { key: 'Mod-e', run: view => runFormatCommand(view, 'code') },
      { key: 'Mod-k', run: view => runFormatCommand(view, 'link') },
      { key: 'Mod-Shift-x', run: view => runFormatCommand(view, 'strikethrough') },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab
    ]),

    // Markdown language support (for syntax tree)
    markdown({
      base: markdownLanguage,
      codeLanguages: languages
    }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

    // Our custom theme
    editorBaseTheme,

    // The live rendering plugin
    markdownDecorationPlugin,

    // Placeholder
    EditorView.contentAttributes.of({ spellcheck: 'true' })
  ]

  if (onUpdate) {
    extensions.push(EditorView.updateListener.of(onUpdate))
  }

  return EditorState.create({
    doc: doc === undefined ? defaultContent : doc,
    extensions
  })
}

/**
 * Create and mount a CodeMirror 6 editor instance.
 * @param {HTMLElement} parent - The DOM element to mount the editor into
 * @param {Object} [options]
 * @param {string} [options.doc] - Initial document content
 * @param {function} [options.onUpdate] - Callback for editor updates
 * @returns {EditorView}
 */
export function createEditor(parent, options = {}) {
  return new EditorView({
    state: createEditorState(options.doc, options.onUpdate),
    parent
  })
}
