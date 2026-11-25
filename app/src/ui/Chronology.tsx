import { useValue, type Editor } from 'tldraw'
import { focusShape, getLore, getPages } from '../lib/world'
import { compareTime, formatSpan, formatTime, isSet, timeKey } from '../lib/time'

/** Lay dated lore notes out left → right by date on the Backstory canvas (undated ones go last). */
function layoutByDate(editor: Editor) {
  const lore = getLore(editor).sort((a, b) => {
    if (!isSet(a.props.start)) return 1
    if (!isSet(b.props.start)) return -1
    return compareTime(a.props.start, b.props.start)
  })
  if (!lore.length) return
  const y = Math.min(...lore.map((l) => l.y))
  let x = Math.min(...lore.map((l) => l.x))
  editor.markHistoryStoppingPoint('arrange lore')
  editor.run(() => lore.forEach((l) => { editor.updateShape({ id: l.id, type: 'lore', x, y }); x += l.props.w + 40 }))
  editor.zoomToFit({ animation: { duration: 300 } })
}

/** One chronology for the whole world: backstory events and story pages, in time order. */
export function Chronology({ editor }: { editor: Editor }) {
  const data = useValue('chronology', () => {
    const items = [
      ...getLore(editor).filter((l) => isSet(l.props.start)).map((l) => ({
        kind: 'lore' as const, shape: l, key: timeKey(l.props.start), date: formatSpan(l.props.start, l.props.end), title: l.props.title, sub: l.props.category,
      })),
      ...getPages(editor).filter((p) => isSet(p.scene.props.at)).map((p) => ({
        kind: 'page' as const, shape: p.scene, key: timeKey(p.scene.props.at), date: formatTime(p.scene.props.at), title: p.scene.props.title || 'Untitled page', sub: p.node.path,
      })),
    ].sort((a, b) => a.key - b.key)
    const undated = getLore(editor).filter((l) => !isSet(l.props.start)).length + getPages(editor).filter((p) => !isSet(p.scene.props.at)).length
    return { items, undated }
  }, [editor])

  return (
    <div className="timeline chronology">
      <div className="timeline-head">
        <b>World chronology</b>
        <small className="muted">
          <span className="key lore" /> backstory <span className="key page" /> story pages
          {data.undated > 0 && ` · ${data.undated} undated`}
        </small>
        <button onClick={() => layoutByDate(editor)}>Lay out notes by date</button>
      </div>
      <ol>
        {data.items.length === 0 && <li className="muted empty">Give backstory notes and pages a date to see them in time order.</li>}
        {data.items.map((it) => (
          <li key={it.shape.id} className={`chrono-${it.kind}`} onClick={() => focusShape(editor, it.shape)}>
            <div className="tl-group">{it.date}</div>
            <strong>{it.title}</strong>
            <div className="tl-meta"><small>{it.kind === 'page' ? it.sub : it.sub}</small></div>
          </li>
        ))}
      </ol>
    </div>
  )
}
