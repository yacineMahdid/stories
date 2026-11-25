/**
 * Edit a hand-written JSON file in place: set, delete or rename one value at a path, changing only
 * the characters of that value, member or key. The rest of the file (its layout, line endings, a
 * BOM, the way numbers and strings are spelled) stays exactly as it was.
 */
export type JsonOp =
  | { op: 'set'; path: string[]; value: unknown; restore?: Removed }
  | { op: 'delete'; path: string[]; ifEmpty?: boolean; restore?: Removed } // ifEmpty: only an object with nothing in it
  | { op: 'rename'; path: string[]; to: string; restore?: Removed }

/**
 * The text an edit took out of the file: a value it replaced, a key it renamed, or a member it
 * deleted, with the keys of the members it stood between (null: none) and the kinds of line
 * break the file had right after the edit (see breaksOf). The edit that takes it back carries it
 * as `restore`, and puts that same text back where it was when it still fits.
 */
export type Removed = { text: string; after?: string | null; before?: string | null; breaks?: string }

const BREAKS: [string, RegExp][] = [['crlf', /\r\n/], ['lf', /(?:^|[^\r])\n/], ['cr', /\r(?!\n)/]]
/** The kinds of line break a text has: "lf", "crlf", "cr" or several ("crlf lf"), "" for none. */
export const breaksOf = (text: string) => BREAKS.filter(([, re]) => re.test(text)).map(([kind]) => kind).join(' ')

/** A request that can't be applied (it would destroy data); the message says why. */
export class JsonEditRefused extends Error {}

type Node =
  | { kind: 'object'; start: number; end: number; members: Member[] }
  | { kind: 'array'; start: number; end: number }
  | { kind: 'scalar'; start: number; end: number }
type Member = { key: string; keyStart: number; keyEnd: number; value: Node }

/** A positions-only JSON parser: what spans what. Throws on invalid JSON. */
function parse(text: string): Node {
  let i = 0
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++ }
  const fail = (what: string): never => { throw new SyntaxError(`${what} at position ${i}`) }
  const string = () => {
    const start = i
    i++ // opening quote
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    if (i >= text.length) fail('Unterminated string')
    i++
    return text.slice(start, i)
  }
  const value = (): Node => {
    ws()
    const start = i
    const c = text[i]
    if (c === '{') {
      i++
      const members: Member[] = []
      ws()
      if (text[i] === '}') { i++; return { kind: 'object', start, end: i, members } }
      for (;;) {
        ws()
        if (text[i] !== '"') fail('Expected a key')
        const keyStart = i
        const key = JSON.parse(string()) as string
        const keyEnd = i
        ws()
        if (text[i] !== ':') fail('Expected ":"')
        i++
        members.push({ key, keyStart, keyEnd, value: value() })
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return { kind: 'object', start, end: i, members } }
        fail('Expected "," or "}"')
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') { i++; return { kind: 'array', start, end: i } }
      for (;;) {
        value()
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return { kind: 'array', start, end: i } }
        fail('Expected "," or "]"')
      }
    }
    if (c === '"') { string(); return { kind: 'scalar', start, end: i } }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 400))
    if (!m) fail('Unexpected token')
    i += m![0].length
    return { kind: 'scalar', start, end: i }
  }
  const root = value()
  ws()
  if (i < text.length) fail('Unexpected text after the end')
  return root
}

const lineStart = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1
const indentAt = (text: string, pos: number) => /^[ \t]*/.exec(text.slice(lineStart(text, pos)))![0]

/** The file's indentation step (two spaces, four, a tab…), from its first indented line. */
function indentUnit(text: string) {
  const m = /\n([ \t]+)\S/.exec(text)
  return m ? (m[1][0] === '\t' ? '\t' : m[1]) : '  '
}

/** A key JSON.parse puts first, in number order, wherever the file has it ("0", "42"…). */
export const isIndex = (key: string) => /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1

/**
 * Where a member deleted from between `after` and `before` (null: none) goes back among `keys` (in
 * the order JSON.parse gives them): the index to insert it at, or -1 when those two are no longer
 * side by side. Numbered keys are left out, as JSON.parse doesn't keep their place.
 */
export function spotOf(keys: string[], key: string, { after, before }: Pick<Removed, 'after' | 'before'>): number {
  if (after === undefined || before === undefined || isIndex(key) || keys.some(isIndex)) return -1
  const at = after === null ? 0 : keys.indexOf(after) + 1
  if (after !== null && !at) return -1
  return (before === null ? at === keys.length : keys[at] === before) ? at : -1
}

/**
 * Apply one op to the text. `format(value, indent, depth)` writes a new value in the file's style
 * (it is given the indentation of the line it starts on). The caller checks the result.
 */
export type JsonStyle = {
  /** A value written from `indent` (the indentation of the line it starts on) at nesting `depth`. */
  format: (value: unknown, indent: string, depth: number, unit: string) => string
  /** A value written on one line. */
  inline: (value: unknown) => string
}

/** Refused: a rename onto a key the object already has would lose that entry. */
export const nameTaken = (path: string[], to: string) => {
  const where = path.slice(0, -1).join(' › ')
  return new JsonEditRefused(`${where ? `"${where}" in staging.json` : 'staging.json'} already has "${to}", so "${path[path.length - 1]}" can't be renamed to it; change it by hand.`)
}

/** The new text, and what the edit took out of the old one (null: nothing). */
export function editJson(source: string, op: JsonOp, style: JsonStyle): { text: string; removed: Removed | null } {
  const { format, inline } = style
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const text = source.slice(bom.length)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const unit = indentUnit(text)
  const fmt = (value: unknown, indent: string, depth: number) => format(value, indent, depth, unit).replace(/\n/g, eol)
  const root = parse(text)
  if (root.kind !== 'object') throw new JsonEditRefused('The file must hold an object ({ … }).')
  const splice = (start: number, end: number, insert: string, around?: Pick<Removed, 'after' | 'before'>) => {
    const out = text.slice(0, start) + insert + text.slice(end)
    return { text: bom + out, removed: end > start ? { text: text.slice(start, end), ...around, breaks: breaksOf(out) } : null }
  }
  const unchanged = { text: source, removed: null }
  const nest = (keys: string[], value: unknown) => keys.reduceRight<unknown>((v, k) => ({ [k]: v }), value)
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const reads = (json: string, check: (v: any) => boolean) => { try { return check(JSON.parse(json)) } catch { return false } }
  // Text an earlier edit took out goes back as it was written only where its line breaks fit: the
  // file has the same kinds of line break as right after that edit, or the text has only kinds the
  // file has. And only when it still reads as what this edit writes; otherwise it is written anew.
  const back = op.restore?.text ?? ''
  const breaks = breaksOf(text)
  const breaksFit = !!op.restore && (op.restore.breaks === breaks || breaksOf(back).split(' ').every((k) => !k || breaks.split(' ').includes(k)))

  let node: Node = root
  for (let d = 0; d < op.path.length; d++) {
    const key = op.path[d]
    const obj = node as Extract<Node, { kind: 'object' }>
    const index = obj.members.map((m) => m.key).lastIndexOf(key) // JSON.parse keeps the last of duplicates
    const last = d === op.path.length - 1
    if (index < 0) {
      if (op.op !== 'set') return unchanged
      // A new member holding the rest of the path: at the end of this object or, put back by the
      // Undo of its delete, between the same two members (as it was written, when that fits).
      const value = last ? op.value : nest(op.path.slice(d + 1), op.value)
      const keys = [...new Set(obj.members.map((m) => m.key))] // in the order JSON.parse gives them
      const spot = last && op.restore ? spotOf(keys, key, op.restore) : -1
      // Does the object `json` hold just `n` members (a key written twice counts twice), this one
      // among them with this value? Then the text put back is that member and nothing more.
      const holds = (json: string, n: number) => {
        try { const node = parse(json); return node.kind === 'object' && node.members.length === n && reads(json, (v) => Object.keys(v).length === n && Object.hasOwn(v, key) && same(v[key], value)) } catch { return false }
      }
      const first = (k: string) => obj.members.find((m) => m.key === k)!
      const oneLine = !text.slice(obj.start, obj.end).includes('\n')
      if (!obj.members.length) {
        if (spot === 0 && breaksFit && holds(back, 1)) return splice(obj.start, obj.end, back)
        const outer = indentAt(text, obj.start)
        return splice(obj.start, obj.end, `{${eol}${outer}${unit}${JSON.stringify(key)}: ${fmt(value, outer + unit, d + 1)}${eol}${outer}}`)
      }
      if (spot === 0) {
        // It was the first member: back in front of the one that followed it.
        const next = first(keys[0])
        if (breaksFit && holds(`{${back}"\\u0000":0}`, 2)) return splice(next.keyStart, next.keyStart, back)
        if (oneLine) return splice(next.keyStart, next.keyStart, `${JSON.stringify(key)}: ${inline(value)}, `)
        const indent = indentAt(text, next.keyStart)
        const written = fmt(value, indent, d + 1)
        const tall = written.includes('\n') || text.slice(next.value.start, next.value.end).includes('\n')
        return splice(next.keyStart, next.keyStart, `${JSON.stringify(key)}: ${written},${d < 1 && tall ? eol + eol : eol}${indent}`)
      }
      const prev = spot > 0 ? first(keys[spot - 1]) : obj.members[obj.members.length - 1]
      if (spot > 0 && breaksFit && holds(`{"\\u0000":0${back}}`, 2)) return splice(prev.value.end, prev.value.end, back)
      if (oneLine) return splice(prev.value.end, prev.value.end, `, ${JSON.stringify(key)}: ${inline(value)}`)
      const indent = indentAt(text, prev.keyStart)
      const written = fmt(value, indent, d + 1)
      const tall = written.includes('\n') || text.slice(prev.value.start, prev.value.end).includes('\n')
      const gap = d < 1 && tall ? eol + eol : eol // big sections are separated by a blank line
      return splice(prev.value.end, prev.value.end, `,${gap}${indent}${JSON.stringify(key)}: ${written}`)
    }
    const member = obj.members[index]
    if (last) {
      if (op.op === 'set') {
        const kept = breaksFit && reads(back, (v) => same(v, op.value))
        return splice(member.value.start, member.value.end, kept ? back : fmt(op.value, indentAt(text, member.keyStart), d + 1))
      }
      if (op.op === 'rename') {
        if (op.to === key) return unchanged
        if (obj.members.some((m) => m.key === op.to)) throw nameTaken(op.path, op.to)
        if (isIndex(key) || isIndex(op.to)) {
          // JSON.parse doesn't keep a numbered key's place: such an entry moves to the end instead.
          const value = JSON.parse(text.slice(member.value.start, member.value.end))
          const gone = editJson(source, { op: 'delete', path: op.path }, style).text
          return { text: editJson(gone, { op: 'set', path: [...op.path.slice(0, -1), op.to], value }, style).text, removed: null }
        }
        const kept = back.startsWith('"') && back.endsWith('"') && reads(back, (v) => v === op.to)
        return splice(member.keyStart, member.keyEnd, kept ? back : JSON.stringify(op.to))
      }
      // A delete "if empty" (the Undo of an edit that made this object) leaves one with anything
      // in it, such as a field the writer added by hand in the meantime.
      if (op.ifEmpty && !(member.value.kind === 'object' && !member.value.members.length)) return unchanged
      // What a delete takes out comes with the keys around it, so its Undo can put it back there.
      const around = { after: obj.members[index - 1]?.key ?? null, before: obj.members[index + 1]?.key ?? null }
      if (obj.members.length === 1) return splice(obj.start, obj.end, breaksFit && /^\{[ \t\r\n]*\}$/.test(back) ? back : '{}', around)
      if (index > 0) return splice(obj.members[index - 1].value.end, member.value.end, '', around)
      return splice(member.keyStart, obj.members[1].keyStart, '', around)
    }
    if (member.value.kind !== 'object') {
      if (op.op !== 'set') return unchanged
      const where = op.path.slice(0, d + 1).join(' › ')
      if (member.value.kind === 'array' && text.slice(member.value.start + 1, member.value.end - 1).trim()) {
        throw new JsonEditRefused(`"${where}" is a list in staging.json, not an object; change it by hand.`)
      }
      // An empty list or a stray value where an object belongs: replace it with the object.
      return splice(member.value.start, member.value.end, fmt(nest(op.path.slice(d + 1), op.value), indentAt(text, member.keyStart), d + 1))
    }
    node = member.value
  }
  // An empty path: replace the whole document.
  if (op.op !== 'set') throw new JsonEditRefused('Refusing to delete the whole file.')
  return { text: bom + fmt(op.value, '', 0) + (text.endsWith(eol) ? eol : ''), removed: null }
}
