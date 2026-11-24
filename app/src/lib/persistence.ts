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
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not load data/world.json (${res.status})`)
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
  const stop = editor.store.listen(() => {
    clearTimeout(timer)
    onState('saving')
    timer = setTimeout(save, 600)
  }, { scope: 'document' })
  return () => { clearTimeout(timer); stop() }
}
