import type { Editor, TLDocument } from 'tldraw'
import { edit, getStaging, type Op } from './staging'

/**
 * Undo and Redo for 3D edits, on the canvas's own undo stack.
 *
 * The 3D direction lives in staging.json, outside the canvas, so tldraw's history can't see it.
 * Each edit made in the app therefore also writes the values it touched into the canvas
 * document's metadata, as an undo step of its own: first what they were (quietly), then what
 * they are now. When Undo or Redo changes those values back, the change is applied to
 * staging.json, so one Undo takes back the last thing you did, 3D or not.
 */
const KEY = 'staging3d'
type Mirror = Record<string, { v?: unknown; gone?: true }>
let own = false

const keyOf = (path: string[]) => JSON.stringify(path)
const valueAt = (d: unknown, path: string[]) =>
  path.reduce<unknown>((n, k) => (n && typeof n === 'object' && !Array.isArray(n) ? (n as Record<string, unknown>)[k] : undefined), d)
const mirrorOf = (doc: TLDocument): Mirror => ({ ...((doc.meta?.[KEY] as Mirror | undefined) ?? {}) })
const put = (editor: Editor, mirror: Mirror) => {
  const doc = editor.getDocumentSettings()
  editor.store.put([{ ...doc, meta: { ...doc.meta, [KEY]: mirror } } as TLDocument])
}

/** Change the 3D direction as an undoable step. False when it can't be edited now. */
export function edit3d(editor: Editor, ops: Op[]): boolean {
  if (!ops.length) return false
  const before = ops.map((op) => [keyOf(op.path), valueAt(getStaging(), op.path)] as const)
  if (!edit(ops)) return false
  const mirror = mirrorOf(editor.getDocumentSettings())
  for (const [k, v] of before) mirror[k] = v === undefined ? { gone: true } : { v }
  own = true
  try {
    editor.run(() => put(editor, { ...mirror }), { history: 'ignore' }) // what it was, quietly
    editor.markHistoryStoppingPoint('3d edit')
    for (const op of ops) mirror[keyOf(op.path)] = op.op === 'set' ? { v: op.value } : { gone: true }
    editor.run(() => put(editor, mirror)) // what it is now: the undo step
  } finally {
    own = false
  }
  return true
}

/** Apply Undo and Redo of 3D edits to staging.json. Returns a function that stops it. */
export function attachStagingHistory(editor: Editor) {
  return editor.store.listen((entry) => {
    if (own) return
    for (const [from, to] of Object.values(entry.changes.updated)) {
      if (to.typeName !== 'document') continue
      const a = mirrorOf(from as TLDocument), b = mirrorOf(to as TLDocument)
      const ops: Op[] = []
      for (const k of Object.keys(b)) {
        if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue
        const path = JSON.parse(k) as string[]
        ops.push(b[k].gone ? { op: 'delete', path } : { op: 'set', path, value: b[k].v })
      }
      if (ops.length) edit(ops)
    }
  }, { scope: 'document' })
}
