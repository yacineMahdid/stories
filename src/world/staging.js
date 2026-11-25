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
const isEntryMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function directionKey(direction, section, id, name) {
  const entries = isEntryMap(direction?.[section]) ? direction[section] : {};
  if (Object.hasOwn(entries, id)) return id;
  const bare = String(id).replace(/^shape:/, '');
  if (Object.hasOwn(entries, bare)) return bare;
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
    this.warnings = [];
    direction = this.checked(direction);
    this.direction = direction;
    this.scale = direction.map?.scale ?? 0.05;
    const firstPin = canvas.pins.values().next().value;
    this.origin = direction.map?.origin ?? firstPin?.at ?? [0, 0];

    // Places: every pin, with its direction (or an automatic set when there is none).
    this.places = new Map();
    const pins = [...canvas.pins.values()].map((pin) => ({ pin, pos: this.mapToWorld(pin.at) }));
    for (const { pin, pos } of pins) {
      const placeKey = directionKey(direction, 'places', pin.id, pin.name);
      const hand = placeKey != null ? direction.places[placeKey] : null;
      // A place staged by hand ("things") is used as written. Otherwise the automatic set (or the
      // "preset" one) is built, and whatever else the entry says (rotate, radius…) goes on top.
      const auto = !hand?.things;
      const rotate = hand?.rotate ?? 0;
      const dir = auto ? { ...autoPlace(pin, hand?.preset, roomAround(pos, pins, pin, rotate)), ...(hand ?? {}) } : hand;
      const place = {
        id: pin.id, pin, name: pin.name, kind: pin.kind, description: pin.description,
        pos,
        rotate,
        radius: dir.radius ?? 10,
        ground: dir.ground ?? null,
        wild: { grass: 0.55, flowers: 0.05, ...(dir.wild ?? {}) },
        staged: !!hand,
        auto,
        room: auto ? roomAround(pos, pins, pin, rotate).near : Infinity,
        dir,
      };
      this.places.set(pin.id, place);
      // The same place under two keys: say which one is used.
      const other = placeKey === pin.id ? Object.keys(direction.places ?? {}).find((k) => k !== pin.id && k.toLowerCase() === pin.name.toLowerCase()) : null;
      if (other) this.warn(`${pin.name} is staged twice in the direction: "${placeKey}" is used, "${other}" is ignored.`);
    }
    // A place of a deleted pin ("shape:…", it comes back with Undo) is ignored quietly; a place
    // written under a name that matches no pin is worth a note.
    this.orphanThings = new Set();
    for (const [key, entry] of Object.entries(direction.places ?? {})) {
      if (this.places.has(key) || this.placeByName(key)) continue;
      if (key.startsWith('shape:')) { for (const t of expandGroups(entry.things ?? [], key)) if (t.id) this.orphanThings.add(t.id); continue; }
      this.warn(`The direction has a place "${key}" but no pin on the map has that id or name.`);
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
      this.terrain.push({ type: 'flat', at: place.pos, r: place.radius, blend: 5, height: place.dir.height ?? 'auto', place: place.id, dry: place.auto });
      if (place.ground && place.ground !== 'grass') {
        const g = typeof place.ground === 'string' ? { surface: place.ground } : place.ground;
        this.terrain.push({ type: 'plaza', at: place.pos, r: g.r ?? place.radius * 0.8, size: g.size, rotate: (g.rotate ?? 0) + place.rotate, surface: g.surface ?? 'stone', flatten: false, place: place.id });
      }
      for (const f of place.dir.terrain ?? []) {
        const w = this.featureToWorld(f, place);
        // An automatic place's sea, lake or river stays out of the places around it.
        if (place.auto && WATER_TYPES.has(w.type) && Number.isFinite(place.room)) w.clip = { at: place.pos, r: place.room };
        this.terrain.push(w);
      }
    }

    // Characters: canvas cards + 3D looks from the direction.
    this.characters = new Map();
    for (const c of canvas.characters.values()) {
      const key = directionKey(direction, 'characters', c.id, c.name);
      this.characters.set(c.id, { ...c, spec: key != null ? direction.characters[key] : null });
      const other = key === c.id && c.name ? Object.keys(direction.characters ?? {}).find((k) => k !== c.id && k.toLowerCase() === c.name.toLowerCase()) : null;
      if (other) this.warn(`${c.name} has two looks in the direction: "${key}" is used, "${other}" is ignored.`);
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

  /**
   * The direction with anything of the wrong shape left out (a hand edit can put a string where
   * a section belongs): each is named in a staging note instead of breaking the stage.
   */
  checked(direction) {
    if (!isEntryMap(direction)) {
      if (direction != null) this.warn('The direction file should hold an object ({ … }); it is ignored.');
      return {};
    }
    const out = { ...direction };
    for (const section of ['places', 'characters', 'scenes', 'map', 'defaults', 'edge']) {
      if (out[section] == null || isEntryMap(out[section])) continue;
      this.warn(`"${section}" in the direction should be an object ({ … }); it is ignored.`);
      delete out[section];
    }
    if (out.terrain != null && !Array.isArray(out.terrain)) {
      this.warn('"terrain" in the direction should be a list ([ … ]); it is ignored.');
      delete out.terrain;
    }
    for (const section of ['places', 'characters', 'scenes']) {
      if (!out[section]) continue;
      const bad = Object.keys(out[section]).filter((k) => !isEntryMap(out[section][k]));
      if (!bad.length) continue;
      out[section] = Object.fromEntries(Object.entries(out[section]).filter(([k]) => !bad.includes(k)));
      for (const k of bad) this.warn(`"${section}" › "${k}" in the direction should be an object ({ … }); it is ignored.`);
    }
    return out;
  }

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
  resolveAt(at, place, things = this.things, seen = new Set(), warn = this.sink ? (t) => { if (!this.sink.includes(t)) this.sink.push(t); } : (t) => this.warn(t)) {
    if (Array.isArray(at)) return this.localToWorld(at, place);
    if (at && typeof at === 'object') {
      if (at.map) return this.mapToWorld(at.map);
      if (at.pin) {
        const p = this.placeByName(at.pin);
        if (!p) { warn(`Unknown pin "${at.pin}".`); return place?.pos ?? [0, 0]; }
        return this.localToWorld(at.offset ?? [0, 0], p);
      }
      if (at.near) {
        const t = things.get(at.near);
        if (!t || seen.has(at.near)) { warn(`"near" refers to an unknown thing "${at.near}".`); return place?.pos ?? [0, 0]; }
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
  /**
   * Where a page happens: its direction's place, else its first place still on the map, else the
   * place of the page it continues (and so on). `lost` lists the references that matched nothing.
   */
  placeOf(scene, seen = new Set()) {
    this.placeCache ??= new Map();
    if (this.placeCache.has(scene)) return this.placeCache.get(scene);
    let place = null;
    const lost = [];
    for (const ref of [scene.dir.place, ...(scene.page.locationIds ?? [])].filter(Boolean)) {
      place = this.placeByName(ref);
      if (place) break;
      lost.push(ref);
    }
    if (!place && scene.dir.continues && !seen.has(scene.page.id)) {
      seen.add(scene.page.id);
      const i = this.resolveSceneIndex(scene.dir.continues);
      if (i != null) { const r = this.placeOf(this.scenes[i], seen); place = r.place; lost.push(...r.lost); }
    }
    const result = { place, lost };
    this.placeCache.set(scene, result);
    return result;
  }

  sceneState(index) {
    const scene = this.scenes[index];
    if (!scene) return null;
    const { page } = scene;
    const notes = [];
    const warnings = [];
    // Notes found while staging this page belong to it, not to the whole world.
    const outerSink = this.sink;
    this.sink = warnings;
    try { return this.stateOf(index, scene, page, notes, warnings); } finally { this.sink = outerSink; }
  }

  stateOf(index, scene, page, notes, warnings) {

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

    // Place: the direction's, else the page's first place still on the map (also through the
    // pages it continues).
    const found = this.placeOf(scene);
    let place = found.place;
    const lost = found.lost;
    const misnamed = lost.find((ref) => !String(ref).startsWith('shape:')); // a direction "place" that isn't a pin
    if (misnamed) warnings.push(`The direction puts this page at "${misnamed}", which is not on the map.`);
    if (!this.places.size) {
      place = this.nowhere();
      warnings.push('There are no pins on the map yet: add one and put this page there.');
    } else if (!place) {
      place = this.places.values().next().value;
      if (lost.some((ref) => String(ref).startsWith('shape:'))) warnings.push(`This page's map pin was deleted; showing ${place.name} instead.`);
      else if (!page.locationIds?.length) warnings.push('This page has no place on the map yet; showing the first place.');
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
        const chPlace = (ch.place ? this.placeByName(ch.place) : null) ?? this.placeOf(s).place ?? place;
        const gone = (id) => this.orphanThings.has(id); // a thing of a deleted pin's place
        const label = ch.note ?? describeChange(ch);
        let touched = null;
        if (ch.add) {
          for (const t of expandGroups([ch.add], chPlace?.id)) touched = this.addThing(t, chPlace, 'change', things).id;
        } else if (ch.remove) {
          touched = ch.remove;
          if (!things.delete(ch.remove) && !gone(ch.remove)) warnings.push(`A change removes "${ch.remove}", which is not there.`);
        } else if (ch.set) {
          const t = things.get(ch.set);
          if (t) Object.assign(t, ch.to ?? {});
          else if (!gone(ch.set)) warnings.push(`A change sets "${ch.set}", which is not there.`);
          touched = ch.set;
        } else if (ch.move) {
          const t = things.get(ch.move);
          if (t) {
            if (ch.to) t.pos = this.resolveAt(ch.to, chPlace, things);
            if (typeof ch.facing === 'number') t.facing = ch.facing + (chPlace?.rotate ?? 0);
          } else if (!gone(ch.move)) warnings.push(`A change moves "${ch.move}", which is not there.`);
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
      const sPlace = this.placeOf(s).place ?? place;
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
      if (!who) {
        warnings.push(String(c.who).startsWith('shape:') ? 'The cast has a character whose card was deleted.' : `The cast has "${c.who}", who is not a character on the canvas.`);
        continue;
      }
      if (page.characterIds?.length && !page.characterIds.includes(who.id)) warnings.push(`${who.name} is staged here but not listed on this page.`);
      used.add(who.id);
      cast.push({ ...c, who: who.id, character: who, look: deepMerge(looks.get(who.id) ?? {}, c.look ?? {}) });
    }
    const missing = (page.characterIds ?? []).filter((id) => !used.has(id));
    missing.forEach((id, i) => {
      const who = this.character(id);
      if (!who) { warnings.push('This page lists a character whose card was deleted.'); return; }
      // A shallow arc that opens to the south, where the camera looks from: everyone faces its
      // middle, so they talk to each other and their faces read (no backs to the camera).
      const n = missing.length;
      const spread = n > 1 ? Math.min(70, 25 + n * 12) * D2R : 0;
      const t = n > 1 ? -spread + (2 * spread * i) / (n - 1) : 0;
      const r = n > 1 ? 1 + n * 0.22 : 0;
      const view = place.dir?.view ?? 0; // the side the camera looks from
      const at = rotate([Math.sin(t) * r, 1.2 - Math.cos(t) * r * 0.75], view);
      const facing = n > 1 ? yawTo(at, rotate([0, 1.2 + r * 0.35], view)) : view;
      cast.push({ who: who.id, character: who, at, facing, do: n > 1 ? 'Talk' : 'Idle', auto: true, look: looks.get(who.id) ?? {} });
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

const WATER_TYPES = new Set(['sea', 'lake', 'pond', 'river']);

/**
 * How much room an automatic place has: `near` is how far its water and scatter may reach before
 * they'd spill into the next pin's place (about half the way there), and `open` is the most open
 * direction (local degrees, 0 = south), where a beach turns its sea.
 */
function roomAround(pos, pins, self, rotate = 0) {
  const others = pins.filter((p) => p.pin !== self).map((p) => [p.pos[0] - pos[0], p.pos[1] - pos[1]]).filter(([x, z]) => Math.hypot(x, z) > 0.01);
  if (!others.length) return { near: Infinity, open: 0 };
  const nearest = Math.min(...others.map(([x, z]) => Math.hypot(x, z)));
  let open = 0, best = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = k * 22.5;
    const dx = Math.sin(a * D2R), dz = Math.cos(a * D2R);
    let clear = 1000; // how far this way is free of pins (only pins within 50° of it count)
    for (const [x, z] of others) {
      const d = Math.hypot(x, z);
      if ((x * dx + z * dz) / d > Math.cos(50 * D2R)) clear = Math.min(clear, d);
    }
    const score = clear - Math.abs(((a + 180) % 360) - 180) * 0.01; // ties: closest to south
    if (score > best) { best = score; open = a; }
  }
  return { near: Math.max(9, nearest * 0.55), open: open - rotate };
}

/** A modest automatic set for a pin nobody has staged yet, from its kind, name and description. */
export const PLACE_PRESETS = ['town', 'forest', 'beach', 'river', 'lake', 'marsh', 'ruin', 'wild', 'hill', 'meadow'];

const PLACE_WORDS = [
  ['beach', ['beach', 'shore', 'coast', 'harbor', 'harbour', 'dock', 'pier', 'port', 'bay', 'sea', 'seaside', 'cove', 'lagoon']],
  ['river', ['river', 'mill', 'bridge', 'stream', 'brook', 'ford', 'creek', 'riverbank', 'waterfall']],
  ['lake', ['lake', 'pond', 'pool', 'loch', 'tarn', 'spring']],
  ['marsh', ['marsh', 'swamp', 'bog', 'fen', 'mire', 'wetland', 'bayou']],
  ['forest', ['forest', 'wood', 'woods', 'grove', 'clearing', 'glade', 'thicket', 'jungle', 'orchard']],
  ['ruin', ['ruin', 'temple', 'ancient', 'tomb', 'shrine', 'castle', 'tower', 'monument']],
  ['wild', ['cave', 'wasteland', 'graveyard', 'cemetery', 'dead', 'badlands', 'desert']],
  ['hill', ['hill', 'peak', 'lookout', 'mountain', 'cliff', 'summit', 'ridge', 'highland']],
  ['town', ['town', 'village', 'square', 'market', 'city', 'street', 'plaza', 'bakery', 'shop', 'store', 'inn', 'tavern', 'cafe', 'café', 'school', 'library', 'museum', 'station', 'hamlet']],
];

/** The set named by the text, matching whole words (plurals too); in a name, the last one wins ("Dead Marsh"). */
function placeSetIn(text, isName) {
  let best = null;
  for (const [set, words] of PLACE_WORDS) {
    // "spring" is a lake only in a name; in a description it is the season.
    const list = isName ? words : words.filter((w) => w !== 'spring');
    for (const m of text.matchAll(new RegExp(`\\b(?:${list.join('|')})(?:e?s)?\\b`, 'g'))) {
      if (!best || (isName ? m.index > best.index : m.index < best.index)) best = { set, index: m.index };
    }
  }
  return best?.set ?? null;
}

export function autoPlace(pin, preset = null, room = { near: Infinity, open: 0 }) {
  const name = pin.name.toLowerCase();
  const desc = (pin.description ?? '').toLowerCase();
  const kindHint = { town: 'town', danger: 'wild', secret: 'ruin', landmark: null, region: 'forest', place: null }[pin.kind];
  const set = (PLACE_PRESETS.includes(preset) ? preset : null) ?? placeSetIn(name, true) ?? (pin.kind === 'town' ? 'town' : null) ?? placeSetIn(desc, false) ?? kindHint ?? 'meadow';
  const R = Number.isFinite(room.near) ? room.near : 60; // how far this place may spread
  const turn = (p) => rotate(p, room.open ?? 0); // toward the open side
  const things = [];
  const terrain = [];
  let ground = null;
  let wild;
  switch (set) {
    case 'town':
      ground = { surface: 'stone', r: 7 };
      things.push({ id: `${pin.id}/centre`, kind: /fountain/.test(desc + name) ? 'fountain' : 'well', at: [0, 0] });
      // The gap in the ring of houses faces the establishing camera (it looks from 20°).
      things.push({ kind: 'ring', of: 'house', r: 11, count: 5, start: 200, facing: 'in' });
      things.push({ kind: 'ring', of: 'lamp', r: 6.5, count: 4, start: 45 });
      break;
    case 'forest':
      things.push({ kind: 'scatter', of: 'tree', area: { r: Math.min(22, R) }, avoid: { r: 6 }, count: Math.round(40 * Math.min(1, (R / 22) ** 2)) || 8, params: { variant: ['round', 'pine', 'oak'] } });
      things.push({ kind: 'scatter', of: 'mushroom', area: { r: 8 }, count: 5 });
      break;
    case 'beach': {
      // The sea lies on the open side, so it doesn't drown the places around; with little room
      // its waterline comes closer.
      const shore = Math.min(6, R * 0.35);
      terrain.push({ type: 'sea', points: [[-60, shore], [60, shore], [60, 80], [-60, 80]].map(turn), beach: Math.min(8, shore + 2) });
      things.push({ kind: 'dock', at: turn([3, shore - 3]), facing: room.open ?? 0 });
      // Palms between the cast and the sea, leaving the camera's side (the land) open.
      things.push({ kind: 'scatter', of: 'tree', area: { at: turn([0, shore + 2]), r: Math.min(5, R * 0.4) }, avoid: { r: 4 }, count: 5, params: { variant: 'palm' } });
      break;
    }
    case 'river':
      terrain.push({ type: 'river', points: [[-40, 4], [-10, 5], [10, 3], [40, 5]], width: 4 });
      things.push({ kind: 'bridge', at: [0, 4.2], facing: 90 });
      // The watermill's wheel is on its +X side: turned 270°, +X points south, into the river.
      if (/\bmill/.test(name)) things.push({ kind: 'watermill', at: [-6, 0.2], facing: 270 });
      break;
    case 'lake':
      terrain.push({ type: 'pond', at: [0, 6], r: 6 });
      things.push({ kind: 'scatter', of: 'reeds', area: { at: [0, 6], r: 7 }, count: 6, onWater: true });
      if (/\b(lily|lilies|lotus|pads?)\b/.test(name + ' ' + desc)) things.push({ kind: 'scatter', of: 'lilypads', area: { at: [0, 6], r: 4.5 }, count: 6, onWater: true });
      break;
    case 'marsh':
      // Shallow pools among reeds and bare trees; little that flowers.
      terrain.push({ type: 'pond', at: [-4, 5], r: 3.2, depth: 0.45 }, { type: 'pond', at: [5, 3], r: 2.4, depth: 0.4 }, { type: 'pond', at: [1, -6], r: 2.8, depth: 0.45 });
      things.push({ kind: 'scatter', of: 'reeds', area: { r: Math.min(12, R) }, avoid: { r: 2.5 }, count: 14 });
      things.push({ kind: 'scatter', of: 'tree', area: { r: Math.min(18, R) }, avoid: { r: 6 }, count: 7, params: { variant: 'dead' } });
      wild = { grass: 0.8, flowers: 0 };
      break;
    case 'ruin':
      things.push({ kind: 'ruin', at: [0, -2] });
      things.push({ kind: 'scatter', of: 'tree', area: { r: Math.min(20, R) }, avoid: { r: 7 }, count: 16 });
      break;
    case 'wild':
      things.push({ kind: 'scatter', of: 'tree', area: { r: Math.min(20, R) }, avoid: { r: 5 }, count: 25, params: { variant: 'dead' } });
      things.push({ kind: 'scatter', of: 'rock', area: { r: 10 }, count: 8 });
      wild = { grass: 0.45, flowers: 0 };
      break;
    case 'hill':
      terrain.push({ type: 'hill', at: [0, 0], r: 14, height: 3 });
      // Something on top to look at, and somewhere to sit.
      things.push({ kind: 'tree', at: [-1.2, -1.6], variant: 'round' });
      things.push({ kind: 'bench', at: [1.4, 0.4], facing: 200 });
      things.push({ kind: 'scatter', of: 'flowers', area: { r: 8 }, count: 10 });
      break;
    default:
      things.push({ kind: 'scatter', of: 'tree', area: { r: Math.min(20, R) }, avoid: { r: 7 }, count: 14 });
      things.push({ kind: 'scatter', of: 'flowers', area: { r: 8 }, count: 6 });
  }
  // Where the camera looks from (local degrees, 0 = south): on a beach, from the land, so the sea
  // is behind the cast.
  const view = set === 'beach' ? ((room.open ?? 0) + 180) % 360 : 0;
  return { things, terrain, ground, ...(wild ? { wild } : {}), ...(view ? { view } : {}), auto: set };
}

/** Guess a 3D look from a canvas character card (species, hair and colors from the text). */
const SPECIES_WORDS = {
  cat: ['cat', 'kitten', 'kitty', 'tomcat', 'feline'],
  dog: ['dog', 'puppy', 'pup', 'hound', 'pooch', 'canine'],
  horse: ['horse', 'pony', 'stallion', 'mare', 'colt', 'filly'],
  cow: ['cow', 'bull', 'calf', 'ox'],
  frog: ['frog', 'toad'],
  monkey: ['monkey', 'chimp', 'chimpanzee'],
  baboon: ['baboon'],
  gorilla: ['gorilla', 'ape'],
};
const HAIR_COLORS = {
  blonde: '#e0b45c', blond: '#e0b45c', golden: '#e0b45c', red: '#d4692e', ginger: '#d4692e', auburn: '#8a3b22',
  black: '#1f1b1a', dark: '#1f1b1a', brown: '#4a2f22', gray: '#c8c3ba', grey: '#c8c3ba', silver: '#c8c3ba',
  white: '#ece7df', pink: '#f29ab2', blue: '#4d7cc9', green: '#5aa56a', purple: '#8a5cc2',
};
const HAIR_STYLES = [
  ['pigtails', /\b(pigtails?|braids|plaits|twin ?tails)\b/],
  ['ponytail', /\bpony ?tail\b/],
  ['bun', /\b(bun|top ?knot|chignon)\b/],
  ['bob', /\b(bob|bobbed)\b/],
  ['spiky', /\b(spiky|spiked)\b/],
  ['swept', /\b(swept|side-swept|slicked)\b/],
  ['long', /\blong[- ](?:[a-z]+[- ])?hair(?:ed)?\b|\b(?:flowing|long) locks\b/],
];
const CLOTH_COLORS = {
  red: '#d9473c', orange: '#ee8a3a', yellow: '#f2c94c', green: '#5aa56a', blue: '#4f86c6', navy: '#2f3d57',
  teal: '#2f9a94', purple: '#8a5cc2', pink: '#f29ab2', white: '#f4f1ea', cream: '#f2e6c8', beige: '#d9c3a0',
  brown: '#7a5338', black: '#2b2b2e', gray: '#8c8f96', grey: '#8c8f96',
};
const FUR_COLORS = {
  golden: '#e0a84c', ginger: '#e8913c', orange: '#e8913c', black: '#3a3433', white: '#f2eee6', brown: '#8a5a3c',
  chocolate: '#6b4430', gray: '#a3a3a8', grey: '#a3a3a8', silver: '#bfc3c9', cream: '#f2e6c8', tan: '#d9b48c',
  green: '#7cc36a', yellow: '#f2c94c', pink: '#f2a7b8', blue: '#7fa7d9',
};
const TOPS = 'cardigan|sweater|sweatshirt|jumper|shirt|t-shirt|polo|blouse|jacket|coat|raincoat|overcoat|parka|poncho|hoodie|tunic|vest|top|dress|apron|overalls|smock';
const BOTTOMS = 'pants|trousers|shorts|skirt|jeans|overalls|dungarees';
const SKIN_TONES = [
  [/\b(pale|fair|light)[- ]skin(?:ned)?\b/, '#f8d3b0'],
  [/\b(?:olive|tan)[- ]skin(?:ned)?\b|\btanned\b/, '#e0a47c'],
  [/\b(deep|dark brown)[- ]skin(?:ned)?\b/, '#6e4a33'],
  [/\b(brown|dark)[- ]skin(?:ned)?\b/, '#9c6a48'],
];

/** The first species named in the text, as a whole word ("Catherine" and "dogged" don't count). */
function speciesIn(text) {
  let best = null;
  for (const [species, words] of Object.entries(SPECIES_WORDS)) {
    const m = new RegExp(`\\b(?:${words.join('|')})\\b(?!-like|-shaped)`).exec(text);
    if (m && (!best || m.index < best.index)) best = { species, index: m.index };
  }
  return best?.species ?? 'human';
}

export function guessSpec(c, forceSpecies = null) {
  // What the character looks like comes from the appearance and the role; the name only
  // seeds the choices the text leaves open (a "Catherine" isn't a cat, a "Bobby" has no bob).
  const text = `${c.appearance ?? ''} ${c.role ?? ''}`.toLowerCase();
  const species = forceSpecies ?? speciesIn(text);
  const h = hashString(c.id ?? c.name ?? 'x');
  const colorWord = (words, nouns) => new RegExp(`\\b(${Object.keys(words).join('|')})(?:[- ](?:and[- ])?[a-z]+)?[- ](?:${nouns})\\b`).exec(text)?.[1];
  let hairWord = /\bredhead\b/.test(text) ? 'red' : colorWord(HAIR_COLORS, 'hair|haired|locks|curls|braids|pigtails|ponytail|bob|bun');
  if (hairWord === 'dark' && /\bdark[- ]brown\b/.test(text)) hairWord = 'brown';
  const styleWord = HAIR_STYLES.find(([, re]) => re.test(text))?.[0];
  // Without a style in the text, boys and men get a short one.
  const styles = /\b(boy|man|men|he|him|his|gentleman|father|dad|grandpa|grandfather|uncle|king|prince|lad)\b/.test(text)
    ? ['spiky', 'swept', 'bob'] : ['bob', 'spiky', 'swept', 'pigtails', 'ponytail', 'bun', 'long'];
  const skins = ['#f8d3b0', '#f1c39c', '#e0a47c', '#c98e66', '#9c6a48', '#6e4a33'];
  const topWord = colorWord(CLOTH_COLORS, TOPS);
  const bottomWord = colorWord(CLOTH_COLORS, BOTTOMS);
  const spec = {
    species,
    skin: SKIN_TONES.find(([re]) => re.test(text))?.[1] ?? skins[h % skins.length],
    hair: { style: styleWord ?? styles[h % styles.length], color: hairWord ? HAIR_COLORS[hairWord] : ['#4a2f22', '#1f1b1a', '#7a4a2c', '#e0b45c'][(h >>> 3) % 4] },
    outfit: {
      top: topWord ? CLOTH_COLORS[topWord] : c.color ?? ['#e2483c', '#4f86c6', '#5aa56a', '#f2c94c', '#9a72c9'][h % 5],
      sleeves: /\b(sleeveless|tank top)\b/.test(text) ? 'none' : /\b(cardigan|sweater|sweatshirt|jumper|jacket|coat|raincoat|overcoat|parka|hoodie|long[- ]sleeved?)\b/.test(text) ? 'long' : ['short', 'long', 'elbow'][(h >>> 5) % 3],
      bottom: bottomWord ? CLOTH_COLORS[bottomWord] : ['#2f3640', '#5a4636', '#3f5f8a'][(h >>> 7) % 3],
      legs: /\b(shorts)\b/.test(text) ? 'shorts' : /\b(pants|trousers|jeans|overalls|dungarees)\b/.test(text) ? 'pants' : /\b(skirt|dress)\b/.test(text) ? 'knee' : ['shorts', 'pants', 'knee'][(h >>> 9) % 3],
      shoes: '#4a3a30',
    },
    guessed: true,
  };
  if (species !== 'human') {
    // An animal's fur takes the color the text gives it ("a golden dog", "a black cat").
    const colors = Object.keys(FUR_COLORS).join('|');
    const fur = new RegExp(`\\b(${colors})(?:[- ](?:and[- ])?[a-z]+)?[- ](?:${SPECIES_WORDS[species].join('|')})\\b`).exec(text)?.[1]
      ?? new RegExp(`\\b(${colors})[- ](?:fur|pelt)\\b`).exec(text)?.[1];
    if (fur) spec.skin = FUR_COLORS[fur];
    else delete spec.skin;
    delete spec.hair;
  }
  return spec;
}
