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
import { loadStaging, useStagingStatus } from './lib/staging'
import { attachStagingHistory } from './lib/staging-history'
import { StageContext, StageOverlay } from './ui/ThreeViews'

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
  editor.markHistoryStoppingPoint('add')
  editor.createShape({ type: spec.type, x, y })
  const created = editor.getCurrentPageShapesSorted().at(-1)
  if (created) editor.select(created.id)
}

/** One indicator for both files: the canvas (data/world.json) and the 3D direction (data/staging.json). */
function SaveStatus({ save }: { save: SaveState }) {
  const staging = useStagingStatus()
  if (save === 'error') return <span className="save error" title={staging.status === 'error' ? `The 3D direction isn't saved either: ${staging.error}` : undefined}>{staging.status === 'error' ? 'Not saved' : 'Save failed'}</span>
  if (staging.status === 'error') return <span className="save error" title={staging.error}>3D not saved</span>
  const state = save === 'saved' && staging.status === 'saving' ? 'saving' : save
  return <span className={`save ${state}`}>{state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Save failed'}</span>
}

function Header({ editor, save, onStage }: { editor: Editor; save: SaveState; onStage: () => void }) {
  const pageId = useValue('page', () => editor.getCurrentPageId(), [editor])
  const counts = useValue('counts', () => ({
    'page:characters': getCharacters(editor).length,
    'page:map': getPins(editor).length,
    'page:backstory': getLore(editor).length,
    'page:story': getScenes(editor).length,
  } as Record<string, number>), [editor])
  // Where the last export was saved, for a few seconds ('' when it could only be downloaded).
  const [exported, setExported] = useState<string | null>(null)
  const exportTip = exported == null ? `Saves story-bible.md in ${__STORY_DATA__}/exports and downloads a copy`
    : exported ? `Saved as ${exported}, and downloaded` : `Downloaded. It couldn't be saved in ${__STORY_DATA__}/exports.`
  return (
    <header className="topbar">
      <span className="brand">Story Canvas</span>
      <nav>
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === pageId ? 'on' : ''} title={p.name} onClick={() => { editor.setCurrentPage(p.id); editor.selectNone() }}>
            <span>{p.icon}</span><span className="tab-name">{p.name}</span><small>{counts[p.id]}</small>
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
        <button onClick={onStage} title="See the story's pages staged in 3D">3D stage</button>
        {/* A short "done" over the label, the full path in the tooltip: the header never reflows.
            Narrow windows drop the words in .more. */}
        <button className="swap" title={exportTip} onClick={async () => { setExported(await exportStoryBible(editor)); setTimeout(() => setExported(null), 4000) }}>
          <span className={exported == null ? '' : 'off'}>Export<span className="more"> story bible</span></span>
          {exported != null && <span>{exported ? <>Saved<span className="more"> in exports</span></> : 'Downloaded'}</span>}
        </button>
      </div>
      {/* Outside the buttons' scroller, so a failed save is always in view. */}
      <SaveStatus save={save} />
    </header>
  )
}

export default function App() {
  const [world, setWorld] = useState<{ loaded: boolean; data: any; error?: string }>({ loaded: false, data: null })
  const [editor, setEditor] = useState<Editor | null>(null)
  const [save, setSave] = useState<SaveState>('saved')

  const [stage, setStage] = useState<{ open: boolean; pageId?: string }>({ open: false })

  useEffect(() => {
    loadStaging()
    loadWorld().then((data) => setWorld({ loaded: true, data }), (e) => setWorld({ loaded: true, data: null, error: String(e) }))
  }, [])

  // The 3D stage opens at the given page, or at the selected page, or at the first one.
  const openStage = (pageId?: string) => {
    const sel = editor?.getOnlySelectedShape()
    setStage({ open: true, pageId: pageId ?? (sel?.type === 'scene' ? sel.id : undefined) })
  }

  useEffect(() => (editor ? startAutosave(editor, setSave) : undefined), [editor])
  useEffect(() => (editor ? attachStagingHistory(editor) : undefined), [editor]) // Undo/Redo of 3D edits

  const pageId = useValue('page', () => editor?.getCurrentPageId(), [editor])

  if (!world.loaded) return <div className="loading">Loading your world…</div>
  if (world.error) return <div className="loading">{world.error}<br />Start the app with <code>npm run dev</code> so it can read the data folder.</div>

  return (
    <StageContext.Provider value={openStage}>
    <div className="layout">
      {editor && <Header editor={editor} save={save} onStage={() => openStage()} />}
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
      {editor && stage.open && <StageOverlay editor={editor} pageId={stage.pageId} onClose={() => setStage({ open: false })} />}
    </div>
    </StageContext.Provider>
  )
}
