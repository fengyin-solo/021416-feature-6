/**
 * Deterministic markdown format commands.
 *
 * Design goals:
 * - Deterministic result for collapsed selection, non-empty selection and
 *   multi-line selection.
 * - Applying the same format twice toggles it off instead of stacking markers
 *   (e.g. "**bold**" -> "bold" -> "**bold**", never "****bold****").
 * - Every command runs as a single transaction (one undo step) and never
 *   touches text outside the active selection / selected lines.
 * - Unknown command ids are rejected without dispatching anything.
 *
 * All state is derived from the CodeMirror state passed in, so switching
 * documents can never leak formatting into another document.
 */
import { keymap } from '@codemirror/view'
import { parseMarkdownRegions } from './markdown-parser.js'

/**
 * Inline formats toggled by wrapping / unwrapping marker pairs.
 * marker[0] is always used when wrapping new text.
 */
const INLINE_FORMATS = {
  bold: { type: 'bold', marker: '**' },
  italic: { type: 'italic', marker: '*' },
  strikethrough: { type: 'strikethrough', marker: '~~' },
  code: { type: 'inline-code', marker: '`' },
}

/**
 * Block formats toggled by a line prefix.
 */
const BLOCK_FORMATS = {
  blockquote: {
    match: /^(\s*)>\s?/,
    prefix: '> ',
  },
  'bullet-list': {
    match: /^(\s*)[-*+]\s/,
    prefix: '- ',
  },
  'ordered-list': {
    match: /^(\s*)\d+\.\s/,
    prefix: '1. ',
  },
}

const MARKER_FAMILY = (ch) => {
  if (ch === '*' || ch === '_') return '*_'
  if (ch === '~') return '~'
  if (ch === '`') return '`'
  return ''
}

/**
 * True when the character directly before `pos` ends a run of `len` marker
 * characters, and the character directly after `pos` starts another such run,
 * i.e. the (collapsed) cursor sits between an empty marker pair.
 *
 * The boundary checks make sure adjacent stronger markers cannot be mistaken
 * for the pair ("****" inside bold markers is not an empty italic pair).
 */
function adjacentEmptyPair(doc, pos, len) {
  if (pos < len || pos + len > doc.length) return false
  // CodeMirror Text.slice() returns a Text object, not a string — normalize.
  const read = (from, to) => doc.slice(from, to).toString()
  const marker = read(pos - len, pos)
  for (const ch of marker) {
    if (MARKER_FAMILY(ch) !== MARKER_FAMILY(marker[0])) return false
  }
  if (read(pos, pos + len) !== marker) return false

  const before = read(pos - len - 1, pos - len)
  const after = read(pos + len, pos + len + 1)
  // A same-family marker adjacent on the outside means this pair is only the
  // inside of a longer marker run: "****" forms one bold pair, but its inner
  // single "*" must not be treated as an empty italic pair.
  if (before && MARKER_FAMILY(before) === MARKER_FAMILY(marker[0])) return false
  if (after && MARKER_FAMILY(after) === MARKER_FAMILY(marker[0])) return false
  return true
}

/**
 * Map a document position through a sorted list of disjoint replacements,
 * using CodeMirror's change mapping convention:
 * - positions strictly inside a deletion map to its start (bias <= 0) or end
 * - boundary positions map backward for bias < 0, forward otherwise
 */
function mapPos(pos, ranges, bias = 0, maxPos = Infinity) {
  let p = pos
  for (const r of ranges) {
    if (p < r.from) break
    if (p <= r.to) {
      p = bias < 0 ? r.from : r.from + r.insert.length
    } else {
      p += r.insert.length - (r.to - r.from)
    }
  }
  return Math.max(0, Math.min(p, maxPos))
}

/**
 * Find a region of `type` that covers a collapsed cursor position.
 * Marker-only boundaries do not count (cursor must be in the region body).
 */
function regionCoveringPos(regions, type, pos) {
  return regions.find(
    (r) => r.type === type && pos > r.from && pos < r.to
  ) || null
}

/**
 * Find a region of `type` covering the full line segment (or enough of it to
 * treat the selection as "inside" the region).
 */
function regionCoveringSegment(regions, type, from, to) {
  return regions.find(
    (r) =>
      r.type === type &&
      r.from <= from &&
      (r.to >= to || r.contentTo >= to)
  ) || null
}

/**
 * Inspect the main selection and report which inline formats are active.
 * @returns {string[]} active format ids (subset of INLINE_FORMATS keys)
 */
export function getActiveInlineFormats(state) {
  const { doc, selection } = state
  const sel = selection.main
  const regions = parseMarkdownRegions(doc.toString())
  const active = []

  for (const [id, spec] of Object.entries(INLINE_FORMATS)) {
    let on = false
    if (sel.empty) {
      if (regionCoveringPos(regions, spec.type, sel.head)) {
        on = true
      } else if (adjacentEmptyPair(doc, sel.head, spec.marker.length)) {
        on = true
      }
    } else {
      const startLine = doc.lineAt(sel.from)
      const endLine = doc.lineAt(sel.to)
      on = true
      for (let n = startLine.number; n <= endLine.number && on; n++) {
        const line = doc.line(n)
        const from = Math.max(sel.from, line.from)
        const to = Math.min(sel.to, line.to)
        if (from >= to) continue // skip empty line fragments
        if (!regionCoveringSegment(regions, spec.type, from, to)) on = false
      }
    }
    if (on) active.push(id)
  }
  return active
}

/**
 * Inspect the main selection and report which block formats are active.
 * @returns {string[]} active format ids (subset of BLOCK_FORMATS keys)
 */
export function getActiveBlockFormats(state) {
  const { doc, selection } = state
  const sel = selection.main
  const startLine = doc.lineAt(sel.from)
  const endLine = doc.lineAt(sel.to)
  const active = []

  const kinds = {
    blockquote: (m) => m.quote,
    'bullet-list': (m) => m.list?.kind === 'bullet',
    'ordered-list': (m) => m.list?.kind === 'ordered',
  }

  for (const id of Object.keys(kinds)) {
    let on = true
    let sawContentLine = false
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = doc.line(n)
      const withinFrom = Math.max(sel.from, line.from)
      const withinTo = Math.min(sel.to, line.to)
      if (withinFrom >= withinTo && line.text.trim() === '') continue
      if (!kinds[id](parseLineMarkers(line.text))) {
        on = false
        break
      }
      sawContentLine = true
    }
    if (on && sawContentLine) active.push(id)
  }
  return active
}

/**
 * All formats active at the current selection (inline + block + link/image).
 * @returns {string[]}
 */
export function getActiveFormats(state) {
  const { doc, selection } = state
  const active = new Set([
    ...getActiveInlineFormats(state),
    ...getActiveBlockFormats(state),
  ])

  // Links and images are insert commands but read as active when inside one,
  // so repeating the command removes the existing wrapper instead of nesting.
  const sel = selection.main
  if (sel.empty) {
    const regions = parseMarkdownRegions(doc.toString())
    if (regionCoveringPos(regions, 'link', sel.head)) active.add('link')
    if (regionCoveringPos(regions, 'image', sel.head)) active.add('image')
  }
  return [...active]
}

/**
 * Toggle an inline marker-pair format (bold / italic / strikethrough / code).
 * Returns the transaction spec, or null if nothing can be done.
 */
function toggleInline(state, id) {
  const spec = INLINE_FORMATS[id]
  if (!spec) return null
  const { doc, selection } = state
  const sel = selection.main
  const marker = spec.marker
  const regions = parseMarkdownRegions(doc.toString())
  const changes = []

  if (sel.empty) {
    // 1. Cursor inside an existing region -> remove its markers.
    const region = regionCoveringPos(regions, spec.type, sel.head)
    if (region) {
      const ml = region.to - region.contentTo
      changes.push({ from: region.from, to: region.from + ml, insert: '' })
      changes.push({ from: region.to - ml, to: region.to, insert: '' })
      const head = mapPos(sel.head, changes)
      return { changes, selection: { anchor: head } }
    }
    // 2. Cursor between an empty marker pair -> remove the pair.
    if (adjacentEmptyPair(doc, sel.head, marker.length)) {
      changes.push({ from: sel.head - marker.length, to: sel.head, insert: '' })
      changes.push({ from: sel.head, to: sel.head + marker.length, insert: '' })
      const head = mapPos(sel.head, changes)
      return { changes, selection: { anchor: head } }
    }
    // 3. Otherwise insert an empty pair and place the cursor inside it.
    return {
      changes: { from: sel.head, to: sel.head, insert: marker + marker },
      selection: { anchor: sel.head + marker.length },
    }
  }

  const startLine = doc.lineAt(sel.from)
  const endLine = doc.lineAt(sel.to)

  // Per non-empty line fragment, find the covering region (if any).
  const fragments = []
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = doc.line(n)
    const from = Math.max(sel.from, line.from)
    const to = Math.min(sel.to, line.to)
    if (from >= to) continue // blank / zero-width fragment: leave untouched
    fragments.push({ from, to, region: regionCoveringSegment(regions, spec.type, from, to) })
  }
  if (fragments.length === 0) return null

  const allOn = fragments.every((f) => f.region)

  if (allOn) {
    // Remove one covering region per non-empty line fragment.
    const seen = new Set()
    const removedRegions = []
    for (const f of fragments) {
      const region = f.region
      if (seen.has(region)) continue
      seen.add(region)
      removedRegions.push(region)
      const ml = region.to - region.contentTo
      changes.push({ from: region.from, to: region.from + ml, insert: '' })
      changes.push({ from: region.to - ml, to: region.to, insert: '' })
    }
    changes.sort((a, b) => a.from - b.from)
    const delta = changes.reduce(
      (d, c) => d + c.insert.length - (c.to - c.from),
      0
    )
    const newLen = doc.length + delta
    // Select the remaining content of the first/last removed regions so the
    // selection never spans deleted markers or trailing unrelated characters.
    const firstRegion = removedRegions[0]
    const lastRegion = removedRegions[removedRegions.length - 1]
    return {
      changes,
      selection: {
        anchor: mapPos(firstRegion.contentFrom, changes, -1, newLen),
        head: mapPos(lastRegion.contentTo, changes, 1, newLen),
      },
    }
  }

  // Partially / not formatted: wrap only the unformatted parts. Whitespace
  // gaps next to already formatted text are trimmed so we never emit broken
  // markers like "****a** b**".
  const segments = []
  for (const f of fragments) {
    if (f.region) continue
    // Covered sub-ranges from same-type regions overlapping this fragment.
    const covered = []
    for (const r of regions) {
      if (r.type !== spec.type) continue
      const cf = Math.max(f.from, r.from)
      const ct = Math.min(f.to, r.to)
      if (cf < ct) covered.push([cf, ct])
    }
    covered.sort((a, b) => a[0] - b[0])
    let cursor = f.from
    for (const [cf, ct] of covered) {
      pushWrapSegment(doc, segments, cursor, cf, marker)
      cursor = Math.max(cursor, ct)
    }
    pushWrapSegment(doc, segments, cursor, f.to, marker)
  }

  if (segments.length === 0) return null

  for (const s of segments) {
    changes.push({ from: s.from, to: s.from, insert: marker })
    changes.push({ from: s.to, to: s.to, insert: marker })
  }
  changes.sort((a, b) => a.from - b.from)

  const first = segments[0]
  const last = segments[segments.length - 1]
  return {
    changes,
    selection: {
      anchor: first.from,
      head: last.to + marker.length * 2,
    },
  }
}

/**
 * Add [from, to) as a wrap segment, trimming leading/trailing whitespace so
 * markers never land on spaces. Empty/whitespace-only ranges are skipped.
 */
function pushWrapSegment(doc, segments, from, to, marker) {
  if (from >= to) return
  let f = from
  let t = to
  while (f < t && /\s/.test(doc.slice(f, f + 1))) f++
  while (t > f && /\s/.test(doc.slice(t - 1, t))) t--
  if (f >= t) return
  // Don't wrap text already bordered by the same marker run.
  if (f - marker.length >= 0 && doc.slice(f - marker.length, f) === marker) return
  if (t + marker.length <= doc.length && doc.slice(t, t + marker.length) === marker) return
  segments.push({ from: f, to: t })
}

/**
 * Parse the leading block markers of a single line. Positions are relative
 * to the start of the line.
 * @returns {{indentEnd:number, quote:?{start:number,end:number}, list:?{kind:string,start:number,end:number}}}
 */
function parseLineMarkers(text) {
  const indentLen = /^\s*/.exec(text)[0].length
  const out = { indentEnd: indentLen, quote: null, list: null }
  let p = indentLen

  const qm = /^>\s?/.exec(text.slice(p))
  if (qm) {
    out.quote = { start: p, end: p + qm[0].length }
    p += qm[0].length
  }

  const rest = text.slice(p)
  const om = /^(\d+)\.\s/.exec(rest)
  if (om) {
    out.list = { kind: 'ordered', start: p, end: p + om[0].length }
  } else {
    const bm = /^[-*+]\s/.exec(rest)
    if (bm) out.list = { kind: 'bullet', start: p, end: p + bm[0].length }
  }
  return out
}

/**
 * Toggle a line-prefix block format (blockquote / bullet-list / ordered-list).
 *
 * Rules:
 * - If every selected non-blank line already has the target marker, remove it.
 * - Otherwise add / convert markers: bullet and ordered convert each other
 *   (never stack into "- 1. x"), existing same-kind markers are left alone
 *   (ordered lists get renumbered sequentially).
 * - A collapsed cursor on a blank line turns that line into the block type.
 */
function toggleBlock(state, id) {
  const spec = BLOCK_FORMATS[id]
  if (!spec) return null
  const { doc, selection } = state
  const sel = selection.main
  const startLine = doc.lineAt(sel.from)
  const endLine = doc.lineAt(sel.to)
  const changes = []

  const lineInfos = []
  let allOn = true
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = doc.line(n)
    const withinFrom = Math.max(sel.from, line.from)
    const withinTo = Math.min(sel.to, line.to)
    const isAnchorLine = sel.empty && n === startLine.number
    // A collapsed cursor targets its own line (even a blank one); a ranged
    // selection only covers lines that actually contain selected characters.
    const selected = withinFrom < withinTo || isAnchorLine
    if (!selected) {
      lineInfos.push({ line, selected: false, blank: true })
      continue
    }
    const blank = line.text.trim() === ''
    const markers = blank ? null : parseLineMarkers(line.text)
    const on =
      (id === 'blockquote' && markers?.quote) ||
      (id === 'bullet-list' && markers?.list?.kind === 'bullet') ||
      (id === 'ordered-list' && markers?.list?.kind === 'ordered')
    if (!on) allOn = false
    lineInfos.push({ line, selected: true, blank, markers, isAnchorLine })
  }

  let number = 0
  for (const info of lineInfos) {
    if (!info.selected) continue
    const base = info.line.from

    if (allOn) {
      // Remove only the target marker; keep indentation and other markers.
      const range =
        id === 'blockquote' ? info.markers?.quote : info.markers?.list
      if (!range) continue
      changes.push({ from: base + range.start, to: base + range.end, insert: '' })
      continue
    }

    if (info.blank) {
      // Only the anchor line of a collapsed selection is promoted on a blank.
      if (info.isAnchorLine) {
        changes.push({ from: base, to: base, insert: spec.prefix })
      }
      continue
    }

    const { markers } = info
    if (id === 'blockquote') {
      if (markers.quote) continue // already quoted — never stack "> >"
      changes.push({
        from: base + markers.indentEnd,
        to: base + markers.indentEnd,
        insert: spec.prefix,
      })
    } else {
      const targetKind = id === 'bullet-list' ? 'bullet' : 'ordered'
      number++
      const insert = targetKind === 'bullet' ? '- ' : `${number}. `
      const list = markers.list
      if (list) {
        if (list.kind === targetKind && targetKind === 'bullet') continue
        // Convert bullet <-> ordered, or renumber an ordered list: one marker
        // replaced in place, so prefixes can never stack.
        changes.push({ from: base + list.start, to: base + list.end, insert })
      } else {
        changes.push({
          from: base + markers.indentEnd,
          to: base + markers.indentEnd,
          insert,
        })
      }
    }
  }

  if (changes.length === 0) return null

  changes.sort((a, b) => a.from - b.from)
  const delta = changes.reduce(
    (d, c) => d + c.insert.length - (c.to - c.from),
    0
  )
  const newLen = doc.length + delta
  return {
    changes,
    selection: {
      anchor: mapPos(sel.anchor, changes, -1, newLen),
      head: mapPos(sel.head, changes, 1, newLen),
    },
  }
}

/**
 * Insert a horizontal rule after the current line, deterministic regardless
 * of whether the line is blank or has content.
 */
function insertHr(state) {
  const { doc, selection } = state
  const head = selection.main.head
  const line = doc.lineAt(head)

  if (line.text.trim() === '') {
    // Merge with surrounding blank lines so we never stack "------".
    const prev = line.number > 1 ? doc.line(line.number - 1) : null
    const next = line.number < doc.lines ? doc.line(line.number + 1) : null
    let from = line.from
    let to = line.to
    if (prev && prev.text.trim() === '') from = prev.from
    if (next && next.text.trim() === '') to = next.to
    return {
      changes: { from, to, insert: '---' },
      selection: { anchor: from + 3 },
    }
  }

  return {
    changes: { from: line.to, to: line.to, insert: '\n\n---\n\n' },
    selection: { anchor: line.to + 7 },
  }
}

/**
 * Wrap the selection with an image / insert an image template. If the cursor
 * already sits inside an image, remove it (toggle instead of nesting).
 */
function toggleImage(state) {
  const { doc, selection } = state
  const sel = selection.main

  if (sel.empty) {
    const region = regionCoveringPos(parseMarkdownRegions(doc.toString()), 'image', sel.head)
    if (region) {
      // Unwrap: keep the alt text rather than deleting the whole image.
      const alt = state.sliceDoc(region.contentFrom, region.contentTo)
      return {
        changes: { from: region.from, to: region.to, insert: alt },
        selection: { anchor: region.from + alt.length },
      }
    }
  }

  const { from, to } = sel
  const text = sel.empty ? 'alt' : state.sliceDoc(from, to)
  const insert = `![${text}](url)`
  return {
    changes: { from, to, insert },
    selection: { anchor: from + 2, head: from + 2 + text.length },
  }
}

/**
 * Wrap the selection with a link / insert a link template. If the cursor
 * already sits inside a link, remove it (toggle instead of nesting).
 */
function toggleLink(state) {
  const { doc, selection } = state
  const sel = selection.main

  if (sel.empty) {
    const region = regionCoveringPos(parseMarkdownRegions(doc.toString()), 'link', sel.head)
    if (region) {
      // Unwrap: keep the visible link text rather than deleting it.
      const text = state.sliceDoc(region.contentFrom, region.contentTo)
      return {
        changes: { from: region.from, to: region.to, insert: text },
        selection: { anchor: region.from + text.length },
      }
    }
  }

  const { from, to } = sel
  const text = sel.empty ? 'text' : state.sliceDoc(from, to)
  const insert = `[${text}](url)`
  return {
    changes: { from, to, insert },
    // Select the url placeholder so the user can type over it.
    selection: { anchor: from + text.length + 3, head: from + insert.length - 1 },
  }
}

/**
 * Build the transaction spec for a known format command.
 * Returns null for unknown ids or when no change is applicable.
 */
export function buildFormatSpec(state, command) {
  if (INLINE_FORMATS[command]) return toggleInline(state, command)
  if (BLOCK_FORMATS[command]) return toggleBlock(state, command)
  switch (command) {
    case 'hr':
      return insertHr(state)
    case 'link':
      return toggleLink(state)
    case 'image':
      return toggleImage(state)
    default:
      return null
  }
}

/**
 * Execute a format command against an EditorView.
 * @returns {boolean} true when a change was dispatched, false otherwise
 * (unknown commands and no-ops leave the document untouched).
 */
export function runFormatCommand(view, command) {
  if (!view || typeof command !== 'string') return false
  const spec = buildFormatSpec(view.state, command)
  if (!spec) return false
  view.dispatch(spec)
  return true
}

/**
 * Keyboard bindings. Mixed with toolbar buttons they go through the exact same
 * command path, so results can never diverge.
 */
export const formatKeymap = [
  { key: 'Mod-b', preventDefault: true, run: (v) => runFormatCommand(v, 'bold') },
  { key: 'Mod-i', preventDefault: true, run: (v) => runFormatCommand(v, 'italic') },
  { key: 'Mod-Shift-x', preventDefault: true, run: (v) => runFormatCommand(v, 'strikethrough') },
  { key: 'Mod-e', preventDefault: true, run: (v) => runFormatCommand(v, 'code') },
  { key: 'Mod-k', preventDefault: true, run: (v) => runFormatCommand(v, 'link') },
]

export const formatKeymapExtension = keymap.of(formatKeymap)
