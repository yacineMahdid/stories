// Types for bridge.js (the 3D engine lives in plain JS at the repo root).

export type Look = Record<string, any>
export type Direction = Record<string, any>

export interface Option { id: string; label: string }
export interface ColorOption extends Option { value: string }

export const lookOptions: {
  species: Option[]
  hair: Option[]
  hairColors: ColorOption[]
  eyes: Option[]
  bodies: Option[]
  sleeves: string[]
  legs: string[]
}
export const placePresets: string[]
export const weathers: Option[]
/** What a cast entry and a page's props can be, for the Direct panel's selects. */
export const directOptions: {
  /** `do`: every animation name, by group (Basics first) */
  animations: { group: string; names: string[] }[]
  /** `feel`: every emotion, Neutral first */
  emotions: Option[]
  /** `hold`: every hand prop (held-*), by its label */
  held: Option[]
  /** a page's dressing: every set piece by family (no hand props, rows, rings or scatters) */
  props: { family: string; label: string; kinds: Option[] }[]
  /** by a spot's pose (sit, floor, lie, kneel): the clips it can play; any other `do` gives way to the spot's pose */
  spotClips: Record<string, string[]>
}

/** A first look from the card's text; `species` forces one (a person's skin and hair, an animal's fur). */
export function guessLook(card: { id: string; name: string; role?: string; appearance?: string; color?: string }, species?: string): Look
export function effectiveSpec(look: Look): Look
export function directionKey(direction: Direction, section: 'characters' | 'places', id: string, name?: string): string | null

export interface Studio {
  mount(parent: HTMLElement): void
  unmount(parent: HTMLElement): void
  show(look: Look, card?: string | null): Promise<void>
  portrait(color?: string): Promise<Blob | null>
}
export function getStudio(): Studio

/* Coordinates. "World" is the 3D scene's: what groundPoint gives and moveCast / moveThing take.
 * "Local" is the page's place units, as staging.json writes them: [x, z] east and south of the
 * pin, turned by the place's `rotate`. Facings in the file are place degrees (0 faces south, 90
 * east, whole numbers 0–359); a world yaw is (degrees + place.rotate) in radians. Positions are
 * written to 0.01, degrees whole, a lens to 0.1°. */

/** [x, z] in place units. */
export type Local = [number, number]
/** A world point: x and z in the scene, y its height. */
export interface WorldPoint { x: number; y: number; z: number }

/** A camera as a shot's exact framing: x and z in place units, y in world height; fov in degrees. */
export interface CameraView { pos: [number, number, number]; target: [number, number, number]; fov: number }

/** A shot as the direction writes it (docs/scenes.md, Camera). */
export interface Shot {
  shot?: string
  label?: string
  hold?: number
  move?: string
  speed?: number
  on?: string | string[]
  from?: number
  distance?: number
  height?: number
  fov?: number
  turn?: number
  pos?: [number, number, number]
  target?: [number, number, number]
  [key: string]: unknown
}

/** A cast entry as the direction writes it (docs/scenes.md, Cast). */
export interface CastEntry {
  who: string
  /** [x, z] in place units, or "thingId.spot" (a prop's spot), or { near | map | pin, offset } */
  at?: Local | string | Record<string, unknown>
  /** place degrees, or a cast member's id or name, a thing id, "group" or "camera" */
  facing?: number | string
  do?: string
  feel?: string
  talk?: boolean
  hold?: string | { kind: string; [key: string]: unknown }
  path?: (Local | Record<string, unknown>)[]
  speed?: number
  loop?: string
  look?: Look
  /** only on a member gathered automatically (never written) */
  auto?: boolean
  [key: string]: unknown
}

/** A dressing entry as the direction writes it (docs/scenes.md, Things). */
export interface ThingEntry {
  id?: string
  kind: string
  at?: Local | Record<string, unknown>
  facing?: number | string
  [key: string]: unknown
}

/** A note for Claude on a page (docs/scenes.md, Scenes: "feedback"). */
export interface Feedback {
  text: string
  view?: CameraView
  /** the label of the shot on screen, or its number */
  shot?: string | number
  /** the selected character's or prop's id */
  about?: string
  /** ISO date-time */
  added?: string
  done?: boolean
  /** Claude's answer, written when it acts on the note */
  reply?: string
}

/** Where a page's cast or camera comes from: its own entry, a page it continues (`page`), another page's camera through { "same" } (`page`), or nobody's (automatic). */
export interface Source<K extends string> { kind: K; page?: string }

export interface StageState {
  index: number
  hour: number
  weather: string
  season: string
  ambient: string | null
  page: { id: string; title: string; path: string; summary: string; when: string; characterIds?: string[] }
  place: { id: string; name: string; description: string; rotate: number; pos: [number, number] } | null
  /** The page's own direction entry as read (empty when it has none). */
  dir: Direction
  /** Ids of the pages it continues, nearest first. */
  chain: string[]
  /** Everyone on stage, in staging order: each entry with `who` as the card id, its look merged with lasting look changes. Gathered members have `auto: true`. */
  cast: (CastEntry & { who: string; character: { id: string; name: string } })[]
  shots: Shot[]
  notes: { text: string; since: string; title: string }[]
  changes: { text: string }[]
  warnings: string[]
  /** The key of the page's own entry in "scenes" (its id, or a title written by hand); null when it has none (write under the page id). */
  entryKey: string | null
  castFrom: Source<'auto' | 'inherit' | 'own'>
  cameraFrom: Source<'auto' | 'inherit' | 'same' | 'own'>
  /** Where the hour, season and weather come from: this page's direction ("own"), the page's time on the canvas ("canvas"), its When text ("when"), a page it continues ("inherit"), or the defaults. */
  momentFrom: Record<'hour' | 'season' | 'weather', 'own' | 'canvas' | 'when' | 'inherit' | 'default'>
  /** The cast list in effect as written (this page's own, or the one it inherits), also entries that match no character. */
  castList: CastEntry[]
  /** Beside `cast`, one each: the entry as written (who, at, facing… as in the file); a gathered member's as it was made, with auto: true. */
  castEntries: CastEntry[]
  /** Beside the page's own "dressing" list, one each: the thing id a single entry became (pickable and movable), null for a row, ring or scatter. */
  dressingIds: (string | null)[]
  locked: boolean
  /** The index of the shot that is the page's picture, when locked (or null). */
  picture: number | null
  feedback: Feedback[]
}

export type Picked = { kind: 'cast'; id: string } | { kind: 'thing'; id: string }

/** A cast member as the editor lists them (WorldView.castInfo). */
export interface CastInfo {
  /** the card id (what `who` is written as) */
  who: string
  name: string
  /** gathered automatically: not in the page's cast yet */
  auto: boolean
  /** as written (a gathered member's as it was made) */
  entry: CastEntry
  /** where they stand now, local */
  at: Local | null
  /** place degrees they face now (also when the entry names a reference) */
  facing: number | null
  /** the "thingId.spot" they stand at, or null */
  spot: string | null
  /** world position and yaw of the model now */
  pos: [number, number, number] | null
  yaw: number | null
  /** walks a path (moving one moves its whole path) */
  walker: boolean
}

/** One of this page's own dressing props (WorldView.thingMark). */
export interface ThingMark {
  id: string
  kind: string
  /** its place in the page's "dressing" list */
  index: number
  /** where it stands and faces now, local */
  at: Local
  facing: number
  /** world position and yaw of the model now */
  pos: [number, number, number]
  yaw: number
  /** the entry to write back at `index` (moved or turned: at / facing as it is now; the rest as written) */
  entry: ThingEntry
}

/** A part of the view, in CSS pixels from its top left. */
export interface Frame { x: number; y: number; w: number; h: number }
/** A prop's spot a character can stand at (WorldView.spotsNear). */
export interface Spot {
  /** "thingId.spot": what a cast entry's `at` takes */
  ref: string
  /** e.g. "Bench west, left" */
  label: string
  thing: string
  spot: string
  kind: string
  /** stand, sit, lie, lean, floor or kneel */
  pose: string
  /** from the point asked about, in place units */
  distance: number
  /** the cast member standing there, or null */
  by: string | null
}

export class WorldView {
  el: HTMLElement
  mount(parent: HTMLElement): void
  unmount(parent: HTMLElement): void
  /** Stop drawing (nobody can see it), and draw again. */
  suspend(): void
  resume(): void
  setWorld(document: unknown, direction: Direction): unknown
  pages(): { index: number; id: string; title: string; path: string }[]
  /**
   * Stage a page. `keepShot`: the same page again stays on its shot (framed again, unless the
   * camera was moved by hand). `keepCamera`: the same page again leaves the camera exactly where
   * it is. Another page starts on its first shot. Null when a newer show came first.
   */
  showPage(pageId: string, overrides?: { hour?: number; weather?: string; season?: string }, options?: { keepShot?: boolean; keepCamera?: boolean }): Promise<StageState | null>
  /** Already showing this page or place of the current world, unchanged? */
  showing(kind: 'page' | 'place', id: string, overrides?: Record<string, unknown>): boolean
  /** Has the stage caught up with `direction` (pass getStaging()): given to setWorld and staged on screen, with nothing waiting? A direction that differs only in notes for Claude ("feedback") stages nothing. */
  upToDate(direction: Direction): boolean
  showPlace(pinId: string, moment?: { hour?: number; weather?: string; season?: string }): Promise<StageState | null>
  shot(i: number): Shot | undefined
  readonly shots: Shot[]
  readonly state: StageState | null
  readonly warnings: string[]
  /** The shot the camera is on. */
  readonly shotIndex: number
  retime(moment: { hour?: number; weather?: string; season?: string }): Promise<unknown>
  /** A still of what the camera sees now, or with `shot` of shot i (the camera goes back after). Never shows the selection. */
  still(width?: number, height?: number, options?: { shot?: number | null }): Promise<Blob>
  dispose(): void

  /* ── directing ── */

  /** Direct mode on or off. While on, the camera never moves by itself: re-stages keep it, a resize doesn't frame the shot again, and a shot's move (orbit, push…) holds at its framing. Off, watch mode is as before. */
  setDirecting(on: boolean): void
  readonly directing: boolean
  /** The orbit controls (set `enabled = false` on pointerdown over something you drag, back on at pointerup). */
  readonly controls: { enabled: boolean }
  /** The canvas the stage draws on: the element under the pointer (its cursor is what shows). */
  readonly canvas: HTMLCanvasElement
  /**
   * The picture's frame in the view (CSS pixels from its top left), or null for all of it: shots
   * are framed for it, the camera aims at its middle, and a still shows what it shows. True when it changed.
   */
  setFrame(frame: Frame | null): boolean
  readonly frame: Frame | null
  /** Staging work waiting or under way: ignore pointerdown until it is done. */
  readonly pending: boolean
  /** Resolves once no staging work is waiting or under way (also work queued meanwhile). */
  idle(): Promise<void>
  /** Would staging this page now build its set again (another page or place, a new season, a prop added, moved or removed)? That is the slow part. */
  rebuilds(pageId: string): boolean
  /** Stage the page on screen again as the direction has it (the viewer's own time, weather and season go), keeping the camera. */
  restage(): Promise<StageState | null>
  /** The camera was moved by hand since a shot last framed it. */
  readonly userCamera: boolean

  /** What is under a point of the view (client pixels): a cast member by card id, one of this page's own single dressing props by thing id (see StageState.dressingIds), or null. The nearest wins; anything else in front hides it. */
  pick(clientX: number, clientY: number): Picked | null
  /** Where a point of the view meets the ground, the water or a deck (world); null for sky. */
  groundPoint(clientX: number, clientY: number): WorldPoint | null
  /** Move a cast member's live model to world (x, z), on the ground or a deck (no re-stage; fine on every pointer move). A walker's whole path moves with it. */
  moveCast(id: string, x: number, z: number): boolean
  /** Turn a cast member's live model to a world yaw (radians). */
  turnCast(id: string, yaw: number): boolean
  /** Move one of this page's own dressing props (world x, z; no re-stage). */
  moveThing(id: string, x: number, z: number): boolean
  /** Turn one of this page's own dressing props to a world yaw (radians). */
  turnThing(id: string, yaw: number): boolean
  /** Move what `kind`/`id` names by the view: `right` and `away` from the camera, in world units (place units: the same size). */
  nudge(kind: 'cast' | 'thing', id: string, right: number, away: number): boolean
  /** Turn what `kind`/`id` names by `deg` degrees (counterclockwise seen from above: facing degrees go up). */
  turn(kind: 'cast' | 'thing', id: string, deg: number): boolean
  /** Show the selection (a ring under a character, a box round a prop), kept by id through re-stages; select(null) clears it. True when it is on stage. */
  select(kind: 'cast' | 'thing' | null, id?: string | null): boolean
  readonly selected: Picked | null
  /** The camera now as exact framing. setCameraView(cameraView()) moves it less than 0.01. */
  cameraView(): CameraView | null
  /** Put the camera at a view; it counts as a move by hand. */
  setCameraView(view: CameraView): boolean
  /** Change the camera's lens (field of view, degrees) where it stands; it counts as a move by hand. */
  setLens(fov: number): boolean
  /** The exact framing shot i gives (what the camera shows after shot(i)), without moving the camera. */
  shotView(i: number): CameraView | null
  /**
   * The page's cast as entries to write as its "cast" (copy on write), from the direction as it is
   * now (also while a re-stage is on its way): an entry nobody moved or turned exactly as written,
   * a moved or turned one with where it stands (`at`, a walker's `path`) or faces (`facing`) now,
   * and gathered members (by card id) where they stand. `explicit` (the lock): everyone with an
   * explicit at ([x, z] or the spot string) and facing (degrees or the entry's reference), by card
   * id. Writing it back stages the same picture.
   */
  castMarks(opts?: { explicit?: boolean }): CastEntry[]
  /** Everyone on stage, in staging order, with where they stand and face now. */
  castInfo(): CastInfo[]
  /** One of this page's own dressing props, with the entry to write back (null for anything else). */
  thingMark(id: string): ThingMark | null
  /** The ground at the middle of the picture, facing the camera. */
  centerMark(): { at: Local; facing: number } | null
  /** Where a new prop of `kind` goes: the ground nearest the middle of the picture, clear of the cast (`clear`, default 0.8, plus its size) and of solid props, facing the camera. */
  propMark(kind: string, clear?: number): { at: Local; facing: number } | null
  /**
   * What a drag of a cast member or one of this page's props starts from: `at`, the world [x, z]
   * moveCast/moveThing moves (a walker: where its path is), `foot`, the ground under the model now
   * (world), and `screen`, that point in client pixels. Keep the pointer's offset from `screen`, and
   * move by as much as the ground under pointer + offset moves from `foot`.
   */
  grabOf(kind: 'cast' | 'thing', id: string): { at: Local; foot: WorldPoint; screen: [number, number] } | null
  /** Open ground near the middle of the view, `clear` (default 0.9) from everyone, facing the camera (for a new cast member). */
  freeMark(clear?: number): { at: Local; facing: number } | null
  /** The spots of the props near a local point (default r = 2), nearest first. */
  spotsNear(x: number, z: number, r?: number): Spot[]
  /** World [x, z] to local, and back, for the page's place. */
  toLocal(p: Local): Local
  fromLocal(p: Local): Local
  /** Place degrees (whole, 0–359) of a world yaw, and the world yaw of place degrees. */
  localFacing(yaw: number): number
  worldYaw(deg: number): number
  /** Place degrees from a local point toward the camera now (what "the camera" in the Facing select stores). */
  facingToCamera(at: Local): number
  /** Every thing id in the world (places, every page's dressing and added things): a new prop's id must be none of these. */
  thingIds(): string[]
}
export function getPreview(): WorldView
export function coverPreviews(covered: boolean): void
