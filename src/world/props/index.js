import * as THREE from 'three';
import { Parts, finish, rng, hashString, roundBox, signMaterial, footprintOf } from '../kit.js';

/**
 * Every set piece a scene can use, by kind. Each family module exports entries:
 *
 *   kind: {
 *     label: 'Tree',
 *     about: 'what it is and what it can do',
 *     params: { name: { default, options?, min?, max?, type?, about } },
 *     examples: [ { ...params }, ... ],        // shown in the Prop Lab
 *     build(p, ctx) { ...; return finish(group, { footprint, spots, lights, tick }) },
 *   }
 *
 * `p` is the params with defaults filled in. `ctx` is { season, hour, weather, night, rng, seed, id }.
 */
const MODULES = [['nature', './nature.js', 'NATURE'], ['buildings', './buildings.js', 'BUILDINGS'], ['village', './village.js', 'VILLAGE'], ['waterside', './waterside.js', 'WATERSIDE']];

// Families load independently: a broken family file leaves the others working.
export const FAMILIES = {};
export const LOAD_ERRORS = {};
const loaded = await Promise.allSettled(MODULES.map(([, path, name]) => import(path).then((m) => m[name] ?? {})));
loaded.forEach((r, i) => {
  const [family] = MODULES[i];
  FAMILIES[family] = r.status === 'fulfilled' ? r.value : {};
  if (r.status === 'rejected') {
    LOAD_ERRORS[family] = String(r.reason?.message ?? r.reason);
    console.error(`[props] could not load the ${family} family:`, r.reason);
  }
});

export const CATALOG = {};
/** Props that failed to build (kept for tests and the viewer's warnings). */
export const BUILD_ERRORS = [];
for (const [family, entries] of Object.entries(FAMILIES)) {
  for (const [kind, def] of Object.entries(entries)) CATALOG[kind] = { family, ...def };
}

export function defaultsOf(kind) {
  const def = CATALOG[kind];
  const out = {};
  for (const [name, p] of Object.entries(def?.params ?? {})) out[name] = p.default ?? null;
  return out;
}

/**
 * Build a prop. Unknown kinds become a visible placeholder crate with the kind written on it,
 * so a scene never silently drops something the story asked for.
 */
export function buildProp(kind, params = {}, ctx = {}) {
  const def = CATALOG[kind];
  const id = ctx.id ?? kind;
  const seed = params.seed ?? ctx.seed ?? hashString(String(id));
  const context = { season: 'summer', hour: 12, weather: 'clear', night: 0, ...ctx, seed, rng: rng(seed) };
  let object;
  if (!def) {
    object = placeholder(kind);
  } else {
    const p = { ...defaultsOf(kind), ...stripMeta(params) };
    try {
      object = def.build(p, context);
    } catch (e) {
      console.warn(`[props] ${kind} failed to build:`, e);
      BUILD_ERRORS.push({ kind, params, error: String(e?.message ?? e) });
      object = placeholder(kind);
    }
  }
  object.name = String(id);
  object.userData.kind = kind;
  object.userData.footprint ??= footprintOf(object);
  object.userData.spots ??= {};
  object.userData.lights ??= [];
  return object;
}

const META = new Set(['id', 'kind', 'at', 'facing', 'scale', 'lift', 'note', 'seed', 'pin', 'near', 'offset', 'site']);
function stripMeta(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) if (!META.has(k)) out[k] = v;
  return out;
}

export function placeholder(kind) {
  const p = new Parts();
  p.add(roundBox(0.7, 0.7, 0.7, 0.06), '#d6b4e8');
  p.add(new THREE.PlaneGeometry(0.62, 0.2), signMaterial(kind, { bg: '#f7eefc', fg: '#5b3a78', border: '#5b3a78' }), { at: [0, 0.45, 0.352] });
  const object = finish(p.build(`missing:${kind}`), { footprint: { r: 0.5 } });
  object.userData.placeholder = true;
  return object;
}
