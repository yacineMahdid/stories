// node server/json-edit.test.ts — checks that edits change only what they touch.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { patchText, parseDirection, applyOp, checkOps, formatJSON, JsonEditRefused, patchRequest, type Answered, type JsonOp, type Removed } from './json-style.ts'
import { merge3 } from '../src/lib/merge.ts'

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

// Renames and Undo. The app's Undo of an edit is the edits that take it back (inverse() in
// app/src/lib/staging.ts, copied here), the last of them carrying what the server said the edit
// took out of the file.
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const inverseOf = (doc: Record<string, any>, op: JsonOp): JsonOp[] => {
  let node = doc
  for (let i = 0; i < op.path.length; i++) {
    const key = op.path[i], path = op.path.slice(0, i + 1), has = Object.hasOwn(node, key)
    if (i === op.path.length - 1) {
      if (op.op === 'rename') return has && op.to !== key && !Object.hasOwn(node, op.to) ? [{ op: 'rename', path: [...op.path.slice(0, -1), op.to], to: key }] : []
      return has ? [{ op: 'set', path, value: node[key] }] : op.op === 'set' ? [{ op: 'delete', path }] : []
    }
    if (!isObj(node[key])) {
      if (op.op !== 'set' || (Array.isArray(node[key]) && node[key].length)) return []
      if (has) return [{ op: 'set', path, value: node[key] }]
      const made: JsonOp[] = []
      for (let j = op.path.length - 1; j > i; j--) made.push({ op: 'delete', path: op.path.slice(0, j), ifEmpty: true })
      return [{ op: 'delete', path: op.path }, ...made]
    }
    node = node[key]
  }
  return []
}
/** As sent to the server, and checked there. */
const wire = (ops: JsonOp[]) => checkOps(JSON.parse(JSON.stringify(ops)))
/** The Undo of `ops`, made together on `text`, as the app sends it: the last edit's first. */
const undoFor = (text: string, ops: JsonOp[], removed: (Removed | null)[]) => {
  let doc = parseDirection(text)
  const back: JsonOp[] = []
  ops.forEach((op, i) => {
    const us = inverseOf(doc, op)
    const r = removed[i]
    if (us.length && r) us[us.length - 1] = { ...us[us.length - 1], restore: r }
    back.unshift(...us)
    doc = structuredClone(doc)
    applyOp(doc, op)
  })
  return wire(back)
}
/** An edit (or several made together), its Undo (with what it took out) and its Redo: the three texts. */
const roundTrip = (text: string, op: JsonOp | JsonOp[]) => {
  const ops = Array.isArray(op) ? op : [op]
  const done = patchText(text, ops)
  const undone = patchText(done.text, undoFor(text, ops, done.removed))
  const redone = patchText(undone.text, ops)
  return { done: done.text, undone: undone.text, redone: redone.text, spliced: done.spliced && undone.spliced && redone.spliced }
}
/**
 * Edits of one undo step (the same field again within a moment, see edit3d in
 * app/src/lib/staging-history.ts): Undo takes back the last edit, then the one before…; Redo
 * makes them all again, in order.
 */
const stepTrip = (text: string, edits: JsonOp[][]) => {
  let t = text, spliced = true
  const undos: JsonOp[][] = []
  for (const ops of edits) { const r = patchText(t, ops); undos.unshift(undoFor(t, ops, r.removed)); t = r.text; spliced &&= r.spliced }
  const undone = patchText(t, wire(undos.flat()))
  const redone = patchText(undone.text, edits.flat())
  return { done: t, undone: undone.text, redone: redone.text, spliced: spliced && undone.spliced && redone.spliced }
}
const expectExact = (text: string, r: ReturnType<typeof roundTrip>) => {
  assert.ok(r.spliced, 'fell back to a full rewrite')
  assert.equal(r.undone, text, 'Undo did not give the file back byte for byte')
  assert.equal(r.redone, r.done, 'Redo did not give the edited file back byte for byte')
  return r
}
const expectRoundTrip = (text: string, op: JsonOp | JsonOp[]) => expectExact(text, roundTrip(text, op))
const expectStepTrip = (text: string, edits: JsonOp[][]) => expectExact(text, stepTrip(text, edits))
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
  expectRoundTrip(handMira, [{ op: 'delete', path: ['characters', 'shape:biscuit'] }, { op: 'delete', path: ['characters', 'shape:juniper'] }, { op: 'set', path: ['characters', 'shape:mira', 'species'], value: 'cat' }])
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
test('Undo of a delete in a file with mixed line breaks puts the member back as it was', () => {
  const oneCrlf = handMira.replace('"version": 1,\n', '"version": 1,\r\n') // LF, with one CRLF far away
  for (const key of ['shape:mira', 'shape:hattie']) expectRoundTrip(oneCrlf, { op: 'delete', path: ['characters', key] })
  // A CRLF file whose only bare LF goes out with the member: the file looks all CRLF until the Undo.
  const crlf = sample.replace(/\n/g, '\r\n')
  const at = crlf.indexOf('\r\n', crlf.indexOf('"shape:hattie"'))
  const lone = crlf.slice(0, at) + '\n' + crlf.slice(at + 2)
  expectRoundTrip(lone, { op: 'delete', path: ['characters', 'shape:bruno'] })
  // The writer made the file all LF in the meantime: the member's own LF text still goes back.
  const done = patchText(oneCrlf, [{ op: 'delete', path: ['characters', 'shape:mira'] }])
  const value = (parseDirection(handMira).characters as Record<string, unknown>)['shape:mira']
  const undone = patchText(done.text.replace(/\r\n/g, '\n'), [{ op: 'set', path: ['characters', 'shape:mira'], value, restore: done.removed[0]! }])
  assert.equal(undone.text, handMira)
})
test('Undo of a set puts back the value as it was written', () => {
  const odd = '{\n  "a": 1.50,\n  "e": "caf\\u00e9",\n  "m": {\n    "x": 1, "y": 2\n  },\n  "z": { }\n}\n'
  expectRoundTrip(odd, { op: 'set', path: ['a'], value: 2 })
  expectRoundTrip(odd, { op: 'set', path: ['e'], value: 'tea' })
  expectRoundTrip(odd, { op: 'set', path: ['m'], value: { x: 3 } })
  expectRoundTrip(odd, { op: 'set', path: ['z', 'k'], value: 1 }) // into an empty object
  expectRoundTrip(sample, { op: 'set', path: ['places', 'shape:new', 'preset'], value: 'lake' }) // makes the place too
  expectRoundTrip('{\n  "places": [],\n  "x": 1\n}\n', { op: 'set', path: ['places', 'shape:a', 'preset'], value: 'lake' })
  expectRoundTrip('{\n  "version": 1\n}\n', { op: 'set', path: ['places', 'shape:a', 'preset'], value: 'lake' }) // and the section
  expectRoundTrip('{\n  "places": {   },\n  "x": 1\n}\n', { op: 'set', path: ['places', 'shape:a', 'preset'], value: 'lake' }) // its own "{ }" back
  expectRoundTrip('{}\n', { op: 'set', path: ['places', 'shape:a', 'preset'], value: 'lake' })
})
test('a delete "if empty" takes out only an object with nothing in it', () => {
  const t = '{\n  "a": {},\n  "b": {\n  },\n  "c": { "x": {} },\n  "d": "",\n  "e": [],\n  "f": null\n}\n'
  for (const [key, goes] of [['a', true], ['b', true], ['c', false], ['d', false], ['e', false], ['f', false], ['none', false]] as [string, boolean][]) {
    const { out, spliced } = expectSame(t, [{ op: 'delete', path: [key], ifEmpty: true }])
    assert.ok(spliced)
    if (goes) assert.ok(!Object.hasOwn(parseDirection(out), key), key)
    else assert.equal(out, t, key)
  }
  assert.equal(patchText(t, [{ op: 'delete', path: ['c', 'x'], ifEmpty: true }]).text, t.replace('{ "x": {} }', '{}'))
})
test('Undo of a set that made an entry leaves what the writer added to it by hand', () => {
  // A 3D set on a pin with no entry yet, then the writer adds a radius to that entry.
  const set: JsonOp = { op: 'set', path: ['places', 'shape:new', 'preset'], value: 'lake' }
  const done = patchText(sample, [set])
  const hand = done.text.replace('"shape:new": { "preset": "lake" }', '"shape:new": { "preset": "lake", "radius": 9 }')
  assert.notEqual(hand, done.text)
  const { out } = expectSame(hand, undoFor(sample, [set], done.removed))
  assert.equal(out, hand.replace('{ "preset": "lake", "radius": 9 }', '{ "radius": 9 }'))
  // A look field in a group the look didn't have: the group stays with the writer's field in it.
  const eyes: JsonOp = { op: 'set', path: ['characters', 'shape:hattie', 'face', 'eyes'], value: 'sleepy' }
  const done2 = patchText(sample, [eyes])
  const hand2 = done2.text.replace('"face": { "eyes": "sleepy" }', '"face": { "eyes": "sleepy", "blush": true }')
  assert.notEqual(hand2, done2.text)
  const look = (parseDirection(patchText(hand2, undoFor(sample, [eyes], done2.removed)).text).characters as Record<string, any>)['shape:hattie']
  assert.deepEqual(look.face, { blush: true })
})
const presetMill = sample.replace('"shape:mill": {\n', '"shape:mill": {\n      "preset": "forest",\n\n') // a preset, then a blank line
test('Undo of one step of several edits of a field gives the file back byte for byte', () => {
  assert.notEqual(presetMill, sample)
  const pier = ['places', 'shape:pier'], mira = ['characters', 'shape:mira']
  const look = (parseDirection(handMira).characters as Record<string, any>)['shape:mira']
  for (const edits of [
    // "3D set" Automatic (the entry goes), then Forest: the entry is made again, at the end
    [[{ op: 'delete', path: pier }], [{ op: 'set', path: [...pier, 'preset'], value: 'forest' }]],
    // Species Cat (skin and hair go), then Human again (they come back, at the end of the look)
    [[{ op: 'set', path: [...mira, 'species'], value: 'cat' }, { op: 'delete', path: [...mira, 'skin'] }, { op: 'delete', path: [...mira, 'hair'] }],
      [{ op: 'set', path: [...mira, 'species'], value: 'human' }, { op: 'set', path: [...mira, 'skin'], value: look.skin }, { op: 'set', path: [...mira, 'hair'], value: look.hair }]],
    // "3D set" Lake, then Automatic: the preset goes, from an entry that has more
    [[{ op: 'set', path: ['places', 'shape:mill', 'preset'], value: 'lake' }], [{ op: 'delete', path: ['places', 'shape:mill', 'preset'] }]],
    // a colour dragged through three values
    [1, 2, 3].map((n) => [{ op: 'set', path: [...mira, 'skin'], value: `#00000${n}` }]),
    // a preset on a pin with no entry, then another
    [[{ op: 'set', path: ['places', 'shape:new', 'preset'], value: 'lake' }], [{ op: 'set', path: ['places', 'shape:new', 'preset'], value: 'meadow' }]],
  ] as JsonOp[][][]) {
    for (const text of [handMira, presetMill]) expectStepTrip(text, edits)
  }
})
test('text to put back must be the one member, nothing more', () => {
  const done = patchText(sample, [{ op: 'delete', path: ['characters', 'shape:hattie'] }])
  const r = done.removed[0]!
  const value = (parseDirection(sample).characters as Record<string, unknown>)['shape:hattie']
  const { out } = expectSame(done.text, [{ op: 'set', path: ['characters', 'shape:hattie'], value, restore: { ...r, text: r.text + r.text } }])
  assert.equal(out.match(/^ {4}"shape:hattie":/gm)?.length, 1)
  assert.deepEqual(keysOf(out, 'characters'), keysOf(sample, 'characters'))
})
test('only well-formed renames, and text to put back that is not text is dropped', () => {
  assert.throws(() => checkOps([{ op: 'rename', path: ['a'], to: 5 }]), JsonEditRefused)
  assert.throws(() => checkOps([{ op: 'rename', path: ['a'], to: '__proto__' }]), JsonEditRefused)
  assert.throws(() => checkOps([{ op: 'delete', path: ['a'], ifEmpty: 'yes' }]), JsonEditRefused)
  const ops = checkOps([
    { op: 'set', path: ['a'], value: 1, restore: { text: 7 } },
    { op: 'delete', path: ['b'], restore: { text: '{}', after: null, before: null } },
    { op: 'set', path: ['c'], value: 1, restore: { text: '1', breaks: 2 } },
    { op: 'delete', path: ['d'], ifEmpty: true, restore: { text: '{ }', breaks: 'crlf lf' } },
  ])
  assert.equal(ops[0].restore, undefined)
  assert.deepEqual(ops[1].restore, { text: '{}', after: null, before: null } satisfies Removed)
  assert.equal(ops[2].restore, undefined)
  assert.deepEqual(ops[3], { op: 'delete', path: ['d'], ifEmpty: true, restore: { text: '{ }', breaks: 'crlf lf' } })
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
  const randomOp = (): JsonOp => {
    const path = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(keys))
    const r0 = rnd()
    return r0 < 0.6 ? { op: 'set', path, value: value(2) } : r0 < 0.85 ? { op: 'delete', path } : { op: 'rename', path, to: pick(keys) }
  }
  const exact = (text: string, t: ReturnType<typeof roundTrip>) => {
    if (!t.spliced || t.undone !== text || t.redone !== t.done) throw new Error(`Undo or Redo changed the file\nundone ${t.undone}\nredone ${t.redone}\ndone ${t.done}`)
  }
  let fallbacks = 0, runs = 0, undos = 0, steps = 0
  for (let n = 0; n < 3000; n++) {
    const doc: Record<string, unknown> = { version: 1 }
    for (let i = 0; i < 4; i++) doc[pick(keys)] = value(1)
    const layout = pick(['hand', 'two', 'four', 'tab', 'min'])
    let text = layout === 'hand' ? formatJSON(doc) : layout === 'two' ? JSON.stringify(doc, null, 2) : layout === 'four' ? JSON.stringify(doc, null, 4) : layout === 'tab' ? JSON.stringify(doc, null, '\t') : JSON.stringify(doc)
    text += '\n'
    const op = randomOp(), op2 = randomOp()
    let at = 'edit'
    try {
      const r = expectSame(text, [op])
      runs++
      if (!r.spliced) fallbacks++
      // Undo gives the file back byte for byte, and Redo the edited file.
      exact(text, roundTrip(text, op))
      undos++
      // And so do two edits in one undo step (the same field again within a moment).
      at = 'step'
      exact(text, stepTrip(text, [[op], [op2]]))
      steps++
    } catch (e) {
      if (e instanceof JsonEditRefused) continue
      throw new Error(`${(e as Error).message}\nlayout ${layout}\n${at} ${JSON.stringify(at === 'edit' ? op : [op, op2])}\ntext ${text}`)
    }
  }
  console.log(`     ${runs} edits, ${fallbacks} fell back to a full rewrite; ${undos} undone and redone byte for byte, and ${steps} steps of two`)
  assert.ok(fallbacks / runs < 0.01, `too many fallbacks: ${fallbacks}`)
})

/* ── a whole list written from what the app saw (expect), when the file changed it meanwhile ── */

const parse = (text: string) => parseDirection(text) as Record<string, any>

test('merge3: entries by id/who/added/label, fields one by one; the edit wins on the same field', () => {
  const base = [{ who: 'a', feel: 'x', do: 'Idle' }, { who: 'b', feel: 'y' }]
  // The edit changes a's feel; the file changed b's: both stay.
  assert.deepEqual(merge3(base, [{ who: 'a', feel: 'z', do: 'Idle' }, base[1]], [base[0], { who: 'b', feel: 'w' }]), [{ who: 'a', feel: 'z', do: 'Idle' }, { who: 'b', feel: 'w' }])
  // Both changed a's feel: the edit's; the file's other field stays.
  assert.deepEqual(merge3(base, [{ who: 'a', feel: 'z', do: 'Idle' }, base[1]], [{ who: 'a', feel: 'q', do: 'Wave' }, base[1]]), [{ who: 'a', feel: 'z', do: 'Wave' }, base[1]])
  // Added by the edit (after the one it follows) and by the file; taken out by the edit.
  assert.deepEqual(merge3(base, [base[0], { who: 'c' }], [base[0], base[1], { who: 'd' }]), [base[0], { who: 'c' }, { who: 'd' }])
  // A note's reply written in the file stays when the app adds a note.
  const n1 = { text: 'one', added: 't1' }, n2 = { text: 'two', added: 't2' }
  assert.deepEqual(merge3([n1], [n1, n2], [{ ...n1, reply: 'Done.' }]), [{ ...n1, reply: 'Done.' }, n2])
  // Nothing changed in the file: the edit as it is; the edit changed nothing: the file as it is.
  assert.deepEqual(merge3(base, [], base), [])
  assert.deepEqual(merge3(base, base, [base[1]]), [base[1]])
  // A delete of the list keeps what the file added meanwhile, else it is a delete.
  assert.deepEqual(merge3([n1], undefined, [n1, n2]), [n2])
  assert.equal(merge3([n1], undefined, [{ ...n1, reply: 'r' }]), undefined)
  // Points and paths are one value each; entries nobody can tell apart go by their place.
  assert.deepEqual(merge3({ at: [1, 2], path: [[0, 0], [1, 1]] }, { at: [3, 4], path: [[0, 0], [1, 1]] }, { at: [1, 2], path: [[5, 5]] }), { at: [3, 4], path: [[5, 5]] })
  assert.deepEqual(merge3([{ shot: 'wide' }, { shot: 'wide' }], [{ shot: 'close' }, { shot: 'wide' }], [{ shot: 'wide' }, { shot: 'wide', hold: 3 }]), [{ shot: 'close' }, { shot: 'wide', hold: 3 }])
})
test('expect: a list the file changed since the app read it is merged into, not written over', () => {
  const key = ['scenes', 'shape:p1', 'cast']
  const seen = parse(sample).scenes['shape:p1'].cast as Record<string, unknown>[]
  const mine = seen.map((c, i) => (i === 0 ? { ...c, feel: 'angry' } : c))
  // Unchanged in the file: the same text as without expect.
  const plain = patchText(sample, [{ op: 'set', path: key, value: mine }]).text
  assert.equal(patchText(sample, [{ op: 'set', path: key, value: mine, expect: seen }]).text, plain)
  // Juniper's "do" changed by hand meanwhile: it stays, and Mira's feel lands.
  const hand = sample.replace('"do": "Stretch"', '"do": "Dance"')
  assert.notEqual(hand, sample)
  const out = parse(patchText(hand, [{ op: 'set', path: key, value: mine, expect: seen }]).text).scenes['shape:p1'].cast
  assert.equal(out[0].feel, 'angry')
  assert.equal(out[2].do, 'Dance')
  // Its Undo (what the edit wrote as expect) takes back only the edit: Biscuit's later hand edit stays.
  const after = patchText(sample, [{ op: 'set', path: key, value: mine, expect: seen }])
  const later = after.text.replace('"feel": "excited"', '"feel": "bored"')
  const undone = patchText(later, [{ op: 'set', path: key, value: seen, expect: mine, restore: after.removed[0] ?? undefined }])
  const back = parse(undone.text).scenes['shape:p1'].cast
  assert.equal(back[0].feel, seen[0].feel)
  assert.equal(back[1].feel, 'bored')
  assert.equal(undone.text, sample.replace('"feel": "excited"', '"feel": "bored"'))
  // An unchanged file: the Undo is byte for byte.
  assert.equal(patchText(after.text, [{ op: 'set', path: key, value: seen, expect: mine, restore: after.removed[0] ?? undefined }]).text, sample)
})
test('expect: a delete of a list the file added to meanwhile keeps the added entries; checkOps keeps expect', () => {
  const t = patchText(sample, [{ op: 'set', path: ['scenes', 'shape:p2', 'feedback'], value: [{ text: 'one', added: 't1' }] }]).text
  const hand = t.replace('{ "text": "one", "added": "t1" }', '{ "text": "one", "added": "t1" }, { "text": "two", "added": "t2" }')
  const out = parse(patchText(hand, [{ op: 'delete', path: ['scenes', 'shape:p2', 'feedback'], expect: [{ text: 'one', added: 't1' }] }]).text)
  assert.deepEqual(out.scenes['shape:p2'].feedback, [{ text: 'two', added: 't2' }])
  const ops = checkOps([{ op: 'set', path: ['a'], value: [], expect: null }, { op: 'rename', path: ['b'], to: 'c', expect: [] }])
  assert.ok('expect' in ops[0] && !('expect' in ops[1]))
})
test('a save sent again (its answer lost) is answered as before and not made twice', () => {
  const answered: Answered = new Map()
  const body = { id: 's-1', ops: [{ op: 'delete', path: ['scenes', 'shape:p3', 'weather'] }] }
  const first = patchRequest(sample, body, answered)
  assert.ok(first.text && first.answer.removed[0])
  const again = patchRequest(first.text!, structuredClone(body), answered)
  assert.equal(again.text, null)
  assert.deepEqual(again.answer.removed, first.answer.removed)
  // Its Undo with what the first one took out: byte for byte.
  const undo = patchText(first.text!, [{ op: 'set', path: ['scenes', 'shape:p3', 'weather'], value: 'storm', restore: first.answer.removed[0]! }])
  assert.equal(undo.text, sample)
  // Without an id, as before.
  assert.ok(patchRequest(sample, { ops: body.ops }, answered).text)
})
test('a new page entry gets the blank line the page entries are kept apart by', () => {
  const out = patchText(sample, [{ op: 'set', path: ['scenes', 'shape:p9', 'cast'], value: [{ who: 'shape:mira', at: [1, 2], facing: 3, do: 'Talk' }] }]).text
  assert.match(out, /\n    \},\n\n    "shape:p9": \{\n/)
  // Inside a page entry, members aren't kept apart: no blank line.
  const inner = patchText(sample, [{ op: 'set', path: ['scenes', 'shape:p1', 'feedback'], value: [{ text: 'x' }] }]).text
  assert.ok(!/\n\n\s*"feedback"/.test(inner))
})

if (failures) { console.log(`${failures} failed`); process.exit(1) }
console.log('all passed')
