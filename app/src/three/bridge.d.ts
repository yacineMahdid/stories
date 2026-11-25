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

/** A first look from the card's text; `species` forces one (a person's skin and hair, an animal's fur). */
export function guessLook(card: { id: string; name: string; role?: string; appearance?: string; color?: string }, species?: string): Look
export function effectiveSpec(look: Look): Look
export function directionKey(direction: Direction, section: 'characters' | 'places', id: string, name?: string): string | null

export interface Studio {
  mount(parent: HTMLElement): void
  unmount(parent: HTMLElement): void
  show(look: Look): Promise<void>
  portrait(color?: string): Promise<Blob | null>
}
export function getStudio(): Studio

export interface Shot { shot?: string; label?: string; hold?: number }
export interface StageState {
  index: number
  hour: number
  weather: string
  season: string
  page: { id: string; title: string; path: string; summary: string; when: string }
  place: { id: string; name: string; description: string } | null
  cast: { who: string; character: { name: string }; do?: string; feel?: string }[]
  notes: { text: string; since: string; title: string }[]
  changes: { text: string }[]
  warnings: string[]
}

export class WorldView {
  el: HTMLElement
  mount(parent: HTMLElement): void
  unmount(parent: HTMLElement): void
  setWorld(document: unknown, direction: Direction): unknown
  pages(): { index: number; id: string; title: string; path: string }[]
  showPage(pageId: string, overrides?: { hour?: number; weather?: string; season?: string }, options?: { keepShot?: boolean }): Promise<StageState | null>
  /** Already showing this page or place of the current world, unchanged? */
  showing(kind: 'page' | 'place', id: string, overrides?: Record<string, unknown>): boolean
  showPlace(pinId: string, moment?: { hour?: number; weather?: string; season?: string }): Promise<StageState | null>
  shot(i: number): Shot | undefined
  readonly shots: Shot[]
  readonly state: StageState | null
  readonly warnings: string[]
  /** The shot the camera is on. */
  readonly shotIndex: number
  retime(moment: { hour?: number; weather?: string; season?: string }): Promise<unknown>
  still(width?: number, height?: number): Promise<Blob>
  dispose(): void
}
export function getPreview(): WorldView
export function coverPreviews(covered: boolean): void
