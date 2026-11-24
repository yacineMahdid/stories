import type { Editor, TLPageId, TLShape } from 'tldraw'
import type { CharacterShape, LoreShape, PinShape, SceneModifier, SceneShape } from '../shapes/types'
import { buildOutline, flattenPages, type PageEntry } from './structure'

export const PAGES = [
  { id: 'page:characters' as TLPageId, name: 'Characters', icon: '☺' },
  { id: 'page:map' as TLPageId, name: 'Map', icon: '⌖' },
  { id: 'page:backstory' as TLPageId, name: 'Backstory', icon: '✎' },
  { id: 'page:story' as TLPageId, name: 'Story', icon: '▶' },
] as const

/** Make sure the four fixed workspaces exist (dropping tldraw's empty default page) and open on Characters. */
export function ensurePages(editor: Editor) {
  editor.run(() => {
    PAGES.forEach((p, i) => {
      if (!editor.getPage(p.id)) editor.createPage({ id: p.id, name: p.name, index: `a${i + 1}` as any })
    })
    for (const page of editor.getPages()) {
      const ours = PAGES.some((p) => p.id === page.id)
      if (!ours && editor.getPageShapeIds(page.id).size === 0) editor.deletePage(page.id)
    }
    editor.setCurrentPage(PAGES[0].id)
  })
}

function shapesOfType<S extends TLShape>(editor: Editor, type: S['type']): S[] {
  const out: S[] = []
  for (const page of editor.getPages()) {
    for (const id of editor.getPageShapeIds(page.id)) {
      const s = editor.getShape(id)
      if (s?.type === type) out.push(s as S)
    }
  }
  return out
}

export const getCharacters = (e: Editor) => shapesOfType<CharacterShape>(e, 'character')
export const getPins = (e: Editor) => shapesOfType<PinShape>(e, 'pin')
export const getLore = (e: Editor) => shapesOfType<LoreShape>(e, 'lore')

/** Pages (scenes) in reading order through Story ⊃ Book ⊃ Chapter ⊃ Page. */
export function getPages(e: Editor): PageEntry[] {
  return flattenPages(buildOutline(e))
}
export const getScenes = (e: Editor): SceneShape[] => getPages(e).map((p) => p.scene)

export function portraitOf(c: CharacterShape): string | undefined {
  return c.props.portraits[c.props.activePortrait] ?? c.props.portraits[c.props.portraits.length - 1]
}

/**
 * The modifiers that apply to a character on a page: anything marked "persist" on an earlier
 * page of the same story, plus this page's own modifier.
 */
export function effectiveModifiers(pages: PageEntry[], index: number, characterId: string): string[] {
  const out: string[] = []
  const storyId = pages[index]?.node.storyId
  pages.slice(0, index).forEach(({ scene: s, node }) => {
    if (node.storyId !== storyId) return
    const m: SceneModifier | undefined = s.props.modifiers[characterId]
    if (m?.persist && m.text.trim()) out.push(`${m.text.trim()} (since ${node.path}${s.props.title ? ` “${s.props.title}”` : ''})`)
  })
  const own = pages[index]?.scene.props.modifiers[characterId]
  if (own?.text.trim()) out.push(own.text.trim())
  return out
}

export function focusShape(editor: Editor, shape: TLShape) {
  const pageId = editor.getAncestorPageId(shape)
  if (pageId && pageId !== editor.getCurrentPageId()) editor.setCurrentPage(pageId)
  editor.select(shape.id)
  editor.zoomToSelection({ animation: { duration: 300 } })
}

export function centerOfView(editor: Editor) {
  return editor.getViewportPageBounds().center
}
