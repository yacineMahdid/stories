# Scenes

A scene is a **Story Canvas page staged in 3D**. The canvas already says where a page happens
(its map pins), when (world time), who is there and what happens. A **direction file** adds only
what 3D needs: what stands at each place, the weather, where everyone stands and what they do,
and the camera. Everything else comes from the canvas, so moving a pin or a page there moves it
in 3D too.

```
data/world.json      the Story Canvas (pins, characters, pages)       ← written in the canvas app
data/staging.json    the 3D direction for it                           ← written from your descriptions
scene.html           the Story Stage: stages any page, plays the story
props.html           the Prop Lab: every set piece, in every season and at any hour
```

The Story Canvas app shows all of this too: select a character, a map pin or a page to see it in
3D in the inspector, generate portraits and page stills onto the canvas, or open the full 3D stage
from the top bar. Looks and place sets chosen there are written to `data/staging.json`, the same
direction file described below.

`samples/brindlewick/` is a small invented world (five places, six characters, eight pages from
spring to winter) made to exercise all of this. The Story Stage opens `data/staging.json` when it
exists, then `data/world.json` staged automatically, otherwise the sample;
`scene.html?story=path/to/staging.json` opens any other. Each page has its own link: `scene.html#page-3`.

## The world is the map

Every pin is a place, at the tip of its marker. Map units become world units with `map.scale`
(0.05 by default: 20 map units per character height), from `map.origin`. So places keep their
real distances and directions: from the square you see the mill where the map says it is.

- Places have local coordinates in units (1 = a character's height): **x is east and z is south**
  of the pin. A place's `rotate` turns its local axes.
- Facings are degrees: 0 faces south (toward the default camera), 90 east, 180 north, 270 west.

## Direction file

```jsonc
{
  "version": 1,
  "world": "world.json",                        // the canvas file, relative to this one
  "map": { "scale": 0.05, "origin": [1000, 1000] },
  "defaults": { "weather": "clear", "season": "summer" },

  "terrain": [ ... ],                           // world-wide ground, in map coordinates
  "places": { "<pin id>": { ... } },            // what stands at each pin (pin id or pin name)
  "characters": { "<character id>": { ... } },  // 3D look of each canvas character
  "scenes": { "<page id>": { ... } }            // direction for each page (page id or title)
}
```

Anything left out has a default:
- A pin with no place entry gets a modest automatic set guessed from its kind and description (a
  village, a forest, a beach, a river...).
- A character with no look gets one guessed from their card (species, hair color).
- A page with no direction gathers its characters at its place and frames them.

### Terrain

Ground features, in map coordinates at the top level and in place units inside a place.

| type | fields | |
| --- | --- | --- |
| `river` | `points`, `width`, `depth` | carved into the land, water at y = -0.3 |
| `pond`, `lake` | `at` + `r`, or `points` | |
| `sea` | `points` (polygon of open water), `beach` | its edge is the waterline; a beach rises behind it |
| `hill` | `at`, `r`, `height` | a soft rise |
| `plateau` | `at` + `r` or `points`, `height`, `edge` | a raised terrace with cliffs |
| `flat` | `at`, `r`, `height` | levels the ground |
| `path` | `points`, `width`, `surface` | `dirt`, `stone`, `brick` or `sand` |
| `plaza` | `at` + `r` or `size`, `surface` | a paved area |
| `field` | `at`, `size` | tilled soil in rows |
| `sand` | `at` + `r` or `points` | a sandy patch |

### Places

```jsonc
"shape:square": {
  "radius": 15,                                 // level ground around the pin
  "height": 0,                                  // level it at this height (a hilltop: 3)
  "rotate": 0,
  "ground": { "surface": "stone", "r": 8.5 },   // a plaza under the place
  "wild": { "grass": 0.6, "flowers": 0.06 },    // grass tufts and wild flowers around it
  "terrain": [ ... ],                           // local ground features
  "things": [ ... ]
}
```

A **thing** is a prop by `kind` (see the Prop Lab for every kind and its params) plus where it
goes. Every other field is passed to the prop as a param.

```jsonc
{ "id": "bakery", "kind": "house", "at": [-9.5, -7.5], "facing": "fountain",
  "sign": "Bakery", "roof": "#cf5a45", "note": "Juniper's bakery" }
```

- `id` names it for changes, spots and cameras. Ids are global across the world.
- `at` takes one of these forms:
  - `[x, z]` in place units
  - `{ "map": [x, y] }` a map point
  - `{ "pin": "<pin>", "offset": [x, z] }` at another pin, for a thing with its own pin on the map
  - `{ "near": "<thing>", "offset": [x, z] }` relative to another thing, turned with it
- `facing` is degrees, or a thing id to face it, or `"center"`.
- `scale`, `lift` (raise above the ground), and `note` (what the story said about it).
- Groups:
  - `{ "kind": "row", "of": "lamp", "from": [x, z], "to": [x, z], "count": 4 }`
  - `{ "kind": "ring", "of": "bench", "at": [x, z], "r": 5, "count": 4, "facing": "in" | "out", "start": 45 }`
  - `{ "kind": "scatter", "of": "tree" | ["tree", "bush"], "area": { "r": 20 } | { "at": [x, z], "size": [w, d] } | { "points": [...] }, "avoid": { "r": 8 }, "count": 40, "spacing": 2.4, "params": { "variant": ["oak", "pine"] } }`
  - Scatters skip water, paths and other things. A list in `params` is picked at random for each copy.

### Characters

A look is a character spec (see `docs/characters.md`) with a `species`:

```jsonc
"shape:hattie": { "species": "horse", "outfit": { "top": "#f2e6c8", "bottom": "#4f8a55", "legs": "pants" } }
```

### Scenes

```jsonc
"shape:p3": {
  "place": "shape:mill",          // default: the page's first location
  "time": 19.5,                   // hour; default: the page's world time. "+2" = two hours after the page it continues
  "season": "spring",             // default: from the page's month
  "weather": "storm",             // clear | cloudy | overcast | rain | storm | snow | fog
  "ambient": "leaves",            // floating particles: leaves | petals | fireflies | dust
  "continues": "shape:p2",        // a direct continuation: inherits its dressing, place, weather and camera
  "changes": [ ... ],             // lasting changes, from this page on
  "dressing": [ ... ],            // things only in this page (and pages that continue it)
  "cast": [ ... ],
  "camera": [ ... ]
}
```

**Continuity.**
- `changes` last, like a persistent page modifier on the canvas: every later page of the same story
  sees them, in reading order.
- `dressing` is temporary: a market stall for one festival, a tent for one night.
- A page that `continues` another also keeps that page's dressing: a branch the storm brought down
  is still there the next morning.
- The viewer lists, on each page, every inherited change and the page it came from.

```jsonc
{ "set": "bridge", "to": { "state": "broken" }, "note": "The storm broke the old footbridge" }
{ "add": { "id": "statue", "kind": "statue", "at": [0, 4] } }
{ "remove": "old-oak" }
{ "move": "cart", "to": [3, 2], "facing": 90 }
{ "look": "shape:mira", "to": { "outfit": { "top": "#f2c94c" } } }   // a character's look from here on
{ "terrain": { "type": "path", "points": [[0, 0], [8, 3]] } }
```

**Cast.** Each entry is one character on their mark:

```jsonc
{ "who": "shape:mira",            // character id or name
  "at": [0.6, 5.2],               // place units, or "bench-west.left" (a prop's spot), or { "near": ... }
  "facing": "shape:biscuit",      // degrees, a character, a thing, or "group" (face the others)
  "do": "Wave",                   // any animation: Idle, Walk, Talk, Sit, Point, Cower, Dance...
  "feel": "cheerful",             // any emotion: happy, scared, furious, love, sleepy...
  "talk": true,                   // mouth moves
  "hold": "held-umbrella",        // a hand prop, or { "kind": "held-lantern", ...params }
  "path": [[-2, 6], [3, 6], [4, 1]], "speed": 0.9, "loop": "pingpong",   // walks
  "look": { ... }                 // a look change for this page only
}
```

Spots are the places props offer characters: a bench's seats, a door, the end of a pier, the
logs around a campfire. A character put on a spot takes its position, facing and pose (sitters
sit on the seat, at the seat's height).

**Camera.** One shot or a list. The viewer can switch between shots, and Play runs through every
page and every shot.

```jsonc
{ "shot": "medium", "on": ["shape:mira", "shape:biscuit"], "from": 200, "label": "Hello", "hold": 4, "move": "push" }
```

- `shot`:
  - `establishing`: the whole place from above
  - `wide`: the group and its surroundings
  - `medium`
  - `two`
  - `close`: a head and shoulders
  - `over`: over the first subject's shoulder at the second
  - `low`: looking up
  - `high`
  - `top`: straight down
- `on`: subjects (cast or things). The default is the whole cast.
- `from`: the compass direction the camera looks from. The default is the direction the subjects
  face, turned 22° for a three-quarter view.
- `distance`, `height`, `fov` and `turn` override the framing.
- `pos` + `target` (`[x, y, z]` in place units) place the camera exactly.
- `move`: `orbit`, `push`, `pull`, `pan` or `still`. `hold` is the seconds the shot lasts in Play.
- `{ "same": "<page>" }` in place of the shots reuses another page's camera, to come back to a
  spot with the same framing.

## Props

`props.html` (the Prop Lab) shows every kind with its params, examples and spots, in any season,
hour and weather. Props live in `src/world/props/` (nature, buildings, village, waterside and hand
props), built from the shared kit in `src/world/kit.js`.
- Snow on upward faces, rain wetness, windows that light up at night and swaying foliage are
  automatic for every prop.
- A kind nobody has built yet shows up as a labeled crate, so nothing a story asks for silently
  disappears.

## Engine

| file | |
| --- | --- |
| `src/world/canvas.js` | reads a Story Canvas file: pins, characters, pages in reading order |
| `src/world/staging.js` | the direction format, continuity and every default |
| `src/world/director.js` | builds the set, stages the cast, frames the shots |
| `src/world/terrain.js` | heightfield, painted ground, cliffs, water, the far hills |
| `src/world/sky.js`, `weather.js` | time of day, sun and moon, sky, clouds, stars, rain, snow, particles |
| `src/world/world-stage.js` | renderer, light, fog, shadows |
| `src/world/kit.js` | the prop kit: shapes, materials, palette, scale |
