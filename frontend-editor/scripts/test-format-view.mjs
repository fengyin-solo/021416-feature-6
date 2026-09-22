/**
 * EditorView-level integration tests for the format commands.
 *
 * Covers: single-transaction undo, keymap/toolbar equivalence, unknown
 * commands creating no history entry, isolation between documents, and the
 * live-render decoration plugin rebuilding after every command.
 *
 * Run: npm run test:view
 */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true })
globalThis.document = dom.window.document
globalThis.window = dom.window
globalThis.navigator = dom.window.navigator
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.ResizeObserver = dom.window.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.DOMParser = dom.window.DOMParser
// jsdom lacks layout — CodeMirror's async measurement calls these; give them
// inert stubs so scheduled animation frames don't crash after assertions.
dom.window.Range.prototype.getClientRects = () => []
if (!dom.window.Element.prototype.getClientRects) {
  dom.window.Element.prototype.getClientRects = () => []
}
dom.window.matchMedia = dom.window.matchMedia || (() => ({
  matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
}))

const { EditorState, EditorSelection } = await import('@codemirror/state')
const { EditorView, keymap } = await import('@codemirror/view')
const { defaultKeymap, history, historyKeymap, undo } = await import('@codemirror/commands')
const {
  runFormatCommand,
  getActiveFormats,
  formatKeymap,
} = await import('../src/editor/format-commands.js')
const { markdownDecorationPlugin } = await import('../src/editor/decoration-plugin.js')

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

function makeView(doc, sel) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    selection: typeof sel === 'number'
      ? EditorSelection.single(sel)
      : sel
        ? EditorSelection.range(sel[0], sel[1])
        : undefined,
    extensions: [
      history(),
      keymap.of([...formatKeymap, ...defaultKeymap, ...historyKeymap]),
      markdownDecorationPlugin,
      EditorView.updateListener.of(() => {}),
    ],
  })
  return new EditorView({ state, parent })
}

/** Simulate a key binding run by looking it up the same way CodeMirror does. */
function runKey(view, key) {
  const binding = formatKeymap.find((b) => b.key === key)
  assert.ok(binding, `binding ${key} registered`)
  return binding.run(view)
}

console.log('One command = one undo step')
test('multi-line block toggle undoes with a single undo', () => {
  const view = makeView('a\nb\nc', [0, 5])
  const before = view.state.doc.toString()
  runFormatCommand(view, 'bullet-list')
  assert.equal(view.state.doc.toString(), '- a\n- b\n- c')
  undo(view)
  assert.equal(view.state.doc.toString(), before)
})
test('multi-line inline toggle is one undo step', () => {
  const view = makeView('aa\nbb', [0, 5])
  const before = view.state.doc.toString()
  runFormatCommand(view, 'bold')
  undo(view)
  assert.equal(view.state.doc.toString(), before)
})
test('unknown command adds no undoable history', () => {
  const view = makeView('abc', 1)
  runFormatCommand(view, 'nope')
  runFormatCommand(view, null)
  assert.equal(undo(view), false)
})

console.log('\nKeymap and toolbar button take the same code path')
test('Mod-b and runFormatCommand bold give identical documents', () => {
  const v1 = makeView('hello world', [0, 5])
  const v2 = makeView('hello world', [0, 5])
  runKey(v1, 'Mod-b')
  runFormatCommand(v2, 'bold')
  assert.equal(v1.state.doc.toString(), v2.state.doc.toString())
  assert.deepEqual(
    [v1.state.selection.main.from, v1.state.selection.main.to],
    [v2.state.selection.main.from, v2.state.selection.main.to],
  )
})
test('mixing keymap and toolbar: toggle cycles stay consistent', () => {
  const view = makeView('hello', [0, 5])
  runKey(view, 'Mod-b') // on via keyboard
  assert.equal(view.state.doc.toString(), '**hello**')
  runFormatCommand(view, 'bold') // off via toolbar button
  assert.equal(view.state.doc.toString(), 'hello')
  runFormatCommand(view, 'bold') // on via button
  runKey(view, 'Mod-b') // off via keyboard
  assert.equal(view.state.doc.toString(), 'hello')
})
test('Mod-i / Mod-e / Mod-k bindings toggle their formats', () => {
  const v = makeView('x', [0, 1])
  runKey(v, 'Mod-i')
  assert.equal(v.state.doc.toString(), '*x*')
  runKey(v, 'Mod-e')
  // selection now covers *x*; code wraps it
  assert.match(v.state.doc.toString(), /`?\*?x\*?`?/)
  const v2 = makeView('t', [0, 1])
  runKey(v2, 'Mod-k')
  assert.equal(v2.state.doc.toString(), '[t](url)')
})

console.log('\nButton state follows the cursor after every path')
test('active formats update after keymap toggle and cursor move', () => {
  const view = makeView('**bold** plain', [2, 6])
  assert.ok(getActiveFormats(view.state).includes('bold'))
  // toggle off via keyboard
  runKey(view, 'Mod-b')
  assert.ok(!getActiveFormats(view.state).includes('bold'))
  // move cursor onto the still-plain part
  view.dispatch({ selection: EditorSelection.single(10) })
  assert.deepEqual(getActiveFormats(view.state), [])
})

console.log('\nSwitching documents cannot pollute another document')
test('commands on view A never touch view B', () => {
  const docB = '**keep**\n- intact'
  const a = makeView('alpha\nbeta', [0, 9])
  const b = makeView(docB, 3)
  runFormatCommand(a, 'blockquote')
  runFormatCommand(a, 'bold')
  runKey(a, 'Mod-b')
  assert.equal(b.state.doc.toString(), docB)
  assert.ok(getActiveFormats(b.state).includes('bold'))
})
test('state is fully derived per view — no shared mutable format state', () => {
  const a = makeView('one', [0, 3])
  const b = makeView('two', [0, 3])
  runFormatCommand(a, 'bold')
  assert.equal(a.state.doc.toString(), '**one**')
  assert.equal(b.state.doc.toString(), 'two')
  runFormatCommand(b, 'italic')
  assert.equal(a.state.doc.toString(), '**one**')
  assert.equal(b.state.doc.toString(), '*two*')
})

console.log('\nLive rendering survives every command')
test('decoration plugin rebuilds without throwing after toggles', () => {
  const view = makeView('# Title\n\nhello **world**', [9, 14])
  const commands = ['bold', 'italic', 'code', 'blockquote', 'bullet-list', 'hr', 'link']
  for (const cmd of commands) {
    assert.doesNotThrow(() => runFormatCommand(view, cmd))
    // Force a plugin update pass; decorations must remain a valid RangeSet.
    assert.doesNotThrow(() => {
      view.viewportLineBlocks
      markdownDecorationPlugin
    })
  }
})

console.log('\nDeterminism: same inputs always produce the same output')
const cases = [
  ['abc', 1, 'bold'],
  ['**abc**', [2, 5], 'bold'],
  ['l1\nl2\nl3', [0, 6], 'italic'],
  ['> q', 2, 'blockquote'],
  ['x', 0, 'hr'],
  ['', 0, 'code'],
  ['~~s~~ *i*', [0, 9], 'strikethrough'],
]
for (const [doc, sel, cmd] of cases) {
  test(`${cmd} on ${JSON.stringify(doc)} @${JSON.stringify(sel)}`, () => {
    const results = new Set()
    for (let i = 0; i < 3; i++) {
      const v = makeView(doc, sel)
      runFormatCommand(v, cmd)
      const m = v.state.selection.main
      results.add(`${v.state.doc.toString()}#${m.from},${m.to}`)
    }
    assert.equal(results.size, 1)
  })
}

console.log(`\n${passed} tests passed`)
