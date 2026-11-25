import { useSyncExternalStore } from 'react'

/**
 * The 3D direction (staging.json in the data folder): character looks, place presets and
 * everything else a scene needs in 3D (see docs/scenes.md). The file is also edited by hand, so
 * the app never writes a copy of the whole thing: each change is a small set/delete that the dev
 * server splices into the file on disk, and the server answers with the file as it now is.
 */
export type Direction = Record<string, any>
export type StagingStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'
export type Op = { op: 'set'; path: string[]; value: unknown } | { op: 'delete'; path: string[] }

/** Where the direction lives, for messages (data/ unless the app was started with STORY_DATA). */
export const STAGING_FILE = `${__STORY_DATA__}/staging.json`

let direction: Direction = {}
let status: StagingStatus = 'loading'
let error = ''
let readFailed = false // the file on disk could not be read: no edits until it can
let pending: Op[] = [] // made here, not sent yet
let inflight: Op[] = [] // sent, not answered yet
let timer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | null = null
let rereadAfterSave = false // the window came back while a save was on its way
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const isObject = (v: unknown): v is Direction => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The same edit the server makes, on the copy here (see app/server/json-style.ts). */
function apply(doc: Direction, op: Op): Direction {
  const next = structuredClone(doc)
  let node: any = next
  for (const key of op.path.slice(0, -1)) {
    if (!isObject(node[key])) {
      if (op.op === 'delete' || (Array.isArray(node[key]) && node[key].length)) return next
      node[key] = {}
    }
    node = node[key]
  }
  const last = op.path[op.path.length - 1]
  if (op.op === 'set') node[last] = op.value
  else delete node[last]
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
    error = `${(e instanceof Error ? e.message : String(e)).replace(/[.\s]*$/, '.')} Fix it; it is read again when you come back to this tab.`
  }
  notify()
  if (pending.length) schedule()
}

async function flush(keepalive = false) {
  if (readFailed || status === 'loading' || !pending.length) return
  const ops = pending
  pending = []
  inflight = ops
  status = 'saving'
  notify()
  try {
    const res = await fetch('/api/staging', { method: 'PATCH', body: JSON.stringify({ ops }), keepalive })
    if (!res.ok) throw await failure(res, `Saving ${STAGING_FILE} failed`)
    let fresh: Direction = await res.json()
    for (const op of pending) fresh = apply(fresh, op) // changes made while saving
    if (!same(fresh, direction)) direction = fresh // an identical answer changes nothing on screen
    status = pending.length ? 'saving' : 'saved'
    error = ''
  } catch (e) {
    pending = [...ops, ...pending] // sent again with the next change, or when you come back
    status = 'error'
    error = e instanceof Error ? e.message : String(e)
  }
  inflight = []
  notify()
  if (rereadAfterSave && !pending.length && !readFailed) { rereadAfterSave = false; void loadStaging() }
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => { flushing = (flushing ?? Promise.resolve()).then(() => flush()) }, 400)
}

/** Can the direction be edited now? (Not before it has been read, nor while it can't be.) */
export const canEdit = () => status !== 'loading' && !readFailed

/**
 * Change the direction: a few sets and deletes that land together. Refused (false) until the
 * file has been read, so nothing the app didn't see can be overwritten.
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
