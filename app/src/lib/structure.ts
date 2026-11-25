import type { Editor, TLParentId, TLShape, TLShapeId } from 'tldraw'
import type { ContainerShape, ContainerType, SceneShape, StructureType } from '../shapes/types'

/**
 * The story is a tree drawn on the Story canvas:
 *   Story ⊃ Books ⊃ Chapters ⊃ Pages (scenes)
 * Containers are nested shapes; reading order inside each one is rows top → bottom,
 * left → right within a row. "Tidy layout" puts pages and chapters in rows and stacks books.
 */

export const STORY_PAGE = 'page:story' as TLParentId

export const LEVEL: Record<StructureType, { label: string; child?: StructureType; header: number; min: [number, number] }> = {
  story: { label: 'Story', child: 'book', header: 104, min: [460, 300] },
  book: { label: 'Book', child: 'chapter', header: 92, min: [420, 250] },
  chapter: { label: 'Chapter', child: 'scene', header: 80, min: [348, 200] },
  scene: { label: 'Page', header: 0, min: [300, 260] },
}
export const PAD = 24
export const GAP = 28

export const isContainer = (s: TLShape | undefined): s is ContainerShape =>
  !!s && (s.type === 'story' || s.type === 'book' || s.type === 'chapter')
export const isStructural = (s: TLShape | undefined): s is ContainerShape | SceneShape => isContainer(s) || s?.type === 'scene'

/** Rows top → bottom, then left → right (two shapes are in the same row if they overlap vertically). */
function readingSort(shapes: TLShape[], editor: Editor) {
  return shapes
    .map((s) => ({ s, b: editor.getShapePageBounds(s)! }))
    .sort((a, b) => {
      const sameRow = a.b.minY < b.b.maxY && b.b.minY < a.b.maxY
      return sameRow ? a.b.x - b.b.x : a.b.y - b.b.y
    })
    .map((x) => x.s)
}

export function structuralChildren(editor: Editor, parentId: TLParentId): (ContainerShape | SceneShape)[] {
  const kids = editor.getSortedChildIdsForParent(parentId).map((id) => editor.getShape(id)).filter(isStructural)
  return readingSort(kids, editor) as (ContainerShape | SceneShape)[]
}

export interface OutlineNode {
  shape: ContainerShape | SceneShape
  /** Number within its book (pages, chapters) or story (books). */
  number: number
  /** e.g. "Book 1 · Ch 2 · p. 5" */
  path: string
  storyId: TLShapeId | null
  children: OutlineNode[]
}

export interface PageEntry {
  scene: SceneShape
  node: OutlineNode
}

export function buildOutline(editor: Editor): OutlineNode[] {
  const walk = (
    parentId: TLParentId,
    ctx: { storyId: TLShapeId | null; book?: number; chapter?: number; pages: { n: number }; counters: Record<string, number> },
  ): OutlineNode[] =>
    structuralChildren(editor, parentId).map((shape) => {
      const type = shape.type as StructureType
      let number: number
      let path: string
      let childCtx = ctx
      if (type === 'scene') {
        number = ++ctx.pages.n
        path = [ctx.book && `Book ${ctx.book}`, ctx.chapter && `Ch ${ctx.chapter}`, `p. ${number}`].filter(Boolean).join(' · ')
      } else {
        number = ctx.counters[type] = (ctx.counters[type] ?? 0) + 1
        if (type === 'story') {
          path = `Story ${number}`
          childCtx = { storyId: shape.id, pages: { n: 0 }, counters: {} }
        } else if (type === 'book') {
          path = `Book ${number}`
          // Chapters and pages are numbered continuously through a book.
          childCtx = { ...ctx, book: number, pages: { n: 0 }, counters: {} }
        } else {
          path = [ctx.book && `Book ${ctx.book}`, `Ch ${number}`].filter(Boolean).join(' · ')
          childCtx = { ...ctx, chapter: number, counters: ctx.counters }
        }
      }
      const node: OutlineNode = { shape, number, path, storyId: ctx.storyId, children: [] }
      if (type !== 'scene') node.children = walk(shape.id, childCtx)
      return node
    })
  return walk(STORY_PAGE, { storyId: null, pages: { n: 0 }, counters: {} })
}

export function flattenPages(outline: OutlineNode[]): PageEntry[] {
  const out: PageEntry[] = []
  const visit = (n: OutlineNode) => {
    if (n.shape.type === 'scene') out.push({ scene: n.shape as SceneShape, node: n })
    n.children.forEach(visit)
  }
  outline.forEach(visit)
  return out
}

export function findNode(outline: OutlineNode[], id: string): OutlineNode | undefined {
  for (const n of outline) {
    if (n.shape.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
}

export function countDescendants(node: OutlineNode) {
  const c: Record<string, number> = {}
  const visit = (n: OutlineNode) => n.children.forEach((k) => { c[k.shape.type] = (c[k.shape.type] ?? 0) + 1; visit(k) })
  visit(node)
  return c
}

/* ───────────── creating ───────────── */

/** The selected container (or the nearest selected ancestor) that can hold a new `type`. */
function targetParent(editor: Editor, type: StructureType): ContainerShape | undefined {
  const parentType = (Object.keys(LEVEL) as StructureType[]).find((k) => LEVEL[k].child === type)
  let s: TLShape | undefined = editor.getOnlySelectedShape() ?? undefined
  while (s) {
    if (s.type === parentType) return s as ContainerShape
    s = editor.getShape(s.parentId as TLShapeId)
  }
  // Nothing selected: if there is exactly one possible parent, use it.
  if (parentType) {
    const all = editor.getCurrentPageShapes().filter((x) => x.type === parentType)
    if (all.length === 1) return all[0] as ContainerShape
  }
}

export function addStructural(editor: Editor, type: StructureType) {
  if (editor.getCurrentPageId() !== STORY_PAGE) editor.setCurrentPage(STORY_PAGE as any)
  const parent = targetParent(editor, type)
  const [w, h] = LEVEL[type].min
  let id: TLShapeId | undefined
  editor.run(() => {
    if (parent) {
      const siblings = structuralChildren(editor, parent.id)
      const last = siblings.at(-1)
      const header = LEVEL[parent.type].header
      const stacked = parent.type === 'story' // books stack vertically, everything else flows in a row
      const x = !last ? PAD : stacked ? PAD : last.x + last.props.w + GAP
      const y = !last ? header : stacked ? last.y + last.props.h + GAP : last.y
      editor.createShape({ type, parentId: parent.id, x, y, props: { w, h } as any })
    } else {
      const c = editor.getViewportPageBounds().center
      editor.createShape({ type, x: c.x - w / 2, y: c.y - h / 2, props: { w, h } as any })
    }
    const created = editor.getCurrentPageShapesSorted().filter((s) => s.type === type).at(-1)!
    id = created.id
    fitAncestors(editor, created)
  })
  const created = editor.getShape(id!)!
  editor.select(created.id)
  editor.centerOnPoint(editor.getShapePageBounds(created)!.center, { animation: { duration: 250 } })
}

/** Grow every container above `shape` so its children fit (never shrinks, never moves anything). */
export function fitAncestors(editor: Editor, shape: TLShape) {
  let parent = editor.getShape(shape.parentId as TLShapeId)
  while (isContainer(parent)) {
    let w = parent.props.w, h = parent.props.h
    for (const id of editor.getSortedChildIdsForParent(parent.id)) {
      const k = editor.getShape(id)!
      const b = editor.getShapeGeometry(k).bounds
      w = Math.max(w, k.x + b.w + PAD)
      h = Math.max(h, k.y + b.h + PAD)
    }
    if (w !== parent.props.w || h !== parent.props.h) editor.updateShape({ id: parent.id, type: parent.type, props: { w, h } })
    parent = editor.getShape(parent.id)!
    parent = editor.getShape(parent.parentId as TLShapeId)
  }
}

/**
 * Give a page card (or a box) a new height without changing the reading order: whatever sits
 * below it in the same box moves down, or back up, by as much as needed, and each box around it
 * is refitted the same way up to the story. Boxes grow to fit; when something shrinks they shrink
 * by at most that much, never below what their contents need.
 */
export function resizeKeepingOrder(editor: Editor, shape: ContainerShape | SceneShape, h: number) {
  let current: ContainerShape | SceneShape = shape
  let newH = h
  for (;;) {
    const oldH = current.props.h
    if (Math.abs(newH - oldH) < 0.5) break
    editor.updateShape({ id: current.id, type: current.type, props: { h: newH } } as Parameters<Editor['updateShape']>[0])
    shiftBelow(editor, current, oldH, newH)
    const parent: TLShape | undefined = editor.getShape(current.parentId as TLShapeId)
    if (!isContainer(parent)) break
    const need = Math.max(LEVEL[parent.type].min[1], ...editor.getSortedChildIdsForParent(parent.id).map((id) => {
      const k = editor.getShape(id)!
      return k.y + editor.getShapeGeometry(k).bounds.h + PAD
    }))
    const dy = newH - oldH
    newH = dy > 0 ? Math.max(parent.props.h, need) : Math.max(need, parent.props.h + dy)
    current = parent
  }
}

/** After `shape` went from oldH to newH tall, move the shapes below it so the gap stays right. */
function shiftBelow(editor: Editor, shape: TLShape, oldH: number, newH: number) {
  const oldBottom = shape.y + oldH
  const siblings = editor.getSortedChildIdsForParent(shape.parentId as TLParentId).map((id) => editor.getShape(id)!).filter((k) => k.id !== shape.id)
  const below = siblings.filter((k) => k.y >= oldBottom - 1)
  if (!below.length) return
  const above = siblings.filter((k) => k.y < oldBottom - 1)
  const bottom = Math.max(shape.y + newH, ...above.map((k) => k.y + editor.getShapeGeometry(k).bounds.h))
  const top = Math.min(...below.map((k) => k.y))
  let shift = bottom + GAP - top
  const dy = newH - oldH
  shift = dy > 0 ? Math.max(0, shift) : Math.min(0, Math.max(shift, dy)) // never further than the change
  if (Math.abs(shift) < 0.5) return
  for (const k of below) editor.updateShape({ id: k.id, type: k.type, y: k.y + shift })
}

/* ───────────── tidy layout ───────────── */

/** Lay a container out from the bottom up: pages & chapters in a row, books stacked. Returns its new size. */
function tidy(editor: Editor, shape: ContainerShape | SceneShape): { w: number; h: number } {
  if (shape.type === 'scene') return { w: shape.props.w, h: shape.props.h }
  const kids = structuralChildren(editor, shape.id)
  const sizes = kids.map((k) => tidy(editor, k))
  const { header, min } = LEVEL[shape.type]
  const stacked = shape.type === 'story'
  let x = PAD, y = header, w = min[0], h = min[1]
  kids.forEach((k, i) => {
    editor.updateShape({ id: k.id, type: k.type, x, y })
    if (stacked) { y += sizes[i].h + GAP; w = Math.max(w, sizes[i].w + 2 * PAD) }
    else { x += sizes[i].w + GAP; h = Math.max(h, header + sizes[i].h + PAD) }
  })
  if (stacked) h = Math.max(h, y - GAP + PAD)
  else w = Math.max(w, x - GAP + PAD)
  editor.updateShape({ id: shape.id, type: shape.type, props: { w, h } })
  return { w, h }
}

export function tidyAll(editor: Editor) {
  editor.run(() => {
    const top = structuralChildren(editor, STORY_PAGE)
    top.forEach((s) => tidy(editor, s))
    // Loose top-level pieces: stories stacked on the left, everything else in a row beneath.
    const containers = structuralChildren(editor, STORY_PAGE).filter(isContainer)
    const loose = structuralChildren(editor, STORY_PAGE).filter((s) => !isContainer(s))
    const origin = editor.getShapePageBounds(top[0] ?? containers[0])
    if (!origin) return
    let y = origin.y
    containers.forEach((c) => { editor.updateShape({ id: c.id, type: c.type, x: origin.x, y }); y += c.props.h + GAP * 2 })
    let x = origin.x
    loose.forEach((s) => { editor.updateShape({ id: s.id, type: s.type, x, y }); x += s.props.w + GAP })
  })
}

export function containerTypeAccepts(parent: ContainerType, child: TLShape['type']) {
  // Structural shapes only nest at the right level; annotations (text, drawings, notes) can go anywhere.
  if (child === 'story' || child === 'book' || child === 'chapter' || child === 'scene') return LEVEL[parent].child === child
  return true
}
