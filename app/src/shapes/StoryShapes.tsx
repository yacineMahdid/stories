import { BaseBoxShapeUtil, BaseFrameLikeShapeUtil, HTMLContainer, useEditor, useValue, type TLShape } from 'tldraw'
import {
  characterProps, containerProps, loreProps, pinProps, sceneProps,
  EMPTY_TIME, type BookShape, type ChapterShape, type CharacterShape, type ContainerShape, type LoreShape, type PinShape, type SceneShape, type StoryContainerShape,
} from './types'
import { getPages, getScenes, portraitOf } from '../lib/world'
import { formatSpan, formatTime, isSet } from '../lib/time'
import { buildOutline, containerTypeAccepts, countDescendants, findNode, LEVEL } from '../lib/structure'

function roundRect(w: number, h: number, r = 14) {
  const p = new Path2D()
  p.roundRect(0, 0, w, h, r)
  return p
}

/* ───────────────────────────── Character ───────────────────────────── */

export class CharacterShapeUtil extends BaseBoxShapeUtil<CharacterShape> {
  static override type = 'character' as const
  static override props = characterProps

  getDefaultProps(): CharacterShape['props'] {
    return {
      w: 260, h: 360, name: 'New character', role: '', color: '#e8590c',
      appearance: '', personality: '', backstory: '', portraits: [], activePortrait: 0, born: null,
    }
  }
  component(shape: CharacterShape) {
    return <CharacterCard shape={shape} />
  }
  getIndicatorPath(shape: CharacterShape) {
    return roundRect(shape.props.w, shape.props.h)
  }
}

function CharacterCard({ shape }: { shape: CharacterShape }) {
  const editor = useEditor()
  const sceneCount = useValue('scene count', () => getScenes(editor).filter((s) => s.props.characterIds.includes(shape.id)).length, [editor, shape.id])
  const p = shape.props
  const img = portraitOf(shape)
  return (
    <HTMLContainer className="sc-card" style={{ width: p.w, height: p.h, borderColor: p.color }}>
      <div className="sc-portrait" style={{ background: p.color + '22' }}>
        {img ? <img src={img} draggable={false} /> : <span style={{ color: p.color }}>{(p.name || '?').slice(0, 1)}</span>}
        {p.portraits.length > 1 && <em className="sc-badge">v{p.activePortrait + 1}/{p.portraits.length}</em>}
      </div>
      <div className="sc-body">
        <strong style={{ color: p.color }}>{p.name || 'Unnamed'}</strong>
        {p.role && <small>{p.role}</small>}
        <p>{p.appearance || <i>No appearance yet — select me to describe how I look.</i>}</p>
      </div>
      <footer>
        <span>{sceneCount} scene{sceneCount === 1 ? '' : 's'}</span>
        {p.backstory && <span>• has backstory</span>}
      </footer>
    </HTMLContainer>
  )
}

/* ───────────────────────────── Map pin ───────────────────────────── */

export class PinShapeUtil extends BaseBoxShapeUtil<PinShape> {
  static override type = 'pin' as const
  static override props = pinProps

  getDefaultProps(): PinShape['props'] {
    return { w: 180, h: 64, name: 'New place', kind: 'place', color: '#c2255c', description: '' }
  }
  override canResize() { return false }
  override hideRotateHandle() { return true }
  component(shape: PinShape) {
    return <PinView shape={shape} />
  }
  getIndicatorPath(shape: PinShape) {
    return roundRect(shape.props.w, shape.props.h, 8)
  }
}

function PinView({ shape }: { shape: PinShape }) {
  const editor = useEditor()
  const sceneCount = useValue('pin scenes', () => getScenes(editor).filter((s) => s.props.locationIds.includes(shape.id)).length, [editor, shape.id])
  const p = shape.props
  return (
    <HTMLContainer className="sc-pin" style={{ width: p.w, height: p.h }}>
      <svg width="28" height="36" viewBox="0 0 28 36">
        <path d="M14 35C14 35 27 21 27 13A13 13 0 0 0 1 13C1 21 14 35 14 35Z" fill={p.color} stroke="#fff" strokeWidth="2" />
        <circle cx="14" cy="13" r="5" fill="#fff" />
      </svg>
      <div className="sc-pin-label" style={{ borderColor: p.color }}>
        <b>{p.name || 'Unnamed'}</b>
        <small>{p.kind}{sceneCount ? ` · ${sceneCount} scene${sceneCount === 1 ? '' : 's'}` : ''}</small>
      </div>
    </HTMLContainer>
  )
}

/* ───────────────────────────── Lore note ───────────────────────────── */

export class LoreShapeUtil extends BaseBoxShapeUtil<LoreShape> {
  static override type = 'lore' as const
  static override props = loreProps

  getDefaultProps(): LoreShape['props'] {
    return { w: 320, h: 240, title: 'New lore', category: 'history', body: '', start: { ...EMPTY_TIME }, end: { ...EMPTY_TIME } }
  }
  component(shape: LoreShape) {
    const p = shape.props
    return (
      <HTMLContainer className="sc-card sc-lore" style={{ width: p.w, height: p.h }}>
        <header><span className="sc-tag">{p.category}</span><em>hidden from scenes</em></header>
        <span className={`sc-date ${isSet(p.start) ? '' : 'unset'}`}>{isSet(p.start) ? formatSpan(p.start, p.end) : 'no date yet'}</span>
        <strong>{p.title || 'Untitled'}</strong>
        <p>{p.body || <i>Select me to write the backstory.</i>}</p>
      </HTMLContainer>
    )
  }
  getIndicatorPath(shape: LoreShape) {
    return roundRect(shape.props.w, shape.props.h)
  }
}

/* ───────────────────────────── Scene ───────────────────────────── */

export class SceneShapeUtil extends BaseBoxShapeUtil<SceneShape> {
  static override type = 'scene' as const
  static override props = sceneProps

  getDefaultProps(): SceneShape['props'] {
    return { w: 300, h: 260, title: '', when: '', at: { ...EMPTY_TIME }, summary: '', characterIds: [], locationIds: [], modifiers: {} }
  }
  component(shape: SceneShape) {
    return <SceneCard shape={shape} />
  }
  getIndicatorPath(shape: SceneShape) {
    return roundRect(shape.props.w, shape.props.h)
  }
}

function SceneCard({ shape }: { shape: SceneShape }) {
  const editor = useEditor()
  const info = useValue('scene info', () => {
    const entry = getPages(editor).find((p) => p.scene.id === shape.id)
    const characters = shape.props.characterIds.map((id) => editor.getShape(id as any) as CharacterShape | undefined)
    const places = shape.props.locationIds.map((id) => editor.getShape(id as any) as PinShape | undefined)
    return { number: entry?.node.number ?? 0, path: entry?.node.path ?? '', characters, places }
  }, [editor, shape])
  const p = shape.props
  const where = info.path.split(' · ').slice(0, -1).join(' · ')
  return (
    <HTMLContainer className="sc-card sc-scene" style={{ width: p.w, height: p.h }}>
      <header>
        <span className="sc-tag">Page {info.number}</span>
        {where && <small className="sc-path">{where}</small>}
        <em>{p.when || (isSet(p.at) ? '' : 'when?')}</em>
      </header>
      {isSet(p.at) && <span className="sc-date">{formatTime(p.at)}</span>}
      <strong>{p.title || 'Untitled page'}</strong>
      <div className="sc-chips">
        {info.characters.map((c, i) => c
          ? <span key={c.id} className="sc-chip" style={{ background: c.props.color }}>{c.props.name}{p.modifiers[c.id]?.text ? ' *' : ''}</span>
          : <span key={i} className="sc-chip sc-missing">missing character</span>)}
        {info.places.map((pl, i) => pl
          ? <span key={pl.id} className="sc-chip sc-place" style={{ borderColor: pl.props.color }}>⌖ {pl.props.name}</span>
          : <span key={i} className="sc-chip sc-missing">missing place</span>)}
      </div>
      <p>{p.summary || <i>What happens here?</i>}</p>
    </HTMLContainer>
  )
}

/* ───────────────────── Story / Book / Chapter containers ───────────────────── */

const CONTAINER_COLORS = { story: '#1f1d1a', book: '#5f3dc4', chapter: '#1971c2' }

function makeContainerUtil<S extends ContainerShape>(type: S['type']) {
  return class extends BaseFrameLikeShapeUtil<S> {
    static override type = type
    static override props = containerProps

    getDefaultProps(): S['props'] {
      const [w, h] = LEVEL[type].min
      return { w, h, title: '', synopsis: '', color: CONTAINER_COLORS[type] } as S['props']
    }
    override canReceiveNewChildrenOfType(shape: S, childType: TLShape['type']) {
      return !shape.isLocked && containerTypeAccepts(type, childType)
    }
    // Never hide pages that poke outside their chapter; the container grows instead.
    override shouldClipChild() { return false }
    override getClipPath() { return undefined }
    override canEdit() { return false }
    component(shape: S) {
      return <ContainerView shape={shape} />
    }
    getIndicatorPath(shape: S) {
      return roundRect(shape.props.w, shape.props.h, type === 'chapter' ? 14 : 20)
    }
  }
}

function ContainerView({ shape }: { shape: ContainerShape }) {
  const editor = useEditor()
  const info = useValue('container info', () => {
    const node = findNode(buildOutline(editor), shape.id)
    return { path: node?.path ?? LEVEL[shape.type].label, counts: node ? countDescendants(node) : {} }
  }, [editor, shape.id])
  const p = shape.props
  const { header } = LEVEL[shape.type]
  const counts = [
    info.counts.book && `${info.counts.book} book${info.counts.book === 1 ? '' : 's'}`,
    info.counts.chapter && `${info.counts.chapter} chapter${info.counts.chapter === 1 ? '' : 's'}`,
    `${info.counts.scene ?? 0} page${info.counts.scene === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ')
  return (
    <HTMLContainer className={`sc-container sc-${shape.type}`} style={{ width: p.w, height: p.h, borderColor: p.color, ['--c' as any]: p.color }}>
      <div className="sc-container-head" style={{ height: header }}>
        <div className="sc-container-title">
          <span className="sc-tag" style={{ background: p.color }}>{shape.type === 'story' ? 'Full story' : info.path}</span>
          <strong>{p.title || `Untitled ${LEVEL[shape.type].label.toLowerCase()}`}</strong>
          <small>{counts}</small>
        </div>
        {p.synopsis && <p>{p.synopsis}</p>}
      </div>
    </HTMLContainer>
  )
}

export const StoryContainerUtil = makeContainerUtil<StoryContainerShape>('story')
export const BookShapeUtil = makeContainerUtil<BookShape>('book')
export const ChapterShapeUtil = makeContainerUtil<ChapterShape>('chapter')

export const storyShapeUtils = [CharacterShapeUtil, PinShapeUtil, LoreShapeUtil, SceneShapeUtil, StoryContainerUtil, BookShapeUtil, ChapterShapeUtil]
