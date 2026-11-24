import { useValue, type Editor } from 'tldraw'
import type { CharacterShape, PinShape } from '../shapes/types'
import { focusShape, getPages } from '../lib/world'
import { tidyAll } from '../lib/structure'
import { findIssues } from '../lib/checks'
import { formatTime, isSet } from '../lib/time'

/** A strip of every page in reading order, grouped by book and chapter. */
export function Timeline({ editor }: { editor: Editor }) {
  const data = useValue('timeline', () => {
    const issues = findIssues(editor)
    return getPages(editor).map(({ scene: s, node }) => ({
      s,
      node,
      group: node.path.split(' · ').slice(0, -1).join(' · '),
      cast: s.props.characterIds.map((id) => editor.getShape(id as any) as CharacterShape | undefined).filter(Boolean) as CharacterShape[],
      places: s.props.locationIds.map((id) => editor.getShape(id as any) as PinShape | undefined).filter(Boolean) as PinShape[],
      problems: issues.filter((i) => i.shapeId === s.id && i.level !== 'info').length,
    }))
  }, [editor])
  const selected = useValue('sel ids', () => editor.getSelectedShapeIds(), [editor])

  return (
    <div className="timeline">
      <div className="timeline-head">
        <b>Timeline</b>
        <small className="muted">{data.length} page{data.length === 1 ? '' : 's'} in reading order</small>
        <button onClick={() => tidyAll(editor)} disabled={!data.length}>Tidy layout</button>
      </div>
      <ol>
        {data.length === 0 && <li className="muted empty">No pages yet. Start with “+ Story”, then add books, chapters and pages.</li>}
        {data.map(({ s, node, group, cast, places, problems }, i) => (
          <li key={s.id} className={`${selected.includes(s.id) ? 'on' : ''} ${i > 0 && data[i - 1].group !== group ? 'new-group' : ''}`} onClick={() => focusShape(editor, s)}>
            <div className="tl-group">{group || 'loose page'}</div>
            <div className="tl-top"><span>p. {node.number}</span><em>{[isSet(s.props.at) && formatTime(s.props.at), s.props.when].filter(Boolean).join(' · ') || 'when?'}</em>{problems > 0 && <b className="warn" title="continuity issue">!</b>}</div>
            <strong>{s.props.title || 'Untitled'}</strong>
            <div className="tl-meta">
              {cast.map((c) => <span key={c.id} className="dot" title={c.props.name} style={{ background: c.props.color }} />)}
              <small>{places.map((p) => p.props.name).join(', ')}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
