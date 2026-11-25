// node server/json-edit.test.ts — checks that edits change only what they touch.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { patchText, parseDirection, applyOp, formatJSON, JsonEditRefused, type JsonOp } from './json-style.ts'

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
  let fallbacks = 0, runs = 0
  for (let n = 0; n < 3000; n++) {
    const doc: Record<string, unknown> = { version: 1 }
    for (let i = 0; i < 4; i++) doc[pick(keys)] = value(1)
    const layout = pick(['hand', 'two', 'four', 'tab', 'min'])
    let text = layout === 'hand' ? formatJSON(doc) : layout === 'two' ? JSON.stringify(doc, null, 2) : layout === 'four' ? JSON.stringify(doc, null, 4) : layout === 'tab' ? JSON.stringify(doc, null, '\t') : JSON.stringify(doc)
    text += '\n'
    const path = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(keys))
    const op: JsonOp = rnd() < 0.7 ? { op: 'set', path, value: value(2) } : { op: 'delete', path }
    try {
      const r = expectSame(text, [op])
      runs++
      if (!r.spliced) fallbacks++
    } catch (e) {
      if (e instanceof JsonEditRefused) continue
      throw new Error(`${(e as Error).message}\nlayout ${layout}\nop ${JSON.stringify(op)}\ntext ${text}`)
    }
  }
  console.log(`     ${runs} edits, ${fallbacks} fell back to a full rewrite`)
  assert.ok(fallbacks / runs < 0.01, `too many fallbacks: ${fallbacks}`)
})

if (failures) { console.log(`${failures} failed`); process.exit(1) }
console.log('all passed')
