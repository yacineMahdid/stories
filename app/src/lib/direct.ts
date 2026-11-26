/**
 * Direct mode's pure logic: what each edit of a page's direction writes (docs/scenes.md,
 * "Directing a page"). No React, tldraw or three in here, so node can test it (direct.test.ts).
 * The Direction panel (app/src/ui/DirectPanel.tsx) reads the stage, builds its ops with these, and
 * sends them with edit3d.
 *
 * - Edits go under the page's own entry key (its id, or a title written by hand), else its id.
 * - Lists can't be edited inside (an op path can't go into an array), so "cast", "camera",
 *   "dressing" and "feedback" are always written whole.
 * - Copy on write: a page whose cast or camera comes from elsewhere (automatic, a page it
 *   continues, another page's camera through { "same" }) gets its own whole list at the first
 *   edit, taken from what the stage shows, so nobody else moves.
 * - Units: positions to 0.01, facings in whole place degrees (0–359), a lens to 0.1°.
 * - Notes for Claude ("feedback") change nothing in 3D, also on a locked page. The lock writes the
 *   page's full, explicit direction (lockOps).
 */
import type { Direction, Op } from './staging'
import type { CameraView, CastEntry, Feedback, Local, Shot, ThingEntry } from '../three/bridge.js'

export type { CameraView, CastEntry, Feedback, Local, Shot, ThingEntry }

export const isPlain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v))

/* ───────────── the entry key ───────────── */

/**
 * The key of a page's own entry in "scenes", the way the 3D world finds it: its id, else its title
 * written by hand (any case). Null when it has none.
 */
export function sceneEntryKey(direction: Direction, pageId: string, title: string): string | null {
  const scenes = isPlain(direction?.scenes) ? direction.scenes : {}
  if (Object.hasOwn(scenes, pageId)) return pageId
  return (title && Object.keys(scenes).find((k) => k.toLowerCase() === title.toLowerCase())) || null
}

/** Where an edit of a page goes: its own entry's key, else its id. */
export const sceneKey = (direction: Direction, pageId: string, title: string) => sceneEntryKey(direction, pageId, title) ?? pageId

/** The page's own entry as the file has it now ({} when it has none). */
export function sceneEntry(direction: Direction, pageId: string, title: string): Record<string, any> {
  const key = sceneEntryKey(direction, pageId, title)
  const entry = key != null ? direction.scenes[key] : null
  return isPlain(entry) ? entry : {}
}

/** An undo step's key for a Direct edit, e.g. stepKey('shape:p1', 'cast', 'shape:mira', 'at'). */
export const stepKey = (pageId: string, ...parts: string[]) => `${pageId}|direct ${parts.join(' ')}`

/* ───────────── units ───────────── */

const D2R = Math.PI / 180
/** To 0.01 (positions). */
export const round2 = (v: number) => Math.round(v * 100) / 100 + 0 // + 0: never -0
/** To 0.1 (a lens). */
export const roundFov = (v: number) => Math.round(v * 10) / 10 + 0
/** Whole degrees, 0–359. */
export const deg360 = (d: number) => ((Math.round(d) % 360) + 360) % 360

export interface PlaceFrame { pos?: [number, number] | number[]; rotate?: number }

function rotate([x, z]: Local, deg: number): Local {
  const t = deg * D2R, c = Math.cos(t), s = Math.sin(t)
  return [x * c + z * s, -x * s + z * c]
}
/** A place-local point ([x, z] east and south of the pin, turned by the place's rotate) to world. */
export function localToWorld(p: Local, place?: PlaceFrame | null): Local {
  const [rx, rz] = rotate(p, place?.rotate ?? 0)
  return [(place?.pos?.[0] ?? 0) + rx, (place?.pos?.[1] ?? 0) + rz]
}
/** A world point in the place's local units (the inverse of localToWorld). */
export function worldToLocal(p: Local, place?: PlaceFrame | null): Local {
  return rotate([p[0] - (place?.pos?.[0] ?? 0), p[1] - (place?.pos?.[1] ?? 0)], -(place?.rotate ?? 0))
}
/** Place degrees (whole, 0–359; 0 faces south) of a world yaw in radians. */
export const facingOf = (yaw: number, placeRotate = 0) => deg360(yaw / D2R - placeRotate)
/** The world yaw (radians) of place degrees. */
export const yawOf = (deg: number, placeRotate = 0) => (deg + placeRotate) * D2R
/** The yaw (radians, the convention of a model's rotation.y) that looks from one point to another. */
export const yawToward = (from: Local, to: Local) => Math.atan2(to[0] - from[0], to[1] - from[1])

/* ───────────── who is who ───────────── */

/** A character on the canvas: its card id and name. */
export interface Listed { id: string; name: string }

/** Does a `who` (or a facing reference) mean this character: their card id, the id without "shape:", or their name in any case? */
export function refersTo(ref: unknown, id: string, name = ''): boolean {
  if (typeof ref !== 'string' || !ref) return false
  if (ref === id || `shape:${ref}` === id) return true
  return !!name && ref.toLowerCase() === name.toLowerCase()
}

/** Where `who` is in a cast list (by card id or name), or -1. */
export function memberIndex(list: CastEntry[], who: string, name = ''): number {
  return list.findIndex((e) => isPlain(e) && refersTo(e.who, who, name))
}

/* ───────────── the cast ───────────── */

/**
 * The cast list an edit starts from. The page's own list as the file has it now, when it places
 * everyone the page lists; otherwise (an automatic cast, one it inherits through "continues", or
 * its own list plus members gathered automatically) a copy of the cast as the stage shows it
 * (WorldView.castMarks(): everyone where they stand now), so writing it moves nobody.
 */
export function castToEdit(own: unknown, marks: CastEntry[], listed: Listed[]): CastEntry[] {
  if (Array.isArray(own) && listed.every((c) => memberIndex(own, c.id, c.name) >= 0)) return clone(own)
  return clone(marks)
}

/**
 * The list with `who`'s entry changed: each field of `patch` set (in its place when the entry has
 * it), or deleted when it is undefined. Someone not in the list is added at the end, `who` first.
 */
export function withMember(list: CastEntry[], who: string, name: string, patch: Partial<CastEntry>): CastEntry[] {
  const out = clone(list)
  const i = memberIndex(out, who, name)
  const entry: Record<string, unknown> = i >= 0 ? out[i] : { who }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'who') continue
    if (v === undefined) delete entry[k]
    else entry[k] = clone(v)
  }
  if (i < 0) out.push(entry as CastEntry)
  return out
}

/** The list without `who` (every entry that means them). */
export function withoutMember(list: CastEntry[], who: string, name = ''): CastEntry[] {
  return clone(list).filter((e) => !(isPlain(e) && refersTo(e.who, who, name)))
}

/**
 * What a move or a turn of a cast member writes into their entry, from the cast as the stage shows
 * it (`mark`, their entry in WorldView.castMarks()): a move their `at` (a walker their moved
 * `path`, and `at` only when its entry has one), a turn their `facing`.
 */
export function movedFields(entry: CastEntry | undefined, mark: CastEntry | undefined, what: 'at' | 'facing'): Partial<CastEntry> {
  if (!mark) return {}
  if (what === 'facing') return mark.facing === undefined ? {} : { facing: mark.facing }
  const walker = Array.isArray(entry?.path) && entry!.path.length > 0
  if (!walker) return mark.at === undefined ? {} : { at: mark.at }
  const out: Partial<CastEntry> = {}
  if (mark.path) out.path = mark.path
  if (entry?.at !== undefined && mark.at !== undefined) out.at = mark.at
  return out
}

/** A new cast member, where the stage found room for them (WorldView.freeMark()). */
export const newMember = (who: string, at: Local, facing: number): CastEntry => ({ who, at: [round2(at[0]), round2(at[1])], facing: deg360(facing), do: 'Idle' })

/** Writing a page's cast: the whole list. */
export const castOps = (key: string, list: CastEntry[]): Op[] => [{ op: 'set', path: ['scenes', key, 'cast'], value: list }]

/* ───────────── facing ───────────── */

/**
 * What the Facing select shows for an entry's facing: '' for degrees (a number, or none: the
 * stage's choice), a cast member's card id (a reference by id or name), 'group', 'camera', or the
 * reference as written (a thing, e.g. "bridge").
 */
export function facingChoice(facing: unknown, cast: Listed[]): string {
  if (typeof facing !== 'string' || !facing) return ''
  if (facing === 'group' || facing === 'camera') return facing
  return cast.find((c) => refersTo(facing, c.id, c.name))?.id ?? facing
}

/** A thing's id as words, for a label: "stall-pastry" → "Stall pastry". */
export function wordsOf(id: string): string {
  const w = String(id).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])(\d)/gi, '$1 $2').replace(/[-_.]+/g, ' ').trim().toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** The held prop's kind as the Holding select lists it ('' for nothing): "lantern" and { kind } count too. */
export function heldChoice(hold: unknown, kinds: string[]): string {
  const kind = typeof hold === 'string' ? hold : isPlain(hold) && typeof hold.kind === 'string' ? hold.kind : ''
  if (!kind || kinds.includes(kind)) return kind
  return kinds.includes(`held-${kind}`) ? `held-${kind}` : kind
}

/* ───────────── props (the page's dressing) ───────────── */

/** A short name for a page in thing ids: its title as a slug, else its id. */
export function slugOf(title: string, pageId: string): string {
  const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug(title).slice(0, 24).replace(/-+$/, '') || slug(pageId.replace(/^shape:/, '')) || 'page'
}

/** A thing id nobody has yet (ids are global across the world): `<page slug>-<kind>-<n>`. */
export function newThingId(slug: string, kind: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  for (let n = 1; ; n++) {
    const id = `${slug}-${kind}-${n}`
    if (!used.has(id)) return id
  }
}

/** A new prop on the page, where the view looks (WorldView.centerMark()). */
export const newThing = (id: string, kind: string, at: Local, facing: number): ThingEntry => ({ id, kind, at: [round2(at[0]), round2(at[1])], facing: deg360(facing) })

/** The page's own dressing as the file has it now ([] when none). */
export const ownDressing = (entry: Record<string, any>): ThingEntry[] => (Array.isArray(entry.dressing) ? clone(entry.dressing) : [])

/**
 * Writing a page's dressing: the whole list, or no "dressing" at all once it is empty (and no
 * entry, when nothing else is left in it).
 */
export function dressingOps(key: string, list: ThingEntry[]): Op[] {
  if (list.length) return [{ op: 'set', path: ['scenes', key, 'dressing'], value: list }]
  return [{ op: 'delete', path: ['scenes', key, 'dressing'] }, { op: 'delete', path: ['scenes', key], ifEmpty: true }]
}

/* ───────────── the moment ───────────── */

export type MomentField = 'time' | 'weather' | 'season'
export type MomentSource = 'own' | 'canvas' | 'when' | 'inherit' | 'default'

/** Saving the hour (`time`), weather or season on the page; undefined deletes it (and an entry left empty). */
export function momentOps(key: string, field: MomentField, value: number | string | undefined): Op[] {
  if (value !== undefined) return [{ op: 'set', path: ['scenes', key, field], value }]
  return [{ op: 'delete', path: ['scenes', key, field] }, { op: 'delete', path: ['scenes', key], ifEmpty: true }]
}

/** Where a part of the moment comes from, in words. */
export function momentHint(field: MomentField, from: MomentSource): string {
  if (from === 'own') return 'Set on this page'
  if (from === 'canvas') return field === 'time' ? 'From the page’s time' : 'From the page’s month'
  if (from === 'when') return 'From the page’s “When”'
  if (from === 'inherit') return 'From the page it continues'
  return 'Default'
}

/* ───────────── the camera ───────────── */

/**
 * The shot list an edit of the camera starts from: the page's own "camera" as the file has it (a
 * list, or one shot), else a copy of the shots the stage uses (automatic, inherited, or another
 * page's through { "same" }), as written.
 */
export function cameraToEdit(own: unknown, shots: Shot[]): Shot[] {
  if (Array.isArray(own)) return clone(own)
  if (isPlain(own) && !('same' in own)) return [clone(own) as Shot]
  return clone(shots)
}

/** Does the page have a camera of its own (not automatic, inherited or another page's through { "same" })? */
export const ownsCamera = (own: unknown) => Array.isArray(own) || (isPlain(own) && !('same' in own))

/** Writing a page's camera: the whole list. */
export const cameraOps = (key: string, list: Shot[]): Op[] => [{ op: 'set', path: ['scenes', key, 'camera'], value: list }]

/** The automatic framings a shot can have (docs/scenes.md, Camera), as the Framing select lists them. */
export const FRAMINGS: [string, string][] = [
  ['establishing', 'Establishing'], ['wide', 'Wide'], ['medium', 'Medium'], ['two', 'Two shot'], ['close', 'Close-up'],
  ['over', 'Over the shoulder'], ['low', 'Low angle'], ['high', 'High angle'], ['top', 'Straight down'],
]

/** A shot with exact framing: it says where the camera is (`pos`) and what it looks at (`target`). */
export const isExact = (s: Shot | undefined) => !!s && Array.isArray(s.pos) && Array.isArray(s.target)

/** What a shot is called: its label, else its framing, else its number (as the shot chips show it). */
export const shotName = (s: Shot | undefined, i: number) => (typeof s?.label === 'string' && s.label) || (typeof s?.shot === 'string' && s.shot) || `Shot ${i + 1}`

/** The framing a shot gets from the director: its `shot`, else medium (wide with nobody on stage). */
export const framingOf = (s: Shot | undefined, anyone: boolean) => (isExact(s) ? 'exact' : typeof s?.shot === 'string' ? s.shot : anyone ? 'medium' : 'wide')

/** A copy without some keys (the others in their order). */
const omit = <T extends Record<string, any>>(o: T, keys: string[]): T => clone(Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T)

/**
 * A shot made exact framing at a view (Use this view): `pos`, `target` and `fov`, keeping its
 * label, hold, move (and anything else written), without what only automatic framing reads.
 */
export const exactShot = (s: Shot, v: CameraView): Shot => ({ ...omit(s, ['shot', 'on', 'from', 'distance', 'height', 'turn']), pos: [...v.pos], target: [...v.target], fov: v.fov })

/** An automatic framing for a shot: `shot` set, its exact framing (`pos`, `target`, `fov`) gone. */
export const framedShot = (s: Shot, kind: string): Shot => ({ ...omit(s, ['pos', 'target', 'fov']), shot: kind })

/** "Shot n" for a new shot: the number it gets, or the next one no other shot is called. */
export function newShotLabel(list: Shot[]): string {
  const taken = new Set(list.map((s) => s?.label))
  let n = list.length + 1
  while (taken.has(`Shot ${n}`)) n++
  return `Shot ${n}`
}

/** A new shot at a view (New shot from this view), to add to `list`. */
export const newShotAt = (list: Shot[], v: CameraView): Shot => ({ label: newShotLabel(list), pos: [...v.pos], target: [...v.target], fov: v.fov })

/**
 * Whom a shot frames (its `on`) as the On checkboxes show it: which cast members it names (all of
 * them when it names nobody: the default is the whole cast), and the other subjects it names
 * (things), as written.
 */
export function shotSubjects(s: Shot | undefined, cast: Listed[]): { members: Set<string>; others: string[] } {
  const on = s?.on == null ? null : Array.isArray(s.on) ? s.on : [s.on]
  if (!on) return { members: new Set(cast.map((c) => c.id)), others: [] }
  const members = new Set<string>()
  const others: string[] = []
  for (const ref of on) {
    const c = cast.find((m) => refersTo(ref, m.id, m.name))
    if (c) members.add(c.id)
    else others.push(String(ref))
  }
  return { members, others }
}

/**
 * A shot that frames `who` too (`on` true) or no longer (false). Back to the whole cast and
 * nothing else, `on` goes (that is the default); a shot never ends up framing nobody.
 */
export function withSubject(s: Shot, cast: Listed[], who: string, on: boolean): Shot {
  const { members, others } = shotSubjects(s, cast)
  if (on) members.add(who)
  else members.delete(who)
  const out = clone(s)
  const list = [...cast.filter((c) => members.has(c.id)).map((c) => c.id), ...others]
  if (!list.length) return out
  if (!others.length && cast.every((c) => members.has(c.id))) delete out.on
  else out.on = list
  return out
}

/* ───────────── notes for Claude (the page's "feedback") ───────────── */

/** The page's own notes as the file has them now ([] when none). */
export const ownFeedback = (entry: Record<string, any>): Feedback[] => (Array.isArray(entry.feedback) ? clone(entry.feedback) : [])

/** A note: its text, and the camera, the shot and what was selected when it was written. Keys left out when unknown. */
export function newNote(n: { text: string; view?: CameraView | null; shot?: string | number | null; about?: string | null; added: string }): Feedback {
  const note: Feedback = { text: n.text }
  if (n.view) note.view = { pos: [...n.view.pos], target: [...n.view.target], fov: n.view.fov }
  if (n.shot != null && n.shot !== '') note.shot = n.shot
  if (n.about) note.about = n.about
  note.added = n.added
  return note
}

/** What a note records as its shot: the shot's label, or its number. */
export const noteShot = (s: Shot | undefined, i: number): string | number => (typeof s?.label === 'string' && s.label ? s.label : i + 1)

/** Where a note is in the list now: at `hint` when it is still there, else wherever it moved (-1: gone). */
export function noteIndex(list: unknown[], note: unknown, hint = -1): number {
  const same = (x: unknown) => JSON.stringify(x) === JSON.stringify(note)
  if (hint >= 0 && hint < list.length && same(list[hint])) return hint
  return list.findIndex(same)
}

/** A note marked done, or open again (the key goes). */
export function toggledDone(note: Feedback): Feedback {
  const out = clone(note)
  if (out.done) delete out.done
  else out.done = true
  return out
}

/**
 * Writing a page's notes: the whole list, or no "feedback" at all once it is empty (and no entry,
 * when nothing else is left in it).
 */
export function feedbackOps(key: string, list: Feedback[]): Op[] {
  if (list.length) return [{ op: 'set', path: ['scenes', key, 'feedback'], value: list }]
  return [{ op: 'delete', path: ['scenes', key, 'feedback'] }, { op: 'delete', path: ['scenes', key], ifEmpty: true }]
}

/** A view as one line: {"pos":[…],"target":[…],"fov":35}. */
const viewLine = (v: CameraView) => JSON.stringify({ pos: v.pos, target: v.target, fov: v.fov })

/**
 * The brief "Copy for Claude" puts on the clipboard: the page (title, id, path), its open notes,
 * each with its view, shot and what it is about (by name), and the page's entry exactly as the
 * direction file holds it (pretty JSON).
 */
export function brief(b: {
  page: { id: string; title: string; path: string }
  file: string
  /** the page's entry key in "scenes" (null: it has none) */
  key: string | null
  entry: unknown
  notes: Feedback[]
  /** a note's `about` (a card id or a thing id) by name, e.g. "Mira" or "Barrel" */
  nameOf: (id: string) => string | null
}): string {
  const out: string[] = []
  out.push(`Notes for Claude on a page of my story (Story Canvas, 3D direction).`, '')
  out.push(`Page: ${b.page.title || 'Untitled page'}`, `Id: ${b.page.id}`, `Path: ${b.page.path || 'not in a story yet'}`, '')
  const open = b.notes.filter((n) => isPlain(n) && !n.done)
  if (!open.length) out.push('No open notes.')
  else {
    out.push(`Open notes (${open.length}):`)
    open.forEach((n, i) => {
      out.push('', `${i + 1}. ${String(n.text ?? '').trim().replace(/\n/g, '\n   ')}`)
      if (n.about) {
        const name = b.nameOf(n.about)
        out.push(`   About: ${name && name !== n.about ? `${name} (${n.about})` : n.about}`)
      }
      if (n.shot != null) out.push(`   Shot: ${typeof n.shot === 'number' ? n.shot : `"${n.shot}"`}`)
      if (n.view && Array.isArray(n.view.pos)) out.push(`   View: ${viewLine(n.view)}`)
    })
  }
  out.push('')
  if (b.key == null || !isPlain(b.entry)) out.push(`The page has no entry in ${b.file} yet: it is staged automatically.`)
  else out.push(`Its entry in ${b.file}, under "scenes" → "${b.key}":`, JSON.stringify(b.entry, null, 2))
  out.push('', 'Views are exact framing, as a shot writes it (docs/scenes.md). When you act on a note, add a "reply" to it saying what you did.')
  return out.join('\n')
}

/* ───────────── the lock ───────────── */

/**
 * Every shot as exact framing, for a lock: the shot on screen (`current`) where the camera is now
 * (`now`: what you see is what is locked), a shot already exact as written (a lens filled in when
 * it has none), and every other where the director frames it (`viewOf`). Each keeps its label,
 * hold and move.
 */
export function lockedCamera(shots: Shot[], current: number, now: CameraView, viewOf: (i: number) => CameraView | null): Shot[] {
  return shots.map((s, i) => {
    if (i === current) return exactShot(s, now)
    if (isExact(s)) {
      if (typeof s.fov === 'number') return exactShot(s, { pos: s.pos!, target: s.target!, fov: s.fov })
      const v = viewOf(i)
      return exactShot(s, { pos: s.pos!, target: s.target!, fov: v?.fov ?? 35 })
    }
    const v = viewOf(i)
    return v ? exactShot(s, v) : clone(s)
  })
}

/** What a lock writes for the page besides its cast and camera: the moment and place as the stage shows them. */
export interface LockedMoment { place?: string | null; time: number; season: string; weather: string; ambient?: string | null }

/**
 * The page's full, explicit direction, as one undo step: its place, time, season, weather and
 * ambient (when there is one), its cast (everyone with an explicit at and facing) and camera
 * (every shot exact), "locked": true and the shot on screen as its "picture". Its dressing,
 * changes, notes and continues stay as they are. A value the entry already has is left alone.
 */
export function lockOps(key: string, entry: Record<string, any>, d: LockedMoment & { cast: CastEntry[]; camera: Shot[]; picture: number }): Op[] {
  const ops: Op[] = []
  const set = (field: string, value: unknown) => {
    if (JSON.stringify(entry[field]) !== JSON.stringify(value)) ops.push({ op: 'set', path: ['scenes', key, field], value: clone(value) })
  }
  if (d.place) set('place', d.place)
  set('time', round2(d.time))
  set('season', d.season)
  set('weather', d.weather)
  if (d.ambient) set('ambient', d.ambient)
  set('cast', d.cast)
  set('camera', d.camera)
  set('locked', true)
  set('picture', d.picture)
  return ops
}

/** Unlocking: "locked" goes, everything else stays. */
export const unlockOps = (key: string): Op[] => [{ op: 'delete', path: ['scenes', key, 'locked'] }]

/** Is the page's own entry locked? Only "locked": true locks it. */
export const isLocked = (entry: Record<string, any>) => entry.locked === true
