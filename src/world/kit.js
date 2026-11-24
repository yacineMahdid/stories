import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

/**
 * The prop kit: shared scale, palette, materials and modeling helpers for every set piece.
 *
 * Conventions for a prop (see props/index.js for the registry):
 * - 1 unit = one character's height. A prop's origin is the center of its footprint on the
 *   ground (y = 0) and its front faces +Z (doors, faces, seats point +Z).
 * - Build with `Parts`: every piece is a geometry + a look (a color, or { slot, color }).
 *   Pieces that share a slot are merged into one mesh, so a whole house is a few draw calls.
 * - Primitives stand on y = 0 (boxes, cylinders, cones) except spheres and blobs, which are
 *   centered. Angles in code are radians; the staging JSON uses degrees.
 * - Return a group from `finish(group, {...})` with:
 *     footprint { r } or { w, d }    ground area it covers (keeps scatter away, flattens terrain)
 *     spots { name: spot(at, facing, pose) }   where characters stand, sit or lie
 *     lights [light(at, {...})]       warm point lights (lamps, windows, fire)
 *     tick(t, dt)                     animation (blades, flames, bobbing boats)
 * - Everything made from kit materials gets snow on upward faces in winter, darkens in the rain
 *   and (for the glow slots) lights up at night, driven by WORLD_UNIFORMS.
 */

/* ───────────────────────── scale ───────────────────────── */

export const SCALE = {
  character: 1,
  /** Seat height the Sit animation is posed for. Higher seats are fine: the sitter is lifted and their feet dangle. */
  sitPose: 0.083,
  seat: 0.2,          // bench and chair seats
  table: 0.36,
  counter: 0.44,      // market stall counters
  door: [0.72, 1.22], // width, height
  storey: 1.9,        // wall height of one storey
  window: 0.5,
  fence: 0.5,
  lamp: 2.3,
  rail: 0.42,         // bridge and dock railings
};

/* ───────────────────────── palette ───────────────────────── */

export const PALETTE = {
  wood: '#b98552', woodLight: '#d6ab76', woodDark: '#7a5233', woodGrey: '#9d9282', woodRed: '#a3503c',
  stone: '#bdb6aa', stoneLight: '#d9d3c7', stoneDark: '#8e877d', brick: '#c0644a', slate: '#626b78',
  roofRed: '#cf5a45', roofBlue: '#4f7fc0', roofGreen: '#5c9e64', roofBrown: '#8d5b3e', roofTeal: '#3e9c9a',
  roofPurple: '#8d6fc0', roofOrange: '#e38c3d', roofSlate: '#5d6675', thatch: '#d9b46a',
  wallCream: '#f4e7cc', wallWhite: '#f6f2ea', wallPeach: '#f3caa6', wallMint: '#cfe9d4', wallSky: '#d3e3f2',
  wallLemon: '#f7e8a8', wallPink: '#f6d0d6', wallTimber: '#e9dcc2',
  iron: '#3d4148', ironLight: '#6b7079', gold: '#d9a53f', copper: '#c27a4a',
  glass: '#8fb8cf', warmLight: '#ffcf86', fire: '#ff8a2a',
  cloth: { red: '#d9534a', blue: '#4f86c6', green: '#5aa56a', yellow: '#f2c94c', white: '#f4efe6', purple: '#9a72c9', orange: '#ee8c3e', pink: '#f19bb7', teal: '#3fa3a0' },
  leaf: { spring: '#7fcd6a', summer: '#4e9e4e', autumn: '#e48a35', winter: '#7c8a6a' },
  leafAlt: { spring: '#a3dd80', summer: '#64b25b', autumn: '#d4562f', winter: '#8e9a7b' },
  pine: { spring: '#3f8a5a', summer: '#357a4e', autumn: '#3a7550', winter: '#3d6e56' },
  blossom: '#f7b9cc',
  grass: { spring: '#8fcf6c', summer: '#74b85a', autumn: '#b9ae5e', winter: '#e9eff3' },
  flower: { red: '#e9434c', yellow: '#f6cf3a', white: '#f8f4ea', pink: '#f49ac1', purple: '#a57fd9', blue: '#6c9fe3', orange: '#f39a48' },
  water: '#4eb4d8', waterShallow: '#86dbe6', sand: '#ecd9a6', dirt: '#b08a5c',
};

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** Pick a seasonal value: `seasonal({ spring: a, summer: b, autumn: c, winter: d }, 'autumn')`. */
export function seasonal(value, season = 'summer') {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof THREE.Color)) {
    return value[season] ?? value.summer ?? Object.values(value)[0];
  }
  return value;
}

/** Shift a color: `shade('#7fcd6a', 0.1)` lighter, negative darker; `hue` and `sat` nudge HSL. */
export function shade(color, light = 0, { hue = 0, sat = 0 } = {}) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL((hsl.h + hue + 1) % 1, THREE.MathUtils.clamp(hsl.s + sat, 0, 1), THREE.MathUtils.clamp(hsl.l + light, 0, 1));
  return `#${c.getHexString()}`;
}

export function mix(a, b, t) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/* ───────────────────────── randomness ───────────────────────── */

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Seeded random numbers (mulberry32). Same seed, same prop. */
export function rng(seed = 1) {
  let a = (typeof seed === 'string' ? hashString(seed) : Math.floor(seed)) >>> 0 || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    jitter: (v, amount) => v * (1 + (next() * 2 - 1) * amount),
    angle: () => next() * Math.PI * 2,
  };
}

const perlin = new ImprovedNoise();
/** Smooth 3D noise in about [-1, 1]. */
export function noise3(x, y, z) { return perlin.noise(x, y, z); }

/* ───────────────────────── shared world uniforms ───────────────────────── */

/** Driven by the world stage every frame; every kit material reads them. */
export const WORLD_UNIFORMS = {
  uTime: { value: 0 },
  uWind: { value: 0.3 },   // 0 calm … 1 storm
  uSnow: { value: 0 },     // snow cover 0 … 1
  uWet: { value: 0 },      // rain wetness 0 … 1
  uGlow: { value: 0 },     // 0 day … 1 night: windows and lamps light up
};

const VERT_HEAD = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uSway;
uniform float uSwayBase;
varying vec3 vKitWorld;
varying vec3 vKitNormal;
`;

const VERT_SWAY = /* glsl */ `
#ifdef KIT_SWAY
{
  vec3 kitBase = modelMatrix[3].xyz;
  #ifdef USE_INSTANCING
    kitBase += instanceMatrix[3].xyz;
  #endif
  float kitH = max(position.y - uSwayBase, 0.0);
  float kitPh = kitBase.x * 0.37 + kitBase.z * 0.53;
  float kitA = uSway * (0.25 + uWind) * kitH * kitH;
  transformed.x += (sin(uTime * 1.7 + kitPh) * 0.6 + sin(uTime * 3.1 + kitPh * 1.9) * 0.25) * kitA;
  transformed.z += (cos(uTime * 1.3 + kitPh * 1.3) * 0.45) * kitA;
}
#endif
`;

const VERT_WORLD = /* glsl */ `
{
  vec4 kitW = vec4(transformed, 1.0);
  vec3 kitN = objectNormal;
  #ifdef USE_INSTANCING
    kitW = instanceMatrix * kitW;
    kitN = mat3(instanceMatrix) * kitN;
  #endif
  kitW = modelMatrix * kitW;
  vKitWorld = kitW.xyz;
  vKitNormal = normalize(mat3(modelMatrix) * kitN);
}
`;

const FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform float uSnow;
uniform float uWet;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform float uGlowAmount;
uniform float uEmit;
varying vec3 vKitWorld;
varying vec3 vKitNormal;
float kitHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kitNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kitHash(i), kitHash(i + vec2(1, 0)), f.x), mix(kitHash(i + vec2(0, 1)), kitHash(i + vec2(1, 1)), f.x), f.y);
}
float kitSnowAmount = 0.0;
`;

const FRAG_COLOR = /* glsl */ `
#ifdef KIT_SNOW
{
  float kitUp = normalize(vKitNormal).y;
  float kitN = kitNoise(vKitWorld.xz * 2.7) * 0.6 + kitNoise(vKitWorld.xz * 9.0 + 3.1) * 0.4;
  float kitEdge = 0.78 - 0.32 * uSnow;
  kitSnowAmount = smoothstep(kitEdge, kitEdge + 0.12, kitUp + (kitN - 0.5) * 0.35) * smoothstep(0.05, 0.45, uSnow);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.99), kitSnowAmount);
}
#endif
#ifdef KIT_WET
  diffuseColor.rgb *= 1.0 - 0.3 * uWet * (1.0 - kitSnowAmount);
#endif
`;

const FRAG_ROUGH = /* glsl */ `
#ifdef KIT_WET
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, uWet * (1.0 - kitSnowAmount));
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
#ifdef KIT_GLOW
  totalEmissiveRadiance += uGlowColor * uGlowAmount * uGlow;
#endif
#ifdef KIT_EMIT
  totalEmissiveRadiance += diffuseColor.rgb * uEmit;
#endif
`;

/**
 * Add the kit's world effects (snow, rain, wind sway, night glow) to a standard or physical
 * material. Options: { snow, wet, sway, swayBase, glow, glowAmount, emit }.
 */
export function patchMaterial(material, opts = {}) {
  const local = {
    uSway: { value: opts.sway ?? 0 },
    uSwayBase: { value: opts.swayBase ?? 0 },
    uGlowColor: { value: new THREE.Color(opts.glow ?? '#000000') },
    uGlowAmount: { value: opts.glowAmount ?? 1.6 },
    uEmit: { value: opts.emit ?? 0 },
  };
  material.defines = { ...(material.defines ?? {}) };
  if (opts.snow ?? true) material.defines.KIT_SNOW = 1;
  if (opts.wet ?? true) material.defines.KIT_WET = 1;
  if (opts.sway) material.defines.KIT_SWAY = 1;
  if (opts.glow) material.defines.KIT_GLOW = 1;
  if (opts.emit) material.defines.KIT_EMIT = 1;
  material.userData.kit = local;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WORLD_UNIFORMS, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_SWAY}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_WORLD}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  material.customProgramCacheKey = () => 'world-kit-1';
  return material;
}

/* ───────────────────────── materials ───────────────────────── */

/**
 * Material slots. Parts in the same slot share one material and are merged into one mesh;
 * their colors live in vertex colors, so a slot is not tied to a color.
 *   solid    painted wood, stone, plaster: matte, gets snow and rain
 *   foliage  leaves and grass: soft velvet sheen, sways in the wind (`sway`), gets snow
 *   cloth    awnings, tents, flags: soft sheen (add `sway` for flags)
 *   metal    iron, brass
 *   glass    window panes by day that glow warm at night (`glow` color, `glowAmount`)
 *   lamp     lamp shades and lanterns: lit at night (stronger glow)
 *   emit     always glowing (fire, embers, magic): the part's color is its light
 *   clear    transparent glass or ice, no shadows
 */
export const SLOTS = {
  solid: { rough: 0.86 },
  foliage: { rough: 0.78, sheen: 0.55, sway: 0.02 },
  cloth: { rough: 0.9, sheen: 0.4 },
  metal: { rough: 0.42, metal: 0.55 },
  glass: { rough: 0.25, glow: PALETTE.warmLight, glowAmount: 1.5, snow: false, wet: false },
  lamp: { rough: 0.35, glow: PALETTE.warmLight, glowAmount: 3.2, snow: false, wet: false },
  emit: { rough: 1, emit: 2.4, snow: false, wet: false, shadow: false },
  clear: { rough: 0.08, transparent: true, opacity: 0.45, snow: false, wet: false, shadow: false },
};

const materialCache = new Map();

/**
 * A cached kit material. `material('foliage')`, `material('solid', { sway: 0.05 })`,
 * `material('glass', { glow: '#ffd9a0' })`. Vertex colors carry the color.
 */
export function material(slot = 'solid', overrides = {}) {
  const base = SLOTS[slot] ?? SLOTS.solid;
  const o = { ...base, ...overrides };
  const key = `${slot}|${JSON.stringify(o)}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const params = {
    name: `kit-${slot}`,
    color: 0xffffff,
    vertexColors: true,
    roughness: o.rough,
    metalness: o.metal ?? 0,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    side: o.double ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: !!o.flat,
    depthWrite: !o.transparent,
  };
  let m;
  if (o.sheen) {
    m = new THREE.MeshPhysicalMaterial({ ...params, sheen: o.sheen, sheenRoughness: 0.75, sheenColor: new THREE.Color(0xffffff), specularIntensity: 0.3 });
  } else {
    m = new THREE.MeshStandardMaterial(params);
  }
  patchMaterial(m, o);
  m.userData.slot = slot;
  m.userData.castShadow = o.shadow ?? true;
  materialCache.set(key, m);
  return m;
}

/* ───────────────────────── geometry ───────────────────────── */

/** Rounded box standing on y = 0. */
export function roundBox(w, h, d, r = 0.04, segments = 2) {
  const rr = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = new RoundedBoxGeometry(w, h, d, segments, rr);
  g.translate(0, h / 2, 0);
  return g;
}

/** Plain box standing on y = 0 (crisp edges; prefer roundBox for the soft look). */
export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
}

/** Lathe a profile of [radius, y] points around the Y axis. */
export function lathe(profile, segments = 20, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)), segments, 0, phiLength);
}

function arc(points, cx, cy, r, a0, a1, steps = 4) {
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
}

/** Cylinder standing on y = 0 with softly rounded rims. `top` sets a different top radius. */
export function roundCyl(r, h, { top = r, bevel = 0.03, segments = 20, steps = 3 } = {}) {
  const b = Math.max(0.001, Math.min(bevel, h / 2.05, Math.min(r, top) * 0.9));
  const pts = [[0, 0]];
  arc(pts, r - b, b, b, -Math.PI / 2, 0, steps);
  arc(pts, top - b, h - b, b, 0, Math.PI / 2, steps);
  pts.push([0, h]);
  return lathe(pts, segments);
}

/** Open or closed cylinder standing on y = 0 (no bevel). */
export function cyl(r, h, { top = r, segments = 16, open = false } = {}) {
  return new THREE.CylinderGeometry(top, r, h, segments, 1, open).translate(0, h / 2, 0);
}

export function cone(r, h, segments = 16) {
  return new THREE.ConeGeometry(r, h, segments).translate(0, h / 2, 0);
}

/** Centered sphere. */
export function sphere(r, widthSegments = 18, heightSegments = 12) {
  return new THREE.SphereGeometry(r, widthSegments, heightSegments);
}

/**
 * A soft lumpy blob, centered: foliage, bushes, rocks, clouds.
 * { detail, amp (lumpiness), freq, seed, squash: [x, y, z], flatBottom (cut y below -r * f) }
 */
export function blob(r = 0.5, { detail = 3, amp = 0.12, freq = 1.6, seed = 0, squash = [1, 1, 1], flatBottom = null } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const o = (seed % 997) * 1.731;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * freq + o, v.y * freq - o * 0.7, v.z * freq + o * 0.3);
    v.multiplyScalar(r * (1 + amp * n));
    v.set(v.x * squash[0], v.y * squash[1], v.z * squash[2]);
    if (flatBottom != null) v.y = Math.max(v.y, -r * squash[1] * flatBottom);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  return g;
}

/** A tube along a smooth curve through [x, y, z] points. */
export function tube(points, r = 0.04, { segments = 24, radial = 8, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(curve, segments, r, radial, closed);
}

/** Extrude a 2D outline (in XY, [x, y] points) along Z, centered on z = 0. */
export function extrude(outline, depth, { bevel = 0.02, bevelSegments = 2, curveSegments = 8 } = {}) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Torus lying flat (around the Y axis), centered. */
export function ring(radius, tubeRadius, { radial = 8, tubular = 28, arc = Math.PI * 2 } = {}) {
  return new THREE.TorusGeometry(radius, tubeRadius, radial, tubular, arc).rotateX(Math.PI / 2);
}

/** A flat horizontal quad facing up, centered at y = 0. */
export function quad(w, d) {
  return new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
}

/** Matrix from position / rotation (radians, XYZ) / scale (number or [x, y, z]). */
export function xform(at = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(...s),
  );
}

/* ───────────────────────── building props ───────────────────────── */

function prepare(geometry, color, matrix) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * Collects pieces and merges them per material slot.
 *
 *   const p = new Parts();
 *   p.add(roundBox(1, 0.4, 1), '#c89f6a', { at: [0, 0, 0] });                 // solid slot
 *   p.add(blob(0.6), { slot: 'foliage', color: leaf }, { at: [0, 1.2, 0] });
 *   p.add(roundBox(0.3, 0.3, 0.02), { slot: 'glass', color: PALETTE.glass }, { at: [0, 1, 0.5] });
 *   p.add(geometry, someMaterial);                                            // explicit material
 *   const group = p.build();
 */
export class Parts {
  constructor() {
    this.slots = new Map(); // key -> { material, geometries }
  }

  add(geometry, look = '#ffffff', { at, rot, scale, matrix } = {}) {
    let mat, color = '#ffffff';
    if (look?.isMaterial) {
      mat = look;
    } else if (typeof look === 'object' && look !== null) {
      const { slot = 'solid', color: c = '#ffffff', ...rest } = look;
      color = c;
      mat = material(slot, rest);
    } else {
      color = look;
      mat = material('solid');
    }
    const m = matrix ?? ((at || rot || scale !== undefined) ? xform(at, rot, scale ?? 1) : null);
    const g = prepare(geometry, color, m);
    if (!this.slots.has(mat.uuid)) this.slots.set(mat.uuid, { material: mat, geometries: [] });
    this.slots.get(mat.uuid).geometries.push(g);
    return this;
  }

  /** Add every piece of another Parts (or the same piece many times) with a transform. */
  merge(other, matrix) {
    for (const { material: mat, geometries } of other.slots.values()) {
      if (!this.slots.has(mat.uuid)) this.slots.set(mat.uuid, { material: mat, geometries: [] });
      for (const g of geometries) this.slots.get(mat.uuid).geometries.push(matrix ? g.clone().applyMatrix4(matrix) : g.clone());
    }
    return this;
  }

  get empty() { return this.slots.size === 0; }

  build(name = 'prop') {
    const group = new THREE.Group();
    group.name = name;
    for (const { material: mat, geometries } of this.slots.values()) {
      if (!geometries.length) continue;
      const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mat.userData.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.name = `${name}:${mat.userData.slot ?? 'custom'}`;
      group.add(mesh);
    }
    return group;
  }
}

/* ───────────────────────── prop metadata ───────────────────────── */

/** A place for a character: `pose` is stand | sit | lie | lean. `facing` in degrees (0 = +Z). */
export function spot(at, facing = 0, pose = 'stand') {
  return { at, facing, pose };
}

/** A warm point light. `when`: night (default) or always (fire). */
export function light(at, { color = PALETTE.warmLight, intensity = 1.2, distance = 6, when = 'night' } = {}) {
  return { at, color, intensity, distance, when };
}

/** Attach the prop's metadata to its group and return it. */
export function finish(group, { footprint, spots = {}, lights = [], tick = null, height } = {}) {
  group.userData.footprint = footprint ?? footprintOf(group);
  group.userData.spots = spots;
  group.userData.lights = lights;
  if (tick) group.userData.tick = tick;
  if (height) group.userData.height = height;
  return group;
}

/** A circle around everything in the group, from its bounding box. */
export function footprintOf(object) {
  const b = new THREE.Box3().setFromObject(object);
  if (b.isEmpty()) return { r: 0.3 };
  return { w: b.max.x - b.min.x, d: b.max.z - b.min.z, r: Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2 };
}

/* ───────────────────────── instancing ───────────────────────── */

/**
 * Many copies of one prop as instanced meshes (scatter: grass, flowers, trees).
 * `matrices` place each copy; every mesh in the prototype becomes one InstancedMesh.
 */
export function instanced(prototype, matrices) {
  const group = new THREE.Group();
  prototype.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(prototype.matrixWorld).invert();
  prototype.traverse((obj) => {
    if (!obj.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld);
    const inst = new THREE.InstancedMesh(obj.geometry, obj.material, matrices.length);
    const m = new THREE.Matrix4();
    matrices.forEach((mat, i) => inst.setMatrixAt(i, m.multiplyMatrices(mat, local)));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = obj.castShadow;
    inst.receiveShadow = obj.receiveShadow;
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}

/* ───────────────────────── signs and labels ───────────────────────── */

const textureCache = new Map();

/** A canvas texture with centered text: shop signs, notice boards, name plates. */
export function textTexture(text, {
  width = 512, height = 160, bg = '#f4e7cc', fg = '#5a3a22', border = '#7a5233', borderWidth = 10,
  font = 'bold 84px Georgia, "Times New Roman", serif', radius = 26,
} = {}) {
  const key = JSON.stringify([text, width, height, bg, fg, border, borderWidth, font, radius]);
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(borderWidth / 2, borderWidth / 2, width - borderWidth, height - borderWidth, radius);
    g.fill();
    if (border && borderWidth) { g.lineWidth = borderWidth; g.strokeStyle = border; g.stroke(); }
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)?.[1] ?? '84', 10);
  let f = font;
  g.font = f;
  while (g.measureText(text).width > width * 0.86 && size > 12) {
    size -= 4;
    f = font.replace(/\d+px/, `${size}px`);
    g.font = f;
  }
  g.fillText(text, width / 2, height / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

/** A sign face material (text on a board). Use with `Parts.add(geometry, signMaterial('Bakery'))`. */
export function signMaterial(text, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: textTexture(text, opts), roughness: 0.8, vertexColors: true });
  patchMaterial(m, { snow: false });
  m.userData.slot = 'sign';
  return m;
}

/* ───────────────────────── water for props ───────────────────────── */

let propWater = null;
/** Animated water surface for fountains, wells, troughs (flat geometry facing up). */
export function waterMaterial() {
  if (propWater) return propWater;
  propWater = new THREE.MeshStandardMaterial({
    name: 'kit-water', color: 0xffffff, vertexColors: true, roughness: 0.12, metalness: 0,
    transparent: true, opacity: 0.82, depthWrite: false,
  });
  propWater.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvKitW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vKitW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 q = vKitW.xz * 5.0;
          float a = sin(q.x * 1.3 + uTime * 2.1) + sin(q.y * 1.7 - uTime * 1.6) + sin((q.x + q.y) * 0.9 + uTime * 2.7);
          float b = cos(q.x * 1.1 - uTime * 1.8) + cos(q.y * 1.5 + uTime * 2.3);
          normal = normalize(normal + vec3(a, 0.0, b) * 0.04);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float s = sin(vKitW.x * 9.0 + uTime * 2.0) * sin(vKitW.z * 8.0 - uTime * 1.7);
          diffuseColor.rgb += vec3(0.08, 0.1, 0.1) * smoothstep(0.6, 1.0, s);
        }`);
  };
  propWater.userData.slot = 'water';
  propWater.userData.castShadow = false;
  return propWater;
}
