/**
 * Edit a hand-written JSON file in place: set or delete one value at a path, changing only the
 * characters of that value or member. The rest of the file (its layout, line endings, a BOM, the
 * way numbers and strings are spelled) stays exactly as it was.
 */
export type JsonOp = { op: 'set'; path: string[]; value: unknown } | { op: 'delete'; path: string[] }

/** A request that can't be applied (it would destroy data); the message says why. */
export class JsonEditRefused extends Error {}

type Node =
  | { kind: 'object'; start: number; end: number; members: Member[] }
  | { kind: 'array'; start: number; end: number }
  | { kind: 'scalar'; start: number; end: number }
type Member = { key: string; keyStart: number; value: Node }

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
        ws()
        if (text[i] !== ':') fail('Expected ":"')
        i++
        members.push({ key, keyStart, value: value() })
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

export function editJson(source: string, op: JsonOp, { format, inline }: JsonStyle): string {
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const text = source.slice(bom.length)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const unit = indentUnit(text)
  const fmt = (value: unknown, indent: string, depth: number) => format(value, indent, depth, unit).replace(/\n/g, eol)
  const root = parse(text)
  if (root.kind !== 'object') throw new JsonEditRefused('The file must hold an object ({ … }).')
  const splice = (start: number, end: number, insert: string) => bom + text.slice(0, start) + insert + text.slice(end)
  const nest = (keys: string[], value: unknown) => keys.reduceRight<unknown>((v, k) => ({ [k]: v }), value)

  let node: Node = root
  for (let d = 0; d < op.path.length; d++) {
    const key = op.path[d]
    const obj = node as Extract<Node, { kind: 'object' }>
    const index = obj.members.map((m) => m.key).lastIndexOf(key) // JSON.parse keeps the last of duplicates
    const last = d === op.path.length - 1
    if (index < 0) {
      if (op.op === 'delete') return source
      // A new member at the end of this object, holding the rest of the path.
      const value = last ? op.value : nest(op.path.slice(d + 1), op.value)
      if (!obj.members.length) {
        const outer = indentAt(text, obj.start)
        return splice(obj.start, obj.end, `{${eol}${outer}${unit}${JSON.stringify(key)}: ${fmt(value, outer + unit, d + 1)}${eol}${outer}}`)
      }
      const prev = obj.members[obj.members.length - 1]
      if (!text.slice(obj.start, obj.end).includes('\n')) {
        return splice(prev.value.end, prev.value.end, `, ${JSON.stringify(key)}: ${inline(value)}`)
      }
      const indent = indentAt(text, prev.keyStart)
      const written = fmt(value, indent, d + 1)
      const tall = written.includes('\n') || text.slice(prev.value.start, prev.value.end).includes('\n')
      const gap = d < 1 && tall ? eol + eol : eol // big sections are separated by a blank line
      return splice(prev.value.end, prev.value.end, `,${gap}${indent}${JSON.stringify(key)}: ${written}`)
    }
    const member = obj.members[index]
    if (last) {
      if (op.op === 'set') return splice(member.value.start, member.value.end, fmt(op.value, indentAt(text, member.keyStart), d + 1))
      if (obj.members.length === 1) return splice(obj.start, obj.end, '{}')
      if (index > 0) return splice(obj.members[index - 1].value.end, member.value.end, '')
      return splice(member.keyStart, obj.members[1].keyStart, '')
    }
    if (member.value.kind !== 'object') {
      if (op.op === 'delete') return source
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
  if (op.op === 'delete') throw new JsonEditRefused('Refusing to delete the whole file.')
  return bom + fmt(op.value, '', 0) + (text.endsWith(eol) ? eol : '')
}
