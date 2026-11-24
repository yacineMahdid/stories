import { useSyncExternalStore } from 'react'

/**
 * The 3D direction (data/staging.json): character looks, place presets and everything else a
 * scene needs in 3D (see docs/scenes.md). Shared by the whole app and saved like the canvas.
 */
export type Direction = Record<string, any>

let direction: Direction = { version: 1 }
let loaded = false
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

export async function loadStaging(): Promise<Direction> {
  try {
    const res = await fetch('/api/staging')
    if (res.ok) direction = await res.json()
  } catch { /* no staging yet: everything is automatic */ }
  loaded = true
  listeners.forEach((l) => l())
  return direction
}

export function getStaging() { return direction }

/** Change the direction (immutably) and save it a moment later. */
export function updateStaging(change: (d: Direction) => Direction) {
  direction = change(direction)
  listeners.forEach((l) => l())
  clearTimeout(timer)
  timer = setTimeout(() => {
    fetch('/api/staging', { method: 'PUT', body: JSON.stringify(direction) }).catch((e) => console.error('Could not save data/staging.json', e))
  }, 600)
}

export function useStaging(): Direction {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => direction)
}

export const stagingLoaded = () => loaded
