import type { Editor } from 'tldraw'
import type { CharacterShape, ContainerShape, PinShape } from '../shapes/types'
import { effectiveModifiers, getCharacters, getLore, getPages, getPins, portraitOf } from './world'
import { buildOutline, type OutlineNode, type PageEntry } from './structure'
import { ageAt, compareTime, formatSpan, formatTime, isSet, relation } from './time'

const indent = (s: string) => s.trim().split('\n').map((l) => `> ${l}`).join('\n')

/**
 * A markdown "story bible": everything needed to stitch the scenes together.
 * Lore is included as hidden context: it should shape the scenes but never be stated outright.
 */
export function buildStoryBible(editor: Editor): string {
  const out: string[] = ['# Story bible', '']
  const lore = getLore(editor)
  const characters = getCharacters(editor)
  const pins = getPins(editor)

  out.push('## Hidden backstory', '', '_Context for writers. It informs the scenes but must never be stated explicitly in them._', '')
  if (!lore.length) out.push('_None yet._', '')
  const sortedLore = [...lore].sort((a, b) => (isSet(a.props.start) ? (isSet(b.props.start) ? compareTime(a.props.start, b.props.start) : -1) : 1))
  sortedLore.forEach((l) => out.push(`### ${l.props.title} (${l.props.category})`, '', `_${isSet(l.props.start) ? formatSpan(l.props.start, l.props.end) : 'undated'}_`, '', l.props.body.trim() || '_empty_', ''))

  out.push('## Characters', '')
  characters.forEach((c) => {
    out.push(`### ${c.props.name}${c.props.role ? ` — ${c.props.role}` : ''}`, '')
    if (c.props.born != null) out.push(`**Born:** year ${c.props.born}`, '')
    if (c.props.appearance) out.push(`**Base look:** ${c.props.appearance.trim()}`, '')
    if (c.props.personality) out.push(`**Personality:** ${c.props.personality.trim()}`, '')
    const img = portraitOf(c)
    if (img) out.push(`**Reference portrait:** ${img.replace('/data-assets/', 'data/assets/')}`, '')
    if (c.props.backstory) out.push('**Backstory (hidden):**', '', indent(c.props.backstory), '')
  })

  out.push('## Places', '')
  pins.forEach((p) => out.push(`- **${p.props.name}** (${p.props.kind})${p.props.description ? ` — ${p.props.description.trim()}` : ''}`))
  out.push('')

  out.push('## Story structure', '')
  const pages = getPages(editor)
  const writePage = (entry: PageEntry, i: number, depth: number) => {
    const s = entry.scene
    out.push(`${'#'.repeat(depth)} Page ${entry.node.number}: ${s.props.title || 'Untitled'}`, '')
    out.push(`- **Position:** ${entry.node.path}`)
    out.push(`- **When:** ${[isSet(s.props.at) && formatTime(s.props.at), s.props.when].filter(Boolean).join(' — ') || 'unspecified'}`)
    const places = s.props.locationIds.map((id) => editor.getShape(id as any) as PinShape | undefined).filter(Boolean) as PinShape[]
    out.push(`- **Where:** ${places.map((p) => p.props.name).join(', ') || 'unspecified'}`)
    out.push('- **Who:**')
    const cast = s.props.characterIds.map((id) => editor.getShape(id as any) as CharacterShape | undefined).filter(Boolean) as CharacterShape[]
    cast.forEach((c) => {
      const mods = effectiveModifiers(pages, i, c.id)
      const age = ageAt(c.props.born, s.props.at)
      out.push(`  - ${c.props.name}${age != null ? ` (age ${age})` : ''}: ${c.props.appearance.trim() || 'no base look'}${mods.length ? ` — **on this page:** ${mods.join('; ')}` : ''}`)
    })
    if (isSet(s.props.at)) {
      // Period context: what the world has and hasn't lived through at this moment.
      const dated = lore.filter((l) => isSet(l.props.start))
      const by = (r: string) => dated.filter((l) => relation(l.props.start, l.props.end, s.props.at) === r).map((l) => l.props.title)
      const [now, past, future] = [by('ongoing'), by('past'), by('future')]
      if (now.length) out.push(`- **Ongoing in the world (hidden context):** ${now.join(', ')}`)
      if (past.length) out.push(`- **Already history (hidden context):** ${past.join(', ')}`)
      if (future.length) out.push(`- **Has not happened yet, so nothing may reference it:** ${future.join(', ')}`)
    }
    out.push('', s.props.summary.trim() || '_No summary yet._', '')
  }
  const writeNode = (node: OutlineNode, depth: number) => {
    if (node.shape.type === 'scene') {
      const i = pages.findIndex((p) => p.scene.id === node.shape.id)
      return writePage(pages[i], i, Math.min(depth, 6))
    }
    const c = node.shape as ContainerShape
    const label = c.type === 'story' ? 'Story' : c.type === 'book' ? `Book ${node.number}` : `Chapter ${node.number}`
    out.push(`${'#'.repeat(Math.min(depth, 6))} ${label}: ${c.props.title || 'Untitled'}`, '')
    if (c.props.synopsis.trim()) out.push(`_${c.props.synopsis.trim()}_`, '')
    node.children.forEach((k) => writeNode(k, depth + 1))
  }
  const outline = buildOutline(editor)
  if (!outline.length) out.push('_No pages yet._', '')
  outline.forEach((n) => writeNode(n, 3))
  return out.join('\n')
}

export async function exportStoryBible(editor: Editor): Promise<string> {
  const md = buildStoryBible(editor)
  const res = await fetch('/api/export?name=story-bible.md', { method: 'PUT', body: md })
  const blob = new Blob([md], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'story-bible.md'
  a.click()
  URL.revokeObjectURL(a.href)
  return res.ok ? await res.text() : 'downloaded'
}
