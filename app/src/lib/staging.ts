import { useSyncExternalStore } from 'react'

/**
 * The 3D direction (staging.json in the data folder): character looks, place presets and
 * everything else a scene needs in 3D (see docs/scenes.md). The file is also edited by hand, so
 * the app never writes a copy of the whole thing: each change is a small set, delete or rename
 * that the dev server splices into the file on disk, and the server answers with the file as it
 * now is.
 */
export type Direction = Record<string, any>
export type StagingStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'
export type Op =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'delete'; path: string[]; ifEmpty?: boolean } // ifEmpty: only an object with nothing in it
  | { op: 'rename'; path: string[]; to: string } // the key at `path` becomes `to`, in its place
/** The text an edit took out of the file, as the server answers it (see app/server/json-edit.ts). */
type Removed = { text: string; after?: string | null; before?: string | null; breaks?: string }

/** Where the direction lives, for messages (data/ unless the app was started with STORY_DATA). */
export const STAGING_FILE = `${__STORY_DATA__}/staging.json`

let direction: Direction = {}
let status: StagingStatus = 'loading'
let error = ''
let readFailed = false // the file on disk could not be read: no edits until it can
let unreadable = '' // why it could not be read
let pending: Op[] = [] // made here, not sent yet
let inflight: Op[] = [] // sent, not answered yet
let timer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | null = null
let rereadAfterSave = false // the window came back while a save was on its way
let failures = 0 // saves that failed in a row: each try by itself waits longer
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const isObject = (v: unknown): v is Direction => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const readError = () => `${unreadable} Fix it; it is read again when you come back to this tab${pending.length ? ', and the changes not saved yet are saved then' : ''}.`

// An Undo puts back the very text its edit took out of the file (a hand-written entry, its blank
// line, its place among the others), not just the same values: the server's answer to each edit
// says what it took out, and the Undo sends that along (with its last op for that edit).
const undoes = new WeakMap<Op, Op>() // an op of an Undo → the edit it takes back
const took = new WeakMap<Op, Removed>() // an edit → what it last took out of the file
const putsBack = new WeakSet<Op>() // the op of an Undo that puts that text back
const restoreOf = (op: Op) => { const e = putsBack.has(op) ? undoes.get(op) : undefined; return e && took.get(e) }

// Key order as the server keeps it (see spotOf and applyOp in app/server), so the copy here lists
// the entries in the file's order.
const isIndex = (k: string) => /^(?:0|[1-9]\d*)$/.test(k) && Number(k) < 2 ** 32 - 1
function spotOf(keys: string[], key: string, { after, before }: Removed): number {
  if (after === undefined || before === undefined || isIndex(key) || keys.some(isIndex)) return -1
  const at = after === null ? 0 : keys.indexOf(after) + 1
  if (after !== null && !at) return -1
  return (before === null ? at === keys.length : keys[at] === before) ? at : -1
}
function refill(node: Direction, entries: [string, unknown][]) {
  for (const k of Object.keys(node)) delete node[k]
  for (const [k, v] of entries) Object.defineProperty(node, k, { value: v, writable: true, enumerable: true, configurable: true })
}

/** The same edit the server makes, on the copy here (see app/server/json-style.ts). */
function apply(doc: Direction, op: Op): Direction {
  const next = structuredClone(doc)
  let node: any = next
  for (const key of op.path.slice(0, -1)) {
    if (!isObject(node[key])) {
      if (op.op !== 'set' || (Array.isArray(node[key]) && node[key].length)) return next
      node[key] = {}
    }
    node = node[key]
  }
  const last = op.path[op.path.length - 1]
  if (op.op === 'delete') {
    if (!op.ifEmpty || (isObject(node[last]) && !Object.keys(node[last]).length)) delete node[last]
  } else if (op.op === 'rename') {
    if (!Object.hasOwn(node, last) || Object.hasOwn(node, op.to)) return next // nothing to rename, or the name is taken (refused)
    const value = node[last]
    if (isIndex(last) || isIndex(op.to)) { delete node[last]; node[op.to] = value }
    else refill(node, Object.entries(node).map(([k, v]) => [k === last ? op.to : k, v]))
  } else {
    const back = Object.hasOwn(node, last) ? undefined : restoreOf(op)
    const spot = back ? spotOf(Object.keys(node), last, back) : -1
    if (spot < 0) node[last] = op.value
    else { const entries = Object.entries(node); entries.splice(spot, 0, [last, op.value]); refill(node, entries) }
  }
  return next
}

async function failure(res: Response, what: string) {
  const why = (await res.text().catch(() => '')).replace(/^\w*Error: /, '').slice(0, 200)
  return new Error(`${what}${why ? `: ${why}` : ` (${res.status})`}`)
}

export async function loadStaging(): Promise<void> {
  try {
    const res = await fetch('/api/staging')
    let fresh: Direction = {}
    if (res.status !== 204 && res.status !== 404) {
      if (!res.ok) throw await failure(res, `${STAGING_FILE} could not be read`)
      fresh = await res.json()
      if (!isObject(fresh)) throw new Error(`${STAGING_FILE} must hold an object ({ … }).`)
    }
    // Keep the same object when nothing changed, so the 3D views don't restage for nothing.
    for (const op of [...inflight, ...pending]) fresh = apply(fresh, op) // edits still on their way
    if (!same(fresh, direction)) direction = fresh
    status = pending.length || inflight.length ? 'saving' : 'ready'
    readFailed = false
    error = ''
  } catch (e) {
    status = 'error'
    readFailed = true
    unreadable = (e instanceof Error ? e.message : String(e)).replace(/[.\s]*$/, '.')
    error = readError()
  }
  notify()
  if (pending.length) schedule()
}

async function flush(keepalive = false) {
  if (readFailed || status === 'loading' || !pending.length) return
  // An Undo waits for the answer to the edit it takes back, which says what to put back (unless
  // the tab is closing: then everything goes now).
  const held = keepalive ? -1 : pending.findIndex((op, i) => { const e = undoes.get(op); const j = e ? pending.indexOf(e) : -1; return j >= 0 && j < i })
  const ops = held > 0 ? pending.slice(0, held) : pending
  pending = pending.slice(ops.length)
  inflight = ops
  status = 'saving'
  notify()
  let failed = false
  try {
    const body = JSON.stringify({ ops: ops.map((op) => ({ ...op, restore: restoreOf(op) })) })
    const res = await fetch('/api/staging', { method: 'PATCH', body, keepalive })
    if (!res.ok) throw await failure(res, `Saving ${STAGING_FILE} failed`)
    const answer: { doc: Direction; removed?: (Removed | null)[] } = await res.json()
    ops.forEach((op, i) => { const r = answer.removed?.[i]; if (r) took.set(op, r); else took.delete(op) })
    let fresh = answer.doc
    for (const op of pending) fresh = apply(fresh, op) // changes made while saving
    if (!same(fresh, direction)) direction = fresh // an identical answer changes nothing on screen
    status = pending.length ? 'saving' : 'saved'
    error = ''
    failures = 0
  } catch (e) {
    pending = [...ops, ...pending] // sent again with the next change, when you come back, or a little later
    status = 'error'
    error = `${(e instanceof Error ? e.message : String(e)).replace(/[.\s]*$/, '.')} It is tried again by itself.`
    failed = true
  }
  inflight = []
  notify()
  // A failed save is tried again by itself, a little later each time (2 s, 4 s … a minute), and
  // soon if you came back to the tab while it was on its way.
  if (failed) { schedule(rereadAfterSave ? 400 : Math.min(60_000, 2_000 * 2 ** failures++)); rereadAfterSave = false }
  else if (held > 0) schedule(0) // the Undo held back above
  else if (rereadAfterSave && !pending.length && !readFailed) { rereadAfterSave = false; void loadStaging() }
}

function schedule(delay = 400) {
  clearTimeout(timer)
  timer = setTimeout(() => { flushing = (flushing ?? Promise.resolve()).then(() => flush()) }, delay)
}

/** Can the direction be edited now? (Not before it has been read, nor while it can't be.) */
export const canEdit = () => status !== 'loading' && !readFailed

/**
 * Change the direction: a few sets, deletes and renames that land together. Refused (false)
 * until the file has been read, so nothing the app didn't see can be overwritten.
 */
export function edit(ops: Op[]): boolean {
  if (!canEdit() || !ops.length) return false
  for (const op of ops) direction = apply(direction, op)
  pending.push(...ops)
  status = 'saving'
  notify()
  schedule()
  return true
}
/** Set one value in the direction, e.g. setIn(['characters', id, 'body'], 'kid'). */
export const setIn = (path: string[], value: unknown) => edit([{ op: 'set', path, value }])
/** Delete one value from the direction. */
export const deleteIn = (path: string[]) => edit([{ op: 'delete', path }])

/** The edits that take `ops` back, from the direction as it is now (in the order to apply them). */
export function undoOf(ops: Op[]): Op[] {
  let d = direction
  const back: Op[] = []
  for (const op of ops) {
    const us = inverse(d, op)
    for (const u of us) undoes.set(u, op)
    if (us.length) putsBack.add(us[us.length - 1])
    back.unshift(...us)
    d = apply(d, op)
  }
  return back
}

/** The edits that take `op` back on `d` (none when `op` changes nothing there). */
function inverse(d: Direction, op: Op): Op[] {
  let node: Direction = d
  for (let i = 0; i < op.path.length; i++) {
    const key = op.path[i]
    const path = op.path.slice(0, i + 1)
    const has = Object.hasOwn(node, key)
    if (i === op.path.length - 1) {
      if (op.op === 'rename') return has && op.to !== key && !Object.hasOwn(node, op.to) ? [{ op: 'rename', path: [...op.path.slice(0, -1), op.to], to: key }] : []
      return has ? [{ op: 'set', path, value: node[key] }] : op.op === 'set' ? [{ op: 'delete', path }] : []
    }
    if (!isObject(node[key])) {
      if (op.op !== 'set' || (Array.isArray(node[key]) && node[key].length)) return []
      if (has) return [{ op: 'set', path, value: node[key] }] // it replaced a stray value
      // It made the objects on its way: what it set goes, then each object it made, deepest
      // first, if nothing else is in it by then (the writer may have added to it by hand).
      const made: Op[] = []
      for (let j = op.path.length - 1; j > i; j--) made.push({ op: 'delete', path: op.path.slice(0, j), ifEmpty: true })
      return [{ op: 'delete', path: op.path }, ...made]
    }
    node = node[key]
  }
  return []
}

/**
 * Undo or Redo of a 3D edit: an edit that can't be refused. While the file can't be read, it
 * is shown here at once and waits to be saved until the file can be read again.
 */
export function replay(ops: Op[]) {
  if (edit(ops) || !ops.length) return
  for (const op of ops) direction = apply(direction, op)
  pending.push(...ops)
  if (readFailed) error = readError()
  notify()
}

export const getStaging = () => direction
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function useStaging(): Direction {
  return useSyncExternalStore(subscribe, () => direction)
}
export function useStagingStatus(): { status: StagingStatus; error: string; editable: boolean } {
  const s = useSyncExternalStore(subscribe, () => `${status}|${canEdit() ? 1 : 0}|${error}`)
  const [st, ed, ...rest] = s.split('|')
  return { status: st as StagingStatus, editable: ed === '1', error: rest.join('|') }
}

if (typeof window !== 'undefined') {
  // Don't lose the last change when the tab closes; pick up hand edits when coming back.
  window.addEventListener('pagehide', () => { clearTimeout(timer); void flush(true) })
  window.addEventListener('focus', () => {
    if (status === 'saving') { rereadAfterSave = true; return }
    if (status === 'loading') return
    if (readFailed || !pending.length) void loadStaging() // a fixed file, or hand edits
    else schedule() // a save that failed: try again
  })
}
