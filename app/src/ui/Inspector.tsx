import { useRef, type ReactNode } from 'react'
import { useValue, type Editor, type TLShape } from 'tldraw'
import { EMPTY_TIME, LORE_CATEGORIES, PALETTE, PIN_KINDS, type WorldTime, type CharacterShape, type ContainerShape, type LoreShape, type PinShape, type SceneShape } from '../shapes/types'
import { effectiveModifiers, focusShape, getCharacters, getLore, getPages, getPins, PAGES } from '../lib/world'
import { ageAt, isSet, relation } from '../lib/time'
import { addStructural, buildOutline, findNode, LEVEL, tidyAll, type OutlineNode } from '../lib/structure'
import { uploadFile } from '../lib/persistence'
import { findIssues } from '../lib/checks'

type Props<S extends TLShape> = { editor: Editor; shape: S }

function update<S extends TLShape>(editor: Editor, shape: S, props: Partial<S['props']>) {
  editor.updateShape({ id: shape.id, type: shape.type, props } as any)
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="ins-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="ins-colors">
      {PALETTE.map((c) => (
        <button key={c} className={c === value ? 'on' : ''} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function TimeInput({ value, onChange }: { value: WorldTime; onChange: (t: WorldTime) => void }) {
  const num = (v: string) => (v.trim() === '' || isNaN(Number(v)) ? null : Number(v))
  return (
    <div className="ins-time">
      {(['year', 'month', 'day', 'hour'] as const).map((k) => (
        <label key={k}>
          <small>{k}</small>
          <input type="number" value={value[k] ?? ''} placeholder={k === 'year' ? '—' : ''} onChange={(e) => onChange({ ...value, [k]: num(e.target.value) })} />
        </label>
      ))}
      {isSet(value) && <button className="link" onClick={() => onChange({ ...EMPTY_TIME })}>clear</button>}
    </div>
  )
}

function SceneLinks({ editor, filter }: { editor: Editor; filter: (s: SceneShape) => boolean }) {
  const pages = useValue('linked pages', () => getPages(editor).filter(({ scene }) => filter(scene)), [editor, filter])
  if (!pages.length) return <p className="muted">Not on any page yet.</p>
  return (
    <ul className="ins-links">
      {pages.map(({ scene: s, node }) => (
        <li key={s.id}><button onClick={() => focusShape(editor, s)}>{node.path}{s.props.title ? `: ${s.props.title}` : ''}</button> <small>{s.props.when}</small></li>
      ))}
    </ul>
  )
}

/* ───────────── Character ───────────── */

function CharacterInspector({ editor, shape }: Props<CharacterShape>) {
  const p = shape.props
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (props: Partial<CharacterShape['props']>) => update(editor, shape, props)

  const addPortraits = async (files: FileList | null) => {
    if (!files?.length) return
    const urls = await Promise.all([...files].map(uploadFile))
    const portraits = [...p.portraits, ...urls]
    set({ portraits, activePortrait: portraits.length - 1 })
  }
  const removePortrait = (i: number) => {
    const portraits = p.portraits.filter((_, j) => j !== i)
    set({ portraits, activePortrait: Math.max(0, Math.min(p.activePortrait > i ? p.activePortrait - 1 : p.activePortrait, portraits.length - 1)) })
  }

  return (
    <>
      <h2 style={{ color: p.color }}>Character</h2>
      <Field label="Name"><input value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Role"><input value={p.role} placeholder="protagonist, rival, mentor…" onChange={(e) => set({ role: e.target.value })} /></Field>
      <Field label="Colour"><ColorPicker value={p.color} onChange={(color) => set({ color })} /></Field>
      <Field label="Born (world year)" hint="Optional. Their age is worked out on every page.">
        <input type="number" value={p.born ?? ''} onChange={(e) => set({ born: e.target.value === '' ? null : Number(e.target.value) })} />
      </Field>

      <h3>Visual identity</h3>
      <div className="ins-portraits">
        {p.portraits.map((src, i) => (
          <figure key={src + i} className={i === p.activePortrait ? 'on' : ''}>
            <img src={src} onClick={() => set({ activePortrait: i })} title="Use this look" />
            <figcaption>v{i + 1}<button onClick={() => removePortrait(i)} title="Remove">×</button></figcaption>
          </figure>
        ))}
        <button className="ins-add-portrait" onClick={() => fileRef.current?.click()}>+ add<br />iteration</button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addPortraits(e.target.files); e.target.value = '' }} />
      </div>
      <small className="muted">Each upload is kept as a version so you can compare iterations. Click one to make it the base look. You can also drop sketches and references on the canvas around the card.</small>
      <Field label="Base appearance" hint="The look every scene starts from. Scenes can add modifiers on top.">
        <textarea rows={5} value={p.appearance} placeholder="Build, face, hair, clothing, silhouette, palette…" onChange={(e) => set({ appearance: e.target.value })} />
      </Field>
      <Field label="Personality"><textarea rows={3} value={p.personality} onChange={(e) => set({ personality: e.target.value })} /></Field>
      <Field label="Backstory" hint="Their own history: informs scenes, not stated in them.">
        <textarea rows={6} value={p.backstory} onChange={(e) => set({ backstory: e.target.value })} />
      </Field>
      <h3>Appears in</h3>
      <SceneLinks editor={editor} filter={(s) => s.props.characterIds.includes(shape.id)} />
    </>
  )
}

/* ───────────── Pin ───────────── */

function PinInspector({ editor, shape }: Props<PinShape>) {
  const p = shape.props
  const set = (props: Partial<PinShape['props']>) => update(editor, shape, props)
  return (
    <>
      <h2 style={{ color: p.color }}>Map pin</h2>
      <Field label="Name"><input value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Kind">
        <select value={p.kind} onChange={(e) => set({ kind: e.target.value })}>{PIN_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      </Field>
      <Field label="Colour"><ColorPicker value={p.color} onChange={(color) => set({ color })} /></Field>
      <Field label="Description"><textarea rows={6} value={p.description} placeholder="What it looks like, who lives here, what matters about it…" onChange={(e) => set({ description: e.target.value })} /></Field>
      <h3>Scenes here</h3>
      <SceneLinks editor={editor} filter={(s) => s.props.locationIds.includes(shape.id)} />
    </>
  )
}

/* ───────────── Lore ───────────── */

function LoreInspector({ editor, shape }: Props<LoreShape>) {
  const p = shape.props
  const set = (props: Partial<LoreShape['props']>) => update(editor, shape, props)
  return (
    <>
      <h2>Backstory note</h2>
      <p className="muted">Global lore. It is passed along as hidden context and never stated outright in a scene.</p>
      <Field label="Title"><input value={p.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label="Category">
        <select value={p.category} onChange={(e) => set({ category: e.target.value })}>{LORE_CATEGORIES.map((k) => <option key={k}>{k}</option>)}</select>
      </Field>
      <Field label="When it happened" hint="Places this on the world chronology, so pages only treat it as history if it has already happened.">
        <TimeInput value={p.start} onChange={(start) => set({ start })} />
      </Field>
      <Field label="Until (optional)" hint="For spans: a war, a reign, a plague.">
        <TimeInput value={p.end} onChange={(end) => set({ end })} />
      </Field>
      <Field label="Text"><textarea rows={12} value={p.body} onChange={(e) => set({ body: e.target.value })} /></Field>
    </>
  )
}

/* ───────────── Scene ───────────── */

function SceneInspector({ editor, shape }: Props<SceneShape>) {
  const p = shape.props
  const set = (props: Partial<SceneShape['props']>) => update(editor, shape, props)
  const data = useValue('scene inspector', () => {
    const pages = getPages(editor)
    const index = pages.findIndex((p) => p.scene.id === shape.id)
    return { pages, index, path: pages[index]?.node.path ?? '', characters: getCharacters(editor), pins: getPins(editor) }
  }, [editor, shape.id])
  const issues = useValue('scene issues', () => findIssues(editor).filter((i) => i.shapeId === shape.id), [editor, shape.id])

  const toggle = (key: 'characterIds' | 'locationIds', id: string) =>
    set({ [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id] } as any)
  const setModifier = (cid: string, patch: Partial<{ text: string; persist: boolean }>) =>
    set({ modifiers: { ...p.modifiers, [cid]: { ...(p.modifiers[cid] ?? { text: '', persist: false }), ...patch } } })

  return (
    <>
      <h2>Page (scene)</h2>
      <p className="muted">{data.path || 'Loose page'}. Drag it into a chapter to place it in the story. Pages read left → right.</p>
      <Field label="Title"><input value={p.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label="Exact time" hint="Puts this page on the world chronology next to the backstory.">
        <TimeInput value={p.at} onChange={(at) => set({ at })} />
      </Field>
      <Field label="When (description)" hint="Mood of the moment, e.g. “first frost, dusk”.">
        <input value={p.when} onChange={(e) => set({ when: e.target.value })} />
      </Field>
      <WorldAtTime editor={editor} at={p.at} />
      <Field label="What happens"><textarea rows={6} value={p.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>

      <h3>Where</h3>
      {!data.pins.length && <p className="muted">Add pins on the Map tab first.</p>}
      <div className="ins-checks">
        {data.pins.map((pin) => (
          <label key={pin.id}><input type="checkbox" checked={p.locationIds.includes(pin.id)} onChange={() => toggle('locationIds', pin.id)} />
            <span className="dot" style={{ background: pin.props.color }} />{pin.props.name}</label>
        ))}
      </div>

      <h3>Who</h3>
      {!data.characters.length && <p className="muted">Create characters on the Characters tab first.</p>}
      {data.characters.map((c) => {
        const on = p.characterIds.includes(c.id)
        const carried = on ? effectiveModifiers(data.pages, data.index, c.id).filter((m) => m !== p.modifiers[c.id]?.text.trim()) : []
        return (
          <div key={c.id} className={`ins-cast ${on ? 'on' : ''}`}>
            <label><input type="checkbox" checked={on} onChange={() => toggle('characterIds', c.id)} />
              <span className="dot" style={{ background: c.props.color }} />{c.props.name}
              {on && ageAt(c.props.born, p.at) != null && <small className="age">age {ageAt(c.props.born, p.at)}</small>}</label>
            {on && (
              <>
                {carried.map((m) => <small key={m} className="carried">carried: {m}</small>)}
                <input placeholder="Modifier on this page (torn cloak, disguised…)" value={p.modifiers[c.id]?.text ?? ''} onChange={(e) => setModifier(c.id, { text: e.target.value })} />
                <label className="persist"><input type="checkbox" checked={p.modifiers[c.id]?.persist ?? false} onChange={(e) => setModifier(c.id, { persist: e.target.checked })} /> carries into later pages</label>
              </>
            )}
          </div>
        )
      })}

      {issues.length > 0 && <><h3>Continuity</h3><IssueList editor={editor} issues={issues} /></>}
    </>
  )
}

/** What the world looks like at this moment: which backstory has happened, is ongoing, or is still to come. */
function WorldAtTime({ editor, at }: { editor: Editor; at: WorldTime }) {
  const lore = useValue('lore at time', () => getLore(editor).filter((l) => isSet(l.props.start)), [editor])
  if (!isSet(at) || !lore.length) return null
  const groups = { ongoing: [] as LoreShape[], past: [] as LoreShape[], future: [] as LoreShape[] }
  lore.forEach((l) => groups[relation(l.props.start, l.props.end, at)].push(l))
  return (
    <div className="ins-world">
      {groups.ongoing.length > 0 && <div><b>Happening now:</b> {groups.ongoing.map((l) => l.props.title).join(', ')}</div>}
      {groups.past.length > 0 && <div><b>Already history:</b> {groups.past.map((l) => l.props.title).join(', ')}</div>}
      {groups.future.length > 0 && <div className="future"><b>Hasn’t happened yet:</b> {groups.future.map((l) => l.props.title).join(', ')}</div>}
    </div>
  )
}

/* ───────────── Story / Book / Chapter ───────────── */

export function Outline({ editor, rootId }: { editor: Editor; rootId?: string }) {
  const outline = useValue('outline', () => {
    const all = buildOutline(editor)
    return rootId ? findNode(all, rootId)?.children ?? [] : all
  }, [editor, rootId])
  const selected = useValue('sel', () => editor.getSelectedShapeIds(), [editor])
  if (!outline.length) return <p className="muted">Empty. Use the + buttons above.</p>
  const render = (nodes: OutlineNode[]) => (
    <ul className="outline">
      {nodes.map((n) => {
        const title = (n.shape.props as any).title as string
        const label = n.shape.type === 'scene' ? `p. ${n.number}` : n.shape.type === 'story' ? 'Story' : `${LEVEL[n.shape.type].label} ${n.number}`
        return (
          <li key={n.shape.id} className={`ol-${n.shape.type}`}>
            <button className={selected.includes(n.shape.id) ? 'on' : ''} onClick={() => focusShape(editor, n.shape)}>
              <b>{label}</b> {title || <i>untitled</i>}
            </button>
            {n.children.length > 0 && render(n.children)}
          </li>
        )
      })}
    </ul>
  )
  return render(outline)
}

function ContainerInspector({ editor, shape }: Props<ContainerShape>) {
  const p = shape.props
  const set = (props: Partial<ContainerShape['props']>) => update(editor, shape, props)
  const path = useValue('path', () => findNode(buildOutline(editor), shape.id)?.path ?? '', [editor, shape.id])
  const level = LEVEL[shape.type]
  const child = level.child!
  return (
    <>
      <h2 style={{ color: p.color }}>{shape.type === 'story' ? 'Full story' : path || level.label}</h2>
      <Field label="Title"><input value={p.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label={shape.type === 'story' ? 'Logline / synopsis' : 'Synopsis'}>
        <textarea rows={5} value={p.synopsis} onChange={(e) => set({ synopsis: e.target.value })} />
      </Field>
      <Field label="Colour"><ColorPicker value={p.color} onChange={(color) => set({ color })} /></Field>
      <div className="ins-row">
        <button className="primary" onClick={() => addStructural(editor, child)}>+ {LEVEL[child].label} in this {level.label.toLowerCase()}</button>
        <button onClick={() => tidyAll(editor)}>Tidy layout</button>
      </div>
      <h3>Contents</h3>
      <Outline editor={editor} rootId={shape.id} />
    </>
  )
}

export function IssueList({ editor, issues }: { editor: Editor; issues: ReturnType<typeof findIssues> }) {
  if (!issues.length) return <p className="muted">No continuity problems found.</p>
  return (
    <ul className="ins-issues">
      {issues.map((i, k) => (
        <li key={k} className={i.level}><button onClick={() => { const s = editor.getShape(i.shapeId as any); if (s) focusShape(editor, s) }}>{i.message}</button></li>
      ))}
    </ul>
  )
}

/* ───────────── Empty state per tab ───────────── */

const HELP: Record<string, ReactNode> = {
  'page:characters': <>Add a character card, then select it to shape their look and backstory. Drop reference images, sketches and notes around each card. It’s your mood board.</>,
  'page:map': <>Draw the world top-down with the pen, shapes and text tools. Drop a map image and select it to lock it as the background. Add pins for places scenes can happen.</>,
  'page:backstory': <>Global lore: history, factions, secrets. It feeds every page as hidden context but never appears in them explicitly. Date each note so the chronology below places it in time, next to your story pages.</>,
  'page:story': <>Map the story out as nested boxes: <b>Story ⊃ Books ⊃ Chapters ⊃ Pages</b>. Select a box and use the + buttons to add inside it, or drag pieces between boxes. Each page is a scene: who is there, where on the map, and when.</>,
}

function PageOverview({ editor }: { editor: Editor }) {
  const pageId = useValue('page', () => editor.getCurrentPageId(), [editor])
  const issues = useValue('issues', () => (pageId === 'page:story' ? findIssues(editor) : []), [editor, pageId])
  const page = PAGES.find((p) => p.id === pageId)
  return (
    <>
      <h2>{page?.name}</h2>
      <p className="muted">{HELP[pageId]}</p>
      {pageId === 'page:story' && <><h3>Outline</h3><Outline editor={editor} /><h3>Continuity checks</h3><IssueList editor={editor} issues={issues} /></>}
    </>
  )
}

function ImageInspector({ editor, shape }: Props<TLShape>) {
  const onMap = editor.getAncestorPageId(shape) === 'page:map'
  return (
    <>
      <h2>Image</h2>
      {onMap ? (
        <>
          <p className="muted">Lock this image behind everything to use it as the map. Right-click → Unlock to move it again.</p>
          <button className="primary" onClick={() => { editor.sendToBack([shape.id]); editor.updateShape({ id: shape.id, type: shape.type, isLocked: true }); editor.selectNone() }}>Use as map background</button>
        </>
      ) : <p className="muted">Reference image. Keep it next to the card it inspires.</p>}
    </>
  )
}

export function Inspector({ editor }: { editor: Editor }) {
  const shape = useValue('selected', () => editor.getOnlySelectedShape(), [editor])
  let body: ReactNode
  switch (shape?.type) {
    case 'character': body = <CharacterInspector key={shape.id} editor={editor} shape={shape as CharacterShape} />; break
    case 'pin': body = <PinInspector key={shape.id} editor={editor} shape={shape as PinShape} />; break
    case 'lore': body = <LoreInspector key={shape.id} editor={editor} shape={shape as LoreShape} />; break
    case 'scene': body = <SceneInspector key={shape.id} editor={editor} shape={shape as SceneShape} />; break
    case 'story': case 'book': case 'chapter': body = <ContainerInspector key={shape.id} editor={editor} shape={shape as ContainerShape} />; break
    case 'image': body = <ImageInspector editor={editor} shape={shape} />; break
    default: body = <PageOverview editor={editor} />
  }
  return <aside className="inspector">{body}</aside>
}
