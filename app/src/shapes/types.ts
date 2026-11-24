import { T, type TLShape } from 'tldraw'

export interface SceneModifier {
  /** How the character differs from their base look in this scene. */
  text: string
  /** If true, the change carries forward into every later scene (scar, new outfit...). */
  persist: boolean
}

/** A point in world time. Only `year` is required for it to count as set. */
export interface WorldTime {
  year: number | null
  month: number | null
  day: number | null
  hour: number | null
}
export const EMPTY_TIME: WorldTime = { year: null, month: null, day: null, hour: null }

export interface ContainerProps {
  w: number
  h: number
  title: string
  synopsis: string
  color: string
}

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    character: {
      w: number
      h: number
      name: string
      role: string
      color: string
      appearance: string
      personality: string
      backstory: string
      /** Every portrait / visual iteration, oldest first. */
      portraits: string[]
      activePortrait: number
      /** Birth year in world time, so ages can be worked out on every page. */
      born: number | null
    }
    pin: {
      w: number
      h: number
      name: string
      kind: string
      color: string
      description: string
    }
    lore: {
      w: number
      h: number
      title: string
      category: string
      body: string
      start: WorldTime
      /** Optional end, for spans like wars or reigns. */
      end: WorldTime
    }
    story: ContainerProps
    book: ContainerProps
    chapter: ContainerProps
    scene: {
      w: number
      h: number
      title: string
      when: string
      /** Exact world time of the page; `when` stays as a descriptive label ("dusk, first frost"). */
      at: WorldTime
      summary: string
      characterIds: string[]
      locationIds: string[]
      modifiers: Record<string, SceneModifier>
    }
  }
}

export type CharacterShape = TLShape<'character'>
export type PinShape = TLShape<'pin'>
export type LoreShape = TLShape<'lore'>
export type SceneShape = TLShape<'scene'>
export type StoryContainerShape = TLShape<'story'>
export type BookShape = TLShape<'book'>
export type ChapterShape = TLShape<'chapter'>
export type ContainerShape = StoryContainerShape | BookShape | ChapterShape
export type ContainerType = ContainerShape['type']
export type StructureType = ContainerType | 'scene'

export const containerProps = { w: T.number, h: T.number, title: T.string, synopsis: T.string, color: T.string }

const n = T.nullable(T.number)
export const worldTimeProps = T.object({ year: n, month: n, day: n, hour: n })

export const characterProps = {
  w: T.number,
  h: T.number,
  name: T.string,
  role: T.string,
  color: T.string,
  appearance: T.string,
  personality: T.string,
  backstory: T.string,
  portraits: T.arrayOf(T.string),
  activePortrait: T.number,
  born: T.nullable(T.number),
}

export const pinProps = {
  w: T.number,
  h: T.number,
  name: T.string,
  kind: T.string,
  color: T.string,
  description: T.string,
}

export const loreProps = {
  w: T.number,
  h: T.number,
  title: T.string,
  category: T.string,
  body: T.string,
  start: worldTimeProps,
  end: worldTimeProps,
}

export const sceneProps = {
  w: T.number,
  h: T.number,
  title: T.string,
  when: T.string,
  at: worldTimeProps,
  summary: T.string,
  characterIds: T.arrayOf(T.string),
  locationIds: T.arrayOf(T.string),
  modifiers: T.dict(T.string, T.object({ text: T.string, persist: T.boolean })),
}

export const PIN_KINDS = ['place', 'town', 'landmark', 'region', 'danger', 'secret']
export const LORE_CATEGORIES = ['history', 'faction', 'magic', 'geography', 'culture', 'secret', 'other']
export const PALETTE = ['#e8590c', '#1971c2', '#2f9e44', '#ae3ec9', '#f08c00', '#c2255c', '#0c8599', '#495057']
