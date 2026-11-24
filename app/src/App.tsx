import { useEffect, useState } from 'react'
import { Tldraw, useValue, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import { storyShapeUtils } from './shapes/StoryShapes'
import { Inspector } from './ui/Inspector'
import { Timeline } from './ui/Timeline'
import { Chronology } from './ui/Chronology'
import { assetStore, loadWorld, startAutosave, type SaveState } from './lib/persistence'
import { centerOfView, ensurePages, getCharacters, getLore, getPins, getScenes, PAGES } from './lib/world'
import { exportStoryBible } from './lib/exportBible'
import { addStructural } from './lib/structure'

// The four workspaces replace tldraw's own page menu.
const components: TLComponents = { PageMenu: null }

const ADD: Record<string, { label: string; type: 'character' | 'pin' | 'lore'; w: number; h: number }> = {
  'page:characters': { label: '+ Character', type: 'character', w: 260, h: 360 },
  'page:map': { label: '+ Pin', type: 'pin', w: 180, h: 64 },
  'page:backstory': { label: '+ Lore note', type: 'lore', w: 320, h: 240 },
}

const STORY_ADD = [
  { label: '+ Story', type: 'story' },
  { label: '+ Book', type: 'book' },
  { label: '+ Chapter', type: 'chapter' },
  { label: '+ Page', type: 'scene' },
] as const

function addShape(editor: Editor) {
  const spec = ADD[editor.getCurrentPageId()]
  if (!spec) return
  let { x, y } = centerOfView(editor)
  x -= spec.w / 2
  y -= spec.h / 2
  editor.createShape({ type: spec.type, x, y })
  const created = editor.getCurrentPageShapesSorted().at(-1)
  if (created) editor.select(created.id)
}

function Header({ editor, save }: { editor: Editor; save: SaveState }) {
  const pageId = useValue('page', () => editor.getCurrentPageId(), [editor])
  const counts = useValue('counts', () => ({
    'page:characters': getCharacters(editor).length,
    'page:map': getPins(editor).length,
    'page:backstory': getLore(editor).length,
    'page:story': getScenes(editor).length,
  } as Record<string, number>), [editor])
  const [exported, setExported] = useState('')
  return (
    <header className="topbar">
      <span className="brand">Story Canvas</span>
      <nav>
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === pageId ? 'on' : ''} onClick={() => { editor.setCurrentPage(p.id); editor.selectNone() }}>
            <span>{p.icon}</span>{p.name}<small>{counts[p.id]}</small>
          </button>
        ))}
      </nav>
      <div className="actions">
        {ADD[pageId] && <button className="primary" onClick={() => addShape(editor)}>{ADD[pageId].label}</button>}
        {pageId === 'page:story' && (
          <div className="add-group" title="Adds inside the selected box when it fits there">
            {STORY_ADD.map((a) => <button key={a.type} className={a.type === 'scene' ? 'primary' : ''} onClick={() => addStructural(editor, a.type)}>{a.label}</button>)}
          </div>
        )}
        <button onClick={async () => { const where = await exportStoryBible(editor); setExported(where); setTimeout(() => setExported(''), 4000) }}>
          {exported ? `Saved → ${exported}` : 'Export story bible'}
        </button>
        <span className={`save ${save}`}>{save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : 'Save failed'}</span>
      </div>
    </header>
  )
}

export default function App() {
  const [world, setWorld] = useState<{ loaded: boolean; data: any; error?: string }>({ loaded: false, data: null })
  const [editor, setEditor] = useState<Editor | null>(null)
  const [save, setSave] = useState<SaveState>('saved')

  useEffect(() => {
    loadWorld().then((data) => setWorld({ loaded: true, data }), (e) => setWorld({ loaded: true, data: null, error: String(e) }))
  }, [])

  useEffect(() => (editor ? startAutosave(editor, setSave) : undefined), [editor])

  const pageId = useValue('page', () => editor?.getCurrentPageId(), [editor])

  if (!world.loaded) return <div className="loading">Loading your world…</div>
  if (world.error) return <div className="loading">{world.error}<br />Start the app with <code>npm run dev</code> so it can read the data folder.</div>

  return (
    <div className="layout">
      {editor && <Header editor={editor} save={save} />}
      <div className="main">
        <div className="canvas">
          <Tldraw
            shapeUtils={storyShapeUtils}
            components={components}
            assets={assetStore}
            onMount={(ed) => {
              if (world.data?.document) ed.loadSnapshot({ document: world.data.document })
              ensurePages(ed)
              if (import.meta.env.DEV) (window as any).editor = ed // handy for debugging in the console
              setEditor(ed)
            }}
          />
        </div>
        {editor && <Inspector editor={editor} />}
      </div>
      {editor && pageId === 'page:story' && <Timeline editor={editor} />}
      {editor && pageId === 'page:backstory' && <Chronology editor={editor} />}
    </div>
  )
}
