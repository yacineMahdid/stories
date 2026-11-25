import type { Editor, TLDocument } from 'tldraw'
import { edit, replay, undoOf, type Op } from './staging'

/**
 * Undo and Redo for the edits made in the inspector and its 3D panels.
 *
 * One Undo per edit: a change to another field or card, or after a pause, starts a new undo
 * step (typing a word in one field is one step, not one per letter, and not lumped with
 * everything since the last click on the canvas). Fields of the cards and of the 3D panels
 * follow the same rule, so a card's field and a 3D field never share a step, except a rename
 * and the look, place or page direction it takes along.
 *
 * The 3D direction lives in staging.json, outside the canvas, so tldraw's history can't see it.
 * Each 3D step is therefore also a small change to the canvas document's metadata: "before step
 * n" (written quietly), then "after step n" (the part of the undo step tldraw sees). The step's
 * own sets and deletes are kept here, both ways round. When Undo or Redo puts back "before n" or
 * "after n", step n's edits are applied to staging.json: the paths it touched, nothing else.
 */
const KEY = 'staging3d'
type Mark = { step: string; side: 'before' | 'after' }
const steps = new Map<string, { undo: Op[]; redo: Op[] }>()
const session = Math.random().toString(36).slice(2, 8) // a mark saved by an earlier visit matches no step
let count = 0
let last = { key: '', at: 0 }
let current: string | null = null // the 3D part of the current undo step
let own = false // our own writes of the mark, not Undo or Redo

const markOf = (doc: TLDocument): Mark | null => {
  const m = doc.meta?.[KEY] as Partial<Mark> | undefined
  return m && typeof m.step === 'string' && (m.side === 'before' || m.side === 'after') ? (m as Mark) : null
}
const put = (editor: Editor, mark: Mark) => {
  const doc = editor.getDocumentSettings()
  editor.store.put([{ ...doc, meta: { ...doc.meta, [KEY]: mark } } as TLDocument])
}
/** Is path `a` the same as `b`, or inside it? */
const within = (a: string[], b: string[]) => b.length <= a.length && b.every((k, i) => a[i] === k)
/** Does `o` write everything at `path`? (A rename moves an entry; it doesn't write what is in it.) */
const covers = (o: Op, path: string[]) => o.op !== 'rename' && within(path, o.path)

/**
 * Starts a new undo step for an edit of `key` (a field of a card, e.g. "shape:mira|name"),
 * unless it goes on with the same field within a moment. After an Undo, it always starts one.
 */
export function startEdit(editor: Editor, key: string) {
  const now = Date.now()
  if (key !== last.key || now - last.at > 1500 || editor.getCanRedo()) {
    editor.markHistoryStoppingPoint(key)
    current = null
  }
  last = { key, at: now }
}

/**
 * Change the 3D direction as an undoable edit of `key` (see startEdit; by default, of the paths
 * it changes). False when it can't be edited now.
 */
export function edit3d(editor: Editor, ops: Op[], key = ops.map((o) => o.path.join('›')).join('|')): boolean {
  if (!ops.length) return false
  const undo = undoOf(ops)
  if (!edit(ops)) return false
  startEdit(editor, key)
  const step = current ? steps.get(current) : undefined
  if (step) {
    // The same field again: still the same step. Its first values are the ones Undo brings back.
    step.undo = [...undo.filter((u) => !step.undo.some((o) => covers(o, u.path))), ...step.undo]
    step.redo = [...step.redo.filter((r) => !ops.some((o) => covers(o, r.path))), ...ops]
    return true
  }
  const id = `${session}-${++count}`
  steps.set(id, { undo, redo: ops })
  current = id
  own = true
  try {
    editor.run(() => put(editor, { step: id, side: 'before' }), { history: 'ignore' })
    editor.run(() => put(editor, { step: id, side: 'after' })) // recorded: part of the undo step
  } finally {
    own = false
  }
  return true
}

/** Apply Undo and Redo of 3D edits to staging.json. Returns a function that stops it. */
export function attachStagingHistory(editor: Editor) {
  return editor.sideEffects.registerAfterChangeHandler('document', (from, to) => {
    if (own) return
    const mark = markOf(to)
    const was = markOf(from)
    if (!mark || (was?.step === mark.step && was.side === mark.side)) return
    last = { key: '', at: 0 } // the next edit starts a step of its own
    current = null
    const step = steps.get(mark.step)
    if (step) replay(mark.side === 'before' ? step.undo : step.redo)
  })
}
