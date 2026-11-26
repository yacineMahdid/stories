import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getSnapshot, type Editor, type TLShape } from 'tldraw'
import type { CharacterShape, PinShape, SceneShape } from '../shapes/types'
import { coverPreviews, directionKey, effectiveSpec, getStudio, getPreview, guessLook, lookOptions, placePresets, weathers, WorldView, type Frame, type Look, type Picked, type StageState } from '../three/bridge.js'
import { getStaging, STAGING_FILE, useStaging, useStagingStatus, type Direction, type Op } from '../lib/staging'
import { edit3d } from '../lib/staging-history'
import { uploadFile } from '../lib/persistence'
import { fileFrom, putStill, removeStill, takeStill } from '../lib/stills'
import { isExact, isLocked, sceneEntry, sceneEntryKey } from '../lib/direct'
import { createDirectEdits, DirectPanel, useDirectKeys, useDirectPointer } from './DirectPanel'

/* ───────────── shared ───────────── */

/** Opens the full 3D stage at a page, from anywhere in the app (`direct`: in Direct mode). */
export const StageContext = createContext<(pageId?: string, opts?: { direct?: boolean }) => void>(() => {})

/** Mounts a shared 3D view's element in this spot while it is on screen. */
function Slot({ view, className = 'three-slot' }: { view: { mount(el: HTMLElement): void; unmount(el: HTMLElement): void }; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current!
    view.mount(el)
    return () => view.unmount(el)
  }, [view])
  return <div ref={ref} className={className} />
}

/** The canvas document, refreshed shortly after it stops changing. */
export function useCanvasDocument(editor: Editor, delay = 700) {
  return useLiveDocument(editor, delay)[0]
}
/** The same, and a function that takes it now (after a change made with the 3D direction). */
function useLiveDocument(editor: Editor, delay: number) {
  const [doc, setDoc] = useState(() => getSnapshot(editor.store).document)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const stop = editor.store.listen(() => {
      clearTimeout(t)
      t = setTimeout(() => setDoc(getSnapshot(editor.store).document), delay)
    }, { scope: 'document' })
    return () => { clearTimeout(t); stop() }
  }, [editor, delay])
  const now = useCallback(() => setDoc(getSnapshot(editor.store).document), [editor])
  return [doc, now] as const
}

function Busy({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={on ? 'three-busy on' : 'three-busy'}>{children}</span>
}

/* ───────────── characters ───────────── */

const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))

/** A 3D panel that fails shows what went wrong instead of taking the whole app down. */
export class ThreeBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) } }
  componentDidCatch(e: unknown) { console.error('[3d panel]', e) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="three-panel">
        <small className="three-error">The 3D view hit a problem: {this.state.error}</small>
        <div className="ins-row"><button onClick={() => this.setState({ error: null })}>Try again</button></div>
      </div>
    )
  }
}

type Section = 'characters' | 'places' | 'scenes'
const CARD = { characters: 'character', places: 'pin', scenes: 'scene' }

/** The key of a card's entry in the direction, the way the 3D world finds it (a page: by id or title). */
function entryOf(d: Direction, section: Section, id: string, name: string): string | null {
  return section === 'scenes' ? sceneEntryKey(d, id, name) : directionKey(d, section, id, name)
}

/**
 * A look, place or page direction written by hand under a card's name (a page's title) would
 * stop matching when the card is renamed: rename its key to the card's id first (in place, so
 * the file keeps its layout), so it stays with the card. Another card that still has the old
 * name keeps it; the renamed one gets a copy. `step` is the rename's undo step, so one Undo
 * takes back both.
 */
export function followRename(editor: Editor, section: Section, id: string, oldName: string, newName: string, step: string) {
  if (oldName === newName) return
  const d = getStaging()
  const key = entryOf(d, section, id, oldName)
  if (key == null || key === id || key === id.replace(/^shape:/, '') || key.toLowerCase() === newName.toLowerCase()) return
  const nameOf = (s: TLShape) => String((s.props as Record<string, unknown>)[section === 'scenes' ? 'title' : 'name'] ?? '')
  const shared = editor.store.allRecords().some((r) => r.typeName === 'shape' && r.type === CARD[section] && r.id !== id && entryOf(d, section, r.id, nameOf(r)) === key)
  const op: Op = shared ? { op: 'set', path: [section, id], value: d[section][key] } : { op: 'rename', path: [section, key], to: id }
  edit3d(editor, [op], step)
}

/** How long the selection must rest before a 3D preview is (re)built. */
const SETTLE_MS = 180

/** Staging notes (an unknown prop, a cast member not on the page…), folded away. */
function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null
  return (
    <details className="three-warnings">
      <summary>{list.length} staging note{list.length === 1 ? '' : 's'}</summary>
      <ul>{list.map((w) => <li key={w}>{w}</li>)}</ul>
    </details>
  )
}

/** A select's options, plus the current value when the file holds one the list doesn't have. */
function Options({ value, list, note = 'from the file' }: { value: string; list: [string, string][]; note?: string }) {
  return (
    <>
      {value && !list.some(([v]) => v === value) && <option value={value}>{value} ({note})</option>}
      {list.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </>
  )
}

/** The character's 3D look: a live model, a few controls, and a button to add it as a portrait. */
const isPlain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The edits that turn one look into another, field by field (inside outfit, face and hair too). */
function lookOps(base: string[], from: Record<string, any>, to: Record<string, any>): Op[] {
  const ops: Op[] = []
  const gone = (v: unknown) => v === undefined || v === ''
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const a = from[k], b = to[k]
    if (sameJSON(a, b)) continue
    if (gone(b)) ops.push({ op: 'delete', path: [...base, k] })
    else if (isPlain(a) && isPlain(b)) ops.push(...lookOps([...base, k], a, b))
    else ops.push({ op: 'set', path: [...base, k], value: b })
  }
  return ops
}

export function CharacterLook({ editor, shape, onPortrait }: { editor: Editor; shape: CharacterShape; onPortrait: (url: string) => void }) {
  const p = shape.props
  const direction = useStaging()
  const { status, error, editable } = useStagingStatus()
  // The look may be keyed by id or by name (hand-written); edits go back under the same key.
  const entryKey = directionKey(direction, 'characters', shape.id, p.name) ?? shape.id
  const stored: Look | undefined = direction.characters?.[entryKey]
  const card = { id: shape.id, name: p.name, role: p.role, appearance: p.appearance, color: p.color }
  const guessFor = (species?: string) => guessLook(card, species)
  const look: Look = useMemo(() => stored ?? guessLook(card), [stored, shape.id, p.name, p.role, p.appearance, p.color])
  const spec = useMemo(() => effectiveSpec(look), [look]) // species defaults filled in, for the controls
  const studio = useMemo(getStudio, [])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const key = JSON.stringify(look)
  useEffect(() => { studio.show(look, shape.id) }, [key, shape.id])

  // The first change keeps the whole guessed look; after that, only the fields that change are
  // written, so hand edits to the other fields survive. Each control is one field for Undo:
  // dragging through colours is one step.
  const save = (next: Look, field: string) => {
    const base = ['characters', entryKey]
    const step = `${shape.id}|3d ${field}`
    if (!stored) edit3d(editor, [{ op: 'set', path: base, value: clean(next) }], step)
    else edit3d(editor, lookOps(base, stored, clean(next)), step)
  }
  // Animals start without hair, like the guessed looks; going back to a person brings back
  // their skin and hair (or the card's guess).
  const lastHuman = useRef<{ id: string; skin?: string; hair?: Look['hair'] }>({ id: shape.id })
  if (lastHuman.current.id !== shape.id) lastHuman.current = { id: shape.id }
  if ((look.species ?? 'human') === 'human') {
    if (look.hair) lastHuman.current.hair = look.hair
    if (look.skin) lastHuman.current.skin = look.skin
  }
  const changeSpecies = (next: string) => {
    const human = next === 'human'
    const guess = guessFor(next)
    save({
      ...look, species: next, fur: undefined,
      skin: human ? lastHuman.current.skin ?? guess.skin : guess.skin,
      hair: human ? look.hair ?? lastHuman.current.hair ?? guess.hair : undefined,
    }, 'species')
  }
  const set = (patch: Look) => save({ ...look, ...patch }, Object.keys(patch).join())
  const setGroup = (group: 'outfit' | 'face' | 'hair', patch: Record<string, any>) => save({ ...look, [group]: clean({ ...(look[group] ?? {}), ...patch }) }, `${group}.${Object.keys(patch).join()}`)
  const species = look.species ?? 'human'
  const outfit = spec.outfit ?? {}

  const addPortrait = async () => {
    setBusy(true)
    setProblem('')
    try {
      const blob = await studio.portrait(p.color)
      if (blob) onPortrait(await uploadFile(fileFrom(blob, `${p.name || 'character'}-3d`)))
    } catch (e) {
      setProblem(`The portrait could not be saved: ${e instanceof Error ? e.message : e}`)
    } finally { setBusy(false) }
  }
  const note = stored ? 'from the file' : 'guessed'

  return (
    <div className="three-panel">
      <Slot view={studio} className="three-slot tall" />
      <fieldset className="three-grid" disabled={!editable}>
        <label>Species
          <select value={species} onChange={(e) => changeSpecies(e.target.value)}>
            <Options value={species} note={note} list={lookOptions.species.map((s) => [s.id, s.label])} />
          </select>
        </label>
        <label>{species === 'human' ? 'Skin' : 'Fur'}
          <input type="color" value={spec.skin ?? '#f8d3b0'} onChange={(e) => set({ skin: e.target.value })} />
        </label>
        <label>Hair
          <select value={look.hair?.style ?? ''} onChange={(e) => save({ ...look, hair: e.target.value ? { color: look.hair?.color ?? '#4a2f22', style: e.target.value } : undefined }, 'hair')}>
            <Options value={look.hair?.style ?? ''} note={note} list={lookOptions.hair.map((h) => [h.id, h.label])} />
          </select>
        </label>
        <label>Hair colour
          <select value={look.hair?.color ?? ''} disabled={!look.hair?.style} onChange={(e) => setGroup('hair', { color: e.target.value })}>
            <Options value={look.hair?.color ?? ''} note={note} list={lookOptions.hairColors.map((h) => [h.value, h.label])} />
          </select>
        </label>
        <label>Eyes
          <select value={spec.face?.eyes ?? 'classic'} onChange={(e) => setGroup('face', { eyes: e.target.value })}>
            <Options value={spec.face?.eyes ?? 'classic'} note={note} list={lookOptions.eyes.map((h) => [h.id, h.label])} />
          </select>
        </label>
        <label>Body
          <select value={spec.body ?? 'standard'} onChange={(e) => set({ body: e.target.value })}>
            <Options value={spec.body ?? 'standard'} note={note} list={lookOptions.bodies.map((h) => [h.id, h.label])} />
          </select>
        </label>
        <label>Top
          <input type="color" value={outfit.top ?? '#e2483c'} onChange={(e) => setGroup('outfit', { top: e.target.value })} />
        </label>
        <label>Sleeves
          <select value={outfit.sleeves ?? 'short'} onChange={(e) => setGroup('outfit', { sleeves: e.target.value })}>
            <Options value={outfit.sleeves ?? 'short'} note={note} list={lookOptions.sleeves.map((s) => [s, s])} />
          </select>
        </label>
        <label>Bottom
          <input type="color" value={outfit.bottom ?? '#2f3640'} onChange={(e) => setGroup('outfit', { bottom: e.target.value })} />
        </label>
        <label>Legs
          <select value={outfit.legs ?? 'shorts'} onChange={(e) => setGroup('outfit', { legs: e.target.value })}>
            <Options value={outfit.legs ?? 'shorts'} note={note} list={lookOptions.legs.map((s) => [s, s])} />
          </select>
        </label>
        <label>Shoes
          <input type="color" value={outfit.shoes ?? '#4a3a30'} onChange={(e) => setGroup('outfit', { shoes: e.target.value })} />
        </label>
      </fieldset>
      <div className="ins-row">
        <button className="primary" disabled={busy} onClick={addPortrait}><Busy on={busy}>Add as portrait</Busy></button>
        <button disabled={!stored || !editable} onClick={() => edit3d(editor, [{ op: 'delete', path: ['characters', entryKey] }], `${shape.id}|3d guess`)} title="Forget the edits and guess the look from the card's text again (Undo brings them back)">
          Guess from text
        </button>
      </div>
      {problem && <small className="three-error">{problem}</small>}
      <small className={status === 'error' ? 'three-error' : 'muted'}>
        {status === 'error' ? error : stored ? (status === 'saving' ? `Saving to ${STAGING_FILE}…` : `Saved in ${STAGING_FILE}.`) : 'Guessed from the card. Change anything to keep it.'} Drag the model to turn it.
      </small>
    </div>
  )
}

/* ───────────── places ───────────── */

/** A map pin in 3D: its place on its own, with an automatic set unless the direction stages it. */
export function PlacePreview({ editor, shape }: { editor: Editor; shape: PinShape }) {
  const direction = useStaging()
  const { status, error, editable } = useStagingStatus()
  const doc = useCanvasDocument(editor)
  const view = useMemo(getPreview, [])
  const [busy, setBusy] = useState(true)
  const entryKey = directionKey(direction, 'places', shape.id, shape.props.name) ?? shape.id
  const placeDir = direction.places?.[entryKey]
  const handStaged = !!placeDir?.things

  useEffect(() => {
    let live = true
    // A moment's wait first, so clicking through pins quickly builds only the one you stop on.
    const t = setTimeout(() => {
      view.setWorld(doc, direction)
      if (view.showing('place', shape.id)) return setBusy(false) // nothing 3D changed
      setBusy(true)
      view.showPlace(shape.id).catch((e) => console.error(e)).finally(() => { if (live) setBusy(false) })
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(t) }
  }, [direction, shape.id, doc])

  // 'Automatic' removes only the preset; anything else written for the place stays.
  const setPreset = (preset: string) => {
    const step = `${shape.id}|3d set`
    if (preset) edit3d(editor, [{ op: 'set', path: ['places', entryKey, 'preset'], value: preset }], step)
    else if (placeDir && Object.keys(placeDir).some((k) => k !== 'preset')) edit3d(editor, [{ op: 'delete', path: ['places', entryKey, 'preset'] }], step)
    else edit3d(editor, [{ op: 'delete', path: ['places', entryKey] }], step)
  }

  return (
    <div className="three-panel">
      <div className="three-frame">
        <Slot view={view} />
        {busy && <div className="three-loading">Building the place…</div>}
      </div>
      <label className="ins-field">
        <span>3D set</span>
        <select value={handStaged ? '__hand' : placeDir?.preset ?? ''} disabled={handStaged || !editable} onChange={(e) => setPreset(e.target.value)}>
          {handStaged && <option value="__hand">Staged by hand</option>}
          <option value="">Automatic (from the name and description)</option>
          {placePresets.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </select>
        <small className={status === 'error' ? 'three-error' : undefined}>{status === 'error' ? error : handStaged ? `This place is staged in ${STAGING_FILE}.` : 'Where the pin sits on the map is where the place is in 3D.'}</small>
      </label>
    </div>
  )
}

/* ───────────── pages ───────────── */

/** The page staged in 3D, with its cast, moment and shots, plus a still to drop on the canvas. */
export function PagePreview({ editor, shape }: { editor: Editor; shape: SceneShape }) {
  const direction = useStaging()
  const doc = useCanvasDocument(editor)
  const view = useMemo(getPreview, [])
  const openStage = useContext(StageContext)
  const [state, setState] = useState<StageState | null>(null)
  const [busy, setBusy] = useState(true)
  const [shot, setShot] = useState(0)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  // What's on screen comes from the view (the shot may have moved when the page changed).
  const sync = () => { setState(view.state ? { ...view.state } : null); setShot(view.shotIndex) }

  const shownRef = useRef<string | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      view.setWorld(doc, direction)
      // The same page again (the canvas changed): keep the shot and the camera, and when
      // nothing 3D changed (a still put on the card), leave the stage as it is.
      const keepShot = shownRef.current === shape.id
      if (keepShot && view.showing('page', shape.id)) { sync(); return setBusy(false) }
      shownRef.current = shape.id
      setBusy(true)
      view.showPage(shape.id, {}, { keepShot }).then((s) => { if (live && s) sync() }).catch((e) => console.error(e)).finally(() => { if (live) setBusy(false) })
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(t) }
  }, [doc, direction, shape.id])

  // The still goes on the page card itself, so the Story canvas reads like a storyboard (see
  // app/src/lib/stills.ts: the card grows for it, and gives it back when the still goes).
  const addStill = async () => {
    setSaving(true)
    setProblem('')
    try {
      const url = await takeStill(view, shape.props.title)
      editor.markHistoryStoppingPoint('put still')
      putStill(editor, shape.id, url)
    } catch (e) {
      setProblem(`The still could not be saved: ${e instanceof Error ? e.message : e}`)
    } finally { setSaving(false) }
  }
  const takeOffStill = () => {
    editor.markHistoryStoppingPoint('remove still')
    removeStill(editor, shape.id)
  }

  return (
    <div className="three-panel">
      <div className="three-frame">
        <Slot view={view} />
        {busy && <div className="three-loading">Staging the page…</div>}
      </div>
      {view.shots.length > 1 && (
        <div className="three-chips">
          {view.shots.map((s, i) => <button key={i} className={i === shot ? 'on' : ''} onClick={() => { view.shot(i); setShot(i) }}>{s.label ?? s.shot ?? `Shot ${i + 1}`}</button>)}
        </div>
      )}
      {state && (state.changes.length > 0 || state.notes.length > 0) && (
        <ul className="three-notes">
          {state.changes.map((c, i) => <li key={`c${i}`} className="here">{c.text} <small>from this page on</small></li>)}
          {state.notes.map((n, i) => <li key={`n${i}`}>{n.text} <small>since {n.since}</small></li>)}
        </ul>
      )}
      {state && <Warnings list={view.warnings} />}
      <div className="ins-row">
        <button className="primary" onClick={() => openStage(shape.id)}>Open 3D stage</button>
        <button onClick={() => openStage(shape.id, { direct: true })} title="Open the 3D stage at this page in Direct mode: place the cast and props, and save it to the page">Direct in 3D</button>
        <button disabled={saving || busy} onClick={addStill}><Busy on={saving}>{shape.props.still ? 'Replace the card’s still' : 'Put this shot on the card'}</Busy></button>
        {shape.props.still && <button onClick={takeOffStill}>Remove still</button>}
      </div>
      {problem && <small className="three-error">{problem}</small>}
    </div>
  )
}

/* ───────────── the full stage ───────────── */

const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const fmtHour = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`
// While directing, the canvas only changes by the panel's own edits and Undo, and edits should show
// at once: a short wait for the canvas and before a re-stage (a few quick edits still make one).
// "Staging…" shows for a re-stage that takes a while: one that builds the set again (at once, and
// the work starts once it is on screen: the build is one long job) or that runs past SLOW_MS.
const DIRECT_DOC_MS = 30
const DIRECT_SETTLE_MS = 60
const SLOW_MS = 400

/** The page's picture: the shape of the still Lock puts on its card (960×540). */
const PICTURE = 16 / 9
const GAP = 12
/**
 * Directing, where the picture is on the stage: the biggest 16:9 frame in the open part of the view
 * (left of the panel, between the stage bar and the dock), below the page card when that leaves it
 * about as big. Null when there is no room (the panel covers the view). Shots are framed for it, and
 * Lock and Retake picture put exactly what it shows on the card. `cardMax`: how tall the page card
 * may be so it ends above the picture (it scrolls), or null when it is clear of it anyway.
 */
function pictureFrame(root: HTMLElement, bar: HTMLElement | null, dock: HTMLElement | null, panel: HTMLElement | null, card: HTMLElement | null): { frame: Frame | null; cardMax: number | null } {
  const r = root.getBoundingClientRect()
  const box = (el: HTMLElement | null) => {
    const b = el?.getBoundingClientRect()
    return b && b.width > 0 && b.height > 0 ? { left: b.left - r.left, top: b.top - r.top, right: b.right - r.left, bottom: b.bottom - r.top } : null
  }
  const p = box(panel), b = box(bar), d = box(dock), c = box(card)
  const x0 = GAP, x1 = (p ? p.left : r.width) - GAP
  const y0 = (b ? b.bottom : 0) + GAP, y1 = (d ? d.top : r.height) - GAP
  const fit = (top: number): Frame | null => {
    const w = x1 - x0, h = y1 - top
    if (w < 120 || h < 68) return null
    const fw = Math.min(w, h * PICTURE), fh = fw / PICTURE
    return { x: x0 + (w - fw) / 2, y: top + (h - fh) / 2, w: fw, h: fh }
  }
  const any = fit(y0)
  // The card as tall as its content (it may be scrolling now): below it, when that leaves the picture about as big.
  const natural = c && card ? c.top + card.scrollHeight : null
  const below = natural != null ? fit(natural + GAP) : null
  if (below && any && below.w >= any.w * 0.85) return { frame: below, cardMax: null }
  const over = !!any && !!c && natural != null && any.x < c.right && any.y < natural + GAP
  return { frame: any, cardMax: over ? Math.max(40, any!.y - GAP - c!.top) : null }
}

/**
 * Every page of the story in 3D, full screen: pages, shots, time, weather, season and Play. Direct
 * mode (`direct`: open in it) directs the page on screen: see DirectPanel.tsx.
 */
export function StageOverlay({ editor, pageId, direct: directAtOpen = false, onClose }: { editor: Editor; pageId?: string; direct?: boolean; onClose: () => void }) {
  const direction = useStaging()
  const [direct, setDirect] = useState(directAtOpen)
  const directRef = useRef(direct)
  directRef.current = direct
  const [doc, docNow] = useLiveDocument(editor, direct ? DIRECT_DOC_MS : 700)
  const view = useMemo(() => new WorldView(), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const [picture, setPicture] = useState<Frame | null>(null) // directing: the picture's frame on the stage
  const [pages, setPages] = useState<{ id: string; title: string; path: string }[]>([])
  const [current, setCurrent] = useState<string | undefined>(pageId)
  const [state, setState] = useState<StageState | null>(null)
  const [shot, setShot] = useState(0)
  const [busy, setBusy] = useState(true)
  const [playing, setPlaying] = useState(false)
  const shownRef = useRef<string | null>(null)
  const [slow, setSlow] = useState(false) // directing: a re-stage that takes a while shows "Staging…"
  const [framed, setFramed] = useState(0) // goes up each time a shot frames the camera (the panel's lens follows)
  const sync = () => { setState(view.state ? { ...view.state } : null); setShot(view.shotIndex) }
  /** Frame shot i (its chip in the dock, or an edit of the camera that asks for it). */
  const frame = (i: number) => { view.shot(i); setShot(view.shotIndex); setFramed((n) => n + 1) }

  // Direct mode: what is selected (a cast member or a prop of the page), and every edit.
  const [selected, setSelected] = useState<Picked | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const stagedRef = useRef<{ id: string; title: string } | null>(null)
  stagedRef.current = state ? { id: state.page.id, title: state.page.title } : null
  const frameRef = useRef(frame)
  frameRef.current = frame
  const edits = useMemo(() => createDirectEdits(editor, view, { page: () => stagedRef.current, canvasChanged: docNow, goShot: (i) => frameRef.current(i) }), [editor, view])
  const { editable } = useStagingStatus()
  // A locked page (as the file says now): no dragging or keys that change staging; nor while a lock is on its way.
  const own = state ? sceneEntry(direction, state.page.id, state.page.title) : {}
  const locked = isLocked(own)
  const canStage = () => editable && !locked && !edits.locking

  useEffect(() => {
    coverPreviews(true)
    // While the stage is open, the canvas underneath takes no keys (Backspace would delete the
    // selected shape, letters would switch tools) and nothing behind the stage can be focused.
    // On close, focus goes back where it was (a field in the inspector, or the canvas).
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const canvasHadFocus = !!opener?.closest('.tl-container')
    const wasFocused = editor.getIsFocused()
    editor.blur()
    const root = rootRef.current
    const behind = [...(root?.parentElement?.children ?? [])].filter((el) => el !== root)
    behind.forEach((el) => el.setAttribute('inert', ''))
    root?.focus()
    if (import.meta.env.DEV) (window as any).stageView = view // handy for debugging in the console
    return () => {
      // A slider's edit still waiting is saved, and so is an edit waiting for a re-stage: they read
      // the stage, so it goes once they have landed.
      const saved = edits.close()
      behind.forEach((el) => el.removeAttribute('inert'))
      view.suspend()
      view.el.remove()
      void saved.finally(() => view.dispose())
      coverPreviews(false)
      if (opener?.isConnected && !canvasHadFocus) opener.focus()
      else if (wasFocused && (canvasHadFocus || !opener)) editor.focus()
    }
  }, [view])

  // A selection that is no longer on stage (taken out, removed, undone) goes.
  const dropGone = () => {
    const sel = selectedRef.current
    if (sel && !(sel.kind === 'cast' ? view.castInfo().some((c) => c.who === sel.id) : view.thingMark(sel.id))) setSelected(null)
  }

  useEffect(() => {
    view.setWorld(doc, direction)
    const list = view.pages()
    setPages(list)
    const id = current && list.some((p) => p.id === current) ? current : list[0]?.id
    if (!id) { setBusy(false); setState(null); return }
    if (id !== current) setCurrent(id)
    let live = true
    const keepShot = shownRef.current === id
    if (keepShot && view.showing('page', id)) { sync(); setBusy(false); return } // nothing 3D changed
    setBusy(true)
    // Directing, the camera stays exactly where it is (the director keeps it while directing anyway).
    const directing = directRef.current
    const rebuild = directing && view.rebuilds(id)
    if (rebuild) setSlow(true)
    let frame = 0, after: ReturnType<typeof setTimeout> | undefined
    const stage = () => {
      shownRef.current = id
      view.showPage(id, {}, directing ? { keepCamera: keepShot } : { keepShot }).then((s) => { if (live && s) { sync(); dropGone() } }).catch((e) => console.error(e)).finally(() => { if (live) setBusy(false) })
    }
    // A new set: once "Staging…" has been drawn (the frame after it, then the task after the paint).
    const t = setTimeout(() => (rebuild ? (frame = requestAnimationFrame(() => { after = setTimeout(stage, 0) })) : stage()), directing ? DIRECT_SETTLE_MS : SETTLE_MS)
    return () => { live = false; clearTimeout(t); cancelAnimationFrame(frame); clearTimeout(after) }
  }, [doc, direction, current])

  const index = pages.findIndex((p) => p.id === current)
  const go = (i: number) => { if (pages[i]) setCurrent(pages[i].id) }

  // Play: every shot of every page, in reading order.
  useEffect(() => {
    if (!playing || busy) return
    const shots = view.shots
    const hold = (shots[shot] as any)?.hold ?? 5
    const t = setTimeout(() => {
      if (shot + 1 < shots.length) { view.shot(shot + 1); setShot(shot + 1) }
      else if (index + 1 < pages.length) go(index + 1)
      else setPlaying(false)
    }, hold * 1000)
    return () => clearTimeout(t)
  }, [playing, busy, shot, index, pages.length])

  useEffect(() => {
    if (direct) return // Direct mode has keys of its own (useDirectKeys below)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, pages, direct])

  // The time, weather and season of watch mode are the viewer's own; Direct mode shows and saves
  // the page's, so turning it on puts the page's back.
  const viewerMoment = useRef(false)

  // A new season rebuilds the set: show "Staging…" first, then do the work.
  const changeSeason = (season: string) => {
    viewerMoment.current = true
    setBusy(true)
    setTimeout(() => view.retime({ season }).then(sync).finally(() => setBusy(false)), 50)
  }

  const retime = (m: { hour?: number; weather?: string; season?: string }) => {
    if (m.hour != null || m.weather) setState((s) => (s ? { ...s, ...m } as StageState : s))
    view.retime(m).then(() => setState({ ...(view.state as StageState) }))
  }
  const viewerRetime = (m: { hour?: number; weather?: string }) => { viewerMoment.current = true; retime(m) }

  /* ── Direct mode ── */

  useEffect(() => {
    view.setDirecting(direct)
    if (!direct) {
      edits.flush()
      setSelected(null)
      return
    }
    setPlaying(false)
    if (viewerMoment.current) {
      viewerMoment.current = false
      view.restage().then((s) => { if (s) sync() })
    }
  }, [direct])
  // The selection shows on stage (a ring, a box) while directing, kept by id through re-stages.
  useEffect(() => { view.select(direct ? selected?.kind ?? null : null, selected?.id ?? null) }, [direct, selected])
  // Another page: a slider's write still waiting goes to the page it was made on, and nothing is selected.
  useEffect(() => { edits.flush(); setSelected(null) }, [current])

  // "Staging…" while directing: only when a re-stage takes a while (a new set is known before: see above).
  useEffect(() => {
    if (!busy || !direct) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [busy, direct])

  // The panel sits between the stage bar and the dock, whatever their height (they wrap when narrow).
  useEffect(() => {
    const root = rootRef.current, bar = barRef.current, dock = dockRef.current
    if (!direct || !root || !bar || !dock) return
    const fit = () => {
      root.style.setProperty('--bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`)
      root.style.setProperty('--dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(bar)
    ro.observe(dock)
    fit()
    return () => ro.disconnect()
  }, [direct])

  // Directing, the picture is a 16:9 frame beside the panel (pictureFrame): the camera is framed for
  // it, and Lock puts exactly what it shows on the page card. A shot the director framed for the whole
  // view is framed again for it when it first appears; after that the camera stays where it is.
  const hasState = !!state
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!direct || !root || !hasState) {
      view.setFrame(null)
      setPicture(null)
      root?.style.removeProperty('--card-max-h')
      return
    }
    const fit = () => {
      const { frame: f, cardMax } = pictureFrame(root, barRef.current, dockRef.current, panelRef.current, cardRef.current)
      // A tall page card ends above the picture, and scrolls.
      if (cardMax != null) root.style.setProperty('--card-max-h', `${Math.round(cardMax)}px`)
      else root.style.removeProperty('--card-max-h')
      const was = view.frame
      view.setFrame(f)
      setPicture(view.frame)
      if (!was && view.frame && !view.userCamera && view.shots.length) frameRef.current(view.shotIndex)
    }
    fit()
    const ro = new ResizeObserver(fit)
    for (const el of [root, barRef.current, dockRef.current, panelRef.current, cardRef.current]) if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [direct, hasState])

  // A select, checkbox or slider of the panel set with the mouse gives the keys back to the stage once
  // it changes, so the next arrow nudges (and Q, E turn) what is selected instead of changing that
  // field again and saving it. One reached with the keyboard (Tab) keeps them.
  useEffect(() => {
    const panel = panelRef.current
    if (!direct || !panel) return
    let pointed: Element | null = null
    const down = (e: PointerEvent) => { pointed = e.target instanceof Element ? e.target.closest('select, input') : null }
    const focus = (e: FocusEvent) => { if (e.target !== pointed) pointed = null }
    const changed = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLElement) || t !== pointed || !t.matches('select, input[type="checkbox"], input[type="range"]')) return
      pointed = null
      setTimeout(() => { if (document.activeElement === t) { t.blur(); rootRef.current?.focus() } }, 0)
    }
    panel.addEventListener('pointerdown', down, true)
    panel.addEventListener('focusin', focus, true)
    panel.addEventListener('change', changed, true)
    return () => {
      panel.removeEventListener('pointerdown', down, true)
      panel.removeEventListener('focusin', focus, true)
      panel.removeEventListener('change', changed, true)
    }
  }, [direct, hasState])

  useDirectPointer(view, direct, {
    canStage,
    select: setSelected,
    moved: (p, what) => (p.kind === 'cast' ? edits.moved(p.id, what) : edits.propMoved(p.id, what)),
  })
  useDirectKeys(direct, {
    selected: () => selectedRef.current,
    canStage,
    deselect: () => setSelected(null),
    close: onClose,
    page: (step) => { edits.flush(); go(index + step) },
    undo: () => edits.undo(),
    redo: () => edits.redo(),
    leaveField: () => { (document.activeElement as HTMLElement | null)?.blur(); rootRef.current?.focus() },
    nudge: (p, right, away) => edits.nudge(p.kind, p.id, right, away),
    turn: (p, deg) => edits.turn(p.kind, p.id, deg),
    remove: (p) => edits.removeProp(p.id, () => setSelected(null)),
  })

  return (
    <div className={direct ? 'stage-overlay directing' : 'stage-overlay'} role="dialog" aria-modal="true" aria-label="3D stage" tabIndex={-1} ref={rootRef}>
      <Slot view={view} className="stage-view" />
      {direct && picture && <div className="direct-frame" aria-hidden="true" style={{ left: picture.x, top: picture.y, width: picture.w, height: picture.h }} />}
      <header className="stage-bar" ref={barRef}>
        <button onClick={onClose} aria-label="Close the 3D stage">✕</button>
        <button disabled={index <= 0} onClick={() => go(index - 1)} aria-label="Previous page">←</button>
        <select value={current ?? ''} onChange={(e) => setCurrent(e.target.value)}>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.path} {p.title}</option>)}
        </select>
        <button disabled={index >= pages.length - 1} onClick={() => go(index + 1)} aria-label="Next page">→</button>
        <button className={playing ? 'on' : ''} disabled={direct} onClick={() => setPlaying(!playing)}>{playing ? 'Stop' : 'Play'}</button>
        <button className={direct ? 'on' : ''} aria-pressed={direct} onClick={() => setDirect(!direct)}
          title="Direct this page: select and drag the cast and props, set what they do and feel, and save it to the page">Direct</button>
      </header>
      {state && (
        <aside className="stage-card" ref={cardRef}>
          <small>{state.page.path}</small>
          <h2>{state.page.title || 'Untitled page'}</h2>
          <p className="when">{[state.page.when, state.place?.name].filter(Boolean).join(' · ')}</p>
          {state.page.summary && <p>{state.page.summary}</p>}
          {(state.changes.length > 0 || state.notes.length > 0) && (
            <ul className="three-notes">
              {state.changes.map((c, i) => <li key={`c${i}`} className="here">{c.text} <small>from this page on</small></li>)}
              {state.notes.map((n, i) => <li key={`n${i}`}>{n.text} <small>since {n.since}</small></li>)}
            </ul>
          )}
          <Warnings list={view.warnings} />
        </aside>
      )}
      {direct && state && (
        <aside className="direct-panel" aria-label="Direction" ref={panelRef}>
          <ThreeBoundary>
            <DirectPanel editor={editor} view={view} state={state} shot={shot} framed={framed} selected={selected} onSelect={setSelected} edits={edits} retime={retime} />
          </ThreeBoundary>
        </aside>
      )}
      <footer className="stage-dock" ref={dockRef}>
        <div className="three-chips">
          {view.shots.map((s, i) => {
            // Directing, a shot with exact framing has a marker, and so has the picture of a locked page.
            const exact = direct && isExact(s), picture = direct && locked && own.picture === i
            const tip = [picture && 'The page\'s picture', exact && 'Exact framing (your view)'].filter(Boolean).join(', ')
            return (
              <button key={i} className={[i === shot && 'on', exact && 'exact', picture && 'picture'].filter(Boolean).join(' ')} title={tip || undefined}
                onClick={() => (direct ? frame(i) : (view.shot(i), setShot(i)))}>{s.label ?? s.shot ?? `Shot ${i + 1}`}</button>
            )
          })}
        </div>
        {/* Directing, the moment is the page's own and lives in the panel (Moment); here it is the viewer's. */}
        {state && !direct && (
          <div className="stage-moment">
            <label>Time <input type="range" min={0} max={24} step={0.25} value={state.hour} onChange={(e) => viewerRetime({ hour: Number(e.target.value) })} /> <output>{fmtHour(state.hour)}</output></label>
            <select value={state.weather} onChange={(e) => viewerRetime({ weather: e.target.value })} aria-label="Weather">
              {weathers.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <select value={state.season} onChange={(e) => changeSeason(e.target.value)} aria-label="Season">
              {SEASONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        )}
      </footer>
      {busy && (!direct || slow) && <div className="three-loading big">Staging…</div>}
      {!busy && !pages.length && <div className="three-loading big empty">Add pages on the Story tab to see them here.</div>}
    </div>
  )
}
