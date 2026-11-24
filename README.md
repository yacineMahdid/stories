# stories
repo where I keep my stories and invent how I want to bring them to life

## Story Canvas

An infinite-canvas workspace (built on [tldraw](https://tldraw.dev)) for building a world and stitching it into scenes.

```bash
cd app
npm install
npm run dev
```

Then open http://localhost:5173.

| Tab | What lives there |
| --- | --- |
| **Characters** | Character cards: name, role, colour, base appearance, personality and their own backstory. Upload portrait iterations (each one is kept as a version; pick the active look). Drop sketches and references around the card. |
| **Map** | Top-down 2D map. Draw with the pen, shape, arrow and text tools, drop a map image (select it → *Use as map background*), and add pins for places. |
| **Backstory** | Global lore notes, each with a precise world date (year / month / day / hour) and an optional end for spans. It is fed to pages as hidden context and never stated in them. A **world chronology** strip puts lore and story pages on one timeline. |
| **Story** | Nested boxes: **Story ⊃ Books ⊃ Chapters ⊃ Pages**. A page is a scene: its characters, map pins, exact world time and a description. Numbering and reading order come from the nesting; the outline and timeline strip follow it. Characters can get per-page modifiers, optionally carried into later pages of the same story. |

**Continuity checks** flag deleted references, missing time or places, a character in two places at the same moment, a character appearing before they are born, and pages that jump back in time.
**Export story bible** writes `data/exports/story-bible.md`: lore in date order, characters, places, then the full Story → Book → Chapter → Page tree. Each page lists each character's age and effective look, plus which backstory is history, ongoing, or has not happened yet at that moment.

### Where things are saved

Everything autosaves into the repo so it can be versioned with git:

- `data/world.json`: the whole canvas (all four tabs)
- `data/assets/`: uploaded images (portraits, maps, references)
- `data/exports/`: exported story bibles

## 3D engine

A three.js engine that turns the story into 3D scenes.

- `scene.html`: **Scene Viewer**. Stages any Story Canvas page in 3D: the place at its map pin, the moment (hour, weather, season), the cast on their marks, and the camera shots. Play runs the whole story page by page. It opens `data/staging.json` when there is one, otherwise the sample world in `samples/brindlewick/`.
- `props.html`: **Prop Lab**. Every set piece scenes can use (nature, buildings, village, waterside, hand props), in every season and at any hour.
- `lab.html`: **Character Lab**. The canonical character base with hair, faces, emotions, body types, species and animations.
- `src/world/`: places, terrain, sky, weather, props, staging and continuity, director (see `docs/scenes.md`).
- `src/engine/`: characters, animations, faces, outfits (see `docs/characters.md`).
- `assets/characters/canonical/`: the rigged base every character is built from.
- `tools/`: asset builders (Python 3 + numpy).

Run it: serve the repo root (for example `python3 -m http.server`) and open `/scene.html`, `/props.html` or `/lab.html`.
