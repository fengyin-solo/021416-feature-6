/**
 * Deterministic behavior tests for src/editor/format-commands.js.
 *
 * Run: npm run test:format
 * Uses the real CodeMirror EditorState (no DOM needed) so change mapping,
 * selection handling and the actual markdown parser are all exercised.
 */
import assert from 'node:assert/strict'
import { EditorState, EditorSelection } from '@codemirror/state'
import { buildFormatSpec, getActiveFormats } from '../src/editor/format-commands.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

/** Apply a command to a fresh state; returns { state, doc, sel, spec } */
function apply(docText, sel, command) {
  let state = EditorState.create({
    doc: docText,
    selection: typeof sel === 'number'
      ? EditorSelection.single(sel)
      : EditorSelection.single(sel[0], sel[1]),
  })
  const spec = buildFormatSpec(state, command)
  if (!spec) return { state, doc: state.doc.toString(), spec: null }
  state = state.update(spec).state
  const main = state.selection.main
  return {
    state,
    doc: state.doc.toString(),
    spec,
    sel: [main.from, main.to],
    empty: main.empty,
  }
}

const stateAt = (text, sel) =>
  EditorState.create({
    doc: text,
    selection: typeof sel === 'number'
      ? EditorSelection.single(sel)
      : EditorSelection.range(sel[0], sel[1]),
  })
const eq = assert.equal

console.log('Collapsed selection (no selection) — insert empty pair, cursor inside')
test('bold inserts **** with cursor between markers and reports active', () => {
  const r = apply('abc', 1, 'bold')
  eq(r.doc, 'a****bc')
  eq(r.sel[0], 3)
  eq(r.empty, true)
  assert.ok(getActiveFormats(r.state).includes('bold'))
})
test('italic inserts empty single-star pair', () => {
  const r = apply('abc', 1, 'italic')
  eq(r.doc, 'a**bc') // '*' + '*'
  eq(r.sel[0], 2)
})
test('strikethrough / code empty pairs', () => {
  eq(apply('abc', 0, 'strikethrough').doc, '~~~~abc')
  eq(apply('abc', 3, 'code').doc, 'abc``')
})

console.log('\nToggle: same command twice returns to original (no stacking)')
test('bold twice on collapsed: empty pair then back to original', () => {
  const once = apply('abc', 1, 'bold')
  eq(once.doc, 'a****bc')
  const twice = apply(once.doc, once.sel[0], 'bold')
  eq(twice.doc, 'abc')
})
test('bold thrice equals once (stable cycle)', () => {
  const a = apply('abc', 1, 'bold')
  const b = apply(a.doc, a.sel[0], 'bold')
  const c = apply(b.doc, b.sel[0], 'bold')
  eq(c.doc, a.doc)
})
test('cursor inside existing **** pair toggles bold off', () => {
  eq(apply('a****bc', 3, 'bold').doc, 'abc')
})
test('**** at cursor is bold-active, not italic-active', () => {
  const active = getActiveFormats(stateAt('a****bc', 3))
  assert.ok(active.includes('bold'))
  assert.ok(!active.includes('italic'))
})

console.log('\nNon-empty selection')
test('bold wraps selection and keeps the new range selected', () => {
  const r = apply('hello world', [0, 5], 'bold')
  eq(r.doc, '**hello** world')
  eq(r.sel[0], 0)
  eq(r.sel[1], 9)
})
test('bold on fully-bold selection removes markers', () => {
  const r = apply('**hello** world', [0, 9], 'bold')
  eq(r.doc, 'hello world')
  eq(r.sel[0], 0)
  eq(r.sel[1], 5)
})
test('bold on content-only selection removes markers too', () => {
  const r = apply('**hello** world', [2, 7], 'bold')
  eq(r.doc, 'hello world')
})
test('bold then un-bold the produced range cycles back', () => {
  const on = apply('hello', [0, 5], 'bold')
  eq(on.doc, '**hello**')
  const off = apply(on.doc, [on.sel[0], on.sel[1]], 'bold')
  eq(off.doc, 'hello')
  eq(off.sel[0], 0)
  eq(off.sel[1], 5)
})
test('partial "**a** b" wraps only b — never emits broken **** markers', () => {
  const r = apply('**a** b', [0, 7], 'bold')
  eq(r.doc, '**a** **b**')
  assert.ok(!r.doc.includes('****'))
})
test('code wraps selection and toggles off', () => {
  const on = apply('x code y', [2, 6], 'code')
  eq(on.doc, 'x `code` y')
  const off = apply(on.doc, [2, 8], 'code')
  eq(off.doc, 'x code y')
})
test('link wraps selection and selects the url placeholder for typing', () => {
  const r = apply('hello', [0, 5], 'link')
  eq(r.doc, '[hello](url)')
  eq(r.doc.slice(r.sel[0], r.sel[1]), 'url')
})
test('collapsed link inserts the template', () => {
  const r = apply('hello', 5, 'link')
  eq(r.doc, 'hello[text](url)')
})
test('collapsed inside a link: link removes it instead of nesting', () => {
  // [hello](url) — text "hello" spans positions 1..6
  const r = apply('[hello](url) x', 3, 'link')
  eq(r.doc, 'hello x')
})
test('image wraps selection and toggles off from inside', () => {
  const on = apply('cat', [0, 3], 'image')
  eq(on.doc, '![cat](url)')
  // ![cat](url) — alt "cat" spans positions 2..5
  const off = apply(on.doc, 3, 'image')
  eq(off.doc, 'cat')
})

console.log('\nMulti-line selection')
test('bold wraps each non-empty line fragment', () => {
  const r = apply('a\nb\nc', [0, 4], 'bold')
  eq(r.doc, '**a**\n**b**\nc')
})
test('bold skips the blank line in a multi-line selection', () => {
  const r = apply('a\n\nb', [0, 4], 'bold')
  eq(r.doc, '**a**\n\n**b**')
})
test('multi-line bold toggles off with one command', () => {
  const on = apply('a\nb', [0, 3], 'bold')
  eq(on.doc, '**a**\n**b**')
  const off = apply(on.doc, [0, on.doc.length - 1], 'bold')
  eq(off.doc, 'a\nb')
})

console.log('\nBlock formats')
test('blockquote toggles prefix and cursor follows the insertion', () => {
  const on = apply('hello', 2, 'blockquote')
  eq(on.doc, '> hello')
  eq(on.sel[0], 4)
  const off = apply(on.doc, on.sel[0], 'blockquote')
  eq(off.doc, 'hello')
})
test('bullet list toggles multiple lines on and off again', () => {
  const on = apply('a\nb', [0, 3], 'bullet-list')
  eq(on.doc, '- a\n- b')
  const off = apply(on.doc, [0, on.doc.length - 1], 'bullet-list')
  eq(off.doc, 'a\nb')
})
test('ordered list numbers lines sequentially, repeating toggles off', () => {
  const ordered = apply('a\nb', [0, 3], 'ordered-list')
  eq(ordered.doc, '1. a\n2. b')
  const again = apply(ordered.doc, [0, ordered.doc.length - 1], 'ordered-list')
  eq(again.doc, 'a\nb')
})
test('bullet <-> ordered converts markers instead of stacking', () => {
  const bullet = apply('a\nb', [0, 3], 'bullet-list')
  eq(bullet.doc, '- a\n- b')
  const ordered = apply(bullet.doc, [0, bullet.doc.length - 1], 'ordered-list')
  eq(ordered.doc, '1. a\n2. b')
  assert.ok(!ordered.doc.includes('- '))
  const back = apply(ordered.doc, [0, ordered.doc.length - 1], 'bullet-list')
  eq(back.doc, '- a\n- b')
  assert.ok(!/\d+\./.test(back.doc))
})
test('mixed list lines: adding a format never stacks prefixes', () => {
  // one ordered, one plain -> bullet converts the ordered line and adds bullet
  const r = apply('1. a\nb', [0, 6], 'bullet-list')
  eq(r.doc, '- a\n- b')
})
test('collapsed cursor on blank line creates a block prefix', () => {
  eq(apply('a\n\nb', 2, 'bullet-list').doc, 'a\n- \nb')
  eq(apply('a\n\nb', 2, 'ordered-list').doc, 'a\n1. \nb')
  eq(apply('a\n\nb', 2, 'blockquote').doc, 'a\n> \nb')
})
test('block formats skip blank lines', () => {
  eq(apply('a\n\nb', [0, 4], 'bullet-list').doc, '- a\n\n- b')
})
test('nested list keeps indentation on both on and off', () => {
  const on = apply('  nested', [2, 8], 'bullet-list')
  eq(on.doc, '  - nested')
  const off = apply(on.doc, 4, 'bullet-list')
  eq(off.doc, '  nested')
})

console.log('\nHorizontal rule')
test('hr on a text line appends a separated rule', () => {
  eq(apply('hello', 2, 'hr').doc, 'hello\n\n---\n\n')
})
test('hr on blank line absorbs adjacent blanks — never stacks ------', () => {
  const r = apply('hello\n\n\nworld', 7, 'hr')
  eq(r.doc, 'hello\n---\nworld')
  assert.ok(!r.doc.includes('------'))
})
test('hr next to an existing hr does not merge markers', () => {
  // cursor on the text line "x" — hr is appended after it
  const r = apply('---\n\nx', 6, 'hr')
  eq(r.doc, '---\n\nx\n\n---\n\n')
  assert.ok(!r.doc.includes('------'))
})

console.log('\nUnknown commands / formats preserve content exactly')
test('unknown command returns null and leaves doc untouched', () => {
  const doc = 'keep **me** intact'
  const r = apply(doc, [5, 7], 'totally-unknown')
  eq(r.spec, null)
  eq(r.doc, doc)
})
test('empty / undefined command is a no-op', () => {
  eq(apply('abc', 1, '').spec, null)
  eq(apply('abc', 1, undefined).spec, null)
})
test('collapsed cursor always inserts an empty pair (even on blank lines)', () => {
  const r = apply('a\n\nb', 2, 'bold')
  eq(r.doc, 'a\n****\nb')
  eq(r.empty, true)
})

console.log('\nNo pollution outside the target area')
test('inline command changes nothing before/after the selection', () => {
  const r = apply('**keep** middle **keep**', [9, 15], 'bold')
  eq(r.doc, '**keep** **middle** **keep**')
})
test('block command on one line does not touch the other lines', () => {
  // 'a\nb\nc' — position 2 is on line b
  eq(apply('a\nb\nc', 2, 'blockquote').doc, 'a\n> b\nc')
})

console.log('\nActive formats reflect the cursor position')
test('inline indicators', () => {
  assert.deepEqual(getActiveFormats(stateAt('**b**', 3)), ['bold'])
  assert.deepEqual(getActiveFormats(stateAt('plain', 2)), [])
  assert.ok(getActiveFormats(stateAt('`x`', 2)).includes('code'))
  assert.ok(getActiveFormats(stateAt('~~s~~', 2)).includes('strikethrough'))
  assert.ok(getActiveFormats(stateAt('*i*', 2)).includes('italic'))
})
test('block indicators', () => {
  assert.ok(getActiveFormats(stateAt('> q', 3)).includes('blockquote'))
  assert.ok(getActiveFormats(stateAt('- item', 4)).includes('bullet-list'))
  assert.ok(getActiveFormats(stateAt('1. item', 5)).includes('ordered-list'))
  assert.deepEqual(getActiveFormats(stateAt('', 0)), [])
})
test('multi-line selection requires every selected line to match', () => {
  assert.ok(!getActiveFormats(stateAt('- a\nb', [0, 5])).includes('bullet-list'))
  assert.ok(getActiveFormats(stateAt('- a\n- b', [0, 7])).includes('bullet-list'))
})
test('link active inside a link (so repeat triggers toggle-off)', () => {
  assert.ok(getActiveFormats(stateAt('[t](u)', 2)).includes('link'))
})
test('plain bullet line is not blockquote-active', () => {
  const active = getActiveFormats(stateAt('- item', 4))
  assert.ok(active.includes('bullet-list'))
  assert.ok(!active.includes('blockquote'))
})
test('quoted list line reports both quote and list', () => {
  const active = getActiveFormats(stateAt('> - item', 5))
  assert.ok(active.includes('blockquote'))
  assert.ok(active.includes('bullet-list'))
})

console.log(`\n${passed} tests passed`)
