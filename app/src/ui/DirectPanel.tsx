import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useValue, type Editor } from 'tldraw'
import type { SceneShape } from '../shapes/types'
import { directOptions, weathers, type CastInfo, type Picked, type StageState, type WorldView } from '../three/bridge.js'
import { getStaging, STAGING_FILE, useStaging, useStagingStatus } from '../lib/staging'
import { edit3d } from '../lib/staging-history'
import { getCharacters } from '../lib/world'
import {
  castOps, castToEdit, dressingOps, facingChoice, heldChoice, memberIndex, momentHint, momentOps, movedFields, newMember, newThing, newThingId,
  ownDressing, refersTo, sceneEntry, sceneKey, slugOf, stepKey, withMember, withoutMember, wordsOf, yawToward, type CastEntry, type Listed, type MomentField,
} from '../lib/direct'

/*
 * Direct mode of the full 3D stage: select and drag the cast and the page's props in 3D, and the
 * Direction panel. Every edit goes through DirectEdits (one place that reads the stage and the file
 * and builds the ops, with app/src/lib/direct.ts), and is one Undo (edit3d).
 *
 * The panel, top to bottom: 1 header (page, Undo/Redo; the lock goes there too), 2 cast,
 * 3 selected character, 4 props on this page, 5 moment, then 6 camera and 7 notes for Claude
 * (see the spot marked below); 8, the lock, shows in the header.
 */

const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const fmtHour = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`
const HELD = directOptions.held.map((h) => h.id)
const KIND_LABEL = new Map(directOptions.props.flatMap((g) => g.kinds.map((k) => [k.id, k.label] as const)))
const kindLabel = (kind: string) => KIND_LABEL.get(kind) ?? wordsOf(kind)

/* ───────────── the edits ───────────── */

export interface DirectContext {
  /** The page on stage now (what the panel shows), or null. */
  page(): { id: string; title: string } | null
  /** The canvas changed (a page's Who): show it on stage now, not after the canvas settles. */
  canvasChanged(): void
}

/**
 * Every edit Direct mode makes, as one undo step each (edit3d; nudges and drags of the same field
 * within a moment merge). Each reads the file and the stage when it runs: the page's entry key, its
 * own lists, and the cast as the stage shows it for a copy on write. An edit asked for while the
 * stage is re-staging waits for it (the models are being rebuilt then), and they run in order.
 */
export function createDirectEdits(editor: Editor, view: WorldView, ctx: DirectContext) {
  let closed = false
  let queue: Promise<void> = Promise.resolve()
  let waiting = 0
  const run = (fn: () => void) => {
    if (closed) return
    if (!waiting && !view.pending) return fn()
    waiting++
    queue = queue.then(() => view.idle()).then(() => { waiting--; if (!closed) fn() }, () => { waiting-- })
  }

  // A slider writes once it rests (or before anything else is edited), not at every step.
  let pending: { key: string; fn: () => void; timer: ReturnType<typeof setTimeout> } | null = null
  const flush = () => {
    const p = pending
    if (!p) return
    pending = null
    clearTimeout(p.timer)
    p.fn()
  }
  const later = (key: string, fn: () => void, ms = 300) => {
    if (pending && pending.key !== key) flush()
    if (pending) clearTimeout(pending.timer)
    pending = { key, fn, timer: setTimeout(flush, ms) }
  }
  /** Where the page is written: its entry key and its entry, as the file has them now. */
  type Target = { page: { id: string; title: string }; key: string; entry: Record<string, any> }
  /**
   * Run an edit of the page on stage: after any slider write waiting, and after a re-stage in
   * flight. It belongs to that page: when the stage has gone on to another page by then, it is
   * dropped (it would read the other page's cast).
   */
  const now = (fn: (t: Target) => void) => {
    flush()
    const page = ctx.page()
    if (!page) return
    run(() => {
      if (ctx.page()?.id !== page.id) return
      const d = getStaging()
      fn({ page, key: sceneKey(d, page.id, page.title), entry: sceneEntry(d, page.id, page.title) })
    })
  }
  const sceneShape = (id: string) => editor.getShape(id as SceneShape['id']) as SceneShape | undefined
  const nameOf = (who: string) => getCharacters(editor).find((c) => c.id === who)?.props.name ?? view.castInfo().find((c) => c.who === who)?.name ?? ''
  /** The characters the page lists on the canvas (that still exist). */
  const listed = (pageId: string): Listed[] => {
    const all = getCharacters(editor)
    return (sceneShape(pageId)?.props.characterIds ?? []).flatMap((id) => {
      const c = all.find((x) => x.id === id)
      return c ? [{ id: c.id, name: c.props.name }] : []
    })
  }
  /** The cast an edit starts from: the page's own, or a copy of the stage's (copy on write). */
  const castBase = (t: Target) => castToEdit(t.entry.cast, view.castMarks(), listed(t.page.id))
  const writeCast = (t: Target, list: CastEntry[], ...step: string[]) => edit3d(editor, castOps(t.key, list), stepKey(t.page.id, 'cast', ...step))
  const setWho = (pageId: string, ids: string[]) => {
    const s = sceneShape(pageId)
    if (s) editor.updateShape({ id: s.id, type: 'scene', props: { characterIds: ids } })
  }

  const api = {
    flush,
    later,
    /** The stage closes: a slider's edit still waiting is saved; nothing after it. */
    close() { flush(); closed = true },

    /** Change fields of a cast member's entry (undefined deletes one); `field` names the undo step. */
    member(who: string, patch: Partial<CastEntry>, field: string) {
      now((t) => { writeCast(t, withMember(castBase(t), who, nameOf(who), patch), who, field) })
    },

    /** Write where a cast member stands or faces on stage now (after a drag, a nudge, Q or E). */
    moved(who: string, what: 'at' | 'facing') {
      now((t) => {
        const name = nameOf(who)
        const base = castBase(t)
        const mark = view.castMarks().find((m) => refersTo(m.who, who, name))
        const entry = base[memberIndex(base, who, name)]
        const patch = movedFields(entry, mark, what)
        // Moved off a spot (which faced them), they keep facing the way they do.
        if (what === 'at' && entry && entry.facing === undefined && mark?.facing !== undefined && !entry.path) patch.facing = mark.facing
        if (Object.keys(patch).length) writeCast(t, withMember(base, who, name, patch), who, what)
      })
    },

    /** Move a cast member's live model by the view (arrows), then write it. */
    nudge(kind: 'cast' | 'thing', id: string, right: number, away: number) {
      now(() => {
        if (!view.nudge(kind, id, right, away)) return
        if (kind === 'cast') api.moved(id, 'at')
        else api.propMoved(id, 'at')
      })
    },
    /** Turn by `deg` (Q and E), then write it. */
    turn(kind: 'cast' | 'thing', id: string, deg: number) {
      now(() => {
        if (kind === 'cast' && view.castInfo().find((c) => c.who === id)?.walker) return // a walker faces the way it walks
        if (!view.turn(kind, id, deg)) return
        if (kind === 'cast') api.moved(id, 'facing')
        else api.propMoved(id, 'facing')
      })
    },

    /** Put a canvas character on stage near the middle of the view, facing the camera, and on the page's Who: one undo step. */
    putIn(who: string, then?: () => void) {
      now((t) => {
        const spot = view.freeMark()
        if (!spot) return
        if (!writeCast(t, withMember(castBase(t), who, nameOf(who), newMember(who, spot.at, spot.facing)), who, 'put in')) return
        // The same undo step: no stopping point between the two.
        const ids = sceneShape(t.page.id)?.props.characterIds ?? []
        if (!ids.includes(who)) setWho(t.page.id, [...ids, who])
        ctx.canvasChanged()
        then?.()
      })
    },

    /** Take a cast member out of the page and off its Who (their page modifier stays): one undo step. */
    takeOut(who: string, then?: () => void) {
      now((t) => {
        if (!writeCast(t, withoutMember(castBase(t), who, nameOf(who)), who, 'take out')) return
        const ids = sceneShape(t.page.id)?.props.characterIds ?? []
        if (ids.includes(who)) setWho(t.page.id, ids.filter((x) => x !== who))
        ctx.canvasChanged()
        then?.()
      })
    },

    /** Add a prop to the page's dressing at the middle of the view, facing the camera. `then` gets its id. */
    addProp(kind: string, then?: (id: string) => void) {
      now((t) => {
        const c = view.centerMark()
        if (!c) return
        const id = newThingId(slugOf(t.page.title, t.page.id), kind, view.thingIds())
        if (edit3d(editor, dressingOps(t.key, [...ownDressing(t.entry), newThing(id, kind, c.at, c.facing)]), stepKey(t.page.id, 'dressing', id, 'add'))) then?.(id)
      })
    },

    /** Write where one of the page's props stands or faces on stage now. */
    propMoved(id: string, what: 'at' | 'facing') {
      now((t) => {
        const mark = view.thingMark(id)
        if (!mark) return
        const list = ownDressing(t.entry)
        if (!list[mark.index]) return
        list[mark.index] = mark.entry
        edit3d(editor, dressingOps(t.key, list), stepKey(t.page.id, 'dressing', id, what))
      })
    },

    /** Remove one of the page's props. */
    removeProp(id: string, then?: () => void) {
      now((t) => {
        const mark = view.thingMark(id)
        if (!mark) return
        const list = ownDressing(t.entry)
        if (!list[mark.index]) return
        list.splice(mark.index, 1)
        if (edit3d(editor, dressingOps(t.key, list), stepKey(t.page.id, 'dressing', id, 'remove'))) then?.()
      })
    },

    /** Save the hour (`time`), weather or season on the page; undefined resets it (deletes the key). */
    moment(field: MomentField, value: number | string | undefined) {
      now((t) => { edit3d(editor, momentOps(t.key, field, value), stepKey(t.page.id, field)) })
    },
  }
  return api
}
export type DirectEdits = ReturnType<typeof createDirectEdits>

/* ───────────── selecting and dragging in 3D ───────────── */

/** How far (px) a press may move and still be a click. */
const CLICK_PX = 3

/**
 * Pointer handling while directing, in the capture phase on the view, so a press on someone or a
 * prop of this page turns the orbit controls off before they see it. A press that moves more than
 * a few pixels drags (Shift or Alt: turns to face the pointer); less is a click, which selects (on
 * nothing: deselects). An empty-space drag still orbits. Nothing starts while a re-stage runs.
 */
export function useDirectPointer(view: WorldView, on: boolean, opts: {
  canStage: () => boolean
  select: (p: Picked | null) => void
  moved: (p: Picked, what: 'at' | 'facing') => void
}) {
  const ref = useRef(opts)
  ref.current = opts
  useEffect(() => {
    if (!on) return
    const el = view.el
    type Drag = {
      pointerId: number; x0: number; y0: number; hit: Picked | null; ignored: boolean
      took: boolean; started: boolean; changed: boolean; turn: boolean
      from: [number, number]; grab: [number, number]
    }
    let drag: Drag | null = null
    let frame = 0
    let hover: [number, number] | null = null
    const cursor = (c: string) => { if (el.style.cursor !== c) el.style.cursor = c }

    /** Where the thing grabbed stands (world), and the grab offset from the ground under the pointer. */
    const grip = (hit: Picked, x: number, y: number) => {
      let at: [number, number] | null = null, mark: [number, number] | null = null, walker = false
      if (hit.kind === 'cast') {
        const info = view.castInfo().find((c) => c.who === hit.id)
        if (info?.pos && info.at) {
          at = [info.pos[0], info.pos[2]]
          // A walker is somewhere along its path: what moves is its mark (where the path is).
          walker = info.walker
          mark = walker ? view.fromLocal(info.at) : at
        }
      } else {
        const t = view.thingMark(hit.id)
        if (t) at = mark = [t.pos[0], t.pos[2]]
      }
      if (!at || !mark) return null
      const g = view.groundPoint(x, y)
      return { from: at, grab: (g ? [mark[0] - g.x, mark[1] - g.z] : [0, 0]) as [number, number], walker }
    }

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || drag) return
      const ignored = view.pending // don't fight a re-stage in flight
      const hit = ignored ? null : view.pick(e.clientX, e.clientY)
      drag = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, hit, ignored, took: false, started: false, changed: false, turn: e.shiftKey || e.altKey, from: [0, 0], grab: [0, 0] }
      if (!hit || !ref.current.canStage()) return // a click selects; a drag orbits
      const g = grip(hit, e.clientX, e.clientY)
      if (!g) return
      // A walker faces the way it walks: Shift+drag moves it too.
      Object.assign(drag, { from: g.from, grab: g.grab, took: true, turn: drag.turn && !g.walker })
      view.controls.enabled = false // before the orbit controls see this press
      el.setPointerCapture(e.pointerId)
      // No preventDefault: the press still takes the focus off a field of the panel, so the keys
      // act on what was just picked.
    }

    const move = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.pointerId) {
        if (!drag.took) return
        if (!drag.started && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) <= CLICK_PX) return
        drag.started = true
        cursor('grabbing')
        const g = view.groundPoint(e.clientX, e.clientY)
        const { hit } = drag
        if (!g || !hit) return
        if (drag.turn) {
          const yaw = yawToward(drag.from, [g.x, g.z])
          drag.changed = (hit.kind === 'cast' ? view.turnCast(hit.id, yaw) : view.turnThing(hit.id, yaw)) || drag.changed
        } else {
          const x = g.x + drag.grab[0], z = g.z + drag.grab[1]
          drag.changed = (hit.kind === 'cast' ? view.moveCast(hit.id, x, z) : view.moveThing(hit.id, x, z)) || drag.changed
        }
        return
      }
      if (e.buttons) return // orbiting
      // The cursor shows what can be grabbed (picked once a frame at most).
      hover = [e.clientX, e.clientY]
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        if (!hover || drag) return
        cursor(ref.current.canStage() && !view.pending && view.pick(hover[0], hover[1]) ? 'grab' : '')
      })
    }

    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!drag || e.pointerId !== drag.pointerId) return
      const d = drag
      drag = null
      if (d.took) {
        view.controls.enabled = true
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      }
      if (d.started) {
        cursor('grab')
        if (d.changed && d.hit) ref.current.moved(d.hit, d.turn ? 'facing' : 'at')
        return
      }
      if (!cancelled && !d.ignored && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) <= CLICK_PX) ref.current.select(d.hit)
    }
    const up = (e: PointerEvent) => end(e, false)
    const cancel = (e: PointerEvent) => end(e, true)
    const leave = () => { if (!drag) { hover = null; cursor('') } }

    el.addEventListener('pointerdown', down, true)
    el.addEventListener('pointermove', move, true)
    el.addEventListener('pointerup', up, true)
    el.addEventListener('pointercancel', cancel, true)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      el.removeEventListener('pointermove', move, true)
      el.removeEventListener('pointerup', up, true)
      el.removeEventListener('pointercancel', cancel, true)
      el.removeEventListener('pointerleave', leave)
      cancelAnimationFrame(frame)
      if (drag?.took) view.controls.enabled = true
      cursor('')
    }
  }, [view, on])
}

/* ───────────── keys ───────────── */

/** A field: keys there are the field's own. */
const FIELD = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])'
/** A text field: its own Undo (Ctrl+Z) is native text undo. */
const TEXT = 'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"], input[type="password"], input[type="tel"]'
const inside = (t: EventTarget | null, sel: string) => t instanceof Element && !!t.closest(sel)
const ARROWS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }

/**
 * Keys while directing: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo (not in a text field);
 * Esc leaves a field, then deselects, then closes; with a selection the arrows nudge it 0.1 (Shift:
 * 0.5) by the view, Up away from the camera, Q and E turn it 15°, Delete or Backspace removes a prop;
 * without one, ← and → go to the page before or after. None of them act in a field.
 */
export function useDirectKeys(on: boolean, opts: {
  selected: () => Picked | null
  canStage: () => boolean
  deselect: () => void
  close: () => void
  page: (step: number) => void
  undo: () => void
  redo: () => void
  leaveField: () => void
  nudge: (p: Picked, right: number, away: number) => void
  turn: (p: Picked, deg: number) => void
  remove: (p: Picked) => void
}) {
  const ref = useRef(opts)
  ref.current = opts
  useEffect(() => {
    if (!on) return
    const key = (e: KeyboardEvent) => {
      const h = ref.current
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (mod && !e.altKey && (k === 'z' || (k === 'y' && e.ctrlKey))) {
        if (inside(e.target, TEXT)) return
        e.preventDefault()
        if (k === 'z' && !e.shiftKey) h.undo()
        else h.redo()
        return
      }
      if (e.key === 'Escape') {
        if (inside(e.target, FIELD)) return h.leaveField()
        if (h.selected()) h.deselect()
        else h.close()
        return
      }
      if (inside(e.target, FIELD) || mod || e.altKey) return
      const sel = h.selected()
      if (ARROWS[e.key]) {
        if (!sel) {
          if (e.key === 'ArrowRight') h.page(1)
          if (e.key === 'ArrowLeft') h.page(-1)
          return
        }
        e.preventDefault()
        const [x, y] = ARROWS[e.key], step = e.shiftKey ? 0.5 : 0.1
        if (h.canStage()) h.nudge(sel, x * step, y * step)
        return
      }
      if (sel && (k === 'q' || k === 'e')) {
        if (h.canStage()) h.turn(sel, k === 'q' ? 15 : -15)
        return
      }
      if (sel?.kind === 'thing' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        if (h.canStage()) h.remove(sel)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [on])
}

/* ───────────── the panel ───────────── */

/** A select's options, plus the value the file holds when the list doesn't have it. */
function Choices({ value, list, note = 'from the file' }: { value: string; list: [string, string][]; note?: string }) {
  return (
    <>
      {value && !list.some(([v]) => v === value) && <option value={value}>{wordsOf(value)} ({note})</option>}
      {list.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </>
  )
}

/** A field of the panel: a label, the control, and an optional line under it. */
function Row({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="dp-row">
      <label htmlFor={htmlFor}>{label}</label>
      <div className="dp-control">{children}{hint && <small className="dp-source">{hint}</small>}</div>
    </div>
  )
}

/** While a slider moves, its value is the one being dragged; when the stage catches up, the stage's. */
function useDragged(stage: number, key: unknown) {
  const [v, setV] = useState<number | null>(null)
  useEffect(() => setV(null), [stage, key])
  return [v ?? stage, setV] as const
}

export function DirectPanel({ editor, view, state, selected, onSelect, edits, retime }: {
  editor: Editor
  view: WorldView
  state: StageState
  selected: Picked | null
  onSelect: (p: Picked | null) => void
  edits: DirectEdits
  /** Show a moment on stage at once (no re-stage), while its edit is on its way. */
  retime: (m: { hour?: number; weather?: string }) => void
}) {
  const direction = useStaging() // the panel follows every edit at once
  const { status, error, editable } = useStagingStatus()
  // A locked page: nothing that changes staging (see the lock in the header).
  const canStage = editable && !state.locked
  const canUndo = useValue('can undo', () => editor.getCanUndo(), [editor])
  const canRedo = useValue('can redo', () => editor.getCanRedo(), [editor])
  const characters = useValue('characters', () => getCharacters(editor).map((c) => ({ id: c.id, name: c.props.name, color: c.props.color })), [editor])

  const page = state.page
  const own = sceneEntry(direction, page.id, page.title)
  const cast = view.castInfo()
  const onStage = new Set(cast.map((c) => c.who))
  const offStage = characters.filter((c) => !onStage.has(c.id))
  const colorOf = (id: string) => characters.find((c) => c.id === id)?.color
  /** A member's entry: the file's own when it has one (it is ahead of the stage while a re-stage runs), else the stage's. */
  const entryOf = (c: CastInfo): CastEntry => {
    const list = Array.isArray(own.cast) ? own.cast as CastEntry[] : null
    const i = list ? memberIndex(list, c.who, c.name) : -1
    return i >= 0 ? list![i] : c.entry
  }
  const member = selected?.kind === 'cast' ? cast.find((c) => c.who === selected.id) ?? null : null
  const prop = selected?.kind === 'thing' ? view.thingMark(selected.id) : null

  const castFrom = state.castFrom
  const fromTitle = castFrom.page ? view.pages().find((p) => p.id === castFrom.page) : null
  const castHint = castFrom.kind === 'auto' ? 'Placed automatically by the pin. Moving anyone keeps everyone where they are now.'
    : castFrom.kind === 'inherit' ? `From “${fromTitle?.title || fromTitle?.path || 'another page'}” (this page continues it). Changing it here gives this page its own cast.`
    : null

  const props = state.dressingIds.flatMap((id, i) => (id != null ? [{ id, kind: String(state.dir.dressing?.[i]?.kind ?? '') }] : []))
  const groups = state.dressingIds.filter((id) => id == null).length

  // Saving shows in the header (like the app's own save status); a problem gets a line of its own.
  const saved = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''
  const problem = status === 'error' ? error : !editable ? 'The direction can’t be edited until it has been read.' : ''

  return (
    <>
      {/* 1. Header */}
      <header className="dp-head">
        <div className="dp-title">
          <small>{page.path || 'Loose page'}{saved && <span className="dp-saved" title={`In ${STAGING_FILE}`}> · {saved}</span>}</small>
          <h2>{page.title || 'Untitled page'}</h2>
        </div>
        <div className="dp-tools">
          <button onClick={() => { edits.flush(); editor.undo() }} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
          <button onClick={() => { edits.flush(); editor.redo() }} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
          {/* 8. Lock: the lock state and the Lock page button go here. */}
        </div>
      </header>
      {problem && <p className="dp-note three-error">{problem}</p>}
      <p className="dp-note" title="With something selected: the arrows nudge it by the view (Shift: more), Q and E turn it, Delete removes a prop, Esc deselects.">
        Click someone or a prop of this page, then drag it. Shift+drag turns it.
      </p>

      {/* 2. Cast */}
      <section className="dp-section" aria-label="Cast">
        <h3>Cast</h3>
        {castHint && <p className="dp-hint">{castHint}</p>}
        {cast.length ? (
          <ul className="dp-list">
            {cast.map((c) => {
              const on = member?.who === c.who
              return (
                <li key={c.who}>
                  <button className={on ? 'on' : ''} aria-pressed={on} onClick={() => onSelect(on ? null : { kind: 'cast', id: c.who })}>
                    <span className="dot" style={{ background: colorOf(c.who) ?? 'var(--line)' }} />
                    <span className="dp-name">{c.name || 'Unnamed'}</span>
                    {c.walker && <small>walks</small>}
                    {c.auto && <span className="dp-tag" title="Gathered automatically: not in the page's cast yet">auto</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : <p className="dp-hint">Nobody is on stage.</p>}
        <select className="dp-add" value="" disabled={!canStage || !offStage.length} aria-label="Put in a character"
          onChange={(e) => { const who = e.target.value; if (who) edits.putIn(who, () => onSelect({ kind: 'cast', id: who })) }}>
          <option value="">{offStage.length ? 'Put in a character…' : 'Everyone is on stage'}</option>
          {offStage.map((c) => <option key={c.id} value={c.id}>{c.name || 'Unnamed'}</option>)}
        </select>
      </section>

      {/* 3. Selected character */}
      {member && <MemberSection key={member.who} c={member} entry={entryOf(member)} cast={cast} view={view} edits={edits} canStage={canStage} onSelect={onSelect} />}

      {/* 4. Props on this page */}
      <section className="dp-section" aria-label="Props on this page">
        <h3>Props on this page</h3>
        {props.length ? (
          <ul className="dp-list">
            {props.map((p) => {
              const on = prop?.id === p.id
              return (
                <li key={p.id}>
                  <button className={on ? 'on' : ''} aria-pressed={on} onClick={() => onSelect(on ? null : { kind: 'thing', id: p.id })}>
                    <span className="dp-name">{kindLabel(p.kind)}</span><small>{p.id}</small>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : <p className="dp-hint">None yet. A prop added here stays on this page and the pages that continue it.</p>}
        {groups > 0 && <p className="dp-hint">{groups === 1 ? 'A row, ring or scatter' : `${groups} rows, rings or scatters`} of this page can only be changed in {STAGING_FILE}.</p>}
        {prop && <PropSection key={prop.id} id={prop.id} kind={prop.kind} facing={prop.facing} view={view} edits={edits} canStage={canStage} onSelect={onSelect} />}
        <select className="dp-add" value="" disabled={!canStage} aria-label="Add a prop"
          onChange={(e) => { const kind = e.target.value; if (kind) edits.addProp(kind, (id) => onSelect({ kind: 'thing', id })) }}>
          <option value="">Add a prop…</option>
          {directOptions.props.map((g) => (
            <optgroup key={g.family} label={g.label}>
              {g.kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </optgroup>
          ))}
        </select>
      </section>

      {/* 5. Moment */}
      <MomentSection state={state} edits={edits} canStage={canStage} retime={retime} />

      {/* 6. Camera and 7. Notes for Claude go here. */}
    </>
  )
}

function MemberSection({ c, entry, cast, view, edits, canStage, onSelect }: {
  c: CastInfo
  entry: CastEntry
  cast: CastInfo[]
  view: WorldView
  edits: DirectEdits
  canStage: boolean
  onSelect: (p: Picked | null) => void
}) {
  const who = c.who
  const others = cast.filter((m) => m.who !== who)
  const stageFacing = typeof entry.facing === 'number' ? entry.facing : c.facing ?? 0
  const [facing, setFacing] = useDragged(stageFacing, who)
  const choice = facingChoice(entry.facing, others.map((m) => ({ id: m.who, name: m.name })))
  const set = (patch: Partial<CastEntry>, field: string) => edits.member(who, patch, field)
  const spotNow = typeof entry.at === 'string' ? entry.at : ''
  const spots = c.at ? view.spotsNear(c.at[0], c.at[1], 2.5) : []
  const nameOf = (id: string | null) => cast.find((m) => m.who === id)?.name ?? ''
  const doNow = typeof entry.do === 'string' ? entry.do : ''
  const knownDo = directOptions.animations.some((g) => g.names.includes(doNow))
  const feelNow = typeof entry.feel === 'string' ? entry.feel : 'neutral'
  const holdNow = heldChoice(entry.hold, HELD)

  return (
    <section className="dp-section dp-selected" aria-label="Selected character">
      <h3>{c.name || 'Unnamed'}</h3>
      {c.walker && <p className="dp-hint">Walks a path: dragging moves the whole path.</p>}
      <fieldset className="dp-fields" disabled={!canStage}>
        <Row label="Doing" htmlFor="dp-do">
          <select id="dp-do" value={doNow} onChange={(e) => set({ do: e.target.value || undefined }, 'do')}>
            <option value="">Automatic</option>
            {doNow && !knownDo && <option value={doNow}>{doNow} (not found)</option>}
            {directOptions.animations.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.names.map((n) => <option key={n} value={n}>{wordsOf(n)}</option>)}
              </optgroup>
            ))}
          </select>
        </Row>
        <Row label="Feeling" htmlFor="dp-feel">
          <select id="dp-feel" value={feelNow} onChange={(e) => set({ feel: e.target.value }, 'feel')}>
            <Choices value={feelNow} note="not found" list={directOptions.emotions.map((x) => [x.id, x.label])} />
          </select>
        </Row>
        <Row label="Holding" htmlFor="dp-hold">
          <select id="dp-hold" value={holdNow} onChange={(e) => set({ hold: e.target.value || undefined }, 'hold')}>
            <option value="">Nothing</option>
            <Choices value={holdNow} note="not found" list={directOptions.held.map((x) => [x.id, x.label.replace(/\s*\(held\)$/i, '')])} />
          </select>
        </Row>
        <Row label="Talking" htmlFor="dp-talk">
          <input id="dp-talk" type="checkbox" checked={!!entry.talk} onChange={(e) => set({ talk: e.target.checked || undefined }, 'talk')} />
        </Row>
        <Row label="Facing" htmlFor="dp-facing">
          <div className="dp-range">
            <input id="dp-facing" type="range" min={0} max={359} step={1} value={facing} disabled={c.walker} aria-label="Facing, in degrees"
              title="Place degrees: 0 faces south, 90 east"
              onChange={(e) => {
                const deg = Number(e.target.value)
                setFacing(deg)
                view.turnCast(who, view.worldYaw(deg))
                edits.later(`${who} facing`, () => set({ facing: deg }, 'facing'))
              }} />
            <output htmlFor="dp-facing">{facing}°</output>
          </div>
          <select value={choice} disabled={c.walker} aria-label="Facing toward"
            onChange={(e) => {
              const v = e.target.value
              if (v === '') set({ facing: stageFacing }, 'facing')
              else if (v === 'camera') set({ facing: c.at ? view.facingToCamera(c.at) : stageFacing }, 'facing')
              else set({ facing: v }, 'facing')
            }}>
            <option value="">Angle</option>
            {others.map((m) => <option key={m.who} value={m.who}>{m.name || 'Unnamed'}</option>)}
            <option value="group">The group</option>
            <option value="camera" title="Faces where the camera is now">The camera</option>
            {choice && choice !== 'group' && choice !== 'camera' && !others.some((m) => m.who === choice) && <option value={choice}>{wordsOf(choice.replace(/^shape:/, ''))}</option>}
          </select>
        </Row>
        {!c.walker && (
          <Row label="Stand at" htmlFor="dp-spot">
            <select id="dp-spot" value={spotNow}
              title="A spot on a prop nearby sets where they stand, which way they face and how (a seat makes them sit)"
              onChange={(e) => {
                const ref = e.target.value
                if (ref) set({ at: ref, facing: undefined }, 'at')
                else if (c.at) set({ at: c.at, facing: entry.facing ?? stageFacing }, 'at')
              }}>
              <option value="">Where you put them</option>
              {spotNow && !spots.some((s) => s.ref === spotNow) && <option value={spotNow}>{wordsOf(spotNow)}</option>}
              {spots.map((s) => <option key={s.ref} value={s.ref}>{s.label}{s.by && s.by !== who ? ` (${nameOf(s.by)})` : ''}</option>)}
            </select>
          </Row>
        )}
      </fieldset>
      <div className="dp-actions">
        <button disabled={!canStage} onClick={() => edits.takeOut(who, () => onSelect(null))} title="Takes them out of the 3D cast and off the page's Who (their modifier stays)">Take out of this page</button>
      </div>
    </section>
  )
}

function PropSection({ id, kind, facing: stageFacing, view, edits, canStage, onSelect }: {
  id: string
  kind: string
  facing: number
  view: WorldView
  edits: DirectEdits
  canStage: boolean
  onSelect: (p: Picked | null) => void
}) {
  const [facing, setFacing] = useDragged(stageFacing, id)
  return (
    <div className="dp-selected dp-prop" aria-label="Selected prop">
      <div className="dp-subhead"><b>{kindLabel(kind)}</b><small>{id}</small></div>
      <fieldset className="dp-fields" disabled={!canStage}>
        <Row label="Facing" htmlFor="dp-prop-facing">
          <div className="dp-range">
            <input id="dp-prop-facing" type="range" min={0} max={359} step={1} value={facing} aria-label="Facing, in degrees"
              onChange={(e) => {
                const deg = Number(e.target.value)
                setFacing(deg)
                view.turnThing(id, view.worldYaw(deg))
                edits.later(`${id} facing`, () => edits.propMoved(id, 'facing'))
              }} />
            <output htmlFor="dp-prop-facing">{facing}°</output>
          </div>
        </Row>
      </fieldset>
      <div className="dp-actions">
        <button disabled={!canStage} onClick={() => edits.removeProp(id, () => onSelect(null))} title="Remove it from this page (Delete)">Remove</button>
      </div>
    </div>
  )
}

function MomentSection({ state, edits, canStage, retime }: {
  state: StageState
  edits: DirectEdits
  canStage: boolean
  retime: (m: { hour?: number; weather?: string }) => void
}) {
  const from = state.momentFrom
  // A new season rebuilds the set: the select shows the choice while it does.
  const [season, setSeason] = useState<string | null>(null)
  useEffect(() => setSeason(null), [state.season, state.page.id])
  const source = (field: MomentField, src: typeof from.hour) => (
    <>
      {momentHint(field, src)}
      {src === 'own' && <button className="dp-reset" disabled={!canStage} onClick={() => edits.moment(field, undefined)} aria-label={`Reset the ${field === 'time' ? 'time' : field}`} title="Reset: take it from the canvas or the defaults again">↺</button>}
    </>
  )
  return (
    <section className="dp-section" aria-label="Moment">
      <h3>Moment</h3>
      <p className="dp-hint">What you set here is saved on this page.</p>
      <fieldset className="dp-fields" disabled={!canStage}>
        <Row label="Time" htmlFor="dp-time" hint={source('time', from.hour)}>
          <div className="dp-range">
            <input id="dp-time" type="range" min={0} max={24} step={0.25} value={state.hour}
              onChange={(e) => {
                const hour = Number(e.target.value)
                retime({ hour })
                edits.later('time', () => edits.moment('time', hour))
              }} />
            <output htmlFor="dp-time">{fmtHour(state.hour)}</output>
          </div>
        </Row>
        <Row label="Weather" htmlFor="dp-weather" hint={source('weather', from.weather)}>
          <select id="dp-weather" value={state.weather} onChange={(e) => { retime({ weather: e.target.value }); edits.moment('weather', e.target.value) }}>
            {weathers.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </Row>
        <Row label="Season" htmlFor="dp-season" hint={source('season', from.season)}>
          <select id="dp-season" value={season ?? state.season} onChange={(e) => { setSeason(e.target.value); edits.moment('season', e.target.value) }}>
            {SEASONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </Row>
      </fieldset>
    </section>
  )
}
