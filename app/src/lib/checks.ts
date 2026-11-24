import type { Editor } from 'tldraw'
import type { CharacterShape, SceneShape } from '../shapes/types'
import { getCharacters, getPages } from './world'
import type { PageEntry } from './structure'
import { ageAt, compareTime, formatTime, isSet, sameMoment } from './time'

export interface Issue {
  level: 'error' | 'warn' | 'info'
  message: string
  shapeId: string
}

/** Continuity checks that keep stories coherent across scenes. */
export function findIssues(editor: Editor): Issue[] {
  const issues: Issue[] = []
  const pages = getPages(editor)
  const scenes = pages.map((p) => p.scene)
  const exists = (id: string) => !!editor.getShape(id as any)

  scenes.forEach((s, i) => {
    const label = `${pages[i].node.path}${s.props.title ? ` “${s.props.title}”` : ''}`
    if (s.props.characterIds.some((id) => !exists(id))) issues.push({ level: 'error', shapeId: s.id, message: `${label} references a deleted character.` })
    if (s.props.locationIds.some((id) => !exists(id))) issues.push({ level: 'error', shapeId: s.id, message: `${label} references a deleted map pin.` })
    if (!s.props.when.trim() && !isSet(s.props.at)) issues.push({ level: 'info', shapeId: s.id, message: `${label} has no time set.` })
    if (!s.props.locationIds.length) issues.push({ level: 'info', shapeId: s.id, message: `${label} isn’t placed on the map.` })
    if (!s.props.characterIds.length) issues.push({ level: 'info', shapeId: s.id, message: `${label} has no characters.` })
  })

  // Same character, same moment, different places. Exact times must agree at least to the day;
  // otherwise fall back to identical "when" descriptions.
  const simultaneous = (A: SceneShape, B: SceneShape) => {
    if (isSet(A.props.at) && isSet(B.props.at)) return A.props.at.day != null && B.props.at.day != null && sameMoment(A.props.at, B.props.at)
    const wa = A.props.when.trim().toLowerCase()
    return !!wa && wa === B.props.when.trim().toLowerCase()
  }
  const momentLabel = (s: SceneShape) => (isSet(s.props.at) ? formatTime(s.props.at) : `“${s.props.when}”`)
  for (let a = 0; a < scenes.length; a++) for (let b = a + 1; b < scenes.length; b++) {
    const A = scenes[a], B = scenes[b]
    if (!simultaneous(A, B)) continue
    const sharedPlace = A.props.locationIds.some((l) => B.props.locationIds.includes(l))
    if (sharedPlace || !A.props.locationIds.length || !B.props.locationIds.length) continue
    for (const cid of A.props.characterIds.filter((c) => B.props.characterIds.includes(c))) {
      const name = (editor.getShape(cid as any) as any)?.props.name ?? 'A character'
      issues.push({ level: 'warn', shapeId: B.id, message: `${name} is in two places at ${momentLabel(A)} (${pages[a].node.path} and ${pages[b].node.path}).` })
    }
  }

  // Characters on a page before they were born.
  pages.forEach(({ scene: s, node }) => {
    for (const cid of s.props.characterIds) {
      const c = editor.getShape(cid as any) as CharacterShape | undefined
      const age = c ? ageAt(c.props.born, s.props.at) : null
      if (c && age != null && age < 0) issues.push({ level: 'warn', shapeId: s.id, message: `${c.props.name} appears on ${node.path} (${formatTime(s.props.at)}) but isn’t born until year ${c.props.born}.` })
    }
  })

  // Pages that go back in time within the same story: fine for flashbacks, worth knowing about.
  const lastByStory = new Map<string | null, PageEntry>()
  pages.forEach((p) => {
    if (!isSet(p.scene.props.at)) return
    const prev = lastByStory.get(p.node.storyId)
    if (prev && compareTime(p.scene.props.at, prev.scene.props.at) < 0)
      issues.push({ level: 'info', shapeId: p.scene.id, message: `${p.node.path} jumps back in time from ${prev.node.path} (flashback?).` })
    lastByStory.set(p.node.storyId, p)
  })

  getCharacters(editor).forEach((c) => {
    if (!c.props.appearance.trim() && !c.props.portraits.length)
      issues.push({ level: 'info', shapeId: c.id, message: `${c.props.name || 'A character'} has no visual identity yet.` })
  })
  return issues
}
