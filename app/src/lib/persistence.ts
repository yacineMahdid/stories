import { getSnapshot, type Editor, type TLAssetStore } from 'tldraw'

/** Images dropped on any canvas (portraits, map backgrounds, references) are written to data/assets. */
export const assetStore: TLAssetStore = {
  async upload(_asset, file) {
    return { src: await uploadFile(file) }
  },
}

export async function uploadFile(file: File): Promise<string> {
  const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
  if (!res.ok) throw new Error('Upload failed')
  return (await res.json()).src
}

export async function loadWorld(): Promise<any | null> {
  const res = await fetch('/api/world')
  if (res.status === 204 || res.status === 404) return null // no world yet
  if (!res.ok) throw new Error(`Could not load ${__STORY_DATA__}/world.json (${res.status})`)
  return res.json()
}

export type SaveState = 'saved' | 'saving' | 'error'

/** Autosave the document (not per-user camera/selection state) to data/world.json. */
export function startAutosave(editor: Editor, onState: (s: SaveState) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = async () => {
    onState('saving')
    try {
      const { document } = getSnapshot(editor.store)
      const res = await fetch('/api/world', { method: 'PUT', body: JSON.stringify({ document }, null, 1) })
      onState(res.ok ? 'saved' : 'error')
    } catch {
      onState('error')
    }
  }
  let dirty = false
  const stop = editor.store.listen(() => {
    clearTimeout(timer)
    dirty = true
    onState('saving')
    timer = setTimeout(() => { dirty = false; void save() }, 600)
  }, { scope: 'document' })
  // The last change before the tab is hidden or closed is sent at once, not lost with the timer.
  const now = (keepalive: boolean) => {
    if (!dirty) return
    clearTimeout(timer)
    dirty = false
    const body = JSON.stringify({ document: getSnapshot(editor.store).document }, null, 1)
    void fetch('/api/world', { method: 'PUT', body, keepalive: keepalive && body.length < 60_000 }).then((res) => onState(res.ok ? 'saved' : 'error'), () => onState('error'))
  }
  const onHide = () => { if (document.visibilityState === 'hidden') now(false) }
  const onPageHide = () => now(true)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onPageHide)
  return () => {
    clearTimeout(timer)
    stop()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onPageHide)
  }
}
