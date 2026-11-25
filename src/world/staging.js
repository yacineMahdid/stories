import { SEASON_OF_MONTH } from './sky.js';
import { hashString } from './kit.js';

/**
 * Staging: the 3D direction for a Story Canvas world. It never repeats what the canvas
 * already says (pins, pages, times, who is in a page); it adds what the 3D scene needs:
 * what stands at each place, the weather, the blocking and the camera. Scenes stay in
 * continuity: lasting changes carry into every later page of the same story, and a page
 * can continue another one directly. See docs/scenes.md for the format.
 */

const D2R = Math.PI / 180;

/* ───────────── helpers ───────────── */

function rotate([x, z], deg) {
  const t = deg * D2R, c = Math.cos(t), s = Math.sin(t);
  return [x * c + z * s, -x * s + z * c];
}

function byIdOrName(map, ref) {
  if (ref == null) return null;
  if (map.has(ref)) return map.get(ref);
  if (map.has(`shape:${ref}`)) return map.get(`shape:${ref}`);
  const low = String(ref).toLowerCase();
  for (const v of map.values()) if ((v.name ?? v.title ?? '').toLowerCase() === low) return v;
  return null;
}

function deepMerge(a, b) {
  if (b === undefined) return a;
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out;
}

/**
 * The key of a canvas shape's entry in a direction section ('characters' or 'places'), the way
 * World finds it: by shape id, by id without "shape:", or by name (any case). Null when none.
 */
export function directionKey(direction, section, id, name) {
  const entries = direction?.[section] ?? {};
  if (id in entries) return id;
  const bare = String(id).replace(/^shape:/, '');
  if (bare in entries) return bare;
  const low = (name ?? '').toLowerCase();
  if (low) for (const k of Object.keys(entries)) if (k.toLowerCase() === low) return k;
  return null;
}

export function yawTo(from, to) {
  return Math.atan2(to[0] - from[0], to[1] - from[1]) / D2R;
}

/* ───────────── the world ───────────── */

export class World {
  /**
   * @param {object} canvas     readCanvas() output
   * @param {object} direction  the staging JSON
   */
  constructor(canvas, direction = {}) {
    this.canvas = canvas;
    this.direction = direction;
    this.warnings = [];
    this.scale = direction.map?.scale ?? 0.05;
    const firstPin = canvas.pins.values().next().value;
    this.origin = direction.map?.origin ?? firstPin?.at ?? [0, 0];

    // Places: every pin, with its direction (or an automatic set when there is none).
    this.places = new Map();
    for (const pin of canvas.pins.values()) {
      const placeKey = directionKey(direction, 'places', pin.id, pin.name);
      let dir = placeKey != null ? direction.places[placeKey] : null;
      // { "preset": "forest" } picks an automatic set instead of guessing it from the pin's text.
      if (dir?.preset && !dir.things) dir = { ...autoPlace(pin, dir.preset), ...dir };
      const place = {
        id: pin.id, pin, name: pin.name, kind: pin.kind, description: pin.description,
        pos: this.mapToWorld(pin.at),
        rotate: dir?.rotate ?? 0,
        radius: dir?.radius ?? 10,
        ground: dir?.ground ?? null,
        wild: { grass: 0.55, flowers: 0.05, ...(dir?.wild ?? {}) },
        staged: !!dir,
        dir: dir ?? autoPlace(pin),
      };
      this.places.set(pin.id, place);
    }
    for (const key of Object.keys(direction.places ?? {})) {
      if (!this.places.has(key) && !this.placeByName(key)) this.warn(`The direction has a place "${key}" but no pin on the map has that id or name.`);
    }

    // Base things of every place, in world coordinates.
    this.things = new Map();
    for (const place of this.places.values()) {
      for (const t of expandGroups(place.dir.things ?? [], place.id)) this.addThing(t, place, 'place');
    }

    // Terrain: world-wide features (map coordinates) and each place's own (local).
    this.terrain = [];
    for (const f of direction.terrain ?? []) this.terrain.push(this.featureToWorld(f, null));
    for (const place of this.places.values()) {
      this.terrain.push({ type: 'flat', at: place.pos, r: place.radius, blend: 5, height: place.dir.height ?? 'auto', place: place.id });
      if (place.ground && place.ground !== 'grass') {
        const g = typeof place.ground === 'string' ? { surface: place.ground } : place.ground;
        this.terrain.push({ type: 'plaza', at: place.pos, r: g.r ?? place.radius * 0.8, size: g.size, rotate: (g.rotate ?? 0) + place.rotate, surface: g.surface ?? 'stone', flatten: false, place: place.id });
      }
      for (const f of place.dir.terrain ?? []) this.terrain.push(this.featureToWorld(f, place));
    }

    // Characters: canvas cards + 3D looks from the direction.
    this.characters = new Map();
    for (const c of canvas.characters.values()) {
      const key = directionKey(direction, 'characters', c.id, c.name);
      this.characters.set(c.id, { ...c, spec: key != null ? direction.characters[key] : null });
    }
    // Looks for characters that aren't on the canvas: a deleted card's look ("shape:..." key)
    // is ignored; a look keyed by a plain name stands in as a character of its own.
    for (const [key, spec] of Object.entries(direction.characters ?? {})) {
      if (key.startsWith('shape:') || byIdOrName(this.characters, key)) continue;
      this.characters.set(key, { id: key, name: spec.name ?? key, spec });
    }

    // Scenes in reading order.
    this.scenes = canvas.pages.map((page) => ({ page, dir: direction.scenes?.[page.id] ?? this.sceneDirectionByTitle(page.title) ?? {} }));
    this.sceneIndex = new Map(this.scenes.map((s, i) => [s.page.id, i]));
  }

  warn(text) { if (!this.warnings.includes(text)) this.warnings.push(text); }

  sceneDirectionByTitle(title) {
    const low = (title ?? '').toLowerCase();
    if (!low) return null;
    for (const [k, v] of Object.entries(this.direction.scenes ?? {})) if (k.toLowerCase() === low) return v;
    return null;
  }

  placeByName(ref) { return byIdOrName(this.places, ref); }

  /** Where a page happens before the map has any pins: an empty meadow at the origin. */
  nowhere() {
    return {
      id: '', pin: null, name: 'Nowhere yet', kind: 'place', description: 'Add a pin on the map and put this page there.',
      pos: [0, 0], rotate: 0, radius: 10, ground: null, wild: { grass: 0.55, flowers: 0.05 }, staged: false, dir: { things: [] },
    };
  }
  character(ref) { return byIdOrName(this.characters, ref); }

  mapToWorld([mx, my]) {
    return [(mx - this.origin[0]) * this.scale, (my - this.origin[1]) * this.scale];
  }
  worldToMap([x, z]) {
    return [x / this.scale + this.origin[0], z / this.scale + this.origin[1]];
  }

  /** A place-local point to world: [x, z] in units east / south of the pin, turned by the place. */
  localToWorld(p, place) {
    if (!place) return this.mapToWorld(p);
    const [rx, rz] = rotate(p, place.rotate);
    return [place.pos[0] + rx, place.pos[1] + rz];
  }

  /** Resolve an `at`: [x, z] local, { map }, { pin, offset }, { near, offset }. Returns world [x, z]. */
  resolveAt(at, place, things = this.things, seen = new Set()) {
    if (Array.isArray(at)) return this.localToWorld(at, place);
    if (at && typeof at === 'object') {
      if (at.map) return this.mapToWorld(at.map);
      if (at.pin) {
        const p = this.placeByName(at.pin);
        if (!p) { this.warn(`Unknown pin "${at.pin}".`); return place?.pos ?? [0, 0]; }
        return this.localToWorld(at.offset ?? [0, 0], p);
      }
      if (at.near) {
        const t = things.get(at.near);
        if (!t || seen.has(at.near)) { this.warn(`"near" refers to an unknown thing "${at.near}".`); return place?.pos ?? [0, 0]; }
        const [ox, oz] = rotate(at.offset ?? [0, 0], t.facing ?? 0);
        return [t.pos[0] + ox, t.pos[1] + oz];
      }
    }
    return place?.pos ?? [0, 0];
  }

  featureToWorld(f, place) {
    const out = { ...f, place: place?.id ?? null };
    if (f.at) out.at = Array.isArray(f.at) ? this.localToWorld(f.at, place) : this.resolveAt(f.at, place);
    if (f.points) out.points = f.points.map((p) => this.localToWorld(p, place));
    if (f.rotate != null || place) out.rotate = (f.rotate ?? 0) + (place?.rotate ?? 0);
    // Map-space features measure sizes in map units unless they say `units`.
    if (!place && !f.units) {
      for (const k of ['r', 'width', 'beach', 'bank', 'edge', 'blend']) if (typeof f[k] === 'number') out[k] = f[k] * this.scale;
      if (f.size) out.size = f.size.map((v) => v * this.scale);
    }
    return out;
  }

  addThing(t, place, source, things = this.things) {
    const id = t.id ?? `${place?.id ?? 'world'}/${t.kind}-${things.size}`;
    if (things.has(id) && source === 'place') this.warn(`Two things share the id "${id}".`);
    const pos = this.resolveAt(t.at ?? [0, 0], place, things);
    const thing = {
      ...t, id, kind: t.kind, place: place?.id ?? null, pos,
      facing: typeof t.facing === 'number' ? t.facing + (place?.rotate ?? 0) : (place?.rotate ?? 0),
      facingTarget: typeof t.facing === 'string' ? t.facing : null,
      source,
    };
    things.set(id, thing);
    return thing;
  }

  /* ───────────── one scene, in continuity ───────────── */

  /**
   * Everything needed to stage scene `index`: its place and moment, the things standing (after
   * every lasting change from earlier pages of the same story), its dressing, cast and camera,
   * plus continuity notes saying where each inherited change came from.
   */
  sceneState(index) {
    const scene = this.scenes[index];
    if (!scene) return null;
    const { page } = scene;
    const notes = [];
    const warnings = [];

    // The chain of scenes this one continues (newest first), for dressing and defaults.
    const chain = [];
    let cur = scene;
    const guard = new Set([page.id]);
    while (cur.dir.continues) {
      const i = this.resolveSceneIndex(cur.dir.continues);
      if (i == null) { warnings.push(`"continues" points to an unknown page "${cur.dir.continues}".`); break; }
      const prev = this.scenes[i];
      if (guard.has(prev.page.id)) break;
      guard.add(prev.page.id);
      chain.push(prev);
      cur = prev;
    }
    const inherit = (key) => { for (const s of [scene, ...chain]) if (s.dir[key] != null) return s.dir[key]; return null; };

    // Place.
    let place = null;
    for (const s of [scene, ...chain]) {
      const ref = s.dir.place ?? s.page.locationIds?.[0];
      if (ref) { place = this.placeByName(ref); if (place) break; }
    }
    if (!place) {
      place = this.places.values().next().value ?? null;
      if (!page.locationIds?.length) warnings.push('This page has no place on the map yet; showing the first place.');
    }
    if (!place) {
      place = this.nowhere();
      warnings.push('There are no pins on the map yet: add one and put this page there.');
    }

    // Moment.
    const hourOf = (s) => {
      const t = s.dir.time;
      if (typeof t === 'number') return t;
      return s.page.at?.hour ?? null;
    };
    let hour = hourOf(scene);
    if (typeof scene.dir.time === 'string' && /^[+-]/.test(scene.dir.time) && chain[0]) hour = (hourOf(chain[0]) ?? 12) + Number(scene.dir.time);
    if (hour == null) for (const s of chain) { hour = hourOf(s); if (hour != null) break; }
    hour = ((hour ?? 12) % 24 + 24) % 24;
    const season = scene.dir.season ?? SEASON_OF_MONTH(page.at?.month) ?? inherit('season') ?? this.direction.defaults?.season ?? 'summer';
    const weather = inherit('weather') ?? this.direction.defaults?.weather ?? 'clear';
    const ambient = inherit('ambient') ?? null;
    const day = page.at?.day ?? 15;

    // Things after continuity: base, then lasting changes of earlier pages in the same story.
    const things = new Map([...this.things].map(([k, v]) => [k, { ...v }]));
    const looks = new Map();
    const here = []; // lasting changes this page makes
    const applyChanges = (s, isEarlier) => {
      for (const ch of s.dir.changes ?? []) {
        const chPlace = this.placeByName(ch.place ?? s.dir.place ?? s.page.locationIds?.[0]) ?? place;
        const label = ch.note ?? describeChange(ch);
        let touched = null;
        if (ch.add) {
          for (const t of expandGroups([ch.add], chPlace?.id)) touched = this.addThing(t, chPlace, 'change', things).id;
        } else if (ch.remove) {
          touched = ch.remove;
          if (!things.delete(ch.remove)) warnings.push(`A change removes "${ch.remove}", which is not there.`);
        } else if (ch.set) {
          const t = things.get(ch.set);
          if (t) Object.assign(t, ch.to ?? {});
          else warnings.push(`A change sets "${ch.set}", which is not there.`);
          touched = ch.set;
        } else if (ch.move) {
          const t = things.get(ch.move);
          if (t) {
            if (ch.to) t.pos = this.resolveAt(ch.to, chPlace, things);
            if (typeof ch.facing === 'number') t.facing = ch.facing + (chPlace?.rotate ?? 0);
          } else warnings.push(`A change moves "${ch.move}", which is not there.`);
          touched = ch.move;
        } else if (ch.look) {
          const c = this.character(ch.look);
          if (c) looks.set(c.id, deepMerge(looks.get(c.id) ?? {}, ch.to ?? {}));
          touched = ch.look;
        } else if (ch.terrain) {
          things.set(`terrain:${s.page.id}:${hashString(JSON.stringify(ch.terrain))}`, { kind: '__terrain', feature: this.featureToWorld(ch.terrain, chPlace), pos: chPlace?.pos ?? [0, 0], source: 'change' });
          touched = 'terrain';
        }
        if (isEarlier && touched) notes.push({ text: label, since: s.page.path, title: s.page.title, id: touched, look: !!ch.look });
        if (!isEarlier && touched) here.push({ text: label, id: touched });
      }
    };
    for (let i = 0; i < index; i++) {
      const s = this.scenes[i];
      if (s.page.storyId !== page.storyId) continue;
      applyChanges(s, true);
    }
    applyChanges(scene, false);

    // Dressing: this page's own, plus what the pages it continues left standing.
    for (const s of [...chain].reverse()) {
      const sPlace = this.placeByName(s.dir.place ?? s.page.locationIds?.[0]) ?? place;
      for (const t of expandGroups(s.dir.dressing ?? [], sPlace?.id)) {
        const th = this.addThing({ ...t, id: t.id ?? `${s.page.id}/dress-${things.size}` }, sPlace, 'dressing', things);
        notes.push({ text: `${t.note ?? t.kind} (left from the page it continues)`, since: s.page.path, title: s.page.title, id: th.id });
      }
    }
    for (const t of expandGroups(scene.dir.dressing ?? [], place?.id)) this.addThing({ ...t, id: t.id ?? `${page.id}/dress-${things.size}` }, place, 'dressing', things);

    // Facing toward a named target (another thing, or the place center).
    for (const t of things.values()) {
      if (!t.facingTarget) continue;
      const target = things.get(t.facingTarget);
      const home = this.places.get(t.place) ?? place; // "center" is the middle of the thing's own place
      if (target) t.facing = yawTo(t.pos, target.pos);
      else if (t.facingTarget === 'center' && home) t.facing = yawTo(t.pos, home.pos);
    }

    // Cast: the page's characters, placed by the direction or gathered automatically.
    const castDir = scene.dir.cast ?? (chain.length ? inherit('cast') ?? [] : []);
    const cast = [];
    const used = new Set();
    for (const c of castDir) {
      const who = this.character(c.who);
      if (!who) { warnings.push(`The cast has "${c.who}", who is not a character on the canvas.`); continue; }
      if (page.characterIds?.length && !page.characterIds.includes(who.id)) warnings.push(`${who.name} is staged here but not listed on this page.`);
      used.add(who.id);
      cast.push({ ...c, who: who.id, character: who, look: deepMerge(looks.get(who.id) ?? {}, c.look ?? {}) });
    }
    const missing = (page.characterIds ?? []).filter((id) => !used.has(id));
    missing.forEach((id, i) => {
      const who = this.character(id);
      if (!who) { warnings.push(`This page lists a character (${id}) that no longer exists.`); return; }
      const n = missing.length;
      const a = (i / Math.max(n, 1)) * Math.PI * 2 + 0.6;
      const r = n > 1 ? 0.9 + n * 0.18 : 0;
      cast.push({ who: who.id, character: who, at: [Math.sin(a) * r, Math.cos(a) * r + 1.2], facing: n > 1 ? 'group' : 0, do: n > 1 ? 'Talk' : 'Idle', auto: true, look: looks.get(who.id) ?? {} });
    });

    // Camera: its own shots, the continued page's, or `{ "same": "<page>" }` to reuse another page's framing.
    let camera = scene.dir.camera ?? inherit('camera') ?? null;
    if (camera && !Array.isArray(camera) && camera.same) {
      const j = this.resolveSceneIndex(camera.same);
      if (j == null) { warnings.push(`The camera copies an unknown page "${camera.same}".`); camera = null; }
      else camera = this.scenes[j].dir.camera ?? null;
    }
    const shots = Array.isArray(camera) ? camera : camera ? [camera] : [{ shot: cast.length ? 'medium' : 'wide' }];

    // Only mention inherited changes that can matter here: things near this place, looks of
    // characters on this page.
    const castIds = new Set(cast.map((c) => c.who));
    const NEAR = 30;
    const latest = new Map();
    for (const n of notes) latest.set(n.look ? `look:${n.id}` : n.id, n); // the newest change to each thing
    const seenText = new Set();
    const relevant = [...latest.values()].filter((n) => {
      const key = `${n.text}|${n.since}`;
      if (seenText.has(key)) return false;
      seenText.add(key);
      if (n.look) return castIds.has(this.character(n.id)?.id);
      const t = things.get(n.id);
      if (!t) return n.id === 'terrain' || [...this.things.values()].some((b) => b.id === n.id && place && Math.hypot(b.pos[0] - place.pos[0], b.pos[1] - place.pos[1]) < NEAR);
      return !place || Math.hypot(t.pos[0] - place.pos[0], t.pos[1] - place.pos[1]) < NEAR;
    });

    return {
      index, page, dir: scene.dir, place, chain: chain.map((s) => s.page.id),
      hour, season, weather, ambient, day,
      things, cast, shots, notes: relevant, allNotes: notes, changes: here, warnings: [...warnings],
      looks,
    };
  }

  /**
   * A place on its own, with no page: its things as they stand before the story starts,
   * at a given moment. For previews of a map pin.
   */
  placeState(ref, { hour = 11, season = 'summer', weather = 'clear', day = 15 } = {}) {
    const place = this.placeByName(ref);
    if (!place) return null;
    const things = new Map([...this.things].map(([k, v]) => [k, { ...v }]));
    for (const t of things.values()) {
      if (!t.facingTarget) continue;
      const target = things.get(t.facingTarget);
      const home = this.places.get(t.place) ?? place;
      if (target) t.facing = yawTo(t.pos, target.pos);
      else if (t.facingTarget === 'center' && home) t.facing = yawTo(t.pos, home.pos);
    }
    return {
      index: -1, page: { id: `place:${place.id}`, title: place.name, when: '', at: {}, summary: place.description, path: '', characterIds: [], locationIds: [place.id] },
      dir: {}, place, chain: [], hour, season, weather, ambient: null, day,
      things, cast: [], shots: [{ shot: 'establishing', label: place.name }, { shot: 'wide', label: 'Closer' }], notes: [], allNotes: [], changes: [], warnings: [], looks: new Map(),
    };
  }

  resolveSceneIndex(ref) {
    if (this.sceneIndex.has(ref)) return this.sceneIndex.get(ref);
    if (this.sceneIndex.has(`shape:${ref}`)) return this.sceneIndex.get(`shape:${ref}`);
    const low = String(ref).toLowerCase();
    const i = this.scenes.findIndex((s) => s.page.title.toLowerCase() === low || s.page.path.toLowerCase() === low);
    return i >= 0 ? i : null;
  }

  /** Character spec for the 3D model: direction look, else guessed from the canvas card. */
  specFor(character, look = {}) {
    return deepMerge(character.spec ?? guessSpec(character), look);
  }
}

function describeChange(ch) {
  if (ch.add) return `${ch.add.note ?? ch.add.kind} added`;
  if (ch.remove) return `${ch.remove} removed`;
  if (ch.set) return `${ch.set}: ${Object.entries(ch.to ?? {}).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')}`;
  if (ch.move) return `${ch.move} moved`;
  if (ch.look) return `${ch.look}'s look changed`;
  if (ch.terrain) return `the ground changed (${ch.terrain.type})`;
  return 'a change';
}

/**
 * Rows and rings of things become individual things:
 *   { kind: 'row', of: 'lamp', from: [x, z], to: [x, z], count, ...params }
 *   { kind: 'ring', of: 'bench', at: [x, z], r, count, facing: 'in' | 'out', start: deg, ...params }
 * Scatters stay as one entry; the set builder spreads them over the ground it builds.
 */
export function expandGroups(list, placeId) {
  const out = [];
  list.forEach((t, k) => {
    if (t.kind === 'row') {
      const n = Math.max(1, t.count ?? 2);
      const { of, from = [0, 0], to = [0, 0], count, id, ...params } = t;
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0.5 : i / (n - 1);
        out.push({ ...params, kind: of, id: `${id ?? `${placeId}/row${k}`}-${i + 1}`, at: [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u] });
      }
    } else if (t.kind === 'ring') {
      const n = Math.max(1, t.count ?? 4);
      const { of, at = [0, 0], r = 4, count, id, start = 0, facing = 'in', ...params } = t;
      for (let i = 0; i < n; i++) {
        const a = start + (i / n) * 360;
        const p = [at[0] + Math.sin(a * D2R) * r, at[1] + Math.cos(a * D2R) * r];
        const face = facing === 'in' ? a + 180 : facing === 'out' ? a : facing;
        out.push({ ...params, kind: of, id: `${id ?? `${placeId}/ring${k}`}-${i + 1}`, at: p, facing: face });
      }
    } else {
      out.push(t);
    }
  });
  return out;
}

/** A modest automatic set for a pin nobody has staged yet, from its kind, name and description. */
export const PLACE_PRESETS = ['town', 'forest', 'beach', 'river', 'lake', 'ruin', 'wild', 'hill', 'meadow'];

export function autoPlace(pin, preset = null) {
  const SETS = [
    ['beach', ['beach', 'shore', 'coast', 'harbor', 'harbour', 'dock', 'pier', 'port', 'bay', 'sea']],
    ['river', ['river', 'mill', 'bridge', 'stream', 'brook', 'ford']],
    ['lake', ['lake', 'pond', 'pool', 'spring']],
    ['forest', ['forest', 'wood', 'grove', 'clearing', 'glade', 'thicket']],
    ['ruin', ['ruin', 'temple', 'ancient', 'tomb', 'shrine']],
    ['wild', ['cave', 'wasteland', 'graveyard', 'swamp', 'dead']],
    ['hill', ['hill', 'peak', 'lookout', 'mountain', 'cliff']],
    ['town', ['town', 'village', 'square', 'market', 'city', 'street', 'plaza']],
  ];
  // The name says what the place is; the description only helps when the name doesn't.
  const pick = (text) => SETS.find(([, words]) => words.some((w) => new RegExp(`\\b${w}`).test(text)))?.[0];
  const kindHint = { town: 'town', danger: 'wild', secret: 'ruin', landmark: null, region: 'forest', place: null }[pin.kind];
  const set = (PLACE_PRESETS.includes(preset) ? preset : null) ?? pick(pin.name.toLowerCase()) ?? (pin.kind === 'town' ? 'town' : null) ?? pick(pin.description.toLowerCase()) ?? kindHint ?? 'meadow';
  const things = [];
  const terrain = [];
  let ground = null;
  switch (set) {
    case 'town':
      ground = { surface: 'stone', r: 7 };
      things.push({ id: `${pin.id}/centre`, kind: /fountain/.test(pin.description.toLowerCase()) ? 'fountain' : 'well', at: [0, 0] });
      things.push({ kind: 'ring', of: 'house', r: 11, count: 5, start: 160, facing: 'in' });
      things.push({ kind: 'ring', of: 'lamp', r: 6.5, count: 4, start: 45 });
      break;
    case 'forest':
      things.push({ kind: 'scatter', of: 'tree', area: { r: 22 }, avoid: { r: 6 }, count: 40, params: { variant: ['round', 'pine', 'oak'] } });
      things.push({ kind: 'scatter', of: 'mushroom', area: { r: 8 }, count: 5 });
      break;
    case 'beach':
      terrain.push({ type: 'sea', points: [[-60, 6], [60, 6], [60, 80], [-60, 80]], beach: 8 });
      things.push({ kind: 'dock', at: [3, 3] });
      things.push({ kind: 'scatter', of: 'tree', area: { r: 18 }, avoid: { r: 7 }, count: 8, params: { variant: 'palm' } });
      break;
    case 'river':
      terrain.push({ type: 'river', points: [[-40, 4], [-10, 5], [10, 3], [40, 5]], width: 4 });
      things.push({ kind: 'bridge', at: [0, 4.2], facing: 90 });
      // The watermill's wheel is on its +X side: turned 270°, +X points south, into the river.
      if (/mill/.test(pin.name.toLowerCase())) things.push({ kind: 'watermill', at: [-6, 0.2], facing: 270 });
      break;
    case 'lake':
      terrain.push({ type: 'pond', at: [0, 6], r: 6 });
      things.push({ kind: 'scatter', of: 'reeds', area: { at: [0, 6], r: 7 }, count: 6, onWater: true });
      break;
    case 'ruin':
      things.push({ kind: 'ruin', at: [0, -2] });
      things.push({ kind: 'scatter', of: 'tree', area: { r: 20 }, avoid: { r: 7 }, count: 16 });
      break;
    case 'wild':
      things.push({ kind: 'scatter', of: 'tree', area: { r: 20 }, avoid: { r: 5 }, count: 25, params: { variant: 'dead' } });
      things.push({ kind: 'scatter', of: 'rock', area: { r: 10 }, count: 8 });
      break;
    case 'hill':
      terrain.push({ type: 'hill', at: [0, 0], r: 14, height: 3 });
      things.push({ kind: 'scatter', of: 'flowers', area: { r: 8 }, count: 8 });
      break;
    default:
      things.push({ kind: 'scatter', of: 'tree', area: { r: 20 }, avoid: { r: 7 }, count: 14 });
      things.push({ kind: 'scatter', of: 'flowers', area: { r: 8 }, count: 6 });
  }
  return { things, terrain, ground, auto: set };
}

/** Guess a 3D look from a canvas character card (species, hair and colors from the text). */
export function guessSpec(c) {
  const text = `${c.appearance ?? ''} ${c.role ?? ''} ${c.name ?? ''}`.toLowerCase();
  const species = ['monkey', 'baboon', 'gorilla', 'cow', 'dog', 'cat', 'horse', 'frog'].find((s) => text.includes(s)) ?? 'human';
  const h = hashString(c.id ?? c.name ?? 'x');
  const hairColors = { blonde: '#e0b45c', blond: '#e0b45c', red: '#d4692e', ginger: '#d4692e', black: '#1f1b1a', brown: '#4a2f22', gray: '#c8c3ba', grey: '#c8c3ba', white: '#ece7df', pink: '#f29ab2', blue: '#4d7cc9' };
  const hairWord = Object.keys(hairColors).find((w) => text.includes(`${w} hair`));
  const styles = ['bob', 'spiky', 'swept', 'pigtails', 'ponytail', 'bun', 'long'];
  const styleWord = styles.find((s) => text.includes(s));
  const skins = ['#f8d3b0', '#f1c39c', '#e0a47c', '#c98e66', '#9c6a48', '#6e4a33'];
  const top = c.color ?? ['#e2483c', '#4f86c6', '#5aa56a', '#f2c94c', '#9a72c9'][h % 5];
  const spec = {
    species,
    skin: skins[h % skins.length],
    hair: { style: styleWord ?? styles[h % styles.length], color: hairWord ? hairColors[hairWord] : ['#4a2f22', '#1f1b1a', '#7a4a2c', '#e0b45c'][(h >> 3) % 4] },
    outfit: { top, sleeves: ['short', 'long', 'elbow'][(h >> 5) % 3], bottom: ['#2f3640', '#5a4636', '#3f5f8a'][(h >> 7) % 3], legs: ['shorts', 'pants', 'knee'][(h >> 9) % 3], shoes: '#4a3a30' },
    guessed: true,
  };
  if (species !== 'human') delete spec.skin, delete spec.hair;
  return spec;
}
