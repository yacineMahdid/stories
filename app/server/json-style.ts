import { editJson, isIndex, JsonEditRefused, nameTaken, spotOf, type JsonOp, type Removed } from './json-edit.ts'

export { JsonEditRefused, type JsonOp, type Removed }

/**
 * JSON in the hand-written style of the direction files (see samples/brindlewick/staging.json),
 * used for whole files and for new values spliced into an existing file:
 * - lists of things (props, cast, shots, terrain) get one item per line, each item on one line
 * - short objects stay on one line; an object holding such a list is broken out
 * - lists of numbers or names (points, positions) always stay on one line
 * - a blank line separates the big sections and the place and page entries
 */
export function inlineJSON(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inlineJSON).join(', ')}]`
  if (v && typeof v === 'object') {
    const e = Object.entries(v).filter(([, x]) => x !== undefined)
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inlineJSON(x)}`).join(', ')} }` : '{}'
  }
  return JSON.stringify(v) ?? 'null'
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hasList = (v: unknown): boolean =>
  Array.isArray(v) ? v.some((x) => isObj(x) || hasList(x)) : isObj(v) && Object.values(v).some(hasList)

export function formatJSON(v: unknown, indent = '', depth = 0, inList = false, unit = '  '): string {
  if (!v || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  const flat = inlineJSON(v)
  if (depth > 0) {
    if (Array.isArray(v) && !v.some((x) => isObj(x) || (Array.isArray(x) && x.some(isObj)))) return flat
    if (flat.length <= 300 && (inList || !hasList(v))) return flat
  }
  const inner = indent + unit
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return `[\n${v.map((x) => inner + formatJSON(x, inner, depth + 1, true, unit)).join(',\n')}\n${indent}]`
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined)
  if (!entries.length) return '{}'
  const lines = entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatJSON(x, inner, depth + 1, false, unit)}`)
  const tall = lines.map((l) => l.includes('\n'))
  return `{\n${lines.map((l, i) => (i && depth < 2 && (tall[i] || tall[i - 1]) ? '\n' : '') + l).join(',\n')}\n${indent}}`
}

const STYLE = { format: (v: unknown, indent: string, depth: number, unit: string) => formatJSON(v, indent, depth, false, unit), inline: inlineJSON }

/** The direction as an object; anything else is an error the writer must fix by hand. */
export function parseDirection(text: string): Record<string, unknown> {
  const doc = JSON.parse(text.replace(/^﻿/, ''))
  if (!isObj(doc)) throw new JsonEditRefused('staging.json must hold an object ({ … }), not a list or a single value.')
  return doc
}

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const isName = (k: unknown) => typeof k === 'string' && !BAD_KEYS.has(k)
const isRemoved = (r: unknown): r is Removed =>
  isObj(r) && typeof r.text === 'string' && [r.after, r.before].every((k) => k === undefined || k === null || typeof k === 'string')

/** Only well-formed set, delete and rename operations on a non-empty path of names. */
export function checkOps(ops: unknown): JsonOp[] {
  if (!Array.isArray(ops)) throw new JsonEditRefused('Expected { "ops": [...] }.')
  for (const op of ops as JsonOp[]) {
    const kind = (op as { op?: unknown } | null)?.op
    if (kind !== 'set' && kind !== 'delete' && kind !== 'rename') throw new JsonEditRefused(`Unknown operation ${JSON.stringify(kind)}.`)
    if (!Array.isArray(op.path) || !op.path.length || !op.path.every(isName)) throw new JsonEditRefused(`Bad path ${JSON.stringify(op.path)}.`)
    if (op.op === 'set' && op.value === undefined) throw new JsonEditRefused(`A set at ${op.path.join(' › ')} needs a value.`)
    if (op.op === 'rename' && !isName(op.to)) throw new JsonEditRefused(`A rename at ${op.path.join(' › ')} needs a new name.`)
    // Text to put back only helps the layout: one that isn't is dropped, and the edit still lands.
    if (op.restore !== undefined && !isRemoved(op.restore)) delete op.restore
  }
  return ops as JsonOp[]
}

/** Fill `node` again with `entries`, in their order (as own keys, whatever their names). */
function refill(node: Record<string, unknown>, entries: [string, unknown][]) {
  for (const k of Object.keys(node)) delete node[k]
  for (const [k, v] of entries) Object.defineProperty(node, k, { value: v, writable: true, enumerable: true, configurable: true })
}

/** The same edit on the parsed document, with the same rules as the text edit (key order too). */
export function applyOp(doc: Record<string, unknown>, op: JsonOp) {
  let node: Record<string, unknown> = doc
  for (let d = 0; d < op.path.length - 1; d++) {
    const key = op.path[d]
    const next = node[key]
    if (!isObj(next)) {
      if (op.op !== 'set') return
      if (Array.isArray(next) && next.length) throw new JsonEditRefused(`"${op.path.slice(0, d + 1).join(' › ')}" is a list in staging.json, not an object; change it by hand.`)
      node[key] = {}
    }
    node = node[key] as Record<string, unknown>
  }
  const last = op.path[op.path.length - 1]
  if (op.op === 'delete') { delete node[last]; return }
  if (op.op === 'rename') {
    if (!Object.hasOwn(node, last) || op.to === last) return
    if (Object.hasOwn(node, op.to)) throw nameTaken(op.path, op.to)
    const value = node[last]
    if (isIndex(last) || isIndex(op.to)) { delete node[last]; node[op.to] = value; return } // moves to the end
    refill(node, Object.entries(node).map(([k, v]) => [k === last ? op.to : k, v]))
    return
  }
  const spot = !Object.hasOwn(node, last) && op.restore ? spotOf(Object.keys(node), last, op.restore) : -1
  if (spot < 0) { node[last] = op.value; return }
  const entries = Object.entries(node)
  entries.splice(spot, 0, [last, op.value])
  refill(node, entries)
}

/**
 * Apply edits to the file's text, changing only the spans they touch. The result is checked
 * against the same edits applied to the parsed document; if splicing can't be trusted, the
 * whole file is written in the hand style instead (same content, new layout).
 */
export function patchText(text: string, ops: JsonOp[]): { text: string; doc: Record<string, unknown>; spliced: boolean; removed: (Removed | null)[] } {
  const doc = parseDirection(text)
  let out = text
  let spliced = true
  const removed: (Removed | null)[] = [] // what each edit took out of the text, for its Undo
  for (const op of ops) {
    applyOp(doc, op) // refusals throw before anything is written
    if (!spliced) continue
    try {
      const r = editJson(out, op, STYLE)
      out = r.text
      removed.push(r.removed)
    } catch (e) { if (e instanceof JsonEditRefused) throw e; spliced = false }
  }
  if (spliced) {
    try { spliced = JSON.stringify(parseDirection(out)) === JSON.stringify(doc) } catch { spliced = false }
  }
  if (!spliced) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    out = (text.startsWith('﻿') ? '﻿' : '') + formatJSON(doc).replace(/\n/g, eol) + eol
  }
  return { text: out, doc, spliced, removed: spliced ? removed : ops.map(() => null) }
}
