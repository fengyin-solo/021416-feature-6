/**
 * 格式化命令引擎的确定性测试（纯 Node，无需浏览器）：
 *   node tests/commands.test.mjs
 *
 * 覆盖：无选区 / 有选区 / 跨行选区、重复执行切换而非叠加、
 *       未知格式与未知命令保持原内容、斜体不误伤粗体、
 *       行级格式的添加/切换/有序重编号、链接/图片/分割线插入。
 */
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import {
  formatSpec,
  getActiveFormats,
  INLINE_FORMATS
} from '../src/editor/commands.js'

/** 对状态应用命令规格（模拟 view.dispatch 的无视图版本），返回新状态 */
function apply(state, commandId) {
  const spec = formatSpec(state, commandId)
  if (!spec) return state
  return state.update(spec).state
}

function makeState(doc, anchor, head = anchor) {
  return EditorState.create({
    doc,
    selection: { anchor, head }
  })
}

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// ---------- 粗体：无选区 ----------
test('bold 无选区：插入占位骨架并选中占位符', () => {
  const s = makeState('hello', 0)
  const spec = formatSpec(s, 'bold')
  const next = s.update(spec).state
  assert.equal(next.doc.toString(), '**粗体文本**hello')
  assert.equal(next.sliceDoc(next.selection.main.from, next.selection.main.to), '粗体文本')
})

test('bold 无选区：光标位于已有粗体内 -> 移除标记（切换，不叠加）', () => {
  const doc = 'a **bold** b'
  // 光标落在 bold 中间（"a **bol" 长度 8）
  const s = makeState(doc, 8)
  const next = apply(s, 'bold')
  assert.equal(next.doc.toString(), 'a bold b')
  assert.equal(next.selection.main.empty, true)
})

test('bold 无选区：连续执行两次解包标记（文字保留，绝不叠加标记）', () => {
  let s = makeState('hello', 2)
  s = apply(s, 'bold') // 插入 he**粗体文本**llo
  assert.equal(s.doc.toString(), 'he**粗体文本**llo')
  // 占位符仍处于选中态，再执行一次解包：文字保留、标记消失
  s = apply(s, 'bold')
  assert.equal(s.doc.toString(), 'he粗体文本llo')
})

// ---------- 粗体：有选区 ----------
test('bold 有选区：包裹选中内容且选中包裹后的内容', () => {
  const doc = 'hello world'
  const s = makeState(doc, 0, 5) // "hello"
  const next = apply(s, 'bold')
  assert.equal(next.doc.toString(), '**hello** world')
  assert.equal(next.sliceDoc(next.selection.main.from, next.selection.main.to), 'hello')
})

test('bold 有选区：再次执行（标记在选区外）-> 解包', () => {
  const doc = '**hello** world'
  // 选中 hello（标记外）
  const s = makeState(doc, 2, 7)
  const next = apply(s, 'bold')
  assert.equal(next.doc.toString(), 'hello world')
  assert.equal(next.sliceDoc(next.selection.main.from, next.selection.main.to), 'hello')
})

test('bold 有选区：选区含标记 -> 剥离', () => {
  const doc = '**hello** world'
  const s = makeState(doc, 0, 9) // 选中 **hello**
  const next = apply(s, 'bold')
  assert.equal(next.doc.toString(), 'hello world')
})

test('bold 有选区：连按 3 次在 包裹/解包 间交替，绝不叠加 ****', () => {
  let s = makeState('abc', 0, 3)
  s = apply(s, 'bold')
  assert.equal(s.doc.toString(), '**abc**')
  s = apply(s, 'bold')
  assert.equal(s.doc.toString(), 'abc')
  s = apply(s, 'bold')
  assert.equal(s.doc.toString(), '**abc**')
})

// ---------- 粗体：跨行选区 ----------
test('bold 跨行选区：整体包裹，结果确定', () => {
  const doc = 'foo\nbar\nbaz'
  // 选中 "oo\nbar\nb"（跨行）
  const s = makeState(doc, 1, 9)
  const next = apply(s, 'bold')
  assert.equal(next.doc.toString(), 'f**oo\nbar\nb**az')
  assert.equal(next.sliceDoc(next.selection.main.from, next.selection.main.to), 'oo\nbar\nb')
})

test('bold 跨行选区：外层已包裹 -> 一次解包', () => {
  const doc = 'f**oo\nbar\nb**az'
  const s = makeState(doc, 3, 11) // 选中 oo\nbar\nb
  const next = apply(s, 'bold')
  assert.equal(next.doc.toString(), 'foo\nbar\nbaz')
})

// ---------- 斜体不误伤粗体 ----------
test('italic 不应匹配粗体的 ** 标记', () => {
  const doc = 'a **bold** b'
  const s = makeState(doc, 5) // 位于 bold 内
  const spec = formatSpec(s, 'italic')
  assert.ok(spec, 'italic 命令必须有返回（插入骨架）')
  const next = s.update(spec).state
  // 粗体的 ** 标记必须原样保留，斜体只在光标处插入自己的骨架
  assert.equal(next.doc.toString(), 'a **b*斜体文本*old** b')
})

test('italic 光标位于 *斜体* 内 -> 移除标记', () => {
  const doc = 'a *x* b'
  const s = makeState(doc, 4) // x 处
  const next = apply(s, 'italic')
  assert.equal(next.doc.toString(), 'a x b')
})

test('strikethrough / code 切换正常', () => {
  let s = makeState('ab', 0, 2)
  s = apply(s, 'strikethrough')
  assert.equal(s.doc.toString(), '~~ab~~')
  s = apply(s, 'strikethrough')
  assert.equal(s.doc.toString(), 'ab')

  s = apply(s, 'code')
  assert.equal(s.doc.toString(), '`ab`')
  s = apply(s, 'code')
  assert.equal(s.doc.toString(), 'ab')
})

// ---------- 未知格式 / 未知命令 ----------
test('未知格式 id：formatSpec 返回 null', () => {
  const s = makeState('abc', 1)
  assert.equal(formatSpec(s, 'underline'), null)
  assert.equal(formatSpec(s, 'highlight'), null)
})

test('未知命令不派发任何变更，原内容保持不变', () => {
  const s = makeState('abc **x** def', 0, 3)
  const next = apply(s, 'some-random-command')
  assert.equal(next, s) // 同一状态引用，未发生更新
  assert.equal(next.doc.toString(), 'abc **x** def')
})

// ---------- 行级格式：引用 ----------
test('blockquote 多行选区：每行加前缀', () => {
  const doc = 'a\nb\nc'
  // 选中三行
  const s = makeState(doc, 0, 5)
  const next = apply(s, 'blockquote')
  assert.equal(next.doc.toString(), '> a\n> b\n> c')
})

test('blockquote 再次执行：全部移除（切换）', () => {
  const doc = '> a\n> b\n> c'
  const s = makeState(doc, 0, doc.length)
  const next = apply(s, 'blockquote')
  assert.equal(next.doc.toString(), 'a\nb\nc')
})

test('blockquote 混合状态：缺前缀的行补齐，已有行不动', () => {
  const doc = '> a\nb'
  const s = makeState(doc, 0, doc.length)
  const next = apply(s, 'blockquote')
  assert.equal(next.doc.toString(), '> a\n> b')
})

test('blockquote 跳过空行', () => {
  const doc = 'a\n\nb'
  const s = makeState(doc, 0, doc.length)
  const next = apply(s, 'blockquote')
  assert.equal(next.doc.toString(), '> a\n\n> b')
})

// ---------- 行级格式：列表 ----------
test('bullet-list 添加/移除切换', () => {
  let s = makeState('a\nb', 0, 3)
  s = apply(s, 'bullet-list')
  assert.equal(s.doc.toString(), '- a\n- b')
  s = apply(s, 'bullet-list')
  assert.equal(s.doc.toString(), 'a\nb')
})

test('ordered-list 添加时按序编号，再次执行移除', () => {
  let s = makeState('a\nb\nc', 0, 5)
  s = apply(s, 'ordered-list')
  assert.equal(s.doc.toString(), '1. a\n2. b\n3. c')
  s = apply(s, 'ordered-list')
  assert.equal(s.doc.toString(), 'a\nb\nc')
})

test('有序 -> 无序：标记类型规范化，不残留编号', () => {
  const s = makeState('1. a\n2. b', 0, 7)
  const next = apply(s, 'bullet-list')
  assert.equal(next.doc.toString(), '- a\n- b')
})

test('无序 -> 有序：统一重编号', () => {
  const s = makeState('- a\n- b', 0, 7)
  const next = apply(s, 'ordered-list')
  assert.equal(next.doc.toString(), '1. a\n2. b')
})

// ---------- 链接 / 图片 / 分割线 ----------
test('link 有选区：包裹为 [文本](url) 且选中 URL', () => {
  const s = makeState('click here', 6, 10) // "here"
  const next = apply(s, 'link')
  assert.equal(next.doc.toString(), 'click [here](https://example.com)')
  assert.equal(
    next.sliceDoc(next.selection.main.from, next.selection.main.to),
    'https://example.com'
  )
})

test('link 光标在链接内：还原为纯文本（切换）', () => {
  const doc = 'see [Google](https://google.com) now'
  // 光标落在 Google 上
  const s = makeState(doc, 8)
  const next = apply(s, 'link')
  assert.equal(next.doc.toString(), 'see Google now')
})

test('link 选中整条链接：还原文本', () => {
  const doc = '[x](http://a)'
  const s = makeState(doc, 0, doc.length)
  const next = apply(s, 'link')
  assert.equal(next.doc.toString(), 'x')
})

test('link 无选区：插入占位骨架并选中文字', () => {
  const s = makeState('', 0)
  const next = apply(s, 'link')
  assert.equal(next.doc.toString(), '[链接文字](https://example.com)')
  assert.equal(next.sliceDoc(next.selection.main.from, next.selection.main.to), '链接文字')
})

test('image 有选区：选区作为 alt，URL 选中', () => {
  const s = makeState('pic', 0, 3)
  const next = apply(s, 'image')
  assert.equal(next.doc.toString(), '![pic](https://example.com/image.png)')
  assert.equal(
    next.sliceDoc(next.selection.main.from, next.selection.main.to),
    'https://example.com/image.png'
  )
})

test('hr：插入到当前行之后，光标落到分隔线之后', () => {
  const s = makeState('abc', 3)
  const next = apply(s, 'hr')
  assert.equal(next.doc.toString(), 'abc\n\n---\n\n')
  assert.equal(next.selection.main.head, next.doc.length)
})

// ---------- 激活格式检测 ----------
test('getActiveFormats：光标在粗体/斜体内时按钮应高亮', () => {
  const s = makeState('a **bold** and *it* end', 5)
  const active = getActiveFormats(s)
  assert.ok(active.includes('bold'))
  assert.ok(!active.includes('italic'))

  const s2 = makeState('a **bold** and *it* end', 16)
  assert.ok(getActiveFormats(s2).includes('italic'))
})

test('getActiveFormats：选中被粗体包裹的内容时高亮 bold', () => {
  const s = makeState('**abc**', 2, 5)
  assert.ok(getActiveFormats(s).includes('bold'))
})

test('getActiveFormats：多行均为引用/列表时高亮', () => {
  const s1 = makeState('> a\n> b', 0, 5)
  assert.ok(getActiveFormats(s1).includes('blockquote'))

  const s2 = makeState('1. a\n2. b', 0, 5)
  assert.ok(getActiveFormats(s2).includes('ordered-list'))
})

test('INLINE_FORMATS 与命令 id 一一对应（未知 id 有兜底）', () => {
  for (const id of Object.keys(INLINE_FORMATS)) {
    const s = makeState('x', 0, 1)
    assert.ok(formatSpec(s, id), `${id} 应返回规格`)
  }
})

console.log(`\n全部 ${passed} 项测试通过 ✅`)
