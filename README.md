# stories
repo where I keep my stories and invent how I want to bring them to life

## Engine

A small three.js engine for directing 3D scenes.

- `lab.html`: Character Lab. Shows the canonical base, its animations, faces and example outfits.
- `src/engine/`: stage (renderer, camera, lights), characters, animations, faces, outfits.
- `assets/characters/canonical/`: the rigged base every character is built from (see `docs/characters.md`).
- `tools/`: asset builders (Python 3 + numpy).

Run it: serve the repo root (for example `python3 -m http.server`) and open `/lab.html`.
