import { Component, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getSnapshot, type Editor, type TLShape } from 'tldraw'
import type { CharacterShape, PinShape, SceneShape } from '../shapes/types'
import { coverPreviews, directionKey, effectiveSpec, getStudio, getPreview, guessLook, lookOptions, placePresets, weathers, WorldView, type Look, type StageState } from '../three/bridge.js'
import { getStaging, STAGING_FILE, useStaging, useStagingStatus, type Direction, type Op } from '../lib/staging'
import { edit3d } from '../lib/staging-history'
import { uploadFile } from '../lib/persistence'
import { resizeKeepingOrder } from '../lib/structure'

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
  if (section !== 'scenes') return directionKey(d, section, id, name)
  const scenes = isPlain(d.scenes) ? d.scenes : {}
  if (Object.hasOwn(scenes, id)) return id
  return (name && Object.keys(scenes).find((k) => k.toLowerCase() === name.toLowerCase())) || null
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
  const hairTextures: string[] = lookOptions.hair.find((h) => h.id === look.hair?.style)?.textures ?? [] // natural first
  const textureLabel = (t?: string) => lookOptions.hairTextures.find((x) => x.id === t)?.label ?? t ?? ''
  // A stored texture the style doesn't offer: the natural one is drawn, which the select says.
  const oddTexture = look.hair?.texture && hairTextures.length && !hairTextures.includes(look.hair.texture) ? look.hair.texture : undefined
  // The texture belongs to the person: one picked on a style survives a style that draws it
  // naturally (where it isn't written) and comes back on the next style that offers it.
  const lastTexture = useRef<{ id: string; texture?: string }>({ id: shape.id })
  if (lastTexture.current.id !== shape.id) lastTexture.current = { id: shape.id }
  if (look.hair?.texture && !oddTexture) lastTexture.current.texture = look.hair.texture
  // A remembered pick this style offers (not as its natural one) that the file no longer has was
  // taken back (Undo, or an edit elsewhere): forget it.
  if (!look.hair?.texture && hairTextures.indexOf(lastTexture.current.texture ?? '') > 0) lastTexture.current.texture = undefined

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
          <select value={look.hair?.style ?? ''} onChange={(e) => {
            // The person's texture goes along: the one in the file, else a remembered pick, else the
            // one drawn now (a natural one too: an afro's coils make coily puffs). It is written only
            // when it isn't the new style's natural one.
            const style = e.target.value, offered = lookOptions.hair.find((h) => h.id === style)?.textures ?? []
            const drawnNow = look.hair?.style ? (look.hair.texture && hairTextures.includes(look.hair.texture) ? look.hair.texture : hairTextures[0]) : undefined
            const texture = [look.hair?.texture, lastTexture.current.texture, drawnNow].find((t) => t && offered.includes(t))
            const keep = offered.indexOf(texture ?? '') > 0
            save({ ...look, hair: style ? { color: look.hair?.color ?? '#4a2f22', style, ...(keep ? { texture } : {}) } : undefined }, 'hair')
          }}>
            <Options value={look.hair?.style ?? ''} note={note} list={lookOptions.hair.map((h) => [h.id, h.label])} />
          </select>
        </label>
        <label>Hair colour
          <select value={look.hair?.color ?? ''} disabled={!look.hair?.style} onChange={(e) => setGroup('hair', { color: e.target.value })}>
            <Options value={look.hair?.color ?? ''} note={note} list={lookOptions.hairColors.map((h) => [h.value, h.label])} />
          </select>
        </label>
        <label>Hair texture
          <select value={look.hair?.texture ?? hairTextures[0] ?? ''} disabled={!look.hair?.style || (hairTextures.length < 2 && !oddTexture)} onChange={(e) => {
            const natural = e.target.value === hairTextures[0]
            if (natural) lastTexture.current.texture = undefined
            setGroup('hair', { texture: natural ? undefined : e.target.value })
          }}>
            {oddTexture && (
              <option value={oddTexture} title={`${textureLabel(oddTexture)} isn't offered for this style: it is drawn ${textureLabel(hairTextures[0])}. Pick a texture to clear it.`}>
                {`${textureLabel(oddTexture)}: drawn ${textureLabel(hairTextures[0])}`}
              </option>
            )}
            <Options value={oddTexture ? '' : look.hair?.texture ?? hairTextures[0] ?? ''} note={note} list={hairTextures.map((t) => [t, textureLabel(t)])} />
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

  // The still goes on the page card itself, so the Story canvas reads like a storyboard.
  // The card grows to make room for the picture; what sits below it moves down so the reading
  // order stays, and the card remembers by how much it grew, so removing the still gives it back.
  const addStill = async () => {
    setSaving(true)
    setProblem('')
    try {
      const blob = await view.still(960, 540)
      const url = await uploadFile(fileFrom(blob, `${shape.props.title || 'page'}-still`))
      const current = editor.getShape(shape.id) as SceneShape
      const want = Math.max(current.props.h, Math.round(current.props.w * 9 / 16 * 0.92) + 250)
      const grown = Number(current.meta?.stillGrow ?? 0) + (want - current.props.h)
      editor.markHistoryStoppingPoint('put still')
      editor.run(() => {
        editor.updateShape({ id: shape.id, type: 'scene', props: { still: url }, meta: { ...current.meta, stillGrow: grown } })
        resizeKeepingOrder(editor, editor.getShape(shape.id) as SceneShape, want)
      })
    } catch (e) {
      setProblem(`The still could not be saved: ${e instanceof Error ? e.message : e}`)
    } finally { setSaving(false) }
  }
  const removeStill = () => {
    const current = editor.getShape(shape.id) as SceneShape
    const grown = Number(current.meta?.stillGrow ?? 0)
    editor.markHistoryStoppingPoint('remove still')
    editor.run(() => {
      editor.updateShape({ id: shape.id, type: 'scene', props: { still: '' }, meta: { ...current.meta, stillGrow: 0 } })
      if (grown > 0) resizeKeepingOrder(editor, editor.getShape(shape.id) as SceneShape, Math.max(260, current.props.h - grown))
    })
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
        <button disabled={saving || busy} onClick={addStill}><Busy on={saving}>{shape.props.still ? 'Replace the card’s still' : 'Put this shot on the card'}</Busy></button>
        {shape.props.still && <button onClick={removeStill}>Remove still</button>}
      </div>
      {problem && <small className="three-error">{problem}</small>}
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
  const rootRef = useRef<HTMLDivElement>(null)
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
      behind.forEach((el) => el.removeAttribute('inert'))
      view.dispose()
      coverPreviews(false)
      if (opener?.isConnected && !canvasHadFocus) opener.focus()
      else if (wasFocused && (canvasHadFocus || !opener)) editor.focus()
    }
  }, [view])
  const [pages, setPages] = useState<{ id: string; title: string; path: string }[]>([])
  const [current, setCurrent] = useState<string | undefined>(pageId)
  const [state, setState] = useState<StageState | null>(null)
  const [shot, setShot] = useState(0)
  const [busy, setBusy] = useState(true)
  const [playing, setPlaying] = useState(false)
  const shownRef = useRef<string | null>(null)
  const sync = () => { setState(view.state ? { ...view.state } : null); setShot(view.shotIndex) }

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
    const t = setTimeout(() => {
      shownRef.current = id
      view.showPage(id, {}, { keepShot }).then((s) => { if (live && s) sync() }).catch((e) => console.error(e)).finally(() => { if (live) setBusy(false) })
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(t) }
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

  // A new season rebuilds the set: show "Staging…" first, then do the work.
  const changeSeason = (season: string) => {
    setBusy(true)
    setTimeout(() => view.retime({ season }).then(sync).finally(() => setBusy(false)), 50)
  }

  const retime = (m: { hour?: number; weather?: string; season?: string }) => {
    if (m.hour != null || m.weather) setState((s) => (s ? { ...s, ...m } as StageState : s))
    view.retime(m).then(() => setState({ ...(view.state as StageState) }))
  }

  return (
    <div className="stage-overlay" role="dialog" aria-modal="true" aria-label="3D stage" tabIndex={-1} ref={rootRef}>
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
            <select value={state.season} onChange={(e) => changeSeason(e.target.value)} aria-label="Season">
              {SEASONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        )}
      </footer>
      {busy && <div className="three-loading big">Staging…</div>}
      {!busy && !pages.length && <div className="three-loading big empty">Add pages on the Story tab to see them here.</div>}
    </div>
  )
}
