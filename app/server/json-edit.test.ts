// node server/json-edit.test.ts — checks that edits change only what they touch.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { patchText, parseDirection, applyOp, checkOps, formatJSON, JsonEditRefused, type JsonOp, type Removed } from './json-style.ts'

let failures = 0
const test = (name: string, fn: () => void) => {
  try { fn(); console.log(`ok   ${name}`) } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').join('\n     ')}`) }
}
const changedLines = (a: string, b: string) => {
  const x = a.split(/\r?\n/), y = b.split(/\r?\n/)
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  let ex = x.length - 1, ey = y.length - 1
  while (ex >= i && ey >= i && x[ex] === y[ey]) { ex--; ey-- }
  return { removed: x.slice(i, ex + 1), added: y.slice(i, ey + 1) }
}
const expectSame = (text: string, ops: JsonOp[]) => {
  const { text: out, doc, spliced } = patchText(text, ops)
  const want = parseDirection(text)
  for (const op of ops) applyOp(want, op)
  assert.deepEqual(parseDirection(out), want, 'content differs from the object-level edit')
  assert.deepEqual(doc, want, 'returned document differs')
  return { out, spliced }
}

const sample = fs.readFileSync(new URL('../../samples/brindlewick/staging.json', import.meta.url), 'utf8')

test('sample: change one look field touches one line', () => {
  const { out, spliced } = expectSame(sample, [{ op: 'set', path: ['characters', 'shape:biscuit', 'outfit', 'shoes'], value: '#123456' }])
  assert.ok(spliced)
  const d = changedLines(sample, out)
  assert.equal(d.removed.length, 1); assert.equal(d.added.length, 1)
  assert.match(d.added[0], /"shoes": "#123456"/)
})
test('sample: add a place preset to an existing place', () => {
  const { out } = expectSame(sample, [{ op: 'set', path: ['places', 'shape:hill', 'preset'], value: 'meadow' }])
  const d = changedLines(sample, out)
  assert.ok(d.added.length <= 3, JSON.stringify(d))
})
test('sample: set then delete restores the file byte for byte', () => {
  const a = patchText(sample, [{ op: 'set', path: ['places', 'shape:hill', 'preset'], value: 'meadow' }]).text
  const b = patchText(a, [{ op: 'delete', path: ['places', 'shape:hill', 'preset'] }]).text
  assert.equal(b, sample)
})
test('sample: a new character look is one new line', () => {
  const { out } = expectSame(sample, [{ op: 'set', path: ['characters', 'shape:new'], value: { species: 'cat', outfit: { top: '#ff0000' } } }])
  const d = changedLines(sample, out)
  assert.deepEqual(d.removed.length, 1) // the previous last line gains a comma
  assert.equal(d.added.length, 2)
})
test('sample: delete the first, a middle and the last member', () => {
  for (const key of ['shape:mira', 'shape:hattie', 'shape:pell']) {
    const { out } = expectSame(sample, [{ op: 'delete', path: ['characters', key] }])
    const d = changedLines(sample, out)
    assert.ok(d.removed.length <= 2 && d.added.length <= 1, `${key}: ${JSON.stringify(d)}`)
  }
})
test('sample: nested new path creates the objects', () => {
  expectSame(sample, [{ op: 'set', path: ['scenes', 'shape:p9', 'camera'], value: [{ shot: 'wide' }] }])
})

const handLook = `{
  "version": 1,
  "characters": {
    "Mira": {
      "species": "human",
      "skin": "#f6d3b2",
      "outfit": { "top": "#d9473c" }
    },
    "shape:biscuit": { "species": "dog", "outfit": { "shoes": "#000000" } }
  }
}
`
test('hand-written multi-line look stays as written when another look changes', () => {
  const { out } = expectSame(handLook, [{ op: 'set', path: ['characters', 'shape:biscuit', 'outfit', 'shoes'], value: '#ffffff' }])
  const d = changedLines(handLook, out)
  assert.equal(d.removed.length, 1); assert.equal(d.added.length, 1)
})

const four = JSON.stringify(JSON.parse(sample), null, 4) + '\n'
test('4-space file keeps its indentation', () => {
  const { out } = expectSame(four, [{ op: 'set', path: ['places', 'shape:hill', 'preset'], value: 'lake' }])
  const d = changedLines(four, out)
  assert.ok(d.added.every((l) => !/^ {2}"|^ {6}"/.test(l)), JSON.stringify(d))
  assert.ok(d.removed.length <= 1 && d.added.length <= 2, JSON.stringify(d))
})
test('tab-indented file keeps tabs', () => {
  const tabs = JSON.stringify(JSON.parse(sample), null, '\t') + '\n'
  const { out } = expectSame(tabs, [{ op: 'set', path: ['characters', 'shape:mira', 'body'], value: 'kid' }])
  const d = changedLines(tabs, out)
  assert.ok(d.added.every((l) => /^\t/.test(l)), JSON.stringify(d))
})
test('CRLF file keeps CRLF everywhere', () => {
  const crlf = sample.replace(/\n/g, '\r\n')
  const { out } = expectSame(crlf, [{ op: 'set', path: ['characters', 'shape:new'], value: { species: 'frog' } }])
  assert.ok(!/[^\r]\n/.test(out), 'a bare LF appeared')
  assert.ok(changedLines(crlf, out).added.length <= 2)
})
test('BOM is kept and parsed', () => {
  const bom = '\uFEFF' + sample
  const { out } = expectSame(bom, [{ op: 'set', path: ['defaults', 'weather'], value: 'fog' }])
  assert.ok(out.startsWith('\uFEFF'))
})
test('untouched numbers and strings keep their spelling', () => {
  const odd = '{\n  "a": 1.50,\n  "b": 1E3,\n  "c": -0,\n  "d": 1e21,\n  "e": "a\\/b \\u00e9",\n  "f": { "g": 1 }\n}\n'
  const { out } = expectSame(odd, [{ op: 'set', path: ['f', 'g'], value: 2 }])
  for (const s of ['1.50', '1E3', '-0', '1e21', '"a\\/b \\u00e9"']) assert.ok(out.includes(s), `lost ${s}`)
})
test('a set through an empty list turns it into an object', () => {
  const t = '{\n  "characters": [],\n  "x": 1\n}\n'
  expectSame(t, [{ op: 'set', path: ['characters', 'shape:a', 'species'], value: 'cat' }])
})
test('a set through a non-empty list is refused', () => {
  const t = '{\n  "characters": [1, 2]\n}\n'
  assert.throws(() => patchText(t, [{ op: 'set', path: ['characters', 'a'], value: 1 }]), JsonEditRefused)
})
test('duplicate keys: the last one (the one JSON.parse uses) is edited', () => {
  const t = '{\n  "a": 1,\n  "a": 2\n}\n'
  const { out } = expectSame(t, [{ op: 'set', path: ['a'], value: 3 }])
  assert.ok(out.includes('"a": 1'))
})
test('a file that is not an object is refused', () => {
  assert.throws(() => patchText('null\n', [{ op: 'set', path: ['a'], value: 1 }]), JsonEditRefused)
  assert.throws(() => patchText('[1]\n', [{ op: 'set', path: ['a'], value: 1 }]), JsonEditRefused)
})
test('one-line objects stay on one line', () => {
  const t = '{\n  "map": { "scale": 0.05 }\n}\n'
  const { out } = expectSame(t, [{ op: 'set', path: ['map', 'origin'], value: [1, 2] }])
  assert.ok(out.includes('"map": { "scale": 0.05, "origin": [1, 2] }'), out)
})
test('deleting the only member leaves {}', () => {
  const t = '{\n  "a": {\n    "b": 1\n  },\n  "c": 2\n}\n'
  const { out } = expectSame(t, [{ op: 'delete', path: ['a', 'b'] }])
  assert.ok(out.includes('"a": {}'))
})
test('deleting something absent changes nothing', () => {
  const { out } = expectSame(sample, [{ op: 'delete', path: ['characters', 'nobody', 'outfit'] }])
  assert.equal(out, sample)
})

// Renames and Undo. The app's Undo of an edit is the edit that takes it back (see undoOf in
// app/src/lib/staging.ts), carrying what the server said the edit took out of the file.
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const inverseOf = (doc: Record<string, any>, op: JsonOp): JsonOp | null => {
  let node = doc
  for (let i = 0; i < op.path.length; i++) {
    const key = op.path[i], path = op.path.slice(0, i + 1), has = Object.hasOwn(node, key)
    if (i === op.path.length - 1) {
      if (op.op === 'rename') return has && op.to !== key && !Object.hasOwn(node, op.to) ? { op: 'rename', path: [...op.path.slice(0, -1), op.to], to: key } : null
      return has ? { op: 'set', path, value: node[key] } : op.op === 'set' ? { op: 'delete', path } : null
    }
    if (!isObj(node[key])) {
      if (op.op !== 'set' || (Array.isArray(node[key]) && node[key].length)) return null
      return has ? { op: 'set', path, value: node[key] } : { op: 'delete', path }
    }
    node = node[key]
  }
  return null
}
/** An edit, its Undo (with what the edit took out) and its Redo: the three texts. */
const roundTrip = (text: string, op: JsonOp) => {
  const done = patchText(text, [op])
  const inv = inverseOf(parseDirection(text), op)
  const undone = inv ? patchText(done.text, [{ ...inv, restore: done.removed[0] ?? undefined }]) : { text: done.text, spliced: true }
  const redone = patchText(undone.text, [op])
  return { done: done.text, undone: undone.text, redone: redone.text, spliced: done.spliced && undone.spliced && redone.spliced }
}
const expectRoundTrip = (text: string, op: JsonOp) => {
  const r = roundTrip(text, op)
  assert.ok(r.spliced, 'fell back to a full rewrite')
  assert.equal(r.undone, text, 'Undo did not give the file back byte for byte')
  assert.equal(r.redone, r.done, 'Redo did not give the edited file back byte for byte')
  return r
}
const byTitle = sample.replace('"shape:p1": {', '"Morning in the square": {')
/** The keys of one section of a file, in the order JSON.parse gives them. */
const keysOf = (text: string, section: string) => Object.keys(parseDirection(text)[section] as object)

test('rename: one key token changes, in place', () => {
  const { out, spliced } = expectSame(byTitle, [{ op: 'rename', path: ['scenes', 'Morning in the square'], to: 'shape:p1' }])
  assert.ok(spliced)
  const d = changedLines(byTitle, out)
  assert.deepEqual(d, { removed: ['    "Morning in the square": {'], added: ['    "shape:p1": {'] })
  assert.deepEqual(keysOf(out, 'scenes'), keysOf(sample, 'scenes'))
})
test('rename and its Undo give the file back byte for byte (pages, characters, pins)', () => {
  expectRoundTrip(byTitle, { op: 'rename', path: ['scenes', 'Morning in the square'], to: 'shape:p1' })
  expectRoundTrip(sample.replace('"shape:mira": {', '"Mira": {'), { op: 'rename', path: ['characters', 'Mira'], to: 'shape:mira' })
  expectRoundTrip(sample.replace('"shape:hill": {', '"Lantern Hill": {'), { op: 'rename', path: ['places', 'Lantern Hill'], to: 'shape:hill' })
})
test('rename onto a key that is there already is refused', () => {
  assert.throws(() => patchText(sample, [{ op: 'rename', path: ['characters', 'shape:mira'], to: 'shape:pell' }]), JsonEditRefused)
})
test('rename of something absent changes nothing', () => {
  assert.equal(patchText(sample, [{ op: 'rename', path: ['characters', 'nobody'], to: 'shape:x' }]).text, sample)
  assert.equal(patchText(sample, [{ op: 'rename', path: ['nothing', 'here'], to: 'shape:x' }]).text, sample)
})
test('Undo of a rename puts back the key as it was spelled', () => {
  expectRoundTrip('{\n  "s": { "Caf\\u00e9": 1, "b": 2 }\n}\n', { op: 'rename', path: ['s', 'Café'], to: 'shape:c' })
})
test('a numbered key moves to the end when renamed, without rewriting the file', () => {
  const t = '{\n  "s": {\n    "1984": { "a": 1 },\n    "b": 2\n  }\n}\n'
  const { spliced } = expectSame(t, [{ op: 'rename', path: ['s', '1984'], to: 'shape:p1' }])
  assert.ok(spliced)
})

const handMira = sample.replace(/ {4}"shape:mira": \{.*\},\n/, (line) => {
  const v = JSON.parse(line.trim().replace(/^"shape:mira": /, '').replace(/,$/, ''))
  return `    "shape:mira": {\n      "species": "human", "skin": "${v.skin}",\n      "hair": ${JSON.stringify(v.hair)},\n      "outfit": ${JSON.stringify(v.outfit)},\n      "face": ${JSON.stringify(v.face)}\n    },\n`
})
test('Undo of a delete puts the member back where it was, as it was written', () => {
  assert.notEqual(handMira, sample)
  for (const [text, path] of [
    [handMira, ['characters', 'shape:mira']], // first, written over several lines
    [sample, ['characters', 'shape:hattie']], // in the middle
    [sample, ['characters', 'shape:pell']], // last
    [sample, ['places', 'shape:square']], // first, with a blank line after it
    [sample, ['places', 'shape:pier']], // in the middle, blank lines around it
    [sample, ['scenes', 'shape:p8']], // last of a section
    [sample, ['characters', 'shape:mira', 'hair']], // inside a one-line look
    [sample, ['characters', 'shape:mira', 'species']], // the first of a one-line look
    [sample, ['map']], // a top-level member
    ['{\n  "a": {\n    "b": { "c": 1 }\n  },\n  "x": 2\n}\n', ['a', 'b']], // the only member
    ['{ "a": 1,\n  "k": 2 }\n', ['k']], // the object reads as one line once it is gone
  ] as [string, string[]][]) expectRoundTrip(text, { op: 'delete', path })
})
test('Undo of several deletes in one edit, side by side, puts them all back', () => {
  const ops: JsonOp[] = [{ op: 'delete', path: ['characters', 'shape:biscuit'] }, { op: 'delete', path: ['characters', 'shape:juniper'] }, { op: 'set', path: ['characters', 'shape:mira', 'species'], value: 'cat' }]
  const done = patchText(handMira, ops)
  const back = ops.map((op, i) => ({ ...inverseOf(parseDirection(handMira), op)!, restore: done.removed[i] ?? undefined })).reverse()
  const undone = patchText(done.text, back)
  assert.ok(undone.spliced)
  assert.equal(undone.text, handMira)
})
test('Undo of a delete: written anew in the same place when the text no longer reads the same', () => {
  const done = patchText(sample, [{ op: 'delete', path: ['characters', 'shape:hattie'] }])
  const value = { species: 'horse', body: 'tall' } // not what was taken out
  const { out, spliced } = expectSame(done.text, [{ op: 'set', path: ['characters', 'shape:hattie'], value, restore: done.removed[0]! }])
  assert.ok(spliced)
  assert.deepEqual(keysOf(out, 'characters'), keysOf(sample, 'characters'))
  assert.ok(out.includes('    "shape:hattie": { "species": "horse", "body": "tall" },\n'), out)
})
test('Undo of a delete: at the end, as before, when its neighbours are gone', () => {
  const done = patchText(sample, [{ op: 'delete', path: ['characters', 'shape:hattie'] }])
  const moved = patchText(done.text, [{ op: 'delete', path: ['characters', 'shape:bruno'] }]).text // the member after it
  const value = (parseDirection(sample).characters as Record<string, unknown>)['shape:hattie']
  const { out } = expectSame(moved, [{ op: 'set', path: ['characters', 'shape:hattie'], value, restore: done.removed[0]! }])
  assert.equal(keysOf(out, 'characters').at(-1), 'shape:hattie')
})
test('Undo of a delete keeps a hand edit made elsewhere in the meantime', () => {
  const done = patchText(handMira, [{ op: 'delete', path: ['characters', 'shape:mira'] }])
  const edited = done.text.replace('"weather": "clear"', '"weather": "rain"')
  const value = (parseDirection(handMira).characters as Record<string, unknown>)['shape:mira']
  const undone = patchText(edited, [{ op: 'set', path: ['characters', 'shape:mira'], value, restore: done.removed[0]! }])
  assert.equal(undone.text, handMira.replace('"weather": "clear"', '"weather": "rain"'))
})
test('Undo of a delete keeps the file\'s line breaks', () => {
  const crlf = handMira.replace(/\n/g, '\r\n')
  expectRoundTrip(crlf, { op: 'delete', path: ['characters', 'shape:mira'] })
  // Text taken from the file before its line breaks changed is written anew.
  const done = patchText(handMira, [{ op: 'delete', path: ['characters', 'shape:mira'] }])
  const value = (parseDirection(handMira).characters as Record<string, unknown>)['shape:mira']
  const { out } = expectSame(done.text.replace(/\n/g, '\r\n'), [{ op: 'set', path: ['characters', 'shape:mira'], value, restore: done.removed[0]! }])
  assert.ok(!/[^\r]\n/.test(out), 'a bare LF appeared')
  assert.equal(keysOf(out, 'characters')[0], 'shape:mira')
})
test('Undo of a set puts back the value as it was written', () => {
  const odd = '{\n  "a": 1.50,\n  "e": "caf\\u00e9",\n  "m": {\n    "x": 1, "y": 2\n  },\n  "z": { }\n}\n'
  expectRoundTrip(odd, { op: 'set', path: ['a'], value: 2 })
  expectRoundTrip(odd, { op: 'set', path: ['e'], value: 'tea' })
  expectRoundTrip(odd, { op: 'set', path: ['m'], value: { x: 3 } })
  expectRoundTrip(odd, { op: 'set', path: ['z', 'k'], value: 1 }) // into an empty object
  expectRoundTrip(sample, { op: 'set', path: ['places', 'shape:new', 'preset'], value: 'lake' }) // makes the place too
  expectRoundTrip('{\n  "places": [],\n  "x": 1\n}\n', { op: 'set', path: ['places', 'shape:a', 'preset'], value: 'lake' })
})
test('only well-formed renames, and text to put back that is not text is dropped', () => {
  assert.throws(() => checkOps([{ op: 'rename', path: ['a'], to: 5 }]), JsonEditRefused)
  assert.throws(() => checkOps([{ op: 'rename', path: ['a'], to: '__proto__' }]), JsonEditRefused)
  const ops = checkOps([{ op: 'set', path: ['a'], value: 1, restore: { text: 7 } }, { op: 'delete', path: ['b'], restore: { text: '{}', after: null, before: null } }])
  assert.equal(ops[0].restore, undefined)
  assert.deepEqual(ops[1].restore, { text: '{}', after: null, before: null } satisfies Removed)
})

// Random documents in random layouts, random edits: the text edit must always agree with the
// object edit, and it should almost never need to fall back to rewriting the file.
test('random edits agree with the object edit', () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
  const keys = ['a', 'b', 'c', 'shape:x', 'Mira', 'é', 'with "quote"', 'k1']
  const value = (depth: number): unknown => {
    const r = rnd()
    if (depth > 2 || r < 0.35) return pick([1, -2.5, 0, 'text', 'a\nb', true, null, [1, 2], []])
    if (r < 0.5) return [value(depth + 1), value(depth + 1)]
    const o: Record<string, unknown> = {}
    for (let i = Math.floor(rnd() * 4); i > 0; i--) o[pick(keys)] = value(depth + 1)
    return o
  }
  let fallbacks = 0, runs = 0, undos = 0
  for (let n = 0; n < 3000; n++) {
    const doc: Record<string, unknown> = { version: 1 }
    for (let i = 0; i < 4; i++) doc[pick(keys)] = value(1)
    const layout = pick(['hand', 'two', 'four', 'tab', 'min'])
    let text = layout === 'hand' ? formatJSON(doc) : layout === 'two' ? JSON.stringify(doc, null, 2) : layout === 'four' ? JSON.stringify(doc, null, 4) : layout === 'tab' ? JSON.stringify(doc, null, '\t') : JSON.stringify(doc)
    text += '\n'
    const path = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(keys))
    const r0 = rnd()
    const op: JsonOp = r0 < 0.6 ? { op: 'set', path, value: value(2) } : r0 < 0.85 ? { op: 'delete', path } : { op: 'rename', path, to: pick(keys) }
    try {
      const r = expectSame(text, [op])
      runs++
      if (!r.spliced) fallbacks++
      // Undo gives the file back byte for byte, and Redo the edited file.
      const t = roundTrip(text, op)
      undos++
      if (!t.spliced || t.undone !== text || t.redone !== t.done) throw new Error(`Undo or Redo changed the file\nundone ${t.undone}\nredone ${t.redone}\ndone ${t.done}`)
    } catch (e) {
      if (e instanceof JsonEditRefused) continue
      throw new Error(`${(e as Error).message}\nlayout ${layout}\nop ${JSON.stringify(op)}\ntext ${text}`)
    }
  }
  console.log(`     ${runs} edits, ${fallbacks} fell back to a full rewrite; ${undos} undone and redone byte for byte`)
  assert.ok(fallbacks / runs < 0.01, `too many fallbacks: ${fallbacks}`)
})

if (failures) { console.log(`${failures} failed`); process.exit(1) }
console.log('all passed')
