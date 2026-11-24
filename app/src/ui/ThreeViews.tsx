import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getSnapshot, useValue, type Editor } from 'tldraw'
import type { CharacterShape, PinShape, SceneShape } from '../shapes/types'
import { coverPreviews, getStudio, getPreview, guessLook, lookOptions, placePresets, weathers, WorldView, type Look, type StageState } from '../three/bridge.js'
import { updateStaging, useStaging, type Direction } from '../lib/staging'
import { uploadFile } from '../lib/persistence'
import { fitAncestors } from '../lib/structure'

/* ───────────── shared ───────────── */

/** Opens the full 3D stage at a page, from anywhere in the app. */
export const StageContext = createContext<(pageId?: string) => void>(() => {})

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
  const [doc, setDoc] = useState(() => getSnapshot(editor.store).document)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const stop = editor.store.listen(() => {
      clearTimeout(t)
      t = setTimeout(() => setDoc(getSnapshot(editor.store).document), delay)
    }, { scope: 'document' })
    return () => { clearTimeout(t); stop() }
  }, [editor, delay])
  return doc
}

function fileFrom(blob: Blob, name: string) {
  return new File([blob], name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() + '.png', { type: 'image/png' })
}

function Busy({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={on ? 'three-busy on' : 'three-busy'}>{children}</span>
}

/* ───────────── characters ───────────── */

const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))

/** The character's 3D look: a live model, a few controls, and a button to add it as a portrait. */
export function CharacterLook({ shape, onPortrait }: { editor: Editor; shape: CharacterShape; onPortrait: (url: string) => void }) {
  const p = shape.props
  const direction = useStaging()
  const stored: Look | undefined = direction.characters?.[shape.id]
  const look: Look = useMemo(() => stored ?? guessLook({ id: shape.id, name: p.name, role: p.role, appearance: p.appearance, color: p.color }), [stored, shape.id, p.name, p.role, p.appearance, p.color])
  const studio = useMemo(getStudio, [])
  const [busy, setBusy] = useState(false)
  const key = JSON.stringify(look)
  useEffect(() => { studio.show(look) }, [key])

  const save = (next: Look) => updateStaging((d: Direction) => ({ ...d, characters: { ...(d.characters ?? {}), [shape.id]: clean(next) } }))
  const set = (patch: Look) => save({ ...look, ...patch })
  const setIn = (group: 'outfit' | 'face' | 'hair', patch: Record<string, any>) => save({ ...look, [group]: clean({ ...(look[group] ?? {}), ...patch }) })
  const species = look.species ?? 'human'
  const outfit = look.outfit ?? {}

  const addPortrait = async () => {
    setBusy(true)
    try {
      const blob = await studio.portrait(p.color)
      if (blob) onPortrait(await uploadFile(fileFrom(blob, `${p.name || 'character'}-3d`)))
    } finally { setBusy(false) }
  }

  return (
    <div className="three-panel">
      <Slot view={studio} className="three-slot tall" />
      <div className="three-grid">
        <label>Species
          <select value={species} onChange={(e) => save({ ...look, species: e.target.value, skin: undefined, fur: undefined })}>
            {lookOptions.species.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label>{species === 'human' ? 'Skin' : 'Fur'}
          <input type="color" value={look.skin ?? '#f8d3b0'} onChange={(e) => set({ skin: e.target.value })} />
        </label>
        <label>Hair
          <select value={look.hair?.style ?? ''} onChange={(e) => save({ ...look, hair: e.target.value ? { color: look.hair?.color ?? '#4a2f22', style: e.target.value } : undefined })}>
            {lookOptions.hair.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
        <label>Hair colour
          <select value={look.hair?.color ?? ''} disabled={!look.hair?.style} onChange={(e) => setIn('hair', { color: e.target.value })}>
            {lookOptions.hairColors.map((h) => <option key={h.id} value={h.value}>{h.label}</option>)}
          </select>
        </label>
        <label>Eyes
          <select value={look.face?.eyes ?? 'classic'} onChange={(e) => setIn('face', { eyes: e.target.value })}>
            {lookOptions.eyes.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
        <label>Body
          <select value={look.body ?? 'standard'} onChange={(e) => set({ body: e.target.value })}>
            {lookOptions.bodies.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
        <label>Top
          <input type="color" value={outfit.top ?? '#e2483c'} onChange={(e) => setIn('outfit', { top: e.target.value })} />
        </label>
        <label>Sleeves
          <select value={outfit.sleeves ?? 'short'} onChange={(e) => setIn('outfit', { sleeves: e.target.value })}>
            {lookOptions.sleeves.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Bottom
          <input type="color" value={outfit.bottom ?? '#2f3640'} onChange={(e) => setIn('outfit', { bottom: e.target.value })} />
        </label>
        <label>Legs
          <select value={outfit.legs ?? 'shorts'} onChange={(e) => setIn('outfit', { legs: e.target.value })}>
            {lookOptions.legs.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Shoes
          <input type="color" value={outfit.shoes ?? '#4a3a30'} onChange={(e) => setIn('outfit', { shoes: e.target.value })} />
        </label>
      </div>
      <div className="ins-row">
        <button className="primary" disabled={busy} onClick={addPortrait}><Busy on={busy}>Add as portrait</Busy></button>
        <button onClick={() => updateStaging((d: Direction) => { const c = { ...(d.characters ?? {}) }; delete c[shape.id]; return { ...d, characters: c } })} title="Forget the edits and guess the look from the card's text again">
          Guess from text
        </button>
      </div>
      <small className="muted">{stored ? 'Saved in data/staging.json.' : 'Guessed from the card. Change anything to keep it.'} Drag the model to turn it.</small>
    </div>
  )
}

/* ───────────── places ───────────── */

/** A map pin in 3D: its place on its own, with an automatic set unless the direction stages it. */
export function PlacePreview({ editor, shape }: { editor: Editor; shape: PinShape }) {
  const direction = useStaging()
  const doc = useCanvasDocument(editor)
  const view = useMemo(getPreview, [])
  const [busy, setBusy] = useState(true)
  const placeDir = direction.places?.[shape.id]
  const handStaged = !!placeDir?.things
  const sig = useValue('pin 3d', () => { const s = editor.getShape(shape.id) as PinShape | undefined; return s ? JSON.stringify([s.x, s.y, s.props]) : '' }, [editor, shape.id])

  useEffect(() => {
    let live = true
    setBusy(true)
    view.setWorld(doc, direction)
    view.showPlace(shape.id).catch((e) => console.error(e)).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [sig, direction, shape.id, doc])

  const setPreset = (preset: string) => updateStaging((d: Direction) => {
    const places = { ...(d.places ?? {}) }
    if (preset) places[shape.id] = { ...(places[shape.id] ?? {}), preset }
    else delete places[shape.id]
    return { ...d, places }
  })

  return (
    <div className="three-panel">
      <div className="three-frame">
        <Slot view={view} />
        {busy && <div className="three-loading">Building the place…</div>}
      </div>
      <label className="ins-field">
        <span>3D set</span>
        <select value={handStaged ? '__hand' : placeDir?.preset ?? ''} disabled={handStaged} onChange={(e) => setPreset(e.target.value)}>
          {handStaged && <option value="__hand">Staged by hand</option>}
          <option value="">Automatic (from the name and description)</option>
          {placePresets.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </select>
        <small>{handStaged ? 'This place is staged in data/staging.json.' : 'Where the pin sits on the map is where the place is in 3D.'}</small>
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

  useEffect(() => {
    let live = true
    setBusy(true)
    view.setWorld(doc, direction)
    view.showPage(shape.id).then((s) => { if (live) { setState(s); setShot(0) } }).catch((e) => console.error(e)).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [doc, direction, shape.id])

  // The still goes on the page card itself, so the Story canvas reads like a storyboard.
  const addStill = async () => {
    setSaving(true)
    try {
      const blob = await view.still(960, 540)
      const url = await uploadFile(fileFrom(blob, `${shape.props.title || 'page'}-still`))
      // The card grows to make room for the picture, and its chapter grows with it.
      const current = editor.getShape(shape.id) as SceneShape
      editor.run(() => {
        editor.updateShape({ id: shape.id, type: 'scene', props: { still: url, h: Math.max(current.props.h, Math.round(current.props.w * 9 / 16 * 0.92) + 250) } })
        fitAncestors(editor, editor.getShape(shape.id)!)
      })
    } finally { setSaving(false) }
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
      <div className="ins-row">
        <button className="primary" onClick={() => openStage(shape.id)}>Open 3D stage</button>
        <button disabled={saving || busy} onClick={addStill}><Busy on={saving}>{shape.props.still ? 'Replace the card’s still' : 'Put this shot on the card'}</Busy></button>
        {shape.props.still && <button onClick={() => editor.updateShape({ id: shape.id, type: 'scene', props: { still: '' } })}>Remove still</button>}
      </div>
    </div>
  )
}

/* ───────────── the full stage ───────────── */

const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const fmtHour = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`

/** Every page of the story in 3D, full screen: pages, shots, time, weather, season and Play. */
export function StageOverlay({ editor, pageId, onClose }: { editor: Editor; pageId?: string; onClose: () => void }) {
  const direction = useStaging()
  const doc = useCanvasDocument(editor)
  const view = useMemo(() => new WorldView(), [])
  useEffect(() => {
    coverPreviews(true)
    if (import.meta.env.DEV) (window as any).stageView = view // handy for debugging in the console
    return () => { view.dispose(); coverPreviews(false) }
  }, [view])
  const [pages, setPages] = useState<{ id: string; title: string; path: string }[]>([])
  const [current, setCurrent] = useState<string | undefined>(pageId)
  const [state, setState] = useState<StageState | null>(null)
  const [shot, setShot] = useState(0)
  const [busy, setBusy] = useState(true)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    view.setWorld(doc, direction)
    const list = view.pages()
    setPages(list)
    const id = current && list.some((p) => p.id === current) ? current : list[0]?.id
    if (!id) { setBusy(false); setState(null); return }
    if (id !== current) setCurrent(id)
    let live = true
    setBusy(true)
    view.showPage(id).then((s) => { if (live) { setState(s); setShot(0) } }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
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
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, pages])

  const retime = (m: { hour?: number; weather?: string; season?: string }) => {
    view.retime(m)?.then(() => setState({ ...(view.state as StageState) }))
    if (m.hour != null || m.weather) setState((s) => (s ? { ...s, ...m } as StageState : s))
  }

  return (
    <div className="stage-overlay" role="dialog" aria-label="3D stage">
      <Slot view={view} className="stage-view" />
      <header className="stage-bar">
        <button onClick={onClose} aria-label="Close the 3D stage">✕</button>
        <button disabled={index <= 0} onClick={() => go(index - 1)} aria-label="Previous page">←</button>
        <select value={current ?? ''} onChange={(e) => setCurrent(e.target.value)}>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.path} {p.title}</option>)}
        </select>
        <button disabled={index >= pages.length - 1} onClick={() => go(index + 1)} aria-label="Next page">→</button>
        <button className={playing ? 'on' : ''} onClick={() => setPlaying(!playing)}>{playing ? 'Stop' : 'Play'}</button>
      </header>
      {state && (
        <aside className="stage-card">
          <small>{state.page.path}</small>
          <h2>{state.page.title || 'Untitled page'}</h2>
          <p className="when">{state.page.when}{state.place ? ` · ${state.place.name}` : ''}</p>
          {state.page.summary && <p>{state.page.summary}</p>}
          {(state.changes.length > 0 || state.notes.length > 0) && (
            <ul className="three-notes">
              {state.changes.map((c, i) => <li key={`c${i}`} className="here">{c.text} <small>from this page on</small></li>)}
              {state.notes.map((n, i) => <li key={`n${i}`}>{n.text} <small>since {n.since}</small></li>)}
            </ul>
          )}
        </aside>
      )}
      <footer className="stage-dock">
        <div className="three-chips">
          {view.shots.map((s, i) => <button key={i} className={i === shot ? 'on' : ''} onClick={() => { view.shot(i); setShot(i) }}>{s.label ?? s.shot ?? `Shot ${i + 1}`}</button>)}
        </div>
        {state && (
          <div className="stage-moment">
            <label>Time <input type="range" min={0} max={24} step={0.25} value={state.hour} onChange={(e) => retime({ hour: Number(e.target.value) })} /> <output>{fmtHour(state.hour)}</output></label>
            <select value={state.weather} onChange={(e) => retime({ weather: e.target.value })} aria-label="Weather">
              {weathers.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <select value={state.season} onChange={(e) => { setBusy(true); view.retime({ season: e.target.value })?.then(() => { setState({ ...(view.state as StageState) }); setBusy(false) }) }} aria-label="Season">
              {SEASONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        )}
      </footer>
      {busy && <div className="three-loading big">Staging…</div>}
      {!busy && !pages.length && <div className="three-loading big">Add pages on the Story tab to see them here.</div>}
    </div>
  )
}
