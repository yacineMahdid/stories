import type { Editor } from 'tldraw'
import type { SceneShape } from '../shapes/types'
import type { WorldView } from '../three/bridge.js'
import { uploadFile } from './persistence'
import { resizeKeepingOrder } from './structure'

/**
 * A page's 3D still on its card, so the Story canvas reads like a storyboard: the inspector's
 * "Put this shot on the card", and the picture of a locked page (Lock, Retake picture). Rendering
 * and uploading come first, then the card changes in one go: the caller decides its undo step (a
 * lock makes it part of the same step as the direction it writes).
 */

/** A PNG file to upload, named after what it shows. */
export function fileFrom(blob: Blob, name: string) {
  return new File([blob], name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() + '.png', { type: 'image/png' })
}

/** Render a 960×540 still of the view (as the camera sees it now, or of shot `shot`) and upload it: its URL. */
export async function takeStill(view: WorldView, title: string, opts: { shot?: number | null } = {}): Promise<string> {
  const blob = await view.still(960, 540, opts)
  return uploadFile(fileFrom(blob, `${title || 'page'}-still`))
}

/**
 * Put a still on a page card. The card grows to make room for the picture; what sits below it
 * moves down so the reading order stays, and the card remembers by how much it grew, so removing
 * the still gives it back. No stopping point: one undo step with whatever came just before it.
 */
export function putStill(editor: Editor, id: SceneShape['id'], url: string): boolean {
  const current = editor.getShape(id) as SceneShape | undefined
  if (!current) return false
  const want = Math.max(current.props.h, Math.round(current.props.w * 9 / 16 * 0.92) + 250)
  const grown = Number(current.meta?.stillGrow ?? 0) + (want - current.props.h)
  editor.run(() => {
    editor.updateShape({ id, type: 'scene', props: { still: url }, meta: { ...current.meta, stillGrow: grown } })
    resizeKeepingOrder(editor, editor.getShape(id) as SceneShape, want)
  })
  return true
}

/** Take the still off a page card, giving back what the card grew for it. No stopping point. */
export function removeStill(editor: Editor, id: SceneShape['id']) {
  const current = editor.getShape(id) as SceneShape | undefined
  if (!current) return
  const grown = Number(current.meta?.stillGrow ?? 0)
  editor.run(() => {
    editor.updateShape({ id, type: 'scene', props: { still: '' }, meta: { ...current.meta, stillGrow: 0 } })
    if (grown > 0) resizeKeepingOrder(editor, editor.getShape(id) as SceneShape, Math.max(260, current.props.h - grown))
  })
}
