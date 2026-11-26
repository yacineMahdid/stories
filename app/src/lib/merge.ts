/**
 * A list the app writes whole (a page's "cast", "camera", "dressing" or "feedback") may have changed
 * in the file since the app last read it: edited by hand, or by Claude answering a note while the
 * app is open. Each such write carries the value it was made from (its "expect"); when the file
 * holds something else by the time the write lands, the write is merged into what the file holds
 * instead of replacing it. The dev server does this on disk (app/server/json-style.ts), and the app
 * does the same on its own copy (app/src/lib/staging.ts). No React, tldraw or node in here.
 */

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
/** What tells the entries of a list apart: their thing id, cast member, note date or shot label. */
const KEYS = ['id', 'who', 'added', 'label']
const keyOf = (v: unknown) => {
  if (isPlain(v)) for (const k of KEYS) if (typeof v[k] === 'string' && v[k]) return `${k}\u0000${v[k]}`
  return `=${JSON.stringify(v)}`
}
const unique = (keys: string[]) => new Set(keys).size === keys.length

/**
 * `mine` is what an edit wants, made from `base`; the file has `theirs`. What `mine` changes from
 * `base` is made on `theirs`: entries of a list are matched by their id, who, added or label (else
 * by their place), objects field by field, so an entry or field changed only in the file keeps that
 * change. Where both changed the same field, `mine` wins. Undefined is "not there" (a delete).
 */
export function merge3(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (same(base, theirs)) return mine
  if (same(base, mine) || same(mine, theirs)) return theirs
  if (isPlain(mine) && isPlain(theirs)) {
    const b = isPlain(base) ? base : {}
    const out: Record<string, unknown> = {}
    const keys = [...Object.keys(theirs), ...Object.keys(mine).filter((k) => !Object.hasOwn(theirs, k))]
    for (const k of keys) {
      const v = merge3(Object.hasOwn(b, k) ? b[k] : undefined, Object.hasOwn(mine, k) ? mine[k] : undefined, theirs[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }
  // Lists of entries (objects), not lists of numbers or names (a point, a path): those are one value.
  const entries = (v: unknown) => (v === undefined ? [] : Array.isArray(v) && v.every(isPlain) ? v : null)
  const B = entries(base), M = entries(mine), T = entries(theirs)
  if (B && M && T && (Array.isArray(mine) || Array.isArray(theirs))) {
    const out = mergeLists(B, M, T)
    return out.length || mine !== undefined ? out : undefined
  }
  return mine
}

function mergeLists(B: unknown[], M: unknown[], T: unknown[]): unknown[] {
  const kb = B.map(keyOf), km = M.map(keyOf), kt = T.map(keyOf)
  if (![kb, km, kt].every(unique)) {
    // Nothing tells the entries apart: by their place when the lists are as long, else mine.
    return B.length === M.length && M.length === T.length ? M.map((m, i) => merge3(B[i], m, T[i])) : M
  }
  const inBase = new Map(kb.map((k, i) => [k, B[i]]))
  const inMine = new Map(km.map((k, i) => [k, M[i]]))
  const out: [string, unknown][] = []
  T.forEach((t, i) => {
    const k = kt[i]
    if (inMine.has(k)) out.push([k, inBase.has(k) ? merge3(inBase.get(k), inMine.get(k), t) : inMine.get(k)])
    else if (!inBase.has(k)) out.push([k, t]) // added in the file
    // else: the edit took it out
  })
  M.forEach((m, i) => {
    const k = km[i]
    if (inBase.has(k) || kt.includes(k)) return // there already, or taken out in the file
    // Added by the edit: after the entry it follows in the edit's list.
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const p = out.findIndex(([x]) => x === km[j])
      if (p >= 0) { at = p + 1; break }
    }
    out.splice(at, 0, [k, m])
  })
  return out.map(([, v]) => v)
}

/** The value at `path` in a document (undefined: not there). */
export function valueAt(doc: unknown, path: string[]): unknown {
  let v = doc
  for (const k of path) {
    if (!isPlain(v) || !Object.hasOwn(v, k)) return undefined
    v = v[k]
  }
  return v
}

/**
 * A set or delete of a whole list, made when the file held `expect` there (null: nothing), as it
 * lands on `doc`: unchanged (null) when `doc` still holds that, else the set or delete that merges
 * it into what `doc` holds now (see merge3).
 */
export function rebase(doc: unknown, op: { op: string; path: string[]; value?: unknown }, expect: unknown): { op: 'set'; path: string[]; value: unknown } | { op: 'delete'; path: string[] } | null {
  if (op.op !== 'set' && op.op !== 'delete') return null
  const now = valueAt(doc, op.path) ?? null
  if (same(now, expect ?? null)) return null
  const value = merge3(expect ?? undefined, op.op === 'set' ? op.value : undefined, now ?? undefined)
  return value === undefined ? { op: 'delete', path: op.path } : { op: 'set', path: op.path, value }
}
