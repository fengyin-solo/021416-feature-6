/**
 * 格式化命令引擎（纯函数）
 *
 * 设计约定（确定性行为）：
 * - 无选区（光标态）：光标已处于该格式区域内 -> 移除标记（切换）；
 *                    否则在光标处插入 `标记+占位符+标记` 并选中占位符。
 * - 有选区（单行或跨行，同一套规则）：选区恰好被该标记包裹 -> 移除标记；
 *                    否则在选区两端插入标记，选中包裹后的内容。
 * - 行级格式（引用/列表）：作用于选区触及的每一个非空行；
 *                    全部已有该前缀 -> 移除，否则补齐（有序列表按序重编号）。
 * - 未知格式 / 未知命令：返回 null，调用方不得派发任何事务，原内容保持不变。
 * - 每个命令只派发一个事务，因此一次撤销即可完整回退。
 */

/**
 * 行内格式定义：标记符号 + 无选区时插入的占位符
 */
export const INLINE_FORMATS = {
  bold: { mark: '**', placeholder: '粗体文本' },
  italic: { mark: '*', placeholder: '斜体文本' },
  strikethrough: { mark: '~~', placeholder: '删除线文本' },
  code: { mark: '`', placeholder: '代码' }
}

const LINK_TEXT_PLACEHOLDER = '链接文字'
const LINK_URL_PLACEHOLDER = 'https://example.com'
const IMG_ALT_PLACEHOLDER = '图片描述'
const IMG_URL_PLACEHOLDER = 'https://example.com/image.png'

/** 行级格式 id 集合 */
export const LINE_FORMAT_IDS = ['blockquote', 'bullet-list', 'ordered-list']
/** 仅插入、不参与“激活态/切换”的命令 */
export const INSERT_ONLY_IDS = ['image', 'hr', 'new-document']

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构造“恰好由 mark 包裹”的正则：标记两侧不允许紧接同字符，
 * 例如斜体 `*` 不会误匹配粗体的 `**`。
 */
function wrappedPattern(mark) {
  const e = escapeRe(mark)
  const ch = escapeRe(mark[0])
  return new RegExp(
    `(?<!${ch})${e}(?!${ch})(.+?)(?<!${ch})${e}(?!${ch})`,
    'g'
  )
}

/** 选区外侧是否紧贴一对完整标记（标记的另一侧不能是同字符，避免 * 误吃 **） */
function hasOuterMarks(state, from, to, mark) {
  const ch = mark[0]
  const before = state.sliceDoc(from - mark.length, from)
  const after = state.sliceDoc(to, to + mark.length)
  if (before !== mark || after !== mark) return false
  const before2 = state.sliceDoc(from - mark.length - 1, from - mark.length)
  const after2 = state.sliceDoc(to + mark.length, to + mark.length + 1)
  return before2 !== ch && after2 !== ch
}

/** 选区文本自身是否就是 “标记+内容+标记” */
function hasInnerMarks(text, mark) {
  const ch = mark[0]
  return (
    text.length >= mark.length * 2 &&
    text.startsWith(mark) &&
    text.endsWith(mark) &&
    text[mark.length] !== ch &&
    text[text.length - mark.length - 1] !== ch
  )
}

/** 在光标所在行查找包含 pos 的行内格式区域 */
function findEnclosingInline(state, pos, mark) {
  const line = state.doc.lineAt(pos)
  const re = wrappedPattern(mark)
  let m
  while ((m = re.exec(line.text)) !== null) {
    const from = line.from + m.index
    const to = from + m[0].length
    if (pos >= from && pos <= to) {
      return { from, to, contentFrom: from + mark.length, contentTo: to - mark.length }
    }
  }
  return null
}

function findEnclosingLink(state, pos) {
  const line = state.doc.lineAt(pos)
  const re = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g
  let m
  while ((m = re.exec(line.text)) !== null) {
    const from = line.from + m.index
    const to = from + m[0].length
    if (pos >= from && pos <= to) {
      return { from, to }
    }
  }
  return null
}

/**
 * 行内格式切换。返回可用于 dispatch 的 { changes, selection }，未知格式返回 null。
 */
export function toggleInlineFormat(state, formatId) {
  const fmt = INLINE_FORMATS[formatId]
  if (!fmt) return null
  const { mark, placeholder } = fmt
  const range = state.selection.main

  // —— 无选区：光标态 ——
  if (range.empty) {
    const region = findEnclosingInline(state, range.head, mark)
    if (region) {
      // 移除包裹标记，光标按其相对内容的位置落位
      const pos = range.head
      const openBefore = pos > region.from ? Math.min(mark.length, pos - region.from) : 0
      const closeBefore = pos > region.to - mark.length ? pos - (region.to - mark.length) : 0
      const newPos = pos - openBefore - closeBefore
      return {
        changes: [
          { from: region.from, to: region.contentFrom },
          { from: region.contentTo, to: region.to }
        ],
        selection: { anchor: newPos }
      }
    }
    // 插入占位符并选中，用户可直接键入替换
    const insert = `${mark}${placeholder}${mark}`
    return {
      changes: { from: range.head, insert },
      selection: {
        anchor: range.head + mark.length,
        head: range.head + mark.length + placeholder.length
      }
    }
  }

  // —— 有选区（单行/跨行规则一致）——
  const { from, to } = range
  const selText = state.sliceDoc(from, to)

  if (hasOuterMarks(state, from, to, mark)) {
    // 选中内容、标记在选区外：删掉外层标记
    return {
      changes: [
        { from: from - mark.length, to: from },
        { from: to, to: to + mark.length }
      ],
      selection: { anchor: from - mark.length, head: to - mark.length }
    }
  }

  if (hasInnerMarks(selText, mark)) {
    // 选区已包含标记：剥离标记
    return {
      changes: [
        { from: from, to: from + mark.length },
        { from: to - mark.length, to }
      ],
      selection: { anchor: from, head: to - mark.length * 2 }
    }
  }

  // 包裹
  return {
    changes: [
      { from, insert: mark },
      { from: to, insert: mark }
    ],
    selection: { anchor: from + mark.length, head: to + mark.length }
  }
}

/**
 * 链接切换：光标处于链接内 -> 还原为纯文本；选区为整条链接 -> 同样还原；
 * 否则用选区包裹链接骨架（URL 选中），无选区时插入占位骨架（文字选中）。
 */
export function toggleLink(state) {
  const range = state.selection.main
  if (range.empty) {
    const region = findEnclosingLink(state, range.head)
    if (region) {
      const m = state.sliceDoc(region.from, region.to)
        .match(/^\[([^\]]*)\]\(([^)]*)\)$/)
      if (m) {
        return {
          changes: { from: region.from, to: region.to, insert: m[1] },
          selection: { anchor: region.from + m[1].length }
        }
      }
    }
  }
  return buildLinkSpec(state, range)
}

/** 生成链接骨架。已有链接 -> 提取文本；选区 -> [选区](url)；无选区 -> 占位符 */
function buildLinkSpec(state, range) {
  const { from, to } = range
  if (range.empty) {
    const insert = `[${LINK_TEXT_PLACEHOLDER}](${LINK_URL_PLACEHOLDER})`
    return {
      changes: { from, insert },
      selection: { anchor: from + 1, head: from + 1 + LINK_TEXT_PLACEHOLDER.length }
    }
  }
  const selText = state.sliceDoc(from, to)
  // 选中的是整条链接 -> 还原为链接文本
  const m = selText.match(/^\[([^\]]*)\]\(([^)]*)\)$/)
  if (m) {
    return {
      changes: { from, to, insert: m[1] },
      selection: { anchor: from, head: from + m[1].length }
    }
  }
  const insert = `[${selText}](${LINK_URL_PLACEHOLDER})`
  return {
    changes: { from, to, insert },
    selection: {
      anchor: to + 3, // "[x](" 之后
      head: to + 3 + LINK_URL_PLACEHOLDER.length
    }
  }
}

/** 图片插入（仅插入，不切换）：选区作为 alt，否则插入占位骨架 */
export function insertImage(state) {
  const range = state.selection.main
  const { from, to } = range
  if (range.empty) {
    const insert = `![${IMG_ALT_PLACEHOLDER}](${IMG_URL_PLACEHOLDER})`
    return {
      changes: { from, insert },
      selection: { anchor: from + 2, head: from + 2 + IMG_ALT_PLACEHOLDER.length }
    }
  }
  const selText = state.sliceDoc(from, to)
  const insert = `![${selText}](${IMG_URL_PLACEHOLDER})`
  return {
    changes: { from, to, insert },
    selection: {
      anchor: to + 4, // "![x](" 之后
      head: to + 4 + IMG_URL_PLACEHOLDER.length
    }
  }
}

/** 取选区覆盖的行；若选区端点正好落在下一行行首（from < to），不包含该空行 */
function linesTouchedBySelection(state) {
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  let lastLineNo = last.number
  // 选区端点正好落在下一行行首时，不把那个（未被选中的）行计入
  if (to > from && to === last.from && last.number > first.number) {
    lastLineNo = last.number - 1
  }
  const lines = []
  for (let n = first.number; n <= lastLineNo; n++) lines.push(state.doc.line(n))
  return lines
}

const BLOCKQUOTE_RE = /^>\s?/
const BULLET_RE = /^(\s*)[-*+]\s/
const ORDERED_RE = /^(\s*)\d+\.\s/
const INDENT_RE = /^\s*/

function isNonEmpty(line) {
  return line.text.trim().length > 0
}

function buildLineChanges(state, id) {
  const lines = linesTouchedBySelection(state).filter(isNonEmpty)
  if (lines.length === 0) return null
  const changes = []

  if (id === 'blockquote') {
    const allHave = lines.every(l => BLOCKQUOTE_RE.test(l.text))
    for (const line of lines) {
      const m = line.text.match(BLOCKQUOTE_RE)
      if (allHave && m) changes.push({ from: line.from, to: line.from + m[0].length })
      else if (!m) changes.push({ from: line.from, insert: '> ' })
    }
    return { changes }
  }

  if (id === 'bullet-list') {
    const allBullet = lines.every(l => BULLET_RE.test(l.text))
    for (const line of lines) {
      if (allBullet) {
        // 全部已是无序列表 -> 移除标记（保留缩进）
        const bm = line.text.match(BULLET_RE)
        if (bm) changes.push({ from: line.from, to: line.from + bm[0].length, insert: bm[1] })
        continue
      }
      // 补齐：有序/无序标记统一规范化为 "- "，其余行在缩进后插入
      const marker = line.text.match(BULLET_RE) || line.text.match(ORDERED_RE)
      if (marker) {
        changes.push({
          from: line.from,
          to: line.from + marker[0].length,
          insert: `${marker[1]}- `
        })
      } else {
        changes.push({ from: line.from + line.text.match(INDENT_RE)[0].length, insert: '- ' })
      }
    }
    return { changes }
  }

  if (id === 'ordered-list') {
    const allOrdered = lines.every(l => ORDERED_RE.test(l.text))
    let num = 1
    for (const line of lines) {
      if (allOrdered) {
        // 全部已是有序列表 -> 移除标记（保留缩进）
        const om = line.text.match(ORDERED_RE)
        if (om) changes.push({ from: line.from, to: line.from + om[0].length, insert: om[1] })
        continue
      }
      // 补齐：所有触及行统一按序重编号，标记类型一并规范化
      const marker = line.text.match(ORDERED_RE) || line.text.match(BULLET_RE)
      if (marker) {
        changes.push({
          from: line.from,
          to: line.from + marker[0].length,
          insert: `${marker[1]}${num}. `
        })
      } else {
        const indent = line.text.match(INDENT_RE)[0]
        changes.push({ from: line.from + indent.length, insert: `${num}. ` })
      }
      num++
    }
    return { changes }
  }

  return null
}

/** 行级格式切换（引用 / 无序列表 / 有序列表） */
export function toggleLineFormat(state, id) {
  if (!LINE_FORMAT_IDS.includes(id)) return null
  return buildLineChanges(state, id)
}

/** 水平分割线：插入到当前行之后，光标落到分割线后的空行 */
export function insertHorizontalRule(state) {
  const line = state.doc.lineAt(state.selection.main.head)
  const insert = '\n\n---\n\n'
  return {
    changes: { from: line.to, insert },
    selection: { anchor: line.to + insert.length }
  }
}

/**
 * 命令总入口：返回可 dispatch 的规格；未知命令返回 null（保持原内容）。
 */
export function formatSpec(state, commandId) {
  if (INLINE_FORMATS[commandId]) return toggleInlineFormat(state, commandId)
  if (commandId === 'link') return toggleLink(state)
  if (commandId === 'image') return insertImage(state)
  if (LINE_FORMAT_IDS.includes(commandId)) return buildLineChanges(state, commandId)
  if (commandId === 'hr') return insertHorizontalRule(state)
  return null
}

/**
 * 派发格式化命令。返回 true 表示已处理；false 表示未知命令，
 * 此时不派发任何事务，文档保持原样。
 * @param {EditorView} view
 * @param {string} commandId
 * @returns {boolean}
 */
export function runFormatCommand(view, commandId) {
  const spec = formatSpec(view.state, commandId)
  if (!spec) return false
  view.dispatch(spec)
  view.focus()
  return true
}

/**
 * 计算当前选区/光标下激活的格式 id，用于工具栏按钮高亮。
 * @param {EditorState} state
 * @returns {string[]}
 */
export function getActiveFormats(state) {
  const active = []
  const range = state.selection.main
  const { from, to } = range

  if (range.empty) {
    for (const [id, fmt] of Object.entries(INLINE_FORMATS)) {
      if (findEnclosingInline(state, to, fmt.mark)) active.push(id)
    }
    if (findEnclosingLink(state, to)) active.push('link')
  } else {
    const selText = state.sliceDoc(from, to)
    for (const [id, fmt] of Object.entries(INLINE_FORMATS)) {
      if (hasOuterMarks(state, from, to, fmt.mark) || hasInnerMarks(selText, fmt.mark)) {
        active.push(id)
      }
    }
    if (/^\[([^\]]*)\]\(([^)]*)\)$/.test(selText)) active.push('link')
  }

  const touched = linesTouchedBySelection(state).filter(isNonEmpty)
  if (touched.length > 0) {
    if (touched.every(l => BLOCKQUOTE_RE.test(l.text))) active.push('blockquote')
    if (touched.every(l => BULLET_RE.test(l.text))) active.push('bullet-list')
    if (touched.every(l => ORDERED_RE.test(l.text))) active.push('ordered-list')
  }

  return active
}
