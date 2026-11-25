import { useSyncExternalStore } from 'react'

/**
 * The 3D direction (data/staging.json): character looks, place presets and everything else a
 * scene needs in 3D (see docs/scenes.md). The file is also edited by hand, so the app never
 * writes a copy of the whole thing: each change is a small set/delete applied to the file on
 * disk, and the server answers with the file as it now is.
 */
export type Direction = Record<string, any>
export type StagingStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'
type Op = { op: 'set'; path: string[]; value: unknown } | { op: 'delete'; path: string[] }

let direction: Direction = {}
let status: StagingStatus = 'loading'
let error = ''
let readFailed = false // the file on disk could not be read: never save over it
let pending: Op[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function apply(doc: Direction, op: Op): Direction {
  const next = structuredClone(doc)
  let node: any = next
  for (const key of op.path.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) {
      if (op.op === 'delete') return next
      node[key] = {}
    }
    node = node[key]
  }
  const last = op.path[op.path.length - 1]
  if (op.op === 'set') node[last] = op.value
  else delete node[last]
  return next
}

export async function loadStaging(): Promise<void> {
  try {
    const res = await fetch('/api/staging')
    let fresh: Direction
    if (res.status === 404) fresh = {}
    else if (!res.ok) throw new Error(`data/staging.json could not be read (${res.status}). Fix the file, then reload.`)
    else fresh = await res.json()
    // Keep the same object when nothing changed, so the 3D views don't restage for nothing.
    if (JSON.stringify(fresh) !== JSON.stringify(direction)) direction = fresh
    // Edits made while loading are kept and saved on top.
    for (const op of pending) direction = apply(direction, op)
    status = 'ready'
    readFailed = false
  } catch (e) {
    status = 'error'
    readFailed = true
    error = e instanceof Error ? e.message : String(e)
  }
  notify()
  if (pending.length) schedule()
}

async function flush(keepalive = false) {
  if (readFailed || status === 'loading' || !pending.length) return
  const ops = pending
  pending = []
  status = 'saving'
  notify()
  try {
    const res = await fetch('/api/staging', { method: 'PATCH', body: JSON.stringify({ ops }), keepalive })
    if (!res.ok) throw new Error(`Saving data/staging.json failed (${res.status}).`)
    let fresh: Direction = await res.json()
    for (const op of pending) fresh = apply(fresh, op) // changes made while saving
    direction = fresh
    status = pending.length ? 'saving' : 'saved'
  } catch (e) {
    pending = [...ops, ...pending] // try again with the next change
    status = 'error'
    error = e instanceof Error ? e.message : String(e)
  }
  notify()
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => { flushing = (flushing ?? Promise.resolve()).then(() => flush()) }, 400)
}

function change(op: Op) {
  direction = apply(direction, op)
  pending.push(op)
  if (readFailed) { notify(); return }
  if (status === 'error') status = 'saving' // a failed save is retried with this change
  notify()
  schedule()
}

/** Set one value in the direction, e.g. setIn(['characters', id], look). */
export const setIn = (path: string[], value: unknown) => change({ op: 'set', path, value })
/** Delete one value from the direction. */
export const deleteIn = (path: string[]) => change({ op: 'delete', path })

export const getStaging = () => direction
export function useStaging(): Direction {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => direction)
}
export function useStagingStatus(): { status: StagingStatus; error: string } {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => `${status}|${error}`)
  const [st, ...rest] = s.split('|')
  return { status: st as StagingStatus, error: rest.join('|') }
}

if (typeof window !== 'undefined') {
  // Don't lose the last change when the tab closes; pick up hand edits when coming back.
  window.addEventListener('pagehide', () => { clearTimeout(timer); flush(true) })
  window.addEventListener('focus', () => { if (!pending.length && status !== 'loading' && status !== 'saving') void loadStaging() })
}
