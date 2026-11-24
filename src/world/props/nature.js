import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Parts, finish, spot, light, roundBox, cyl, sphere, lathe, blob, ring, xform, material,
  PALETTE, SEASONS, shade, noise3, rng,
} from '../kit.js';

// Prop family: nature. Trees, bushes, flowers, grass, reeds, rocks, stumps, logs, mushrooms,
// bamboo, pumpkins and leaf piles. See ../kit.js for the conventions.
//
// Look: soft lumpy shapes with painted vertex colors (darker undersides, lighter tops, gentle
// patches), so every piece reads like a hand-painted toy. Foliage canopies are one smooth
// "cloud" surface made of clumps, which keeps them round and friendly and cheap.
// Variation comes from seeded sub-streams of the prop's seed, so the same tree keeps its shape
// across seasons (only colors, blossoms, fruit and leaves change).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

/* ───────────────────────── params ───────────────────────── */

function num(v, d, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : d;
}
/** A positive scale: non-positive or junk values fall back to the default. */
function size(v, d = 1, lo = 0.25, hi = 4) {
  const n = num(v, NaN);
  return Number.isFinite(n) && n > 0 ? clamp(n, lo, hi) : d;
}
function int(v, d, lo, hi) { return Math.round(num(v, d, lo, hi)); }
function oneOf(v, options, d) {
  if (typeof v !== 'string') return d;
  const s = v.trim().toLowerCase();
  return options.includes(s) ? s : d;
}
function flag(v, d) {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === 0 || v === 'false' || v === 'no' || v === 'off') return false;
  return d;
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** A usable color string, or `d`. `named` maps friendly names (red, pink…) to the family's own tones. */
function colorOr(v, d, named = null) {
  if (typeof v !== 'string') return d;
  const s = v.trim().toLowerCase();
  if (named && named[s]) return named[s];
  if (HEX.test(s)) return s;
  if (THREE.Color.NAMES && Object.prototype.hasOwnProperty.call(THREE.Color.NAMES, s)) return s;
  if (/^(rgb|hsl)a?\([\d\s.,%+-]+\)$/.test(s)) return s;
  return d;
}
const seasonOf = (ctx) => (SEASONS.includes(ctx?.season) ? ctx.season : 'summer');
/** A seeded random stream for one aspect of a prop (shape, color…), stable across seasons. */
const rand = (ctx, tag) => rng(`${ctx?.seed ?? 0}:${tag}`);

/* ───────────────────────── colors ───────────────────────── */

const C = (c) => new THREE.Color(c);
/** The color of a look (a color string, or { slot, color, ... }). */
const colorOf = (look) => (look && typeof look === 'object' ? look.color : look);
/** The same look in another color (keeps its slot and sway). */
const recolor = (look, color) => (look && typeof look === 'object' ? { ...look, color } : color);

/** Friendly color names for blooms, berries and flowers. */
const BLOOM = {
  red: '#e8474f', yellow: '#f7d046', white: '#f7f3ea', pink: '#f59bc0', purple: '#a881dc',
  blue: '#6f9fe6', orange: '#f59a46', black: '#4a3a4e', green: '#a9d36a', gold: '#f2bd3a',
};

/** Foliage tones: [base, light, dark]. */
const LEAF = {
  spring: ['#80d25b', '#b6e97f', '#4c9f47'],
  summer: ['#4caa45', '#8ccf5b', '#2b7a40'],
  orange: ['#ec8f35', '#f7b54f', '#c4642a'],
  red: ['#dc5a3b', '#ef8452', '#a93b2d'],
  yellow: ['#efc445', '#f9dd6e', '#c9962c'],
  russet: ['#c8702f', '#e0974a', '#9a4f27'],
  winter: ['#7f9068', '#9aa880', '#5f6f52'],
};
const tones = (base) => [base, shade(base, 0.09, { sat: 0.03 }), shade(base, -0.13)];

/* ───────────────────────── painting ───────────────────────── */

function matOf(look) {
  if (look?.isMaterial) return look;
  if (typeof look === 'object' && look !== null) {
    const { slot = 'solid', color, ...rest } = look; // eslint-disable-line no-unused-vars
    return material(slot, rest);
  }
  return material('solid');
}

/**
 * Add a piece and paint its vertices: `painter(color, x, y, z, nx, ny, nz, u, v)` gets the
 * look's color and the vertex in prop space (after the transform) and changes the color.
 */
function addPainted(parts, geometry, look, opts, painter) {
  parts.add(geometry, look, opts);
  const list = parts.slots.get(matOf(look).uuid).geometries;
  const g = list[list.length - 1];
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color;
  const base = C(look?.color ?? look);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(base);
    painter(c, pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), uv.getX(i), uv.getY(i));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

/** Bark: darker at the foot, soft vertical streaks. */
function barkPainter(look, { foot = 0.22, streak = 0.07, seed = 0, moss = null, mossLevel = 0.55 } = {}) {
  const base = colorOf(look);
  const dark = C(shade(base, -0.1));
  const light = C(shade(base, 0.07));
  const M = moss ? C(moss) : null;
  return (c, x, y, z, nx, ny, nz) => {
    const a = Math.atan2(z, x);
    const n = noise3(Math.cos(a) * 2.2 + seed, y * 1.1, Math.sin(a) * 2.2);
    c.lerp(n > 0 ? light : dark, Math.min(1, Math.abs(n) * 2.4) * streak / 0.07 * 0.55);
    c.lerp(dark, (1 - smooth(0, foot, y)) * 0.6);
    if (M) c.lerp(M, smooth(mossLevel, mossLevel + 0.25, ny + noise3(x * 4 + seed, y * 4, z * 4) * 0.5) * 0.9);
  };
}

/* ───────────────────────── geometry ───────────────────────── */

/**
 * A tapered tube along a smooth curve with a rounded tip: branches, stalks, strands.
 * `rfn(t)` scales the radius along the way. uv = (around, along).
 */
function taper(points, r0, r1 = r0 * 0.5, { radial = 7, segments = 0, tip = true, base = false, rfn = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const segs = segments || clamp(Math.round(curve.getLength() / 0.14), 2, 24);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], uv = [], idx = [];
  const P = new THREE.Vector3();
  const rad = (t) => (r0 + (r1 - r0) * t) * (rfn ? rfn(t) : 1);
  const ringAt = (center, N, B, r, v) => {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      pos.push(center.x + r * (c * N.x + s * B.x), center.y + r * (c * N.y + s * B.y), center.z + r * (c * N.z + s * B.z));
      uv.push(j / radial, v);
    }
  };
  const band = (a0, b0) => {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  };
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    ringAt(P, frames.normals[i], frames.binormals[i], rad(t), t);
  }
  for (let i = 0; i < segs; i++) band(i * radial, (i + 1) * radial);
  if (tip) {
    const T = frames.tangents[segs], N = frames.normals[segs], B = frames.binormals[segs];
    const r = rad(1);
    curve.getPointAt(1, P);
    const mid = pos.length / 3;
    ringAt(P.clone().addScaledVector(T, r * 0.55), N, B, r * 0.8, 1);
    band(segs * radial, mid);
    const apex = pos.length / 3;
    pos.push(P.x + T.x * r * 0.95, P.y + T.y * r * 0.95, P.z + T.z * r * 0.95);
    uv.push(0, 1);
    for (let j = 0; j < radial; j++) idx.push(mid + j, mid + (j + 1) % radial, apex);
  }
  if (base) {
    const T = frames.tangents[0];
    curve.getPointAt(0, P);
    const c0 = pos.length / 3;
    const r = rad(0) * 0.3;
    pos.push(P.x - T.x * r, P.y - T.y * r, P.z - T.z * r);
    uv.push(0, 0);
    for (let j = 0; j < radial; j++) idx.push(c0, (j + 1) % radial, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A ribbon along a smooth curve: a V-folded strip (willow curtains, reed and bamboo leaves).
 * `side` is the across direction; `widthFn(t)` shapes it (pointed tip by default).
 * uv = (across 0-1, along 0-1). Use a double-sided material.
 */
function ribbon(points, width, { side = [1, 0, 0], fold = 0.35, segments = 8, widthFn = (t) => Math.min(1, (1 - t) * 3.2) * (0.55 + 0.45 * Math.min(1, t * 6)) } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const S = new THREE.Vector3(...side).normalize();
  const pos = [], uv = [], idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), F = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    F.crossVectors(T, S).normalize();
    const w = width * widthFn(t) * 0.5;
    const f = w * fold;
    pos.push(P.x - S.x * w, P.y - S.y * w, P.z - S.z * w, P.x + F.x * f, P.y + F.y * f, P.z + F.z * f, P.x + S.x * w, P.y + S.y * w, P.z + S.z * w);
    uv.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 3, b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A lathe made smooth (no seam), with optional root lobes, twist, lean and wobble. uv = (around, height 0-1). */
function trunkGeo(profile, { radial = 14, lobes = 0, lobeAmp = 0.4, lobeH = 0.3, phase = 0, lean = [0, 0], twist = 0, wobble = 0, seed = 0 } = {}) {
  let g = lathe(profile, radial);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  let top = 1e-6;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z), a = Math.atan2(z, x), h = y / top;
    let k = 1;
    if (lobes > 0 && y < lobeH) {
      const f = 1 - y / lobeH;
      k += lobeAmp * Math.pow(0.5 + 0.5 * Math.cos(lobes * (a + phase)), 2.2) * f * f;
    }
    if (wobble) k *= 1 + wobble * noise3(Math.cos(a) * 1.4 + seed, y * 1.8, Math.sin(a) * 1.4);
    const a2 = a + twist * h;
    pos.setXYZ(i, Math.cos(a2) * r * k + lean[0] * h * h, y, Math.sin(a2) * r * k + lean[1] * h * h);
    uv[i * 2] = fract(a / TAU + 1);
    uv[i * 2 + 1] = h;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * A soft cloud of clumps: one smooth surface around a center (smooth union of spheres seen from
 * the center, plus gentle noise). clumps: [{ c: [x, y, z], r, tone }] relative to the center;
 * keep every clump center inside the first (core) clump. uv = (blended clump tone, crease 0-0.5).
 * Returns { geometry, surface(dx, dy, dz) → [x, y, z] on the surface (relative to the center) }.
 */
function cloud(clumps, { detail = 10, k = 0.1, amp = 0.035, freq = 2.4, fine = 0, fineFreq = 4.8, seed = 0, squash = [1, 1, 1], flatBottom = null } = {}) {
  const o = (Math.abs(seed) % 997) * 1.731;
  const ts = new Float64Array(clumps.length);
  const radius = (x, y, z, out) => {
    let tmax = -Infinity;
    for (let i = 0; i < clumps.length; i++) {
      const cl = clumps[i];
      const b = x * cl.c[0] + y * cl.c[1] + z * cl.c[2];
      const q = cl.c[0] * cl.c[0] + cl.c[1] * cl.c[1] + cl.c[2] * cl.c[2] - cl.r * cl.r;
      const disc = b * b - q;
      ts[i] = b + Math.sign(disc) * Math.sqrt(Math.abs(disc));
      if (ts[i] > tmax) tmax = ts[i];
    }
    let sum = 0, tone = 0;
    for (let i = 0; i < clumps.length; i++) {
      const w = Math.exp((ts[i] - tmax) / k);
      sum += w;
      tone += w * (clumps[i].tone ?? 0);
    }
    const n = noise3(x * freq + o, y * freq - o * 0.7, z * freq + o * 0.3);
    const n2 = fine ? noise3(x * fineFreq - o, y * fineFreq + o * 0.3, z * fineFreq + 2.7) : 0;
    out.t = (tmax + k * Math.log(sum)) * (1 + amp * n + fine * n2);
    out.tone = tone / sum;
    out.crease = 1 - 1 / sum;
    return out;
  };
  const place = (x, y, z, t) => {
    const p = [x * t * squash[0], y * t * squash[1], z * t * squash[2]];
    if (flatBottom != null) p[1] = Math.max(p[1], -flatBottom);
    return p;
  };
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const r = { t: 0, tone: 0, crease: 0 };
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    radius(x, y, z, r);
    const p = place(x, y, z, r.t);
    pos.setXYZ(i, p[0], p[1], p[2]);
    uv[i * 2] = r.tone;
    uv[i * 2 + 1] = r.crease;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const surface = (dx, dy, dz) => {
    const l = Math.hypot(dx, dy, dz) || 1;
    radius(dx / l, dy / l, dz / l, r);
    return place(dx / l, dy / l, dz / l, r.t);
  };
  return { geometry: g, surface };
}

/**
 * Clumps for a round canopy of overall radius about R: a core and rings of bulges (lower,
 * middle, upper) plus a crown, like the soft lumpy canopy of an AC tree.
 */
function canopyClumps(r, R, { core = 0.76, rings = [[-0.3, 0.42, 0.46, 4], [0.02, 0.52, 0.55, 5], [0.36, 0.36, 0.5, 4]], crown = 0.5, crownY = 0.48, jitter = 1 } = {}) {
  const clumps = [{ c: [0, 0, 0], r: core * R, tone: 0 }];
  rings.forEach(([y, dist, rad, n], ri) => {
    const a0 = r.angle();
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU + r.float(-0.25, 0.25) * jitter;
      const d = dist * r.float(0.9, 1.08) * R;
      clumps.push({ c: [Math.cos(a) * d, (y + r.float(-0.06, 0.07) * jitter) * R, Math.sin(a) * d], r: rad * r.float(0.88, 1.1) * R, tone: ((i + ri) % 2 ? 1 : -1) * r.float(0.5, 1) });
    }
  });
  if (crown) clumps.push({ c: [r.float(-0.05, 0.05) * R, crownY * R, r.float(-0.05, 0.05) * R], r: crown * R, tone: 0.8 });
  return clumps;
}

/**
 * Paint a canopy: a little darker underneath and in the creases between clumps, lighter on
 * top, a tone per clump, soft patches of a second color and a fine leafy mottling.
 * `spots`: { color, color2, freq, lo, amt } paints blossom-like dots.
 */
function canopyPainter(cols, { cy, ry, alt = null, altAmt = 0.35, spots = null, seed = 0 }) {
  const [B, L, D] = cols.map(C);
  const A = alt ? C(alt) : L;
  const S = spots ? C(spots.color) : null;
  const S2 = spots?.color2 ? C(spots.color2) : null;
  return (c, x, y, z, nx, ny, nz, tone, crease) => {
    const h = clamp((y - cy) / ry, -1.3, 1.3);
    c.copy(D).lerp(B, 0.5 + 0.5 * smooth(-1.1, 0.0, h));
    c.lerp(L, smooth(0.15, 1.1, h) * 0.3 + smooth(0.6, 1, ny) * 0.1);
    c.offsetHSL(0, 0, tone * 0.035);
    const n = noise3(x * 1.35 + seed, y * 1.35 + 3.1, z * 1.35 - seed);
    c.lerp(A, smooth(0.12, 0.45, n) * altAmt);
    c.offsetHSL(0, 0, noise3(x * 4.3 - seed, y * 4.3, z * 4.3 + 1.7) * 0.03);
    c.lerp(D, smooth(0.04, 0.42, crease) * 0.42);
    if (S) {
      const f = spots.freq;
      const m = noise3(x * f + 11.3 + seed, y * f + 5.7, z * f - 2.1);
      const k = smooth(spots.lo, spots.lo + (spots.soft ?? 0.09), m) * spots.amt * (0.55 + 0.45 * smooth(-0.6, 0.6, h));
      c.lerp(S2 && noise3(x * 3 + 1, y * 3, z * 3) > 0.15 ? S2 : S, k);
    }
  };
}

/** Rotate `dir` by angle `ang` toward the azimuth `az` around it. */
function tilt(dir, ang, az) {
  const d = new THREE.Vector3(...dir).normalize();
  const helper = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(d, helper).normalize();
  const v = new THREE.Vector3().crossVectors(d, u).normalize();
  const side = u.multiplyScalar(Math.cos(az)).addScaledVector(v, Math.sin(az));
  return d.multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize().toArray();
}

/**
 * Grow chunky branches: each limb ends in a few children, `levels` deep. Returns the tips
 * [{ at, dir, r }] for hanging twigs, leaves or blossoms.
 */
function grow(parts, look, r, from, dir, { len, rad, levels = 2, kids = [3, 2, 2], shrink = 0.62, spread = 0.6, up = 0.25, droop = 0, minR = 0.022, taperK = 0.62, painter = null }, level = 0, tips = []) {
  const d = new THREE.Vector3(...dir).normalize();
  const a = new THREE.Vector3(...from);
  const end = a.clone().addScaledVector(d, len);
  if (droop) end.y -= droop * len * len;
  const bend = new THREE.Vector3(...tilt(d.toArray(), Math.PI / 2, r.angle())).multiplyScalar(len * 0.09);
  const mid = a.clone().lerp(end, 0.5).add(bend);
  if (droop) mid.y -= droop * len * len * 0.15;
  const r1 = Math.max(minR, rad * taperK);
  const g = taper([a.toArray(), mid.toArray(), end.toArray()], rad, r1, { radial: rad > 0.07 ? 8 : rad > 0.035 ? 6 : 5, tip: true });
  if (painter) addPainted(parts, g, look, undefined, painter); else parts.add(g, look);
  const endDir = end.clone().sub(mid).normalize();
  if (level >= levels) { tips.push({ at: end.toArray(), dir: endDir.toArray(), r: r1 }); return tips; }
  const n = kids[level] ?? 2;
  const az0 = r.angle();
  for (let k = 0; k < n; k++) {
    const leader = k === 0;
    let cd = tilt(endDir.toArray(), spread * (leader ? 0.35 : r.float(0.8, 1.15)), az0 + (k / n) * TAU + r.float(-0.4, 0.4));
    cd = new THREE.Vector3(...cd).lerp(new THREE.Vector3(0, 1, 0), up).normalize().toArray();
    const start = a.clone().lerp(end, leader ? 0.96 : r.float(0.72, 0.95)).toArray();
    grow(parts, look, r, start, cd, { len: len * shrink * r.float(0.85, 1.12), rad: r1 * (leader ? 0.95 : 0.85), levels, kids, shrink, spread, up, droop, minR, taperK, painter }, level + 1, tips);
  }
  return tips;
}

/** Points spread over a sphere (golden spiral) limited to a band of heights (dy in [lo, hi]). */
function spiralDirs(n, lo, hi, r, jitter = 0.25) {
  const out = [];
  const off = r.angle();
  for (let i = 0; i < n; i++) {
    const y = lerp(hi, lo, (i + 0.5) / n) + r.float(-jitter, jitter) * (hi - lo) / Math.max(n, 1);
    const a = off + i * 2.39996 + r.float(-0.3, 0.3);
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    out.push([Math.cos(a) * s, clamp(y, -1, 1), Math.sin(a) * s]);
  }
  return out;
}

/* ───────────────────────── fruit ───────────────────────── */

const FRUIT = {
  apple: { color: '#e2433b', r: 0.125 },
  orange: { color: '#f4922b', r: 0.125 },
  peach: { color: '#f9ad8a', r: 0.125 },
  pear: { color: '#e6d65e', r: 0.115 },
  cherry: { color: '#d4263e', r: 0.06 },
  coconut: { color: '#8c6038', r: 0.13 },
};
const BLOSSOM = { apple: ['#fbe4ec', '#f6bfd1'], orange: ['#fbf7ee', '#f3eedf'], peach: ['#f7a9c6', '#f28bb3'], pear: ['#fbf8f1', '#efe9dc'], cherry: ['#f9c4d6', '#f4a3bf'] };

const APPLE_PROFILE = [[0, -0.8], [0.4, -0.92], [0.78, -0.72], [0.98, -0.22], [0.97, 0.25], [0.82, 0.62], [0.5, 0.84], [0.2, 0.74], [0, 0.6]];
const PEAR_PROFILE = [[0, -0.95], [0.5, -0.98], [0.86, -0.72], [0.96, -0.3], [0.78, 0.1], [0.52, 0.42], [0.42, 0.72], [0.26, 0.98], [0, 1.02]];
const PEACH_PROFILE = [[0, -0.86], [0.5, -0.94], [0.86, -0.62], [0.99, -0.12], [0.92, 0.38], [0.64, 0.78], [0.3, 0.98], [0, 1.06]];

/** One fruit centered at `at`, with a little stem (and a leaf) on top. */
function addFruit(parts, kind, at, look, lookStem, lookLeaf, r) {
  const F = FRUIT[kind] ?? FRUIT.apple;
  const s = F.r * r.float(0.92, 1.08);
  const [x, y, z] = at;
  const spin = r.angle();
  const leaf = (lx, ly, lz) => parts.add(blob(0.045, { detail: 0, amp: 0, squash: [1.5, 0.28, 0.75] }), lookLeaf, { at: [lx, ly, lz], rot: [0, -spin, 0.35] });
  if (kind === 'cherry') {
    const ty = y + 0.1;
    for (const side of [-1, 1]) {
      const bx = x + side * 0.045;
      parts.add(sphere(s, 9, 7), look, { at: [bx, y, z] });
      parts.add(taper([[x, ty, z], [x + side * 0.02, ty - 0.05, z], [bx, y + s * 0.8, z]], 0.007, 0.006, { radial: 4, tip: false }), lookStem);
    }
    leaf(x + 0.03, ty, z);
    return;
  }
  if (kind === 'coconut') {
    parts.add(sphere(s, 10, 8), look, { at, scale: [1, 1.08, 1] });
    return;
  }
  if (kind === 'orange') {
    parts.add(sphere(s, 14, 10), look, { at, scale: [1, 0.95, 1] });
    parts.add(cyl(s * 0.3, s * 0.12, { segments: 5 }), lookLeaf, { at: [x, y + s * 0.86, z] });
    leaf(x + Math.cos(spin) * 0.05, y + s * 0.92, z + Math.sin(spin) * 0.05);
    return;
  }
  const profile = kind === 'pear' ? PEAR_PROFILE : kind === 'peach' ? PEACH_PROFILE : APPLE_PROFILE;
  const h = kind === 'pear' ? 1.25 : 1;
  const g = lathe(profile.map(([pr, py]) => [pr * s, py * s * h]), 14);
  const top = (kind === 'pear' ? 1.02 : kind === 'peach' ? 1.06 : 0.62) * s * h;
  if (kind === 'peach') {
    const blush = C('#f0727f');
    addPainted(parts, g, look, { at, rot: [0, spin, 0] }, (c, px, py, pz) => {
      c.lerp(blush, smooth(-0.4, 1, ((px - x) * Math.cos(spin) + (pz - z) * Math.sin(spin)) / s + (py - y) / s * 0.4) * 0.75);
    });
  } else {
    parts.add(g, look, { at, rot: [0, spin, 0] });
  }
  parts.add(cyl(0.012, 0.07, { top: 0.009, segments: 4 }), lookStem, { at: [x, y + top - 0.02, z], rot: [0.25, spin, 0.15] });
  if (kind !== 'pear') leaf(x + Math.cos(spin) * 0.045, y + top + 0.02, z + Math.sin(spin) * 0.045);
}

/* ───────────────────────── trees ───────────────────────── */

const TREE_VARIANTS = ['round', 'oak', 'pine', 'cedar', 'palm', 'birch', 'fruit', 'cherry', 'willow', 'dead'];
const TREE_STATES = ['healthy', 'bare', 'stump', 'fallen'];
const FRUIT_OPTIONS = ['auto', 'none', 'apple', 'orange', 'peach', 'pear', 'cherry', 'coconut'];
const DECIDUOUS = new Set(['round', 'oak', 'birch', 'fruit', 'cherry', 'willow', 'dead']);

const BARK = {
  round: '#9a6944', oak: '#86634a', pine: '#7c5238', cedar: '#8c4d36', palm: '#b39064',
  birch: '#efe9de', fruit: '#96653f', cherry: '#7a4a3a', willow: '#86694d', dead: '#958576',
};

/** Leaf tones for a tree in a season. */
function treeLeaves(variant, season, r, override) {
  if (override) return { cols: tones(override), alt: shade(override, 0.12, { hue: 0.02 }) };
  if (season === 'autumn') {
    const pickFrom = {
      round: ['orange', 'red', 'yellow'], fruit: ['orange', 'yellow'], oak: ['russet', 'orange'],
      birch: ['yellow'], willow: ['yellow'], cherry: ['red', 'orange'],
    }[variant] ?? ['orange'];
    const main = r.pick(pickFrom);
    const alt = { orange: LEAF.yellow[0], red: LEAF.orange[0], yellow: LEAF.orange[1], russet: LEAF.orange[0] }[main];
    return { cols: LEAF[main], alt, autumn: main };
  }
  const base = season === 'spring' ? LEAF.spring : LEAF.summer;
  const tweak = {
    oak: (c) => shade(c, -0.04, { hue: 0.01 }),
    birch: (c) => shade(c, 0.05, { hue: -0.03 }),
    willow: (c) => shade(c, 0.06, { hue: -0.04, sat: 0.02 }),
    cherry: (c) => shade(c, 0.0, { hue: 0.01 }),
  }[variant] ?? ((c) => c);
  const cols = base.map(tweak);
  return { cols, alt: shade(cols[0], 0.1, { hue: -0.025 }) };
}

/** Leafy look for a tree: foliage that sways (less for bigger trees, so the tops don't wobble). */
const leafLook = (color, sway) => ({ slot: 'foliage', color, sway, sheen: 0.22 });
const swayFor = (S, base = 0.02) => Math.round((base / (S * S)) * 10000) / 10000;

function addTrunk(parts, bark, profile, opts, paint = {}) {
  return addPainted(parts, trunkGeo(profile, opts), bark, undefined, barkPainter(bark, paint));
}

function addCanopy(parts, look, clumps, cloudOpts, at, painter) {
  const c = cloud(clumps, cloudOpts);
  addPainted(parts, c.geometry, look, { at }, painter);
  return (d) => { const p = c.surface(...d); return [p[0] + at[0], p[1] + at[1], p[2] + at[2]]; };
}

/** Fruit or blossoms on a canopy surface. */
function dressCanopy(parts, surf, { fruit, season, sway, r, count = 6, lo = -0.55, hi = 0.35, blossomCount = 14 }) {
  const lookStem = { slot: 'solid', color: '#6e4a2c', sway };
  const lookLeaf = leafLook('#5aa64c', sway);
  if (season === 'spring' && BLOSSOM[fruit]) {
    const [b1, b2] = BLOSSOM[fruit];
    const flower = petalFan(5, 0.075, 0.045, { cup: 0.3, shape: 'round', eye: 0.016 });
    const eye = C('#f2c86a');
    const look = { slot: 'foliage', color: b1, sway, double: true, sheen: 0.2 };
    for (const d of spiralDirs(blossomCount, -0.45, 0.95, r, 0.8)) {
      const p = surf(d);
      const P = C(r.chance(0.5) ? b1 : b2), Pc = C(shade(b2, -0.06));
      addPainted(parts, flower, look, { matrix: facing([p[0] + d[0] * 0.02, p[1] + d[1] * 0.02, p[2] + d[2] * 0.02], [d[0], d[1] + 0.35, d[2]], r.angle(), r.float(0.85, 1.2)) }, (c, x, y, z, nx, ny, nz, u, v) => {
        c.copy(Pc).lerp(P, smooth(0.0, 0.5, u));
        if (v > 0.5) c.copy(eye);
      });
    }
    return;
  }
  if (season === 'winter' || !FRUIT[fruit]) return;
  const look = { slot: 'solid', color: FRUIT[fruit].color, sway };
  for (const d of spiralDirs(count, lo, hi, r, 0.5)) {
    const p = surf(d);
    const out = FRUIT[fruit].r * 0.35;
    const l = Math.hypot(d[0], d[2]) || 1;
    addFruit(parts, fruit, [p[0] + d[0] / l * out, p[1] - FRUIT[fruit].r * 0.2, p[2] + d[2] / l * out], look, lookStem, lookLeaf, r);
  }
}

/** The classic round tree (also the fruit tree): a big soft lumpy canopy on a short sturdy trunk. */
function roundTree(parts, o) {
  const { r, bare, sway } = o;
  const fruitTree = o.variant === 'fruit';
  const k = fruitTree ? 0.9 : 1;
  const bark = o.bark;
  addTrunk(parts, bark, [[0.25, -0.01], [0.245, 0.015], [0.225, 0.05], [0.2, 0.11], [0.183, 0.2], [0.172, 0.36], [0.163, 0.7], [0.153, 1.0], [0.134, 1.25], [0.08, 1.42], [0, 1.48]].map(([a, b]) => [a * k, b * k]),
    { radial: 22, lobes: 4, lobeAmp: 0.55, lobeH: 0.36 * k, phase: r.angle(), lean: [r.float(-0.05, 0.05), r.float(-0.05, 0.05)] }, { seed: r.float(0, 50), foot: 0.1 });
  const cy = 1.92 * k, R = 1.15 * k;
  const limbs = 3;
  const a0 = r.angle();
  const skel = rand(o.ctx, 'skeleton');
  const paint = barkPainter(bark, { foot: 0 });
  for (let i = 0; i < limbs; i++) {
    const az = a0 + (i / limbs) * TAU + r.float(-0.3, 0.3);
    const el = r.float(0.85, 1.1);
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    grow(parts, bark, skel, [0, 0.95 * k, 0], dir, { len: 0.9 * k, rad: 0.12 * k, levels: bare ? 2 : 0, kids: [3, 3], shrink: 0.6, spread: 0.6, up: 0.16, minR: 0.03 * k, taperK: 0.66, painter: paint });
  }
  if (!bare) {
    const clumps = canopyClumps(r, R);
    const leaves = o.leaves;
    const surf = addCanopy(parts, leafLook(leaves.cols[0], sway), clumps, { detail: 14, k: 0.05 * R, amp: 0.028, freq: 2.2, fine: 0.016, seed: r.int(0, 999), squash: [1.08, 0.95, 1.08] }, [0, cy, 0],
      canopyPainter(leaves.cols, { cy, ry: R * 0.85, alt: leaves.alt, altAmt: o.season === 'autumn' ? 0.5 : 0.28, seed: r.float(0, 40) }));
    if (o.fruit !== 'none') dressCanopy(parts, surf, { fruit: o.fruit, season: o.season, sway, r: rand(o.ctx, 'fruit'), count: fruitTree ? 8 : 5, lo: -0.5, hi: 0.45, blossomCount: 70 });
  }
  return { trunkR: 0.2 * k, reach: 1.25 * k, height: 2.95 * k, under: 0.88 * k };
}

/** A big old oak: thick flared trunk, heavy limbs, a broad dome of leaves. */
function oakTree(parts, o) {
  const { r, bare, sway, bark } = o;
  addTrunk(parts, bark, [[0, 0], [0.44, 0], [0.45, 0.04], [0.35, 0.14], [0.28, 0.3], [0.25, 0.7], [0.23, 1.2], [0.2, 1.6], [0.13, 1.95], [0, 2.02]],
    { radial: 16, lobes: 6, lobeAmp: 0.55, lobeH: 0.5, phase: r.angle(), wobble: 0.07, seed: r.float(0, 50), lean: [r.float(-0.06, 0.06), r.float(-0.06, 0.06)] }, { seed: r.float(0, 50), streak: 0.09 });
  const skel = rand(o.ctx, 'skeleton');
  const paint = barkPainter(bark, { foot: 0 });
  const a0 = r.angle();
  for (let i = 0; i < 4; i++) {
    const az = a0 + (i / 4) * TAU + r.float(-0.25, 0.25);
    const el = r.float(0.62, 0.85);
    grow(parts, bark, skel, [0, 1.45, 0], [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)],
      { len: 1.35, rad: 0.15, levels: bare ? 2 : 0, kids: [3, 2], shrink: 0.64, spread: 0.6, up: 0.18, minR: 0.026, painter: paint });
  }
  if (!bare) {
    const R = 1.6, cy = 3.45;
    const clumps = canopyClumps(r, R, { rings: [[-0.26, 0.5, 0.44, 5], [0.04, 0.6, 0.5, 6], [0.38, 0.4, 0.46, 4]], crown: 0.46, crownY: 0.44, jitter: 1.6 });
    addCanopy(parts, leafLook(o.leaves.cols[0], sway), clumps, { detail: 15, k: 0.055 * R, amp: 0.03, freq: 1.9, seed: r.int(0, 999), squash: [1.3, 0.74, 1.22] }, [0, cy, 0],
      canopyPainter(o.leaves.cols, { cy, ry: R * 0.72, alt: o.leaves.alt, altAmt: o.season === 'autumn' ? 0.5 : 0.28, seed: r.float(0, 40) }));
  }
  return { trunkR: 0.3, reach: 2.0, height: 4.75, under: 1.35 };
}

/** One soft tier of a conifer: a puffy skirt with a rolled, round-scalloped, drooping rim. */
function tierGeo(R, H, { radial = 40, scallops = 7, amp = 0.09, phase = 0, droop = 0.12, round = 0 } = {}) {
  const tipR = R * (0.15 + round * 0.12), tipY = H * (0.92 - round * 0.04);
  const profile = [[0.05, H * 0.1], [R * 0.45, H * 0.06], [R * 0.8, H * 0.03], [R * 0.93, H * 0.05], [R * 1.0, H * 0.12], [R * 0.99, H * 0.2], [R * 0.9, H * 0.28], [R * 0.68, H * 0.46], [R * (0.4 + round * 0.08), H * 0.7], [tipR, tipY], [tipR * 0.45, H * (0.985 - round * 0.02)], [0, H * (1 - round * 0.02)]];
  let g = lathe(profile, radial);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const rr = Math.hypot(x, z), a = Math.atan2(z, x);
    const f = rr / R;
    const wave = Math.cos(scallops * a + phase);
    const k = 1 + amp * (wave * 0.5 + 0.5) * f * f - amp * 0.5 * f * f;
    pos.setXYZ(i, x * k, y - droop * H * f * f * (0.8 + 0.4 * (wave * 0.5 + 0.5)), z * k);
    uv[i * 2] = wave * 0.5 + 0.5;
    uv[i * 2 + 1] = y / H;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Pine (wide, soft tiers) and cedar (taller, slimmer, bluer): evergreen all year. */
function coniferTree(parts, o) {
  const { r, bare, sway, bark } = o;
  const cedar = o.variant === 'cedar';
  const tiers = cedar
    ? [[0.62, 0.98, 1.05], [1.18, 0.88, 1.0], [1.72, 0.76, 0.95], [2.24, 0.63, 0.92], [2.74, 0.5, 0.9], [3.22, 0.36, 0.95]]
    : [[0.5, 1.3, 1.35], [1.25, 1.06, 1.25], [1.95, 0.8, 1.12], [2.6, 0.54, 1.12]];
  const top = tiers[tiers.length - 1][0] + tiers[tiers.length - 1][2];
  addTrunk(parts, bark, [[0.21, 0], [0.205, 0.02], [0.175, 0.07], [0.145, 0.16], [0.125, 0.3], [0.11, 0.7], [0.08, top * 0.75], [0, top * 0.8]],
    { radial: 16, lobes: 5, lobeAmp: 0.32, lobeH: 0.26, phase: r.angle() }, { seed: r.float(0, 50), foot: 0.1 });
  const base = cedar ? ['#28785f', '#43977a', '#174f42'] : ['#2f864a', '#4fa862', '#1b5a38'];
  const winter = cedar ? ['#357564', '#52937e', '#225548'] : ['#3a7a55', '#5c9a6c', '#275a40'];
  const cols = o.leavesOverride ? tones(o.leavesOverride) : (o.season === 'winter' ? winter : o.season === 'spring' ? base.map((c) => shade(c, 0.03, { hue: -0.01 })) : base);
  if (bare) {
    // a bare conifer: a straight spine with short drooping whorls
    const skel = rand(o.ctx, 'skeleton');
    const paint = barkPainter(bark, { foot: 0 });
    tiers.forEach(([y, R], i) => {
      const n = 5;
      for (let j = 0; j < n; j++) {
        const az = (j / n) * TAU + i * 0.6 + skel.float(-0.2, 0.2);
        grow(parts, bark, skel, [0, y + 0.15, 0], [Math.cos(az), -0.05, Math.sin(az)], { len: R * 0.85, rad: 0.04, levels: 0, droop: 0.15, minR: 0.02, painter: paint });
      }
    });
    return { trunkR: 0.15, reach: 1.0, height: top, under: cedar ? 1.1 : 1.35 };
  }
  const [B, L, D] = cols.map(C);
  tiers.forEach(([y, R, H], i) => {
    const last = i === tiers.length - 1;
    const g = tierGeo(R, H, { radial: 40, scallops: cedar ? 6 + (i % 2) : 7 + (i % 2), amp: 0.1, phase: r.angle(), droop: cedar ? 0.1 : 0.13, round: last ? 0.5 : 0 });
    const seed = r.float(0, 40);
    addPainted(parts, g, leafLook(cols[0], sway), { at: [0, y, 0], rot: [0, r.angle(), 0] }, (c, x, py, z, nx, ny, nz, wave) => {
      const t = clamp((py - y) / H, 0, 1);
      c.copy(D).lerp(B, 0.45 + 0.55 * smooth(-0.5, 0.4, ny));
      c.lerp(L, smooth(0.45, 1, ny) * 0.3 + t * 0.12 + wave * 0.1 * smooth(0.6, 0.95, Math.hypot(x, z) / R));
      c.offsetHSL(0, 0, noise3(x * 2.6 + seed, py * 2.6, z * 2.6) * 0.035);
    });
  });
  return { trunkR: 0.15, reach: cedar ? 0.95 : 1.25, height: top, under: cedar ? 1.12 : 1.42 };
}

/** One palm frond: an arching, V-folded leaf with notched edges. */
function frondGeo(len, width, { arch = 0.35, droop = 0.55, notches = 6 } = {}) {
  const steps = notches * 2 + 2;
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * len;
    const y = Math.sin(Math.min(t, 0.6) / 0.6 * Math.PI * 0.5) * arch * len * (1 - t * 0.3) - droop * len * Math.pow(Math.max(0, t - 0.35) / 0.65, 2);
    let w = width * Math.sin(Math.PI * Math.pow(t, 0.75)) * (t < 0.08 ? t / 0.08 : 1);
    if (i > 1 && i < steps - 1 && i % 2 === 0) w *= 0.5; // notches
    const fold = w * 0.35;
    pos.push(x, y - fold * 0.5, -w, x, y + fold * 0.25, 0, x, y - fold * 0.5, w);
    uv.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 3, b = (i + 1) * 3;
    idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A palm: a curved ringed trunk, a crown of arching fronds and coconuts. */
function palmTree(parts, o) {
  const { r, sway, bark } = o;
  const lean = r.float(0.45, 0.75);
  const az = r.angle();
  const dx = Math.cos(az), dz = Math.sin(az);
  const pts = [[0, 0, 0], [0.04 * lean * dx, 0.9, 0.04 * lean * dz], [0.25 * lean * dx, 1.9, 0.25 * lean * dz], [0.62 * lean * dx, 2.85, 0.62 * lean * dz], [0.92 * lean * dx, 3.45, 0.92 * lean * dz]];
  const rings = 13;
  const light = C(shade(colorOf(bark), 0.08)), dark = C(shade(colorOf(bark), -0.12));
  addPainted(parts, taper(pts, 0.17, 0.105, { radial: 12, segments: rings * 4, tip: false, base: false, rfn: (t) => (1 + 0.45 * Math.pow(1 - smooth(0, 0.09, t), 2)) * (0.93 + 0.12 * Math.pow(fract(t * rings), 1.6)) }), bark, undefined, (c, x, y, z, nx, ny, nz, u, v) => {
    const f = fract(v * rings);
    c.lerp(f > 0.72 ? light : dark, f > 0.72 ? 0.7 : 0.25 * (1 - f));
    c.lerp(dark, (1 - smooth(0, 0.08, v)) * 0.5);
  });
  const top = pts[pts.length - 1];
  if (o.bare) return { trunkR: 0.16, reach: 1.5, height: 3.6, under: 1.1 };
  const cols = o.leavesOverride ? tones(o.leavesOverride) : o.season === 'winter' ? ['#5f9a58', '#7db46a', '#3f7444'] : o.season === 'autumn' ? ['#6fa84c', '#94c05e', '#4a7f3c'] : ['#55a84a', '#7cc35d', '#367d3d'];
  const [B, L, D] = cols.map(C);
  const fronds = 9;
  const f0 = r.angle();
  for (let i = 0; i < fronds; i++) {
    const a = f0 + (i / fronds) * TAU + r.float(-0.15, 0.15);
    const upper = i % 3 === 0;
    const g = frondGeo(r.float(1.4, 1.7) * (upper ? 0.85 : 1), r.float(0.36, 0.42), { arch: upper ? 0.5 : 0.34, droop: upper ? 0.38 : 0.66, notches: 5 });
    addPainted(parts, g, { slot: 'foliage', color: cols[0], sway, double: true, sheen: 0.32 }, { at: [top[0], top[1] + 0.02, top[2]], rot: [0, -a, upper ? 0.35 : 0.08] }, (c, x, y, z, nx, ny, nz, u, v) => {
      c.copy(D).lerp(B, smooth(0.0, 0.25, v));
      c.lerp(L, smooth(0.3, 0.95, v) * 0.45 * (1 - Math.abs(u - 0.5)));
      if (Math.abs(u - 0.5) < 0.01) c.lerp(L, 0.35);
    });
  }
  // the crown's heart
  parts.add(blob(0.17, { detail: 2, amp: 0.1, seed: r.int(0, 99), squash: [1, 0.8, 1] }), { slot: 'foliage', color: cols[2], sway }, { at: [top[0], top[1] - 0.02, top[2]] });
  if (o.fruit === 'coconut') {
    const look = { slot: 'solid', color: FRUIT.coconut.color, sway };
    const n = 3 + r.int(0, 1);
    for (let i = 0; i < n; i++) {
      const a = r.angle();
      parts.add(sphere(0.12, 10, 8), look, { at: [top[0] + Math.cos(a) * 0.15, top[1] - 0.2 - r.float(0, 0.06), top[2] + Math.sin(a) * 0.15], scale: [1, 1.08, 1] });
    }
  }
  return { trunkR: 0.17, reach: 1.6, height: 3.9, under: 1.1 };
}

/** Birch: two or three slender white trunks with dark marks under an airy oval crown. */
function birchTree(parts, o) {
  const { r, bare, sway, bark } = o;
  const n = 2 + r.int(0, 1);
  const a0 = r.angle();
  const markDark = C('#3f3a37'), markGrey = C('#b7b0a4');
  const paint = (c, x, y, z) => {
    const a = Math.atan2(z, x);
    const n1 = noise3(x * 5 + 3, y * 2.6, z * 5);
    const band = fract(y * 3.1 + noise3(x * 2, y * 0.7, z * 2) * 0.6);
    c.lerp(markGrey, smooth(0.15, 0.4, n1) * 0.5);
    if (band > 0.82 && noise3(Math.cos(a) * 3, y * 4, Math.sin(a) * 3) > -0.1) c.lerp(markDark, 0.85);
    c.lerp(markDark, (1 - smooth(0.0, 0.32, y)) * 0.55);
  };
  const tops = [], curves = [], azs = [];
  for (let i = 0; i < n; i++) {
    const az = a0 + (i / n) * TAU + r.float(-0.3, 0.3);
    const sp = r.float(0.12, 0.2);
    const h = r.float(2.75, 3.25) * (i === 0 ? 1.06 : 1);
    const bx = Math.cos(az) * 0.06, bz = Math.sin(az) * 0.06;
    const pts = [[bx, 0, bz], [bx + Math.cos(az) * sp * 0.4, h * 0.35, bz + Math.sin(az) * sp * 0.4], [bx + Math.cos(az) * sp * 1.1, h * 0.7, bz + Math.sin(az) * sp * 1.1], [bx + Math.cos(az) * sp * 1.6, h, bz + Math.sin(az) * sp * 1.6]];
    addPainted(parts, taper(pts, i === 0 ? 0.095 : 0.082, 0.04, { radial: 10 }), bark, undefined, paint);
    tops.push(pts[3]);
    azs.push(az);
    curves.push(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))));
    if (bare) {
      const skel = rand(o.ctx, `skeleton${i}`);
      for (let j = 0; j < 3; j++) {
        const p = curves[i].getPointAt(0.55 + j * 0.15);
        const baz = az + skel.float(-1.2, 1.2);
        grow(parts, bark, skel, p.toArray(), [Math.cos(baz) * 0.6, 0.8, Math.sin(baz) * 0.6], { len: 0.75, rad: 0.035, levels: 1, kids: [2], shrink: 0.6, spread: 0.5, up: 0.3, minR: 0.018, painter: paint });
      }
    }
  }
  // the foot where the trunks meet
  addPainted(parts, trunkGeo([[0.21, 0], [0.205, 0.03], [0.16, 0.1], [0.125, 0.2], [0.06, 0.3], [0, 0.32]], { radial: 14, lobes: 4, lobeAmp: 0.3, lobeH: 0.16 }), bark, undefined, paint);
  if (!bare) {
    const cr = rand(o.ctx, 'crown');
    const cx = tops.reduce((a, t) => a + t[0], 0) / n, cz = tops.reduce((a, t) => a + t[2], 0) / n;
    const ty = tops.reduce((a, t) => a + t[1], 0) / n;
    const R = 0.62, cy = ty - 0.05;
    const look = leafLook(o.leaves.cols[0], sway);
    const clumps = canopyClumps(cr, R, { core: 0.78, rings: [[-0.5, 0.42, 0.42, 4], [-0.08, 0.5, 0.46, 5], [0.36, 0.38, 0.44, 4]], crown: 0.42, crownY: 0.6, jitter: 1.4 });
    addCanopy(parts, look, clumps, { detail: 12, k: 0.045, amp: 0.05, freq: 2.6, seed: cr.int(0, 999), squash: [1.0, 1.38, 1.0] }, [cx, cy, cz],
      canopyPainter(o.leaves.cols, { cy, ry: R * 1.3, alt: o.leaves.alt, altAmt: 0.32, seed: cr.float(0, 40) }));
    // two little leafy puffs on short side branches lower down
    for (let i = 0; i < 2; i++) {
      const k = i % n;
      const base = curves[k].getPointAt(cr.float(0.52, 0.62));
      const az = azs[k] + (i ? 1 : -1) * cr.float(0.5, 1.0);
      const end = [base.x + Math.cos(az) * 0.42, base.y + 0.22, base.z + Math.sin(az) * 0.42];
      parts.add(taper([base.toArray(), [base.x + Math.cos(az) * 0.22, base.y + 0.08, base.z + Math.sin(az) * 0.22], end], 0.035, 0.022, { radial: 6 }), recolor(bark, shade(colorOf(bark), -0.04)));
      const pr = 0.3;
      addCanopy(parts, look, canopyClumps(cr, pr, { rings: [[0.0, 0.5, 0.5, 4], [0.34, 0.3, 0.45, 2]], crown: 0 }), { detail: 6, k: 0.04, amp: 0.05, seed: cr.int(0, 999), squash: [1.1, 0.95, 1.1] }, [end[0], end[1] + 0.12, end[2]],
        canopyPainter(o.leaves.cols, { cy: end[1] + 0.12, ry: pr, alt: o.leaves.alt, altAmt: 0.3, seed: cr.float(0, 40) }));
    }
  }
  return { trunkR: 0.17, reach: 1.0, height: 4.0, under: 0.85 };
}

/** Cherry: a dark trunk splitting low into spreading limbs under a wide flat cloud of blossom. */
function cherryTree(parts, o) {
  const { r, bare, sway, bark } = o;
  const bandC = C(shade(colorOf(bark), -0.09)), lightC = C(shade(colorOf(bark), 0.06));
  const paint = (c, x, y, z) => {
    const b = fract(y * 9 + noise3(x * 3, y, z * 3) * 0.4);
    c.lerp(b > 0.8 ? bandC : lightC, b > 0.8 ? 0.6 : 0.15);
  };
  addPainted(parts, trunkGeo([[0, 0], [0.24, 0], [0.25, 0.03], [0.19, 0.1], [0.15, 0.22], [0.13, 0.5], [0.12, 0.8], [0.09, 0.95], [0, 1.0]],
    { radial: 13, lobes: 5, lobeAmp: 0.45, lobeH: 0.28, phase: r.angle(), wobble: 0.05, seed: r.float(0, 30), lean: [r.float(-0.06, 0.06), r.float(-0.06, 0.06)] }), bark, undefined, paint);
  const skel = rand(o.ctx, 'skeleton');
  const a0 = r.angle();
  for (let i = 0; i < 4; i++) {
    const az = a0 + (i / 4) * TAU + r.float(-0.25, 0.25);
    const el = r.float(0.55, 0.78);
    grow(parts, bark, skel, [0, 0.82, 0], [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)],
      { len: 1.0, rad: 0.095, levels: bare ? 2 : 0, kids: [3, 2], shrink: 0.62, spread: 0.62, up: 0.12, minR: 0.02, painter: paint });
  }
  if (!bare) {
    const R = 1.15, cy = 2.15;
    const spring = o.season === 'spring' && !o.leavesOverride;
    const cols = spring ? ['#f6b3c9', '#fcd7e3', '#e48aa9'] : o.leaves.cols;
    const alt = spring ? '#fde6ee' : o.leaves.alt;
    const clumps = canopyClumps(r, R, { rings: [[-0.22, 0.5, 0.42, 5], [0.04, 0.6, 0.5, 6], [0.34, 0.4, 0.46, 4]], crown: 0.46, crownY: 0.44 });
    const surf = addCanopy(parts, leafLook(cols[0], sway), clumps, { detail: 14, k: 0.065, amp: 0.035, freq: 2.4, seed: r.int(0, 999), squash: [1.4, 0.68, 1.32] }, [0, cy, 0],
      canopyPainter(cols, { cy, ry: R * 0.74, alt, altAmt: spring ? 0.45 : 0.32, spots: spring ? { color: '#fff1f5', freq: 3.6, lo: 0.25, amt: 0.6 } : null, seed: r.float(0, 40) }));
    if (spring) {
      const pr = rand(o.ctx, 'petals');
      for (let i = 0; i < 16; i++) {
        const a = pr.angle(), d = pr.float(0.3, 1.9);
        parts.add(sphere(pr.float(0.035, 0.05), 6, 3), { slot: 'foliage', color: pr.chance(0.5) ? '#f8c2d4' : '#fbdbe5' }, { at: [Math.cos(a) * d, 0.006, Math.sin(a) * d], scale: [1, 0.15, 0.7], rot: [0, pr.angle(), 0] });
      }
      for (const d of spiralDirs(10, -0.3, 0.8, rand(o.ctx, 'puffs'), 0.6)) {
        const p = surf(d);
        parts.add(blob(0.09, { detail: 1, amp: 0.15, seed: 3 }), leafLook('#fbd3e0', sway), { at: [p[0], p[1], p[2]] });
      }
    } else if (o.fruit === 'cherry' && o.season === 'summer') {
      dressCanopy(parts, surf, { fruit: 'cherry', season: o.season, sway, r: rand(o.ctx, 'fruit'), count: 6 });
    }
  }
  return { trunkR: 0.16, reach: 1.7, height: 3.05, under: 0.95 };
}

/** Weeping willow: a leaning trunk, a soft dome and long curtains of leaves that sway. */
function willowTree(parts, o) {
  const { r, bare, sway, bark } = o;
  const lx = r.float(-0.12, 0.12), lz = r.float(-0.12, 0.12);
  addTrunk(parts, bark, [[0, 0], [0.3, 0], [0.31, 0.04], [0.24, 0.13], [0.2, 0.3], [0.17, 0.7], [0.16, 1.2], [0.14, 1.6], [0.09, 1.9], [0, 1.95]],
    { radial: 14, lobes: 5, lobeAmp: 0.5, lobeH: 0.35, phase: r.angle(), wobble: 0.08, seed: r.float(0, 30), lean: [lx, lz], twist: 0.5 }, { seed: r.float(0, 30), streak: 0.1 });
  const skel = rand(o.ctx, 'skeleton');
  const paint = barkPainter(bark, { foot: 0 });
  const a0 = r.angle();
  const tips = [];
  for (let i = 0; i < 3; i++) {
    const az = a0 + (i / 3) * TAU + r.float(-0.3, 0.3);
    grow(parts, bark, skel, [lx * 0.8, 1.55, lz * 0.8], [Math.cos(az) * 0.6, 0.85, Math.sin(az) * 0.6], { len: 0.9, rad: 0.1, levels: bare ? 1 : 0, kids: [3], shrink: 0.7, spread: 0.6, up: 0.1, minR: 0.03, painter: paint }, 0, tips);
  }
  const cy = 2.75, R = 0.95;
  const cols = o.leaves.cols;
  const [B, L, D] = cols.map(C);
  if (bare) {
    // long, thin weeping twigs hanging from the branch tips
    for (const t of tips) {
      for (let j = 0; j < 3; j++) {
        const a = skel.angle(), out = skel.float(0.15, 0.35);
        const p0 = t.at, hang = skel.float(1.0, 1.6);
        grow(parts, bark, skel, p0, [Math.cos(a) * out, 0.35, Math.sin(a) * out], { len: 0.3, rad: 0.022, levels: 0, minR: 0.014, painter: paint });
        parts.add(taper([[p0[0], p0[1] + 0.1, p0[2]], [p0[0] + Math.cos(a) * out, p0[1] + 0.05, p0[2] + Math.sin(a) * out], [p0[0] + Math.cos(a) * out * 1.3, p0[1] - hang * 0.5, p0[2] + Math.sin(a) * out * 1.3], [p0[0] + Math.cos(a) * out * 1.4, p0[1] - hang, p0[2] + Math.sin(a) * out * 1.4]], 0.016, 0.01, { radial: 4 }), recolor(bark, shade(colorOf(bark), 0.08)));
      }
    }
    return { trunkR: 0.2, reach: 1.5, height: 3.4, under: 0.95 };
  }
  const clumps = canopyClumps(r, R, { rings: [[0.0, 0.54, 0.52, 5], [0.34, 0.38, 0.48, 4]], crown: 0.48, crownY: 0.46 });
  const surf = addCanopy(parts, leafLook(cols[0], sway), clumps, { detail: 12, k: 0.06, amp: 0.035, freq: 2.4, seed: r.int(0, 999), squash: [1.25, 0.8, 1.25], flatBottom: R * 0.4 }, [lx, cy, lz],
    canopyPainter(cols, { cy, ry: R * 0.8, alt: o.leaves.alt, altAmt: 0.3, seed: r.float(0, 40) }));
  // curtains: three layers of leafy ribbons that start up on the crown, flow over its edge
  // like long hair and fall toward the ground (higher at the front, so the trunk shows)
  const sr = rand(o.ctx, 'strands');
  const look = { slot: 'foliage', color: cols[0], sway, double: true, sheen: 0.32 };
  const layers = [[0.95, 12, 0.5, 0.85, 0.24], [0.55, 14, 0.7, 1.05, 0.22], [0.2, 12, 1.0, 1.4, 0.2]];
  layers.forEach(([e0, n, lo, hi, w], li) => {
    const s0 = sr.angle();
    for (let i = 0; i < n; i++) {
      const a = s0 + (i / n) * TAU + sr.float(-0.1, 0.1);
      const cx = Math.cos(a), cz = Math.sin(a);
      const el = e0 + sr.float(-0.12, 0.12);
      const p0 = surf([cx * Math.cos(el), Math.sin(el), cz * Math.sin(Math.PI / 2) * Math.cos(el)]);
      const p1 = surf([cx, -0.05, cz]);
      const front = Math.max(0, Math.sin(a));
      const yEnd = sr.float(lo, hi) + front * front * 0.55;
      const out = 0.06 + li * 0.02 + sr.float(0, 0.06);
      const pts = [
        [p0[0] - cx * 0.03, p0[1] - 0.02, p0[2] - cz * 0.03],
        [p1[0] + cx * out, p1[1] + 0.02, p1[2] + cz * out],
        [p1[0] + cx * out * 1.6, lerp(p1[1], yEnd, 0.55), p1[2] + cz * out * 1.6],
        [p1[0] + cx * out * 1.4, yEnd, p1[2] + cz * out * 1.4],
      ];
      const tint = (1 - li) * 0.025 + sr.float(-0.02, 0.02);
      addPainted(parts, ribbon(pts, w * sr.float(0.9, 1.15), { side: [-cz, 0, cx], fold: 0.55, segments: 10, widthFn: (t) => Math.min(1, (1 - t) * 3.2) * (0.75 + 0.25 * Math.min(1, t * 6)) }), look, undefined, (c, x, y, z, nx, ny, nz, u, v) => {
        c.copy(B).lerp(L, smooth(0.0, 0.25, v) * 0.35 + smooth(0.45, 1, v) * 0.4);
        c.lerp(D, Math.abs(u - 0.5) > 0.3 ? 0.08 : 0);
        c.offsetHSL(0, 0, tint + noise3(x * 5, y * 2, z * 5) * 0.03);
      });
    }
  });
  return { trunkR: 0.2, reach: 1.6, height: 3.55, under: 0.85 };
}

/** A dead tree: a gnarled grey trunk with crooked bare branches and a hollow. */
function deadTree(parts, o) {
  const { r, bark } = o;
  addTrunk(parts, bark, [[0, 0], [0.27, 0], [0.28, 0.04], [0.21, 0.14], [0.17, 0.3], [0.15, 0.7], [0.13, 1.2], [0.11, 1.6], [0.08, 1.9], [0, 1.95]],
    { radial: 13, lobes: 4, lobeAmp: 0.6, lobeH: 0.4, phase: r.angle(), twist: 1.3, wobble: 0.14, seed: r.float(0, 30), lean: [r.float(-0.15, 0.15), r.float(-0.15, 0.15)] }, { seed: r.float(0, 30), streak: 0.12 });
  const skel = rand(o.ctx, 'skeleton');
  const paint = barkPainter(bark, { foot: 0, streak: 0.1 });
  const a0 = r.angle();
  for (let i = 0; i < 4; i++) {
    const az = a0 + (i / 4) * TAU + r.float(-0.4, 0.4);
    const y = 1.05 + i * 0.22 + r.float(0, 0.1);
    const el = r.float(0.4, 0.95);
    grow(parts, bark, skel, [0, y, 0], [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)],
      { len: 0.9 - i * 0.08, rad: 0.085 - i * 0.008, levels: 2, kids: [2, 2], shrink: 0.6, spread: 0.75, up: 0.05, minR: 0.02, taperK: 0.55, painter: paint });
  }
  // the hollow
  parts.add(sphere(0.075, 10, 8), recolor(bark, '#3a2b24'), { at: [0, 0.78, 0.125], scale: [0.85, 1.25, 0.45] });
  return { trunkR: 0.17, reach: 1.1, height: 2.9, under: 0.8 };
}

const TREES = { round: roundTree, fruit: roundTree, oak: oakTree, pine: coniferTree, cedar: coniferTree, palm: palmTree, birch: birchTree, cherry: cherryTree, willow: willowTree, dead: deadTree };

/* ───────────────────────── stumps and fallen trees ───────────────────────── */

const RINGS = { light: '#e6c896', ring: '#c99c66', heart: '#b88552' };

/** A stump: flared bark body and a cut face with growth rings. Returns the seat height. */
function stumpParts(parts, r, { bark = PALETTE.woodDark, R = 0.3, H = 0.3, moss = false, mushrooms = false, ctx = null } = {}) {
  const prof = [[R * 1.34, -0.01], [R * 1.3, 0.012], [R * 1.18, 0.045], [R * 1.07, 0.09], [R * 1.01, 0.15], [R * 0.985, 0.21], [R * 0.975, H * 0.72], [R * 0.97, H - 0.02], [R * 0.93, H], [R * 0.86, H + 0.012], [0, H + 0.012]];
  const mossC = moss ? '#78a94b' : null;
  const bp = barkPainter(bark, { foot: 0.12, seed: r.float(0, 30) });
  const M1 = C('#7aab4c'), M2 = C('#5f9140');
  const ms = r.float(0, 30);
  addPainted(parts, trunkGeo(prof, { radial: 30, lobes: 5, lobeAmp: 0.28, lobeH: 0.2, phase: r.angle(), wobble: 0.04, seed: r.float(0, 30) }), bark, undefined, (c, x, y, z, nx, ny, nz, u, v) => {
    bp(c, x, y, z, nx, ny, nz);
    if (mossC) {
      // a few soft patches climbing the bark from the ground
      const m = noise3(x * 9 + ms, y * 6, z * 9) - y * 2.4 + 0.06;
      c.lerp(noise3(x * 13, y * 13, z * 13) > 0 ? M1 : M2, smooth(0.1, 0.22, m) * 0.9);
    }
  });
  // the cut face: concentric rings (enough vertex rings for the paint to show them)
  const face = [];
  for (let i = 0; i <= 9; i++) face.push([R * 0.87 * (1 - i / 9), H + 0.014 + Math.sin((i / 9) * Math.PI * 0.5) * 0.006]);
  const L = C(RINGS.light), Rg = C(RINGS.ring), Hh = C(RINGS.heart);
  const off = [r.float(-0.04, 0.04), r.float(-0.04, 0.04)];
  addPainted(parts, lathe(face, 26), PALETTE.woodLight, undefined, (c, x, y, z) => {
    const d = Math.hypot(x - off[0], z - off[1]) / (R * 0.87);
    c.copy(L);
    c.lerp(Rg, smooth(0.5, 0.85, Math.cos(d * 26 + noise3(x * 6, 0, z * 6) * 1.5)) * 0.75);
    c.lerp(Hh, 1 - smooth(0.06, 0.16, d));
    c.lerp(Rg, smooth(0.9, 1, d) * 0.5);
  });
  if (moss) {
    const mr = ctx ? rand(ctx, 'moss') : r;
    for (let i = 0; i < 4; i++) {
      const a = mr.angle();
      const rr = R * (i < 2 ? 1.22 : 1.02);
      parts.add(blob(mr.float(0.04, 0.06), { detail: 2, amp: 0.3, freq: 4, seed: i, squash: [1.3, 0.55, 1] }), { slot: 'foliage', color: i % 2 ? '#86b552' : '#6f9e47', sheen: 0.4 }, { at: [Math.cos(a) * rr, i < 2 ? 0.03 : mr.float(0.08, H * 0.55), Math.sin(a) * rr], rot: [0, -a, 0] });
    }
  }
  if (mushrooms) {
    const mr = ctx ? rand(ctx, 'stump-shrooms') : r;
    const a = mr.angle();
    mushroomCluster(parts, mr, { variant: 'brown', at: [Math.cos(a) * R * 1.12, 0, Math.sin(a) * R * 1.12], scale: 0.7, count: 2 });
  }
  return H + 0.012;
}

/** A fallen tree: a root plate, a long trunk on the ground and a crown at the far end. */
function fallenTree(parts, o) {
  const { r, bare, sway } = o;
  const bark = colorOf(o.bark);
  const spec = { round: [2.3, 0.15], fruit: [2.0, 0.14], oak: [3.2, 0.24], pine: [3.0, 0.14], cedar: [3.4, 0.13], palm: [3.2, 0.13], birch: [2.8, 0.09], cherry: [2.2, 0.14], willow: [2.6, 0.18], dead: [2.2, 0.15] }[o.variant] ?? [2.3, 0.15];
  const [L, tr] = spec;
  const x0 = -L / 2, x1 = L / 2;
  const sag = r.float(-0.08, 0.08);
  addPainted(parts, taper([[x0, tr, 0], [x0 + L * 0.35, tr * 0.98, sag], [x0 + L * 0.7, tr * 0.96 + 0.02, sag * 0.5], [x1, tr * 0.9 + 0.08, -sag]], tr, tr * 0.62, { radial: 12, tip: true, base: true }),
    bark, undefined, o.variant === 'birch' ? ((c, x, y, z) => { if (fract(x * 3.1 + noise3(x, y * 3, z * 3) * 0.5) > 0.84) c.lerp(C('#3f3a37'), 0.8); }) : barkPainter(bark, { foot: 0, streak: 0.1 }));
  // root plate: an upright disc of earth with root knuckles
  const plate = blob(tr * 3.1, { detail: 3, amp: 0.18, seed: r.int(0, 99), squash: [0.32, 0.9, 1] });
  addPainted(parts, plate, '#7c5a3d', { at: [x0 - 0.04, tr * 2.4, 0] }, (c, x, y, z, nx) => { c.lerp(C('#5d432f'), smooth(0.2, 0.9, -nx) * 0.6); c.lerp(C('#8f6b48'), smooth(0.2, 0.8, noise3(y * 4, z * 4, 1)) * 0.4); });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + r.float(-0.3, 0.3);
    const rr = tr * 2.6;
    parts.add(taper([[x0 - 0.05, tr * 2.4 + Math.sin(a) * rr * 0.5, Math.cos(a) * rr * 0.5], [x0 - 0.12, tr * 2.4 + Math.sin(a) * rr * 0.95, Math.cos(a) * rr * 0.95], [x0 - 0.06, tr * 2.4 + Math.sin(a) * rr * 1.25, Math.cos(a) * rr * 1.25]], 0.05, 0.025, { radial: 5 }), shade(colorOf(bark), -0.05));
  }
  // crown: a few limbs and (unless bare) soft clumps resting on the ground
  const skel = rand(o.ctx, 'skeleton');
  const tips = [];
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.7 + skel.float(-0.2, 0.2);
    grow(parts, bark, skel, [x1 - 0.2, tr * 1.6, 0], [Math.cos(a), 0.35 + skel.float(0, 0.3), Math.sin(a)], { len: 0.8, rad: tr * 0.55, levels: 1, kids: [2], shrink: 0.6, spread: 0.6, up: 0.1, minR: 0.02, painter: barkPainter(bark, { foot: 0 }) }, 0, tips);
  }
  if (!bare && o.variant !== 'dead') {
    const conifer = o.variant === 'pine' || o.variant === 'cedar';
    const cols = conifer ? (o.variant === 'cedar' ? ['#28785f', '#43977a', '#174f42'] : ['#2f864a', '#4fa862', '#1b5a38']) : o.variant === 'palm' ? ['#55a84a', '#7cc35d', '#367d3d'] : o.leaves.cols;
    const lr = rand(o.ctx, 'fallen-leaves');
    for (let i = 0; i < 4; i++) {
      const t = tips[i * 2 % tips.length].at;
      const R = lr.float(0.42, 0.55);
      const c = cloud(canopyClumps(lr, R, { rings: [[0, 0.5, 0.5, 5], [0.32, 0.36, 0.44, 3]], crown: 0 }), { detail: 7, k: 0.05, amp: 0.04, seed: lr.int(0, 999), squash: [1, 0.75, 1], flatBottom: R * 0.6 });
      const at = [t[0], Math.max(t[1], R * 0.55), t[2]];
      addPainted(parts, c.geometry, leafLook(cols[0], sway), { at }, canopyPainter(cols, { cy: at[1], ry: R * 0.8, alt: o.leaves.alt, altAmt: 0.3 }));
    }
  }
  return { L, tr };
}

/* ───────────────────────── mushrooms (shared with stumps and logs) ───────────────────────── */

const SHROOM = {
  red: { cap: '#e2473f', capDark: '#b8302f', under: '#f2e3c4', stem: '#f5ecda', dots: '#fbf6ec' },
  brown: { cap: '#a8714a', capDark: '#7d5034', under: '#e8d4b0', stem: '#f1e5cc', dots: null },
  glowing: { cap: '#86e6e0', capDark: '#4fb7c4', under: '#c9f6ef', stem: '#e6f7f1', dots: '#e9fffb', glow: '#6ff3ff' },
};

/** A cluster of mushrooms at `at`. Returns the light position for glowing ones. */
function mushroomCluster(parts, r, { variant = 'red', at = [0, 0, 0], scale = 1, count = 3 } = {}) {
  const M = SHROOM[variant] ?? SHROOM.red;
  const glow = variant === 'glowing';
  const capLook = glow ? { slot: 'lamp', color: M.cap, glow: M.glow, glowAmount: 1.1 } : M.cap;
  const stemLook = glow ? { slot: 'lamp', color: M.stem, glow: '#b8fff6', glowAmount: 0.45 } : M.stem;
  const underLook = glow ? { slot: 'lamp', color: M.under, glow: M.glow, glowAmount: 0.8 } : M.under;
  const dotLook = glow ? { slot: 'lamp', color: M.dots, glow: '#e8ffff', glowAmount: 2.2 } : M.dots;
  const n = clamp(count, 1, 7);
  const a0 = r.angle();
  for (let i = 0; i < n; i++) {
    const big = i === 0;
    const s = scale * (big ? 1 : r.float(0.5, 0.78));
    const a = a0 + i * 2.39996;
    const d = big ? 0 : scale * r.float(0.1, 0.17) * (1 + i * 0.12);
    const x = at[0] + Math.cos(a) * d, z = at[2] + Math.sin(a) * d;
    const h = s * (variant === 'brown' ? 0.15 : 0.13) * r.float(0.9, 1.15);
    const capR = s * (variant === 'brown' ? 0.085 : 0.095);
    const lean = [r.float(-0.12, 0.12), 0, r.float(-0.12, 0.12)];
    const stemR = s * 0.026;
    parts.add(lathe([[stemR * 1.35, 0], [stemR * 1.4, h * 0.12], [stemR * 1.05, h * 0.4], [stemR, h * 0.85], [stemR * 0.95, h], [0, h]], 8), stemLook, { at: [x, at[1], z], rot: lean });
    // cap: a soft dome with a rolled rim
    const capH = capR * (variant === 'brown' ? 0.62 : 0.75);
    const prof = [[capR * 0.9, -capH * 0.06], [capR, capH * 0.12], [capR * 0.92, capH * 0.45], [capR * 0.65, capH * 0.82], [capR * 0.3, capH * 0.98], [0, capH]];
    const capAt = new THREE.Vector3(0, h, 0).applyEuler(new THREE.Euler(...lean)).add(new THREE.Vector3(x, at[1], z));
    const capRot = [lean[0] * 1.4, r.angle(), lean[2] * 1.4];
    const top = C(M.cap), dark = C(M.capDark);
    addPainted(parts, lathe(prof, 13), capLook, { at: capAt.toArray(), rot: capRot }, (c, px, py, pz, nx, ny) => { c.copy(dark).lerp(top, smooth(-0.2, 0.7, ny)); });
    parts.add(lathe([[0, -capH * 0.14], [capR * 0.5, -capH * 0.13], [capR * 0.9, -capH * 0.06]], 13), underLook, { at: capAt.toArray(), rot: capRot });
    if (M.dots) {
      const nd = big ? 6 : 4;
      for (let k = 0; k < nd; k++) {
        const t = r.float(0.25, 0.85), da = r.angle();
        const pr = capR * Math.sin(t * Math.PI * 0.5) * 0.95;
        const py = capH * Math.cos(t * Math.PI * 0.5) * 0.98;
        const local = new THREE.Vector3(Math.cos(da) * pr, py, Math.sin(da) * pr).applyEuler(new THREE.Euler(...capRot)).add(capAt);
        const ds = capR * r.float(0.16, 0.24);
        const nrm = new THREE.Vector3(Math.cos(da) * Math.sin(t * 1.2), Math.cos(t * 1.2), Math.sin(da) * Math.sin(t * 1.2)).applyEuler(new THREE.Euler(...capRot));
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm.normalize());
        parts.add(sphere(ds, 7, 3), dotLook, { matrix: new THREE.Matrix4().compose(local, q, new THREE.Vector3(1, 0.3, 1)) });
      }
    }
  }
  return [at[0], at[1] + 0.12 * scale, at[2]];
}

/* ───────────────────────── grass and blades ───────────────────────── */

/**
 * Blades: thin tapering prisms (a flat back and a ridged front) that lean outward and curve,
 * closed so they need no double-sided material and their normals can lean up to catch the
 * light like the ground. Each blade is `stations` rings of 3 + a tip: (stations - 1) * 6 + 3
 * triangles. uv = (blade index / n, height 0-1).
 */
function bladesGeo(r, { blades = 9, height = 0.2, spread = 0.06, width = 0.035, lean = 0.45, stations = 3, curl = 1.6, minH = 0.65, up = 0.55 } = {}) {
  const pos = [], idx = [], uv = [];
  const a0 = r.angle();
  for (let b = 0; b < blades; b++) {
    const a = a0 + (b / blades) * TAU + r.float(-0.35, 0.35);
    const dist = spread * Math.sqrt(r.float(0.05, 1));
    const bx = Math.cos(a) * dist, bz = Math.sin(a) * dist;
    const h = height * r.float(minH, 1.08);
    const w = width * r.float(0.8, 1.2);
    const out = lean * r.float(0.45, 1.15) * h;
    const face = a + r.float(-0.6, 0.6);
    const ox = Math.cos(face), oz = Math.sin(face); // the blade leans toward its face
    const sx = -oz, sz = ox; // across the blade
    const first = pos.length / 3;
    for (let s = 0; s < stations; s++) {
      const t = s / stations;
      const off = out * Math.pow(t, curl);
      const cx = bx + ox * off, cy = h * t * (1 - 0.15 * t * t), cz = bz + oz * off;
      const wt = w * (1 - t * 0.55) * 0.5;
      const ridge = wt * 0.45;
      // left, ridge (front), right; the back is the flat face right → left
      pos.push(cx - sx * wt, cy, cz - sz * wt, cx + ox * ridge, cy + ridge * 0.2, cz + oz * ridge, cx + sx * wt, cy, cz + sz * wt);
      uv.push(b / blades, t, b / blades, t, b / blades, t);
    }
    pos.push(bx + ox * out, h * 0.85, bz + oz * out);
    uv.push(b / blades, 1);
    for (let s = 0; s < stations - 1; s++) {
      const p = first + s * 3, q = p + 3;
      // front-left, front-right, back
      idx.push(p, q, p + 1, p + 1, q, q + 1);
      idx.push(p + 1, q + 1, p + 2, p + 2, q + 1, q + 2);
      idx.push(p + 2, q + 2, p, p, q + 2, q);
    }
    const last = first + (stations - 1) * 3, tipI = first + stations * 3;
    idx.push(last, tipI, last + 1, last + 1, tipI, last + 2, last + 2, tipI, last);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  bendNormalsUp(g, up);
  return g;
}

/**
 * A thin leaf made two-sided in geometry (a reversed copy shares the up-leaning normals), so it
 * needs no double-sided material and its underside is not lit as if facing down.
 */
function twoSided(g, up = 0.5) {
  g.computeVertexNormals();
  bendNormalsUp(g, up);
  const n = g.attributes.position.count;
  const cat = (a) => { const out = new Float32Array(a.array.length * 2); out.set(a.array); out.set(a.array, a.array.length); return new THREE.Float32BufferAttribute(out, a.itemSize); };
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', cat(g.attributes.position));
  out.setAttribute('normal', cat(g.attributes.normal));
  out.setAttribute('uv', cat(g.attributes.uv));
  const idx = Array.from(g.index.array);
  const back = [];
  for (let i = 0; i < idx.length; i += 3) back.push(idx[i] + n, idx[i + 2] + n, idx[i + 1] + n);
  out.setIndex(idx.concat(back));
  return out;
}

/** Lean normals toward +Y: thin leaves and blades then catch the light like the ground does. */
function bendNormalsUp(g, k) {
  if (!k) return g;
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i).multiplyScalar(1 - k);
    v.y += k;
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

const GRASS = {
  spring: ['#85c965', '#b5e283'],
  summer: ['#6cb453', '#9bd36b'],
  autumn: ['#ada55a', '#d6c672'],
  winter: ['#bdb38a', '#ddd4ab'],
};

/* ───────────────────────── rocks ───────────────────────── */

function rockPainter(base, { moss = false, seed = 0, top = 0.5, bottom = 0 } = {}) {
  const dark = C(shade(base, -0.12)), light = C(shade(base, 0.07)), speck = C(shade(base, -0.05, { hue: 0.03, sat: 0.04 }));
  const m1 = C('#76a548'), m2 = C('#5c8c3e');
  return (c, x, y, z, nx, ny) => {
    c.lerp(dark, (1 - smooth(bottom, lerp(bottom, top, 0.5), y)) * 0.55);
    c.lerp(light, smooth(0.3, 1, ny) * 0.5);
    const n = noise3(x * 3.1 + seed, y * 3.1, z * 3.1 - seed);
    c.lerp(speck, smooth(0.2, 0.5, n) * 0.5);
    if (moss) {
      const m = ny + noise3(x * 3.3 + 9, y * 3.3, z * 3.3 + seed) * 0.65;
      const k = smooth(0.32, 0.5, m);
      if (k > 0) c.lerp(noise3(x * 7, y * 7, z * 7) > 0 ? m1 : m2, k);
    }
  };
}

/** Highest point of a placed geometry within `rad` of (x, z): where a sitter's seat is. */
function topNear(g, x, z, rad) {
  const pos = g.attributes.position;
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i) - x, pos.getZ(i) - z) < rad) top = Math.max(top, pos.getY(i));
  if (top === -Infinity) { g.computeBoundingBox(); top = g.boundingBox.max.y; }
  return top;
}

function rockPiece(parts, r, { at = [0, 0, 0], R = 0.4, squash = [1.15, 0.75, 1], color = '#b5b1a8', moss = false, detail = 5, amp = 0.16, flatTop = null, rot = null }) {
  const g = blob(R, { detail, amp, freq: 1.25, seed: r.int(0, 999), squash, flatBottom: 0.45 });
  if (flatTop != null) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.min(pos.getY(i), flatTop + (pos.getY(i) - flatTop) * 0.15));
    g.computeVertexNormals();
  }
  const bottom = -0.45 * R * squash[1];
  const y = at[1] - bottom - 0.02;
  const placed = addPainted(parts, g, color, { at: [at[0], y, at[2]], rot: rot ?? [0, r.angle(), 0] }, rockPainter(color, { moss, seed: r.float(0, 50), top: y + R * squash[1], bottom: at[1] }));
  return { top: topNear(placed, at[0], at[2], R * 0.3) };
}

/* ───────────────────────── bushes ───────────────────────── */

const BUSH_VARIANTS = ['round', 'flowering', 'hedge', 'berry'];

function bushLeaves(variant, season, r) {
  if (season === 'winter') return variant === 'berry' ? ['#3b7a4b', '#559460', '#265a39'] : LEAF.winter;
  if (season === 'autumn') {
    if (variant === 'round') return r.pick([LEAF.red, LEAF.orange]);
    if (variant === 'flowering') return ['#d98a3a', '#ecae55', '#b2632c'];
    if (variant === 'berry') return ['#3f8248', '#5fa35a', '#2b5f3a'];
    return ['#5f9a46', '#82b85c', '#3f7740'];
  }
  if (season === 'spring') return LEAF.spring;
  if (variant === 'hedge') return ['#4b9a45', '#6eb657', '#2e6b3d'];
  if (variant === 'berry') return ['#3e8a4c', '#5da860', '#28613c'];
  return LEAF.summer;
}

/** A soft rounded box with leafy lumps: hedges. Faces are subdivided so the lumps show. */
function hedgeGeo(L, H, D, { rr = 0.17, amp = 0.045, seed = 0 } = {}) {
  const step = Math.max(0.07, L / 30);
  const f = Math.min(1, 0.07 / step); // long hedges get longer, softer lumps instead of more triangles
  let g = new THREE.BoxGeometry(L, H, D, Math.ceil(L / step), Math.ceil(H / 0.07), Math.ceil(D / 0.07));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const ix = L / 2 - rr, iy = H / 2 - rr, iz = D / 2 - rr;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const qx = clamp(x, -ix, ix), qy = clamp(y, -iy, iy), qz = clamp(z, -iz, iz);
    let dx = x - qx, dy = y - qy, dz = z - qz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    pos.setXYZ(i, qx + dx * rr, qy + dy * rr, qz + dz * rr);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const o = (seed % 97) * 1.37;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // soft leafy bumps: a few big ones plus smaller ones, strongest along the top
    const n = noise3(x * 4.4 * f + o, y * 4.4, z * 4.4) * 0.65 + noise3(x * 1.7 * f - o, y * 1.7, z * 1.7) * 0.6;
    const k = amp * n * smooth(-H / 2, -H / 2 + 0.14, y) * (1 + 0.6 * smooth(0.2, 0.9, nor.getY(i)));
    pos.setXYZ(i, x + nor.getX(i) * k, Math.max(-H / 2, y + nor.getY(i) * k), z + nor.getZ(i) * k);
    uv[i * 2] = n;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // drop the bottom face (it sits on the ground)
  const index = g.index.array, keep = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    if (pos.getY(a) < -H / 2 + 1e-4 && pos.getY(b) < -H / 2 + 1e-4 && pos.getY(c) < -H / 2 + 1e-4) continue;
    keep.push(a, b, c);
  }
  g.setIndex(keep);
  g.computeVertexNormals();
  g.translate(0, H / 2, 0);
  return g;
}

/**
 * A flat flower facing +Y: `n` petals, pointed (star-like, for lilies and leaves) or round
 * (a flat toothed tip, for cosmos, pansies, azaleas), slightly cupped, with an optional inner
 * ring (for a painted face) and a raised eye. uv.x: 0 at the heart … 1 at the petal tips;
 * uv.y: 1 on the eye.
 */
function petalFan(n, rTip, rNotch, { cup = 0.25, lift = 0.004, inner = 0, shape = 'pointed', eye = 0 } = {}) {
  const pos = [0, lift, 0], uv = [0, 0], idx = [];
  const angles = [];
  for (let k = 0; k < n; k++) {
    const c = (k / n) * TAU, h = Math.PI / n;
    angles.push([c - h, rNotch]);
    if (shape === 'round') angles.push([c - h * 0.42, rTip], [c + h * 0.42, rTip]);
    else angles.push([c, rTip]);
  }
  const rim = angles.length;
  const rings = inner ? [inner, 1] : [1];
  rings.forEach((f) => {
    for (const [a, rr0] of angles) {
      const rr = rr0 * f;
      pos.push(Math.cos(a) * rr, cup * rr, Math.sin(a) * rr);
      uv.push(f, 0);
    }
  });
  for (let j = 0; j < rim; j++) idx.push(0, 1 + (j + 1) % rim, 1 + j);
  if (inner) {
    for (let j = 0; j < rim; j++) {
      const a = 1 + j, b = 1 + (j + 1) % rim, c = 1 + rim + j, d = 1 + rim + (j + 1) % rim;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (eye) {
    const c0 = pos.length / 3;
    pos.push(0, lift + eye * 0.55, 0);
    uv.push(0, 1);
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * TAU;
      pos.push(Math.cos(a) * eye, lift + eye * 0.25, Math.sin(a) * eye);
      uv.push(0, 1);
    }
    for (let j = 0; j < 6; j++) idx.push(c0, c0 + 1 + (j + 1) % 6, c0 + 1 + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat oval leaf with a pointed tip along +X, facing +Y, gently cupped (6 triangles). uv.x 0 midrib … 1 edge. */
function leafShape(len, wid) {
  const outline = [[1, 0], [0.62, 0.42], [0.1, 0.5], [-0.42, 0.3], [-0.5, 0], [-0.42, -0.3], [0.1, -0.5], [0.62, -0.42]];
  const pos = [0, 0, 0], uv = [0, 0], idx = [];
  for (const [x, z] of outline) {
    pos.push(x * len * 0.5 + len * 0.25, Math.abs(z) * wid * 0.35, z * wid);
    uv.push(Math.min(1, Math.abs(z) * 2 + 0.3), 0);
  }
  const n = outline.length;
  for (let j = 0; j < n; j++) idx.push(0, 1 + (j + 1) % n, 1 + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Orientation matrix: put a +Y-facing piece at `at`, facing `dir`, spun around it. */
function facing(at, dir, spin = 0, scale = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  return new THREE.Matrix4().compose(new THREE.Vector3(...at), q, new THREE.Vector3(...s));
}

function buildBush(parts, ctx, { variant, season, length, bloom, flower }) {
  const r = rand(ctx, 'bush');
  const cols = bushLeaves(variant, season, rand(ctx, 'bush-autumn'));
  const sway = 0.12;
  const look = leafLook(cols[0], sway);
  if (variant === 'hedge') {
    const L = length, H = 0.72, D = 0.6;
    const [B, Lc, Dk] = cols.map(C);
    const seed = r.float(0, 50);
    addPainted(parts, hedgeGeo(L, H, D, { seed: r.int(0, 999) }), look, undefined, (c, x, y, z, nx, ny, nz, bump) => {
      c.copy(Dk).lerp(B, 0.35 + 0.65 * smooth(0.0, H * 0.55, y));
      c.lerp(Lc, smooth(0.5, 1, ny) * 0.3 + smooth(H * 0.6, H, y) * 0.12);
      c.lerp(bump > 0 ? Lc : Dk, Math.min(1, Math.abs(bump) * 1.4) * 0.35);
      c.offsetHSL(0, 0, noise3(x * 9 + seed, y * 9, z * 9) * 0.03);
    });
    return { w: L, d: D, h: H };
  }
  const R = 0.48;
  const clumps = canopyClumps(r, R, { core: 0.72, rings: [[-0.16, 0.5, 0.52, 5], [0.3, 0.34, 0.48, 4]], crown: 0.46, crownY: 0.46 });
  const cy = R * 0.45 - 0.03;
  const blooming = (variant === 'flowering') && (season === 'spring' || season === 'summer');
  const surf = addCanopy(parts, look, clumps, { detail: variant === 'round' ? 8 : 7, k: 0.026, amp: 0.04, freq: 3.2, seed: r.int(0, 999), squash: [1.08, 1.0, 1.04], flatBottom: R * 0.45 }, [0, cy, 0],
    canopyPainter(cols, { cy: cy + 0.05, ry: R * 0.75, alt: shade(cols[0], 0.1, { hue: -0.025 }), altAmt: 0.3, seed: r.float(0, 40) }));
  const br = rand(ctx, 'blooms');
  if (blooming && flower === 'hydrangea') {
    const B = C(bloom), Bl = C(shade(bloom, 0.1)), Bd = C(shade(bloom, -0.1, { hue: 0.03 }));
    for (const d of spiralDirs(8, -0.05, 0.92, br, 0.6)) {
      const p = surf(d);
      const hue = br.float(-0.04, 0.04);
      addPainted(parts, blob(br.float(0.1, 0.125), { detail: 2, amp: 0.3, freq: 7, seed: br.int(0, 999), squash: [1, 0.85, 1] }), { slot: 'foliage', color: bloom, sway }, { at: [p[0] + d[0] * 0.03, p[1] + d[1] * 0.03, p[2] + d[2] * 0.03] }, (c, x, y, z, nx, ny) => {
        c.copy(Bd).lerp(B, smooth(-0.6, 0.3, ny)).lerp(Bl, smooth(0.3, 1, ny) * 0.6);
        c.offsetHSL(hue, 0, noise3(x * 30, y * 30, z * 30) * 0.05);
      });
    }
  } else if (blooming && flower === 'azalea') {
    const g = petalFan(5, 0.058, 0.034, { cup: 0.3, shape: 'round', eye: 0.013 });
    const B = C(bloom), Bc = C(shade(bloom, -0.12, { hue: 0.02 })), Y = C('#f3d27a');
    for (const d of spiralDirs(56, -0.25, 0.97, br, 0.8)) {
      const p = surf(d);
      addPainted(parts, g, { slot: 'foliage', color: bloom, sway, double: true }, { matrix: facing([p[0] + d[0] * 0.012, p[1] + d[1] * 0.012, p[2] + d[2] * 0.012], d, br.angle(), br.float(0.85, 1.15)) }, (c, x, y, z, nx, ny, nz, u, v) => {
        c.copy(Bc).lerp(B, smooth(0.1, 0.6, u));
        if (v > 0.5) c.copy(Y);
      });
    }
  } else if (variant === 'berry') {
    const berry = bloom;
    const B = C(berry), Bl = C(shade(berry, 0.14));
    for (const d of spiralDirs(9, -0.1, 0.9, br, 0.6)) {
      const p = surf(d);
      for (let k = 0; k < 3; k++) {
        const a = br.angle();
        const q = [p[0] + d[0] * 0.025 + Math.cos(a) * 0.03, p[1] + d[1] * 0.025 + (k - 1) * 0.012, p[2] + d[2] * 0.025 + Math.sin(a) * 0.03];
        addPainted(parts, sphere(0.034, 6, 4), { slot: 'solid', color: berry, sway, rough: 0.45 }, { at: q }, (c, x, y, z, nx, ny) => c.copy(B).lerp(Bl, smooth(0.3, 1, ny) * 0.6));
      }
    }
  }
  return { r: R * 1.15, h: cy + R * 0.95 };
}

/* ───────────────────────── flowers ───────────────────────── */

const SPECIES = ['tulip', 'rose', 'cosmos', 'pansy', 'lily', 'hyacinth', 'windflower', 'mum'];
const FLOWER_COLORS = ['red', 'yellow', 'white', 'pink', 'purple', 'blue', 'orange', 'mixed'];
const SPECIES_MIX = {
  tulip: ['red', 'yellow', 'white', 'pink', 'orange', 'purple'], rose: ['red', 'white', 'yellow', 'pink', 'orange', 'purple'],
  cosmos: ['pink', 'white', 'red', 'yellow', 'orange'], pansy: ['purple', 'yellow', 'blue', 'white', 'orange', 'red'],
  lily: ['white', 'pink', 'orange', 'yellow', 'red'], hyacinth: ['blue', 'purple', 'pink', 'white', 'red', 'yellow'],
  windflower: ['red', 'blue', 'purple', 'white', 'pink', 'orange'], mum: ['yellow', 'white', 'pink', 'red', 'purple', 'orange'],
};
const STEM_H = { tulip: 0.19, rose: 0.2, cosmos: 0.25, pansy: 0.11, lily: 0.25, hyacinth: 0.14, windflower: 0.17, mum: 0.18 };

/** Raise alternate vertices of the top ring of a lathe (petal tips). */
function crown6(g, yTop, lift, n = 6) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - yTop) > 1e-4) continue;
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const j = Math.round(((a + TAU) % TAU) / (TAU / n)) % n;
    if (j % 2 === 0) pos.setY(i, yTop + lift);
  }
  g.computeVertexNormals();
  return g;
}

/** A bloom facing +Y with uv for painting: uv.x 0 (heart) … 1 (petal tips), uv.y 0 petal / 1 inside. */
function bloomGeo(species) {
  switch (species) {
    case 'tulip': {
      const g = lathe([[0, 0], [0.024, 0.014], [0.043, 0.04], [0.044, 0.07], [0.033, 0.092], [0.0, 0.058]], 6);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.min(1, uv.getY(i) * 1.25), uv.getY(i) > 0.9 ? 1 : 0);
      return crown6(g, 0.092, 0.022);
    }
    case 'rose': {
      const g = lathe([[0, 0], [0.034, 0.008], [0.05, 0.034], [0.042, 0.06], [0.018, 0.068], [0, 0.058]], 6);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i)), rr = Math.hypot(pos.getX(i), pos.getZ(i));
        uv.setXY(i, Math.min(1, rr / 0.05), fract(a / TAU * 2 + rr * 22) > 0.62 && pos.getY(i) > 0.04 ? 1 : 0);
      }
      return g;
    }
    case 'cosmos': return petalFan(8, 0.07, 0.022, { cup: 0.2, lift: 0.004, shape: 'round', eye: 0.016 });
    case 'pansy': return petalFan(5, 0.064, 0.05, { cup: 0.14, lift: 0.004, shape: 'round', inner: 0.5, eye: 0.009 });
    case 'windflower': return petalFan(6, 0.064, 0.042, { cup: 0.22, lift: 0.004, shape: 'round', inner: 0.36 });
    case 'lily': {
      const g = petalFan(6, 0.075, 0.03, { cup: 0.55, lift: -0.008, inner: 0.25 });
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const rr = Math.hypot(pos.getX(i), pos.getZ(i));
        if (rr > 0.05) pos.setY(i, pos.getY(i) - (rr - 0.05) * 0.9);
      }
      g.computeVertexNormals();
      return g;
    }
    case 'hyacinth': {
      const g = lathe([[0, 0], [0.03, 0.012], [0.024, 0.032], [0.032, 0.052], [0.024, 0.072], [0.026, 0.09], [0, 0.108]], 5);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const k = Math.round(uv.getY(i) * 6);
        if (k % 2) { const x = pos.getX(i), z = pos.getZ(i), c = Math.cos(0.52), s = Math.sin(0.52); pos.setXYZ(i, x * c - z * s, pos.getY(i), x * s + z * c); }
        uv.setXY(i, uv.getY(i), 0);
      }
      g.computeVertexNormals();
      return g;
    }
    default: { // mum: a soft pom-pom
      const g = sphere(0.05, 7, 5);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const bump = 1 + 0.12 * Math.sin(Math.atan2(z, x) * 7) * Math.sin((y / 0.05 + 1) * 4.5);
        pos.setXYZ(i, x * bump, y * 0.78 + 0.035, z * bump);
        uv.setXY(i, 1 - Math.max(0, y / 0.05) * 0.6, 0);
      }
      g.computeVertexNormals();
      return g;
    }
  }
}

function bloomPainter(species, color) {
  const P = C(color), Pl = C(shade(color, 0.1)), Pd = C(shade(color, -0.12));
  const yellow = C('#f6c93c'), green = C('#8fbf4f'), dark = C('#3b3350'), white = C('#fbf6ee');
  const pale = color === BLOOM.white || color === BLOOM.yellow;
  return (c, x, y, z, nx, ny, nz, u, v) => {
    switch (species) {
      case 'tulip': c.copy(Pd).lerp(P, smooth(0.0, 0.5, u)).lerp(Pl, smooth(0.6, 1, u) * 0.5); if (v > 0.5) c.copy(Pd).lerp(green, 0.25); break;
      case 'rose': c.copy(P).lerp(Pl, smooth(0.6, 1, u) * 0.4); if (v > 0.5) c.lerp(Pd, 0.6); break;
      case 'cosmos': c.copy(Pd).lerp(P, smooth(0.0, 0.6, u)).lerp(Pl, smooth(0.7, 1, u) * 0.4); if (v > 0.5) c.copy(pale ? C('#e9a93a') : yellow); break;
      case 'pansy': c.copy(dark).lerp(P, smooth(0.5, 0.95, u)); if (v > 0.5) c.copy(yellow); break;
      case 'windflower': c.copy(dark).lerp(P, smooth(0.36, 0.75, u)).lerp(Pl, smooth(0.85, 1, u) * 0.3); break;
      case 'lily': c.copy(green).lerp(yellow, smooth(0.0, 0.2, u)).lerp(P, smooth(0.2, 0.7, u)).lerp(Pl, smooth(0.8, 1, u) * 0.3); break;
      case 'hyacinth': c.copy(Pd).lerp(P, smooth(0.0, 0.4, u)).lerp(Pl, smooth(0.6, 1, u) * 0.5); break;
      default: c.copy(Pd).lerp(P, smooth(0.0, 0.5, 1 - u)).lerp(Pl, smooth(0.6, 1, 1 - u) * 0.5);
    }
  };
}

function buildFlowers(parts, ctx, { species, color, count, spread, season }) {
  const r = rand(ctx, 'flowers');
  const look = { slot: 'foliage', color: '#6fae4f', sway: 1.4, double: true, sheen: 0.3 };
  const stemC = '#5f9e45';
  const leafB = C(season === 'autumn' ? '#7f9a48' : '#57a046'), leafL = C(season === 'autumn' ? '#a4b25a' : '#82c35d');
  const spots = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + r.float(-0.3, 0.3);
    const d = count === 1 ? 0 : spread * Math.sqrt((i + 0.5) / count) * r.float(0.85, 1.05);
    spots.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  if (season === 'winter') {
    const brown = '#9b8461';
    const n = Math.min(3, count);
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[i];
      const h = STEM_H[species] * r.float(0.6, 0.85);
      const lean = r.float(-0.04, 0.04);
      parts.add(taper([[x, 0, z], [x + lean * 0.5, h * 0.6, z], [x + lean, h, z + 0.02]], 0.007, 0.005, { radial: 3, tip: false, segments: 2 }), { slot: 'foliage', color: brown, sway: 1.4 });
      parts.add(blob(0.018, { detail: 0, amp: 0.2, seed: i, squash: [1, 1.3, 1] }), { slot: 'foliage', color: '#6f5a3f', sway: 1.4 }, { at: [x + lean, h + 0.012, z + 0.02] });
    }
    return;
  }
  const mix = SPECIES_MIX[species];
  for (let i = 0; i < count; i++) {
    const [x, z] = spots[i];
    const h = STEM_H[species] * r.float(0.82, 1.15);
    const lx = r.float(-0.03, 0.03) + x * 0.1, lz = r.float(-0.02, 0.03) + z * 0.1;
    const top = [x + lx, h, z + lz];
    parts.add(taper([[x, 0, z], [x + lx * 0.4, h * 0.55, z + lz * 0.4], top], 0.0085, 0.0065, { radial: 3, tip: false, segments: 1 }), { ...look, color: stemC });
    const name = color === 'mixed' ? mix[(i + r.int(0, mix.length - 1)) % mix.length] : color;
    const hex = BLOOM[name] ?? colorOr(name, BLOOM.pink);
    const g = bloomGeo(species);
    const tiltDir = new THREE.Vector3(x * 0.6 + lx, 1, z * 0.6 + lz + 0.35).normalize().toArray();
    addPainted(parts, g, { ...look, color: hex }, { matrix: facing([top[0], top[1] - 0.006, top[2]], tiltDir, r.angle(), r.float(0.9, 1.1)) }, bloomPainter(species, hex));
  }
  const leaves = Math.min(7, 3 + Math.ceil(count / 2));
  const broad = species === 'tulip' || species === 'lily' || species === 'hyacinth';
  for (let i = 0; i < leaves; i++) {
    const [sx, sz] = spots[i % spots.length];
    const a = r.angle();
    const len = (broad ? 0.15 : 0.11) * r.float(0.8, 1.15);
    const up = broad ? 0.75 : 0.45;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts = [[sx, 0.004, sz], [sx + dx * len * 0.45, len * up * 0.7, sz + dz * len * 0.45], [sx + dx * len, len * up * 0.55, sz + dz * len]];
    addPainted(parts, ribbon(pts, broad ? 0.055 : 0.045, { side: [-dz, 0, dx], fold: 0.5, segments: 2, widthFn: (t) => (t < 0.99 ? 0.6 + 0.4 * Math.sin(Math.PI * t) : 0) }), { ...look, color: '#5ea24a' }, undefined, (c, x, y, z, nx, ny, nz, u, v) => {
      c.copy(leafB).lerp(leafL, v * 0.7 + (Math.abs(u - 0.5) < 0.1 ? 0.15 : 0));
    });
  }
}

/* ───────────────────────── logs ───────────────────────── */

/** A cut face with growth rings, facing +Y, centered (for log ends and stumps). */
function ringFace(parts, R, at, rot, r) {
  const face = [];
  for (let i = 0; i <= 7; i++) face.push([R * (1 - i / 7), Math.sin((i / 7) * Math.PI * 0.5) * R * 0.04]);
  const L = C(RINGS.light), Rg = C(RINGS.ring), Hh = C(RINGS.heart);
  const off = [r.float(-0.12, 0.12) * R, r.float(-0.12, 0.12) * R];
  const m = xform(at, rot);
  const inv = new THREE.Matrix4().copy(m).invert();
  const v = new THREE.Vector3();
  addPainted(parts, lathe(face, 16), PALETTE.woodLight, { matrix: m }, (c, x, y, z) => {
    v.set(x, y, z).applyMatrix4(inv);
    const d = Math.hypot(v.x - off[0], v.z - off[1]) / R;
    c.copy(L);
    c.lerp(Rg, smooth(0.55, 0.9, Math.cos(d * 24 + noise3(v.x * 6, 0, v.z * 6) * 1.5)) * 0.55);
    c.lerp(Hh, 1 - smooth(0.06, 0.18, d));
    c.lerp(Rg, smooth(0.86, 1, d) * 0.6);
  });
}

function buildLog(parts, ctx, { L, R, moss, mushrooms, season }) {
  const r = rand(ctx, 'log');
  const bark = '#80583a';
  const dark = C(shade(bark, -0.1)), light = C(shade(bark, 0.07)), M1 = C('#77a84a'), M2 = C('#5f8f3f');
  const x0 = -L / 2, x1 = L / 2;
  const sag = r.float(-0.03, 0.03);
  const seed = r.float(0, 40);
  addPainted(parts, taper([[x0, R, 0], [x0 + L * 0.5, R * 1.02, sag], [x1, R * 0.97, 0]], R, R * 0.94, { radial: 16, tip: false, segments: Math.max(6, Math.round(L / 0.12)), rfn: (t) => 1 + 0.03 * Math.sin(t * 17 + seed) }), bark, undefined, (c, x, y, z, nx, ny, nz) => {
    const a = Math.atan2(y - R, z);
    const n = noise3(x * 1.1 + seed, Math.cos(a) * 2.5, Math.sin(a) * 2.5);
    c.lerp(n > 0 ? light : dark, Math.min(1, Math.abs(n) * 2.6) * 0.6);
    c.lerp(dark, (1 - smooth(0.0, R * 0.7, y)) * 0.5);
    if (moss) {
      const m = ny + noise3(x * 3.5 + 7, y * 3.5, z * 3.5) * 0.7;
      c.lerp(noise3(x * 8, y * 8, z * 8) > 0 ? M1 : M2, smooth(0.45, 0.62, m) * 0.95);
    }
  });
  // bark lips and cut faces at both ends
  for (const [x, dir] of [[x0, -1], [x1, 1]]) {
    const rr = x === x0 ? R : R * 0.94;
    parts.add(ring(rr * 0.97, rr * 0.08, { radial: 6, tubular: 18 }), shade(bark, -0.04), { at: [x, R + (x === x1 ? 0 : 0), x === x1 ? 0 : 0], rot: [0, 0, Math.PI / 2] });
    ringFace(parts, rr * 0.93, [x + dir * 0.006, R, 0], [0, 0, -dir * Math.PI / 2], r);
  }
  // a branch stub with a little sprout in the green seasons
  const bx = x0 + L * r.float(0.55, 0.75);
  parts.add(taper([[bx, R * 1.7, -0.02], [bx + 0.06, R * 2.15, -0.05], [bx + 0.08, R * 2.45, -0.07]], R * 0.32, R * 0.22, { radial: 8 }), bark);
  if (season === 'spring' || season === 'summer') {
    const top = [bx + 0.09, R * 2.5, -0.07];
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.6;
      parts.add(ribbon([top, [top[0] + Math.cos(a) * 0.06, top[1] + 0.05, top[2] + Math.sin(a) * 0.06], [top[0] + Math.cos(a) * 0.11, top[1] + 0.04, top[2] + Math.sin(a) * 0.11]], 0.05, { side: [-Math.sin(a), 0, Math.cos(a)], segments: 3 }), { slot: 'foliage', color: '#79bd57', sway: 0.15, double: true });
    }
  }
  if (mushrooms) mushroomCluster(parts, rand(ctx, 'log-shrooms'), { variant: 'brown', at: [x0 + 0.18, 0, R * 1.05], scale: 0.75, count: 3 });
  return { seat: R * 2 };
}

/* ───────────────────────── bamboo ───────────────────────── */

function buildBamboo(parts, ctx, { count, height, season }) {
  const r = rand(ctx, 'bamboo');
  const sway = Math.round((0.012 * (3.2 / height) ** 2) * 10000) / 10000;
  const stalkC = season === 'winter' ? '#79a65a' : season === 'autumn' ? '#8fb34e' : '#6db546';
  const S = C(stalkC), Sl = C(shade(stalkC, 0.1, { hue: -0.02 })), Sd = C(shade(stalkC, -0.1)), node = C('#cfe08a');
  const leafC = season === 'winter' ? '#66a05a' : season === 'autumn' ? '#93b552' : '#66b84f';
  const LB = C(leafC), LL = C(shade(leafC, 0.1, { hue: -0.02 }));
  const leafLookB = { slot: 'foliage', color: leafC, sway, sheen: 0.25 };
  const stalkLook = { slot: 'solid', color: stalkC, sway, rough: 0.55 };
  const a0 = r.angle();
  for (let i = 0; i < count; i++) {
    const a = a0 + i * 2.39996 + r.float(-0.3, 0.3);
    const d = count === 1 ? 0 : 0.08 + 0.22 * Math.sqrt(i / count);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = height * r.float(0.72, 1.05) * (i === 0 ? 1.05 : 1);
    const lean = r.float(0.04, 0.12) * h;
    const la = a + r.float(-0.5, 0.5);
    const top = [x + Math.cos(la) * lean, h, z + Math.sin(la) * lean];
    const nodes = Math.round(h / 0.36);
    const rad = r.float(0.05, 0.064);
    addPainted(parts, taper([[x, -0.02, z], [x + Math.cos(la) * lean * 0.25, h * 0.5, z + Math.sin(la) * lean * 0.25], top], rad, rad * 0.72, { radial: 7, segments: nodes * 2, rfn: (t) => { const f = fract(t * nodes + 0.001); return 1 + 0.15 * (smooth(0.84, 1, f) + 1 - smooth(0, 0.1, f)); } }), stalkLook, undefined, (c, px, py, pz, nx, ny, nz, u, v) => {
      const f = fract(v * nodes);
      c.copy(Sd).lerp(S, 0.6 + 0.4 * v).lerp(Sl, smooth(0.3, 1, nx * 0.6 + nz * 0.8) * 0.3);
      c.lerp(node, (smooth(0.86, 0.97, f) + 1 - smooth(0.0, 0.06, f)) * 0.6);
    });
    // leaf sprays from the upper nodes
    const sprays = 3 + r.int(0, 1);
    for (let k = 0; k < sprays; k++) {
      const t = 0.62 + k * (0.36 / sprays);
      const p = [x + (top[0] - x) * t * t, h * t, z + (top[2] - z) * t * t];
      const sa = r.angle();
      for (let j = 0; j < 4; j++) {
        const la2 = sa + (j - 1.5) * 0.45;
        const len = r.float(0.26, 0.36);
        const dx = Math.cos(la2), dz = Math.sin(la2);
        const pts = [p, [p[0] + dx * len * 0.45, p[1] + 0.05, p[2] + dz * len * 0.45], [p[0] + dx * len, p[1] - len * 0.35, p[2] + dz * len]];
        addPainted(parts, twoSided(ribbon(pts, 0.09, { side: [-dz, 0.3, dx], fold: 0.3, segments: 2, widthFn: (tt) => (tt < 0.99 ? 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, tt * 1.2)) : 0) }), 0.8), leafLookB, undefined, (c, px, py, pz, nx, ny, nz, u, v) => c.copy(LB).lerp(LL, v * 0.6));
      }
    }
  }
  if (season === 'spring') {
    // bamboo shoots poking out of the ground
    for (let i = 0; i < 2; i++) {
      const a = a0 + 1 + i * 2.6, d = 0.38 + i * 0.06;
      const g = lathe([[0.07, 0], [0.068, 0.04], [0.052, 0.1], [0.03, 0.16], [0.01, 0.2], [0, 0.21]], 10);
      const husk = C('#a5884f'), tip = C('#9fbf5a');
      addPainted(parts, g, '#a5884f', { at: [Math.cos(a) * d, -0.01, Math.sin(a) * d], rot: [r.float(-0.1, 0.1), 0, r.float(-0.1, 0.1)], scale: 0.9 + i * 0.25 }, (c, px, py) => {
        c.copy(husk).lerp(tip, smooth(0.1, 0.2, py));
        if (fract(py * 22) > 0.8) c.offsetHSL(0, 0, -0.06);
      });
    }
  }
}

/* ───────────────────────── pumpkins ───────────────────────── */

const PUMPKIN = { orange: '#f08a2e', yellow: '#f2c445', white: '#f1e9d6', green: '#6f9a4a' };

function pumpkinGeo(R, ribs = 9, segments = 24) {
  const H = R * 0.82;
  let g = lathe([[0, -H * 0.5], [R * 0.42, -H * 0.56], [R * 0.82, -H * 0.42], [R, -H * 0.08], [R * 0.95, H * 0.24], [R * 0.72, H * 0.48], [R * 0.35, H * 0.55], [R * 0.12, H * 0.46], [0, H * 0.42]], segments);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const rib = Math.pow(Math.abs(Math.cos(a * ribs / 2)), 0.6);
    const k = 0.9 + 0.1 * rib;
    pos.setXYZ(i, x * k, y, z * k);
    uv[i * 2] = rib;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.translate(0, H * 0.53, 0);
  return { geometry: g, top: H * 0.95 };
}

function pumpkinLeaf(R) {
  const n = 20, pos = [0, 0, 0], uv = [0, 0], idx = [];
  for (let j = 0; j < n; j++) {
    const a = (j / n) * TAU;
    const rr = R * (0.7 + 0.3 * Math.abs(Math.cos(a * 2.5)));
    pos.push(Math.cos(a) * rr, rr * 0.45, Math.sin(a) * rr);
    uv.push(1, 0);
  }
  for (let j = 0; j < n; j++) idx.push(0, 1 + (j + 1) % n, 1 + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildPumpkins(parts, ctx, { count, color, size: S, season }) {
  const r = rand(ctx, 'pumpkins');
  const base = PUMPKIN[color] ?? colorOr(color, PUMPKIN.orange);
  const P = C(base), Pd = C(shade(base, -0.12, { hue: -0.01 })), Pl = C(shade(base, 0.08, { hue: 0.01 }));
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + r.float(-0.3, 0.3);
    const d = count === 1 ? 0 : 0.2 + 0.32 * Math.sqrt(i / count);
    const R = 0.22 * S * (i === 0 ? 1 : r.float(0.6, 0.9));
    const x = Math.cos(a) * d * S, z = Math.sin(a) * d * S;
    const { geometry, top } = pumpkinGeo(R, 8 + (i % 3), Math.round(24 * clamp(R / 0.22, 1, 1.75)));
    addPainted(parts, geometry, base, { at: [x, -0.01, z], rot: [r.float(-0.08, 0.08), r.angle(), r.float(-0.08, 0.08)] }, (c, px, py, pz, nx, ny, nz, rib) => {
      c.copy(Pd).lerp(P, smooth(0.0, 0.7, rib)).lerp(Pl, smooth(0.3, 1, ny) * 0.4 * rib);
    });
    const tilt = r.float(-0.3, 0.3);
    parts.add(taper([[x, top - 0.02, z], [x + 0.01 * S, top + 0.05 * S, z], [x + 0.04 * S + tilt * 0.02, top + 0.09 * S, z + 0.01]], 0.028 * S, 0.02 * S, { radial: 6 }), '#7a6a3a');
    out.push([x, z, R]);
  }
  // leaves and a curly vine
  if (season !== 'winter') {
    const leafC = season === 'autumn' ? '#b3ae4e' : '#6fb24f';
    const LB = C(shade(leafC, 0.06)), LD = C(shade(leafC, -0.1));
    const n = Math.min(5, 2 + count);
    for (let i = 0; i < n; i++) {
      const [px, pz, R] = out[i % out.length];
      const a = r.angle();
      const d = R + 0.12 * S;
      addPainted(parts, bendNormalsUp(pumpkinLeaf(0.15 * S * r.float(0.85, 1.15)), 0.4), { slot: 'foliage', color: leafC, sway: 0.5, double: true, sheen: 0.3 }, { at: [px + Math.cos(a) * d, 0.03 + r.float(0, 0.05) * S, pz + Math.sin(a) * d], rot: [r.float(-0.3, 0.3), r.angle(), r.float(-0.3, 0.3)] }, (c, x, y, z, nx, ny, nz, u) => c.copy(LD).lerp(LB, u));
    }
  }
  const vr = rand(ctx, 'vine');
  const [vx, vz] = out[0];
  const pts = [];
  let va = vr.angle(), px0 = vx + Math.cos(va) * 0.18 * S, pz0 = vz + Math.sin(va) * 0.18 * S;
  for (let k = 0; k <= 9; k++) {
    pts.push([px0, 0.018, pz0]);
    va += vr.float(0.5, 1.1) * (k % 4 < 2 ? 1 : -1);
    px0 += Math.cos(va) * 0.09 * S;
    pz0 += Math.sin(va) * 0.09 * S;
  }
  parts.add(taper(pts, 0.014 * S, 0.008 * S, { radial: 4, segments: 16 }), season === 'winter' ? '#8a7a55' : '#6a8a3a');
  return out;
}

/* ───────────────────────── leaf piles ───────────────────────── */

const LEAF_PILE = ['#e8873a', '#dc5a3b', '#efc243', '#c9682f', '#b98a3e'];

function buildLeafpile(parts, ctx, { size: S, season }) {
  const r = rand(ctx, 'leafpile');
  const tones = season === 'winter' ? ['#a77a4a', '#94683f', '#b98d55', '#8a6a48', '#9c7a50'] : LEAF_PILE;
  const cols = tones.map(C);
  const R = 0.5 * S;
  const g = blob(R, { detail: 6, amp: 0.14, freq: 2.0, seed: r.int(0, 999), squash: [1.12, 0.72, 1.0], flatBottom: 0.2 });
  const y0 = R * 0.72 * 0.2 - 0.01;
  const seed = r.float(0, 30);
  const mound = addPainted(parts, g, tones[0], { at: [0, y0, 0] }, (c, x, y, z, nx, ny) => {
    const n = noise3(x * 6 + seed, y * 6, z * 6);
    c.copy(cols[0]).lerp(cols[n > 0 ? 2 : 1], Math.min(1, Math.abs(n) * 2.2) * 0.6).lerp(cols[3], smooth(-0.2, -0.9, ny) * 0.5);
    c.offsetHSL(0, 0, ny * 0.03 - 0.04);
  });
  // leaves scattered over the mound (on its own vertices) and a few strays on the ground
  const leaf = leafShape(0.12, 0.07);
  const look = { slot: 'foliage', color: tones[0], sway: 0, double: true, sheen: 0.2 };
  const mp = mound.attributes.position, mn = mound.attributes.normal;
  const n = 84;
  for (let i = 0; i < n; i++) {
    let at, dir;
    if (i < 70) {
      let k = 0, tries = 0;
      do { k = r.int(0, mp.count - 1); tries++; } while (mn.getY(k) < 0.25 && tries < 12);
      dir = [mn.getX(k) + r.float(-0.3, 0.3), mn.getY(k) + 0.2, mn.getZ(k) + r.float(-0.3, 0.3)];
      at = [mp.getX(k) + mn.getX(k) * 0.018, mp.getY(k) + mn.getY(k) * 0.018, mp.getZ(k) + mn.getZ(k) * 0.018];
    } else {
      const a = r.angle(), d = R * r.float(1.1, 1.7);
      at = [Math.cos(a) * d * 1.1, 0.01, Math.sin(a) * d];
      dir = [r.float(-0.25, 0.25), 1, r.float(-0.25, 0.25)];
    }
    const tint = cols[r.int(0, 4)];
    addPainted(parts, leaf, look, { matrix: facing(at, dir, r.angle(), S * r.float(0.85, 1.3)) }, (c, px, py, pz, nx, ny, nz, u) => { c.copy(tint).offsetHSL(0, 0, (u - 0.6) * 0.08); });
  }
  return { r: R * 1.5, h: y0 + R * 0.72 };
}

/* ───────────────────────── cacti ───────────────────────── */

const CACTUS_VARIANTS = ['saguaro', 'barrel', 'prickly'];

/** A ribbed column with a rounded top (and enough rings for painted areole dots). uv.x = rib 0 (valley) … 1 (ridge). */
function ribbedColumn(R, H, ribs = 10, { top = 0.9 } = {}) {
  const prof = [[R * 0.82, -0.02], [R * 0.97, 0.04]];
  const steps = Math.max(3, Math.round((H - R * top) / 0.11));
  for (let i = 1; i <= steps; i++) prof.push([R, 0.04 + (H - R * top - 0.04) * (i / steps)]);
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * Math.PI / 2;
    prof.push([R * Math.cos(a), H - R * top + R * top * Math.sin(a)]);
  }
  let g = lathe(prof, ribs * 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const rib = Math.pow(Math.abs(Math.cos(a * ribs / 2)), 0.7);
    const k = 0.88 + 0.12 * rib;
    pos.setXYZ(i, x * k, y, z * k);
    uv[i * 2] = rib;
    uv[i * 2 + 1] = y;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function cactusPainter(base) {
  const B = C(base), L = C(shade(base, 0.1, { hue: -0.02 })), D = C(shade(base, -0.12));
  return (c, x, y, z, nx, ny, nz, rib) => {
    c.copy(D).lerp(B, smooth(0.0, 0.6, rib)).lerp(L, smooth(0.75, 1, rib) * 0.5);
  };
}

/** Soft little areoles (dots instead of spikes) on a cactus surface: points + outward normals. */
function areoles(parts, pts) {
  const dot = sphere(0.015, 5, 2);
  for (const [at, n] of pts) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n).normalize());
    parts.add(dot, '#f4efdc', { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...at), q, new THREE.Vector3(1, 0.45, 1)) });
  }
}

/** Areole spots on the ridges of a ribbed column of radius R from y0 to y1. */
function ridgeDots(R, ribs, y0, y1, r, step = 0.16) {
  const out = [];
  for (let k = 0; k < ribs; k++) {
    const a = (k * TAU) / ribs; // ridges sit where |cos(a * ribs / 2)| = 1
    const off = r.float(0, step);
    for (let y = y0 + off; y < y1; y += step) out.push([[Math.cos(a) * R, y, Math.sin(a) * R], [Math.cos(a), 0, Math.sin(a)]]);
  }
  return out;
}

function buildCactus(parts, ctx, { variant, season, flowers }) {
  const r = rand(ctx, 'cactus');
  const base = '#5ea558';
  const bloom = season === 'spring' || season === 'summer';
  const flowerAt = (at, dir, color, s = 1) => {
    addPainted(parts, petalFan(8, 0.06 * s, 0.028 * s, { cup: 0.45, shape: 'round', eye: 0.014 * s }), { slot: 'foliage', color, double: true, sheen: 0.3, sway: 0 }, { matrix: facing(at, dir, r.angle()) }, (c, px, py, pz, nx, ny, nz, u, v) => {
      c.copy(C(shade(color, -0.08))).lerp(C(color), smooth(0.1, 0.6, u));
      if (v > 0.5) c.copy(C('#f3d36a'));
    });
  };
  if (variant === 'barrel') {
    const R = 0.26, H = 0.42;
    addPainted(parts, ribbedColumn(R, H, 12, { top: 0.75 }), base, { scale: [1, 1, 1] }, cactusPainter(shade(base, 0.02, { hue: 0.02 })));
    areoles(parts, ridgeDots(R, 12, 0.08, H - R * 0.6, r, 0.1));
    if (bloom && flowers) for (let i = 0; i < 3; i++) { const a = r.angle(); flowerAt([Math.cos(a) * 0.06, H + 0.005, Math.sin(a) * 0.06], [Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4], i % 2 ? '#f6c84a' : '#f58fb0', 0.8); }
    return { r: R * 1.1, h: H };
  }
  if (variant === 'prickly') {
    const pad = (at, rot, s) => {
      const g = blob(0.2 * s, { detail: 3, amp: 0.05, seed: r.int(0, 99), squash: [1, 1.25, 0.32] });
      const B = C(base), L = C(shade(base, 0.08));
      const placed = addPainted(parts, g, base, { at, rot }, (c, x, y, z, nx, ny) => {
        c.copy(B).lerp(L, smooth(0.2, 1, ny) * 0.4);
      });
      // dots on both faces of the pad
      const pp = placed.attributes.position, pn = placed.attributes.normal, dots = [];
      for (let k = 0; k < 9; k++) {
        const i = r.int(0, pp.count - 1);
        dots.push([[pp.getX(i), pp.getY(i), pp.getZ(i)], [pn.getX(i), pn.getY(i), pn.getZ(i)]]);
      }
      areoles(parts, dots);
    };
    pad([0, 0.22, 0], [0, 0.2, 0], 1);
    pad([-0.17, 0.52, 0.02], [0, 0.3, 0.45], 0.85);
    pad([0.16, 0.55, -0.02], [0, -0.2, -0.4], 0.8);
    pad([0.02, 0.78, 0.0], [0, 0.6, 0.1], 0.65);
    const rims = [[-0.3, 0.72, 0.02], [0.28, 0.75, -0.03], [0.04, 1.0, 0.0], [-0.08, 0.95, 0.03]];
    for (const p of rims) {
      if (bloom && flowers) flowerAt(p, [p[0], 1, 0.2], '#f6c84a', 0.75);
      else if (season === 'autumn') parts.add(sphere(0.035, 8, 6), { slot: 'solid', color: '#c8346a', rough: 0.5 }, { at: [p[0], p[1] + 0.02, p[2]], scale: [1, 1.3, 1] });
    }
    return { r: 0.4, h: 1.05 };
  }
  // saguaro: a tall ribbed column with two arms raised
  const H = 1.7, R = 0.17;
  addPainted(parts, ribbedColumn(R, H, 10), base, undefined, cactusPainter(base));
  areoles(parts, ridgeDots(R, 10, 0.12, H - R * 0.5, r, 0.24));
  const arms = [[0.62, 0.55, 1, 0.42], [0.95, 0.45, -1, 0.32]];
  for (const [y0, len, side, rise] of arms) {
    const a = r.float(-0.4, 0.4) + (side > 0 ? 0 : Math.PI);
    const dx = Math.cos(a), dz = Math.sin(a);
    const rr = R * 0.68;
    const pts = [[dx * R * 0.5, y0, dz * R * 0.5], [dx * (R + rr * 1.4), y0 + 0.02, dz * (R + rr * 1.4)], [dx * (R + rr * 2.1), y0 + rise * 0.55, dz * (R + rr * 2.1)], [dx * (R + rr * 2.2), y0 + rise + len * 0.4, dz * (R + rr * 2.2)]];
    const painter = cactusPainter(base);
    addPainted(parts, taper(pts, rr, rr * 0.92, { radial: 14, segments: 12 }), base, undefined, (c, x, y, z, nx, ny, nz, u) => painter(c, x, y, z, nx, ny, nz, Math.pow(Math.abs(Math.cos(u * TAU * 4)), 0.7)));
  }
  if (bloom && flowers) flowerAt([0, H + 0.005, 0], [0.1, 1, 0.25], '#f58fb0', 1.1);
  return { r: 0.6, h: H };
}

/* ───────────────────────── sunflowers ───────────────────────── */

function buildSunflowers(parts, ctx, { count, height, season }) {
  const r = rand(ctx, 'sunflowers');
  const winter = season === 'winter', autumn = season === 'autumn', spring = season === 'spring';
  const stemC = winter ? '#9b8661' : autumn ? '#8f9a4a' : '#5f9e3f';
  const leafC = winter ? '#a08a62' : autumn ? '#9aa24c' : '#5fa847';
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + r.float(-0.3, 0.3);
    const d = count === 1 ? 0 : 0.12 + 0.2 * Math.sqrt(i / count);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const H = height * r.float(0.82, 1.1) * (spring ? 0.55 : 1) * (i === 0 ? 1.06 : 1);
    const lean = r.float(-0.06, 0.06);
    const top = [x + lean, H, z + 0.04];
    const sway = Math.round((0.05 / (height * height)) * 1000) / 1000;
    const plant = { slot: 'foliage', color: stemC, sway, sheen: 0.25 };
    parts.add(taper([[x, 0, z], [x + lean * 0.3, H * 0.5, z], [top[0], top[1], top[2]]], 0.03, 0.022, { radial: 6, tip: false }), plant);
    // big heart-shaped leaves along the stem
    const LB = C(leafC), LL = C(shade(leafC, 0.08));
    for (let k = 0; k < 3; k++) {
      const t = 0.3 + k * 0.2;
      const la = a + k * 2.1 + r.float(-0.3, 0.3);
      const at = [x + lean * t * 0.3, H * t, z];
      const g = twoSided(leafShape(0.44 * (1 - k * 0.15), 0.3 * (1 - k * 0.15)), 0.5);
      const droop = winter ? 0.9 : 0.35;
      addPainted(parts, g, recolor(plant, leafC), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -la, -droop)), new THREE.Vector3(1, 1, 1)) }, (c, px, py, pz, nx, ny, nz, u) => c.copy(LB).lerp(LL, (1 - u) * 0.5));
    }
    // the head: a dark seed disc in a ring of yellow petals, facing the front and nodding
    const nod = winter ? 1.25 : autumn ? 0.75 : spring ? 0.1 : 0.35;
    const dir = [lean * 0.5, Math.cos(nod), Math.sin(nod) + 0.15];
    const m = facing(top, dir, r.angle());
    if (spring) {
      addPainted(parts, sphere(0.07, 9, 7), recolor(plant, '#6ea849'), { matrix: m.clone().multiply(new THREE.Matrix4().makeScale(1, 0.8, 1)) }, (c, px, py, pz, nx, ny) => c.offsetHSL(0, 0, ny * 0.05));
      continue;
    }
    const discR = 0.15;
    const seedDark = C(winter ? '#4a3726' : '#5a3a22'), seedLight = C(winter ? '#6d5236' : '#8a5a2c');
    addPainted(parts, lathe([[discR, 0.0], [discR * 0.9, 0.02], [discR * 0.6, 0.035], [discR * 0.3, 0.042], [0, 0.044]], 15), { slot: 'solid', color: '#5a3a22', sway }, { matrix: m }, (c, px, py, pz) => {
      c.copy(seedDark).lerp(seedLight, smooth(0.2, 0.6, noise3(px * 40, py * 40, pz * 40)) * 0.6);
    });
    parts.add(lathe([[0, -0.05], [discR * 0.55, -0.045], [discR * 1.02, -0.012], [discR, 0.0]], 12), recolor(plant, winter ? '#8a7350' : '#4f8f3a'), { matrix: m });
    if (!winter) {
      const petal = autumn ? '#e9a93a' : '#f7cc33';
      const P = C(petal), Pd = C(shade(petal, -0.1, { hue: -0.02 }));
      for (let ring = 0; ring < 2; ring++) {
        const g = petalFan(13, discR * (ring ? 2.05 : 2.3), discR * 1.05, { cup: ring ? 0.1 : 0.05, lift: -0.006 - ring * 0.006 });
        addPainted(parts, g, { slot: 'foliage', color: petal, sway, double: true, sheen: 0.25 }, { matrix: m.clone().multiply(new THREE.Matrix4().makeRotationY(ring * 0.12 + 0.05)) }, (c, px, py, pz, nx, ny, nz, u) => c.copy(Pd).lerp(P, smooth(0.45, 1, u)));
      }
    }
  }
  return { r: 0.35, h: height };
}

/* ───────────────────────── vegetable patch ───────────────────────── */

const CROPS = ['carrot', 'cabbage', 'turnip', 'tomato', 'mixed'];

function buildGarden(parts, ctx, { crop, length, rows, season }) {
  const r = rand(ctx, 'garden');
  const W = length, D = 0.42 * rows + 0.2;
  const wood = PALETTE.wood;
  // a low wooden frame filled with soft soil
  const plank = 0.07, ph = 0.16;
  parts.add(roundBox(W, ph, plank, 0.02, 1), wood, { at: [0, 0, D / 2 - plank / 2] });
  parts.add(roundBox(W, ph, plank, 0.02, 1), wood, { at: [0, 0, -D / 2 + plank / 2] });
  parts.add(roundBox(plank, ph, D - plank * 2 + 0.01, 0.02, 1), shade(wood, -0.04), { at: [W / 2 - plank / 2, 0, 0] });
  parts.add(roundBox(plank, ph, D - plank * 2 + 0.01, 0.02, 1), shade(wood, -0.04), { at: [-W / 2 + plank / 2, 0, 0] });
  const soil = C('#7b5636'), soilD = C('#5f4129');
  addPainted(parts, roundBox(W - plank * 1.6, 0.1, D - plank * 1.6, 0.03, 1), '#654730', undefined, (c, x, y, z) => c.offsetHSL(0, 0, noise3(x * 7, y * 7, z * 7) * 0.04));
  for (let row = 0; row < rows; row++) {
    const z = -D / 2 + 0.1 + 0.21 + row * 0.42;
    addPainted(parts, roundBox(W - plank * 2 - 0.06, 0.06, 0.26, 0.03, 1), '#7b5636', { at: [0, 0.07, z] }, (c, x, y) => {
      c.copy(soilD).lerp(soil, smooth(0.08, 0.13, y));
      c.offsetHSL(0, 0, noise3(x * 9, y * 9, z * 9) * 0.04);
    });
  }
  const topY = 0.13;
  // plants every ~0.32, but at most 24 in a bed so big beds stay light
  const cols = Math.max(1, Math.min(Math.round((W - 0.2) / 0.32), Math.floor(24 / rows)));
  const kinds = crop === 'mixed' ? ['cabbage', 'carrot', 'turnip', 'tomato'] : [crop];
  const leafC = season === 'autumn' ? '#7fa748' : '#5faa45';
  const leafLookG = { slot: 'foliage', color: leafC, sway: 0.6, sheen: 0.25 };
  const LB = C(leafC), LL = C(shade(leafC, 0.1));
  const sprout = season === 'spring';
  for (let row = 0; row < rows; row++) {
    const kind = kinds[row % kinds.length];
    const z = -D / 2 + 0.1 + 0.21 + row * 0.42;
    for (let i = 0; i < cols; i++) {
      const x = -W / 2 + 0.1 + (W - 0.2) * ((i + 0.5) / cols) + r.float(-0.03, 0.03);
      if (season === 'winter') continue;
      const leaves = (n, len, up = 0.75) => {
        const g = bladesGeo(r, { blades: n, height: len, spread: 0.02, width: 0.05, lean: 0.55, stations: 3, up });
        addPainted(parts, g, leafLookG, { at: [x, topY, z] }, (c, px, py, pz, nx, ny, nz, u, v) => c.copy(LB).lerp(LL, v * 0.6));
      };
      if (sprout) { leaves(4, 0.07); continue; }
      if (kind === 'carrot') {
        parts.add(lathe([[0.022, 0], [0.034, 0.02], [0.036, 0.034], [0.02, 0.042], [0, 0.043]], 8), '#f08a2e', { at: [x, topY - 0.022, z] });
        leaves(5, 0.16);
      } else if (kind === 'turnip') {
        addPainted(parts, sphere(0.06, 9, 6), '#f4efe6', { at: [x, topY + 0.02, z], scale: [1, 0.85, 1] }, (c, px, py) => c.lerp(C('#b65aa6'), smooth(topY + 0.01, topY + 0.06, py) * 0.85));
        leaves(5, 0.14);
      } else if (kind === 'cabbage') {
        const head = blob(0.085, { detail: 1, amp: 0.06, seed: r.int(0, 99), squash: [1, 0.85, 1] });
        const CB = C('#a8d57a'), CL = C('#cfe9a2');
        addPainted(parts, head, { slot: 'foliage', color: '#a8d57a', sheen: 0.3 }, { at: [x, topY + 0.06, z] }, (c, px, py, pz, nx, ny) => c.copy(CB).lerp(CL, smooth(0.2, 1, ny) * 0.6));
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + r.float(-0.2, 0.2);
          addPainted(parts, twoSided(leafShape(0.15, 0.12), 0.5), { slot: 'foliage', color: '#79b856', sway: 0.3, sheen: 0.25 }, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, topY + 0.015, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0.5)), new THREE.Vector3(1, 1, 1)) }, (c, px, py, pz, nx, ny, nz, u) => c.lerp(C('#9fd27a'), (1 - u) * 0.4));
        }
      } else {
        // tomato: a staked bushy plant with red fruit
        parts.add(cyl(0.012, 0.55, { segments: 5 }), PALETTE.woodLight, { at: [x + 0.05, topY - 0.02, z - 0.03] });
        const bush = canopyClumps(r, 0.13, { rings: [[0, 0.5, 0.5, 4]], crown: 0.45, crownY: 0.4 });
        addCanopy(parts, { slot: 'foliage', color: leafC, sway: 0.3, sheen: 0.25 }, bush, { detail: 1, k: 0.02, amp: 0.08, seed: r.int(0, 999), squash: [1, 1.5, 1] }, [x, topY + 0.25, z], canopyPainter([leafC, shade(leafC, 0.1), shade(leafC, -0.12)], { cy: topY + 0.25, ry: 0.2 }));
        for (let k = 0; k < 2; k++) {
          const a = r.angle();
          parts.add(sphere(0.045, 7, 4), { slot: 'solid', color: season === 'summer' || k ? '#e2412f' : '#8cc152', rough: 0.4, sway: 0.3 }, { at: [x + Math.cos(a) * 0.11, topY + 0.16 + k * 0.09, z + Math.sin(a) * 0.11] });
        }
      }
    }
  }
  return { w: W, d: D };
}

/* ───────────────────────── the catalog ───────────────────────── */

export const NATURE = {
  tree: {
    label: 'Tree',
    about: 'A tree in any season. The round tree is the classic soft lumpy one; fruit and cherry trees blossom in spring, broadleaf trees turn orange, red or yellow in autumn and are bare in winter, conifers and palms stay green. Can also be a bare tree, a stump to sit on or a fallen tree.',
    params: {
      variant: { default: 'round', options: TREE_VARIANTS, about: 'kind of tree' },
      size: { default: 1, min: 0.4, max: 2.2, about: 'scale (1 is a full-grown tree)' },
      fruit: { default: 'auto', options: FRUIT_OPTIONS, about: 'fruit on fruit trees (apple by default), coconuts on palms; auto picks by variant' },
      leaves: { default: null, type: 'color', about: 'leaf color override (any season but winter)' },
      state: { default: 'healthy', options: TREE_STATES, about: 'healthy, bare (no leaves), stump (cut, to sit on) or fallen' },
    },
    examples: [
      { variant: 'round' }, { variant: 'oak' }, { variant: 'pine' }, { variant: 'palm' },
      { variant: 'fruit', fruit: 'peach' }, { variant: 'cherry' }, { variant: 'birch' }, { variant: 'willow' },
    ],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const variant = oneOf(p.variant, TREE_VARIANTS, 'round');
      const state = oneOf(p.state, TREE_STATES, 'healthy');
      const S = size(p.size, 1, 0.3, 3);
      const r = rand(ctx, 'tree');
      const leavesOverride = colorOr(p.leaves, null, BLOOM);
      let fruit = oneOf(p.fruit, FRUIT_OPTIONS, 'auto');
      if (fruit === 'auto') fruit = variant === 'fruit' ? 'apple' : variant === 'palm' ? 'coconut' : 'none';
      if (variant === 'palm' && fruit !== 'none') fruit = 'coconut';
      if (variant !== 'palm' && fruit === 'coconut') fruit = 'apple';
      if (['pine', 'cedar', 'dead', 'birch', 'willow'].includes(variant)) fruit = 'none';
      const bare = variant === 'dead' || state === 'bare' || (DECIDUOUS.has(variant) && season === 'winter');
      const sway = swayFor(S, variant === 'palm' ? 0.03 : 0.02);
      const o = {
        ctx, r, variant, season, bare, sway, fruit, leavesOverride,
        bark: { slot: 'solid', color: BARK[variant], sway },
        leaves: treeLeaves(variant, season, rand(ctx, 'autumn'), season === 'winter' ? null : leavesOverride),
      };
      const parts = new Parts();
      let spots, footprint, height;
      if (state === 'stump') {
        const R = { oak: 0.34, palm: 0.2, birch: 0.2, cedar: 0.22, pine: 0.22 }[variant] ?? 0.26;
        const seat = stumpParts(parts, r, { bark: BARK[variant], R, H: 0.3, ctx });
        spots = { seat: spot([0, seat * S, Math.max(0.02, R * S * 0.88 - 0.12)], 0, 'sit'), side: spot([0, 0, (R * 1.25 + 0.3) * S], 180, 'stand') };
        footprint = { r: R * 1.35 * S };
        height = seat * S;
      } else if (state === 'fallen') {
        const f = fallenTree(parts, o);
        const n = Math.max(1, Math.floor((f.L * 0.6) / 0.55));
        spots = {};
        for (let i = 0; i < n; i++) {
          const x = (-f.L / 2 + f.L * 0.22 + i * 0.55) * S;
          spots[`seat${i + 1}`] = spot([x, f.tr * 2 * S, 0.02 * S], 0, 'sit');
        }
        spots.rest = spot([-0.1 * S, 0, (f.tr + 0.14) * S], 0, 'floor');
        footprint = { w: (f.L + 1.4) * S, d: 1.8 * S };
        height = 1.2 * S;
      } else {
        const info = TREES[variant](parts, o);
        const t = info.trunkR * S, u = Math.max(info.under * S, t + 0.55);
        const q = Math.SQRT1_2;
        const skirt = (variant === 'pine' || variant === 'cedar') && !bare;
        if (skirt) {
          // the skirts come down low: stand and sit at their edge, facing out
          const e = info.reach * S + 0.18;
          spots = {
            trunk: spot([0, 0, e], 0, 'lean'),
            under: spot([-e * q, 0, e * q], -45, 'stand'),
            under2: spot([e * q, 0, -e * q], 135, 'stand'),
            rest: spot([e + 0.05, 0, 0], 90, 'floor'),
            shake: spot([-(e + 0.25), 0, 0], 90, 'stand'),
          };
        } else spots = {
          trunk: spot([0, 0, t + 0.13], 0, 'lean'),
          under: spot([-u * q, 0, u * q], -45, 'stand'),
          under2: spot([u * q, 0, -u * q], 135, 'stand'),
          rest: spot([t + 0.16, 0, -0.04], 90, 'floor'),
          shake: spot([-(t + 0.4), 0, -0.08], 90, 'stand'),
        };
        footprint = { r: Math.max(0.35, t * 2) * S };
        height = info.height * S;
      }
      const out = S === 1 ? parts : new Parts().merge(parts, xform([0, 0, 0], [0, 0, 0], S));
      return finish(out.build(`tree-${variant}`), { footprint, spots, height });
    },
  },

  stump: {
    label: 'Stump',
    about: 'A cut tree stump with growth rings on top: a seat in the woods. Can be mossy, with a few mushrooms.',
    params: {
      size: { default: 1, min: 0.5, max: 2, about: 'scale' },
      bark: { default: '#7d5537', type: 'color', about: 'bark color' },
      moss: { default: false, about: 'moss patches on the bark' },
      mushrooms: { default: false, about: 'a little cluster of mushrooms at its foot' },
    },
    examples: [{}, { moss: true, mushrooms: true }, { size: 0.7, bark: '#8d7d6c' }, { size: 1.4, bark: '#6e4335', moss: true }],
    build(p, ctx) {
      const S = size(p.size, 1, 0.4, 2.5);
      const parts = new Parts();
      const r = rand(ctx, 'stump');
      const R = 0.28;
      const seat = stumpParts(parts, r, { bark: colorOr(p.bark, '#7d5537'), R, H: 0.3, moss: flag(p.moss, false), mushrooms: flag(p.mushrooms, false), ctx });
      const out = S === 1 ? parts : new Parts().merge(parts, xform([0, 0, 0], [0, 0, 0], S));
      return finish(out.build('stump'), {
        footprint: { r: R * 1.35 * S },
        spots: { seat: spot([0, seat * S, Math.max(0.02, R * S * 0.88 - 0.12)], 0, 'sit'), side: spot([0, 0, (R * 1.3 + 0.3) * S], 180, 'stand') },
        height: seat * S,
      });
    },
  },

  grass: {
    label: 'Grass tuft',
    about: 'A small tuft of soft grass blades that waves in the wind, for scattering by the hundred. Green in spring and summer, golden in autumn, dry straw poking out of the snow in winter.',
    params: {
      height: { default: 0.2, min: 0.08, max: 0.5, about: 'blade height' },
      blades: { default: 8, min: 3, max: 10, about: 'number of blades (10 keeps a tuft under 150 triangles)' },
      sway: { default: 1, min: 0, max: 3, about: 'how much it waves in the wind' },
      color: { default: null, type: 'color', about: 'color override (default: the season\'s grass)' },
    },
    examples: [{}, { height: 0.3, blades: 10 }, { height: 0.12, blades: 6 }, { color: '#9fd06a' }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const r = rand(ctx, 'grass');
      const h = num(p.height, 0.2, 0.05, 0.8);
      const n = int(p.blades, 8, 3, 10);
      const sw = num(p.sway, 1, 0, 4);
      const over = colorOr(p.color, null, BLOOM);
      const [base, tip] = over ? [shade(over, -0.08), shade(over, 0.08)] : GRASS[season];
      const B = C(shade(base, -0.03)), T = C(tip);
      const parts = new Parts();
      const g = bladesGeo(r, { blades: n, height: h, spread: 0.05 + h * 0.1, width: 0.038 + h * 0.06, lean: 0.4 });
      addPainted(parts, g, { slot: 'foliage', color: base, sway: Math.round(1.6 * sw * 100) / 100, sheen: 0.3 }, undefined, (c, x, y, z, nx, ny, nz, u, v) => {
        c.copy(B).lerp(T, smooth(0.0, 1.0, v));
        c.offsetHSL(0, 0, (fract(u * 7.31) - 0.5) * 0.03);
      });
      return finish(parts.build('grass'), { footprint: { r: 0.08 + h * 0.2 }, spots: {} });
    },
  },

  rock: {
    label: 'Rock',
    about: 'Rocks: a round boulder, a flat sitting stone, a cluster, a mossy boulder or a scatter of pebbles.',
    params: {
      variant: { default: 'boulder', options: ['boulder', 'flat', 'cluster', 'mossy', 'pebbles'], about: 'kind of rock' },
      size: { default: 1, min: 0.3, max: 3, about: 'scale' },
      color: { default: '#b5b1a8', type: 'color', about: 'stone color' },
    },
    examples: [{ variant: 'boulder' }, { variant: 'flat' }, { variant: 'cluster' }, { variant: 'mossy' }, { variant: 'pebbles' }, { variant: 'boulder', size: 1.8, color: '#c9b9a0' }],
    build(p, ctx) {
      const variant = oneOf(p.variant, ['boulder', 'flat', 'cluster', 'mossy', 'pebbles'], 'boulder');
      const S = size(p.size, 1, 0.2, 5);
      const color = colorOr(p.color, '#b5b1a8');
      const r = rand(ctx, 'rock');
      const parts = new Parts();
      let spots = {}, footprint;
      if (variant === 'pebbles') {
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = i * 2.39996 + r.float(-0.4, 0.4), d = 0.05 + Math.sqrt(i / n) * 0.26;
          const s = r.float(0.035, 0.07) * (i === 0 ? 1.3 : 1);
          const g = sphere(s, 7, 4);
          const tint = shade(color, r.float(-0.1, 0.08), { hue: r.float(-0.02, 0.02) });
          addPainted(parts, g, tint, { at: [Math.cos(a) * d, s * 0.3, Math.sin(a) * d], scale: [r.float(1, 1.4), r.float(0.5, 0.7), 1], rot: [0, r.angle(), 0] }, (c, x, y, z, nx, ny) => c.offsetHSL(0, 0, ny * 0.05));
        }
        footprint = { r: 0.36 };
      } else if (variant === 'cluster') {
        rockPiece(parts, r, { at: [-0.12, 0, -0.05], R: 0.42, color });
        rockPiece(parts, r, { at: [0.36, 0, 0.12], R: 0.26, squash: [1.2, 0.7, 1.05], color: shade(color, 0.03) });
        rockPiece(parts, r, { at: [0.0, 0, 0.42], R: 0.17, squash: [1.25, 0.65, 1.1], color: shade(color, -0.02), detail: 4 });
        rockPiece(parts, r, { at: [-0.5, 0, 0.3], R: 0.12, squash: [1.2, 0.7, 1], color, detail: 3 });
        spots = { lean: spot([-0.12, 0, -0.62], 180, 'lean') };
        footprint = { r: 0.75 };
      } else if (variant === 'flat') {
        const { top } = rockPiece(parts, r, { R: 0.55, squash: [1.25, 0.4, 0.95], color, amp: 0.12, flatTop: 0.12, detail: 6, rot: [0, r.float(-0.2, 0.2), 0] });
        spots = { seat: spot([0, top, 0.1], 0, 'sit'), seat2: spot([0.3, top, 0.06], 0, 'sit') };
        footprint = { r: 0.7 };
      } else {
        const mossy = variant === 'mossy';
        const { top } = rockPiece(parts, r, { R: 0.48, squash: [1.18, 0.8, 1.02], color: mossy ? shade(color, -0.03, { hue: 0.02 }) : color, moss: mossy, detail: 6 });
        if (mossy) {
          const gr = rand(ctx, 'tufts');
          for (let i = 0; i < 3; i++) {
            const a = gr.angle();
            const g = bladesGeo(gr, { blades: 5, height: 0.16, spread: 0.04 });
            const B = C('#5b9a46'), T = C('#8cc865');
            addPainted(parts, g, { slot: 'foliage', color: '#62a84f', sway: 1.6, sheen: 0.3 }, { at: [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.5] }, (c, x, y, z, nx, ny, nz, u, v) => c.copy(B).lerp(T, v));
          }
        }
        spots = { lean: spot([0, 0, 0.66], 0, 'lean'), perch: spot([0, top, 0.05], 0, 'sit') };
        footprint = { r: 0.6 };
      }
      const out = S === 1 ? parts : new Parts().merge(parts, xform([0, 0, 0], [0, 0, 0], S));
      const scaledSpots = Object.fromEntries(Object.entries(spots).map(([k, s]) => [k, spot(s.at.map((v) => v * S), s.facing, s.pose)]));
      return finish(out.build(`rock-${variant}`), { footprint: footprint.r ? { r: footprint.r * S } : footprint, spots: scaledSpots });
    },
  },

  bush: {
    label: 'Bush',
    about: 'A soft round bush, a flowering bush (hydrangea or azalea style), a boxy hedge of any length or a berry bush. Leaves follow the seasons; flowering bushes bloom in spring and summer, berries stay through winter.',
    params: {
      variant: { default: 'round', options: BUSH_VARIANTS, about: 'kind of bush' },
      size: { default: 1, min: 0.5, max: 1.8, about: 'scale' },
      length: { default: 1.6, min: 0.6, max: 6, about: 'hedge length' },
      flower: { default: 'hydrangea', options: ['hydrangea', 'azalea'], about: 'bloom style of a flowering bush' },
      color: { default: 'auto', type: 'color', about: 'bloom or berry color (pink, blue, purple, white, red, yellow, orange or any color); auto picks one' },
    },
    examples: [{ variant: 'round' }, { variant: 'flowering' }, { variant: 'flowering', flower: 'azalea', color: 'pink' }, { variant: 'hedge' }, { variant: 'berry' }, { variant: 'flowering', color: 'purple', size: 0.75 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const variant = oneOf(p.variant, BUSH_VARIANTS, 'round');
      const S = size(p.size, 1, 0.3, 3);
      const flower = oneOf(p.flower, ['hydrangea', 'azalea'], 'hydrangea');
      const auto = variant === 'berry' ? '#d8343c' : flower === 'azalea' ? BLOOM.pink : '#7ea6ea';
      const bloom = colorOr(p.color, auto, { ...BLOOM, blue: flower === 'hydrangea' ? '#7ea6ea' : BLOOM.blue, red: variant === 'berry' ? '#d8343c' : BLOOM.red });
      const length = num(p.length, 1.6, 0.4, 12) / S;
      const parts = new Parts();
      const info = buildBush(parts, ctx, { variant, season, length, bloom, flower });
      const out = S === 1 ? parts : new Parts().merge(parts, xform([0, 0, 0], [0, 0, 0], S));
      const depth = (info.d ?? info.r * 2) * S;
      return finish(out.build(`bush-${variant}`), {
        footprint: info.w ? { w: info.w * S, d: info.d * S } : { r: info.r * S },
        spots: {
          front: spot([0, 0, depth / 2 + 0.35], 180, 'stand'),
          hide: spot([0, 0, -(depth / 2 + 0.28)], 0, 'kneel'),
        },
        height: info.h * S,
      });
    },
  },

  flowers: {
    label: 'Flowers',
    about: 'A little patch of flowers: tulips, roses, cosmos, pansies, lilies, hyacinths, windflowers or mums in one color or mixed. Light enough to scatter. They sway in the breeze; in winter only a few dry stems remain.',
    params: {
      species: { default: 'tulip', options: SPECIES, about: 'kind of flower' },
      color: { default: 'mixed', options: FLOWER_COLORS, about: 'bloom color (or mixed)' },
      count: { default: 5, min: 1, max: 12, about: 'number of blooms' },
      spread: { default: 0.2, min: 0.05, max: 0.6, about: 'patch radius' },
    },
    examples: [{ species: 'tulip' }, { species: 'rose', color: 'red' }, { species: 'cosmos', color: 'pink' }, { species: 'pansy' }, { species: 'lily', color: 'white' }, { species: 'hyacinth', color: 'blue' }, { species: 'windflower' }, { species: 'mum', color: 'yellow' }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const species = oneOf(p.species, SPECIES, 'tulip');
      let color = oneOf(p.color, FLOWER_COLORS, null);
      if (!color) color = colorOr(p.color, 'mixed');
      const count = int(p.count, 5, 1, 24);
      const spread = num(p.spread, 0.2, 0.02, 1.5);
      const parts = new Parts();
      buildFlowers(parts, ctx, { species, color, count, spread, season });
      return finish(parts.build(`flowers-${species}`), {
        footprint: { r: spread + 0.08 },
        spots: { tend: spot([0, 0, spread + 0.3], 180, 'kneel') },
        height: STEM_H[species] + 0.08,
      });
    },
  },

  reeds: {
    label: 'Reeds',
    about: 'A clump of tall reeds with brown cattails for pond and river edges. Green in spring and summer, golden in autumn, pale straw in winter; they sway in the wind.',
    params: {
      height: { default: 1, min: 0.4, max: 1.8, about: 'reed height' },
      blades: { default: 12, min: 4, max: 24, about: 'number of reed blades' },
      cattails: { default: 3, min: 0, max: 8, about: 'number of cattails' },
    },
    examples: [{}, { height: 0.7, cattails: 1 }, { height: 1.4, blades: 18, cattails: 5 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const r = rand(ctx, 'reeds');
      const H = num(p.height, 1, 0.2, 3);
      const nb = int(p.blades, 12, 2, 32);
      const nc = int(p.cattails, 3, 0, 12);
      const tone = { spring: ['#5f9f48', '#9fd06a'], summer: ['#4f9343', '#8cc35e'], autumn: ['#a99a4f', '#d8c27a'], winter: ['#b9a77a', '#ddd0a8'] }[season];
      const B = C(tone[0]), T = C(tone[1]);
      const sway = Math.round((0.09 / (H * H)) * 1000) / 1000;
      const look = { slot: 'foliage', color: tone[0], sway, sheen: 0.3 };
      const parts = new Parts();
      addPainted(parts, bladesGeo(r, { blades: nb, height: H, spread: 0.13, width: 0.06, lean: 0.25, stations: 4, curl: 2.4, minH: 0.55, up: 0.4 }), look, undefined, (c, x, y, z, nx, ny, nz, u, v) => {
        c.copy(B).lerp(T, smooth(0.1, 1, v));
        c.offsetHSL(0, 0, (fract(u * 7.31) - 0.5) * 0.04);
      });
      const head = season === 'winter' ? '#6e5338' : '#7b4b2a';
      for (let i = 0; i < nc; i++) {
        const a = r.angle(), d = r.float(0.02, 0.12);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const h = H * r.float(0.85, 1.15);
        const lx = r.float(-0.08, 0.08), lz = r.float(-0.08, 0.08);
        parts.add(taper([[x, 0, z], [x + lx * 0.4, h * 0.5, z + lz * 0.4], [x + lx, h, z + lz]], 0.011, 0.008, { radial: 4, tip: false, segments: 3 }), { ...look, color: tone[0] });
        const dir = new THREE.Vector3(lx * 0.6, h * 0.5, lz * 0.6).normalize().toArray();
        addPainted(parts, lathe([[0, 0], [0.022, 0.006], [0.028, 0.03], [0.029, 0.1], [0.023, 0.13], [0, 0.138]], 8), { ...look, color: head }, { matrix: facing([x + lx, h - 0.02, z + lz], dir, 0) }, (c, px, py, pz, nx, ny) => c.offsetHSL(0, 0, ny * 0.04));
        parts.add(cyl(0.004, 0.08, { top: 0.002, segments: 3 }), { ...look, color: tone[0] }, { matrix: facing([x + lx * 1.1, h + 0.11, z + lz * 1.1], dir, 0) });
      }
      return finish(parts.build('reeds'), { footprint: { r: 0.22 }, spots: {}, height: H });
    },
  },

  mushroom: {
    label: 'Mushrooms',
    about: 'A little cluster of mushrooms: red with white spots, brown, or glowing ones for fantasy forests that light up softly at night.',
    params: {
      variant: { default: 'red', options: ['red', 'brown', 'glowing'], about: 'kind of mushroom' },
      count: { default: 3, min: 1, max: 7, about: 'mushrooms in the cluster' },
      size: { default: 1, min: 0.5, max: 6, about: 'scale (big values make giant fairy-tale mushrooms)' },
    },
    examples: [{ variant: 'red' }, { variant: 'brown', count: 4 }, { variant: 'glowing', count: 5 }, { variant: 'red', count: 1, size: 2 }],
    build(p, ctx) {
      const variant = oneOf(p.variant, ['red', 'brown', 'glowing'], 'red');
      const count = int(p.count, 3, 1, 7);
      const S = size(p.size, 1, 0.3, 8);
      const parts = new Parts();
      mushroomCluster(parts, rand(ctx, 'shrooms'), { variant, at: [0, 0, 0], scale: 1, count });
      const out = S === 1 ? parts : new Parts().merge(parts, xform([0, 0, 0], [0, 0, 0], S));
      const lights = variant === 'glowing' ? [light([0, 0.16 * S, 0], { color: '#8af2ff', intensity: 0.32 + 0.06 * count, distance: 2.2 * Math.sqrt(S) })] : [];
      return finish(out.build(`mushroom-${variant}`), {
        footprint: { r: 0.22 * S },
        spots: { pick: spot([0, 0, 0.24 * S + 0.24], 180, 'kneel') },
        lights,
        height: 0.2 * S,
      });
    },
  },

  log: {
    label: 'Log',
    about: 'A fallen log to sit on, with ringed cut ends and a branch stub (it sprouts a couple of leaves in spring and summer). Seats along the top and a spot to sit on the ground leaning against it.',
    params: {
      length: { default: 1.6, min: 0.8, max: 3.5, about: 'log length' },
      size: { default: 1, min: 0.6, max: 1.6, about: 'thickness scale' },
      moss: { default: false, about: 'mossy top' },
      mushrooms: { default: false, about: 'a few mushrooms at one end' },
    },
    examples: [{}, { moss: true, mushrooms: true }, { length: 2.6, size: 1.2 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const S = size(p.size, 1, 0.4, 2.5);
      const L = num(p.length, 1.6, 0.5, 6);
      const R = 0.17 * S;
      const parts = new Parts();
      const { seat } = buildLog(parts, ctx, { L, R, moss: flag(p.moss, false), mushrooms: flag(p.mushrooms, false), season });
      const n = Math.max(1, Math.floor((L - 0.25) / 0.52) + 1);
      const spots = {};
      for (let i = 0; i < n; i++) spots[`seat${i + 1}`] = spot([(i - (n - 1) / 2) * 0.52, seat, 0.02], 0, 'sit');
      spots.rest = spot([0, 0, R + 0.16], 0, 'floor');
      return finish(parts.build('log'), { footprint: { w: L + 0.1, d: R * 2 + 0.1 }, spots, height: seat });
    },
  },

  bamboo: {
    label: 'Bamboo',
    about: 'A cluster of segmented bamboo stalks with leaf sprays at the top that sway in the wind. Evergreen; in spring a couple of bamboo shoots poke out of the ground.',
    params: {
      count: { default: 5, min: 1, max: 9, about: 'number of stalks' },
      height: { default: 3.2, min: 1.5, max: 5, about: 'stalk height' },
    },
    examples: [{}, { count: 3, height: 2.4 }, { count: 8, height: 4 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const count = int(p.count, 5, 1, 12);
      const height = num(p.height, 3.2, 0.8, 7);
      const parts = new Parts();
      buildBamboo(parts, ctx, { count, height, season });
      return finish(parts.build('bamboo'), { footprint: { r: 0.36 }, spots: { lean: spot([0, 0, 0.5], 0, 'lean') }, height });
    },
  },

  pumpkin: {
    label: 'Pumpkin',
    about: 'A ribbed pumpkin, or a small patch of them with big leaves and a curly vine. Orange, yellow, white or green.',
    params: {
      count: { default: 1, min: 1, max: 6, about: 'pumpkins in the patch' },
      color: { default: 'orange', options: ['orange', 'yellow', 'white', 'green'], about: 'pumpkin color (any color works too)' },
      size: { default: 1, min: 0.5, max: 3, about: 'scale (big values make prize pumpkins)' },
    },
    examples: [{}, { count: 4 }, { color: 'white', count: 2 }, { color: 'green', size: 0.8 }, { size: 2.2 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const count = int(p.count, 1, 1, 9);
      const S = size(p.size, 1, 0.3, 4);
      const color = oneOf(p.color, ['orange', 'yellow', 'white', 'green'], null) ?? colorOr(p.color, 'orange');
      const parts = new Parts();
      const placed = buildPumpkins(parts, ctx, { count, color, size: S, season });
      let ext = 0;
      for (const [x, z, R] of placed) ext = Math.max(ext, Math.hypot(x, z) + R);
      return finish(parts.build('pumpkin'), {
        footprint: { r: ext + 0.05 },
        spots: { tend: spot([0, 0, ext + 0.3], 180, 'kneel') },
        height: 0.4 * S,
      });
    },
  },

  leafpile: {
    label: 'Leaf pile',
    about: 'A heap of fallen autumn leaves in orange, red and gold, with a few strays around it. A spot to sit right in the pile and one to stand beside it with a rake.',
    params: {
      size: { default: 1, min: 0.5, max: 2.5, about: 'scale' },
    },
    examples: [{}, { size: 0.6 }, { size: 1.6 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const S = size(p.size, 1, 0.3, 4);
      const parts = new Parts();
      const info = buildLeafpile(parts, ctx, { size: S, season });
      return finish(parts.build('leafpile'), {
        footprint: { r: info.r },
        spots: { jump: spot([0, info.h * 0.35, 0.05], 0, 'floor'), rake: spot([0.5 * S + 0.35, 0, 0.3 * S], -90, 'stand') },
        height: info.h,
      });
    },
  },

  cactus: {
    label: 'Cactus',
    about: 'A friendly ribbed cactus with soft dots instead of spikes: a tall saguaro with raised arms, a round barrel or a prickly pear of flat pads. Flowers in spring and summer; the prickly pear bears red fruit in autumn.',
    params: {
      variant: { default: 'saguaro', options: CACTUS_VARIANTS, about: 'kind of cactus' },
      size: { default: 1, min: 0.4, max: 2.5, about: 'scale' },
      flowers: { default: true, about: 'flowers in spring and summer' },
    },
    examples: [{ variant: 'saguaro' }, { variant: 'barrel' }, { variant: 'prickly' }, { variant: 'saguaro', size: 0.6 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const variant = oneOf(p.variant, CACTUS_VARIANTS, 'saguaro');
      const S = size(p.size, 1, 0.3, 4);
      const parts = new Parts();
      const info = buildCactus(parts, ctx, { variant, season, flowers: flag(p.flowers, true) });
      const out = S === 1 ? parts : new Parts().merge(parts, xform([0, 0, 0], [0, 0, 0], S));
      return finish(out.build(`cactus-${variant}`), { footprint: { r: info.r * S }, spots: { look: spot([0, 0, info.r * S + 0.35], 180, 'stand') }, height: info.h * S });
    },
  },

  sunflower: {
    label: 'Sunflowers',
    about: 'Tall sunflowers with big golden heads facing the front, alone or in a little clump. Buds in spring, full bloom in summer, nodding heads in autumn and dry stalks in winter.',
    params: {
      count: { default: 3, min: 1, max: 7, about: 'number of sunflowers' },
      height: { default: 1.35, min: 0.6, max: 2.2, about: 'stalk height' },
    },
    examples: [{}, { count: 1 }, { count: 6, height: 1.7 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const count = int(p.count, 3, 1, 9);
      const height = num(p.height, 1.35, 0.3, 3);
      const parts = new Parts();
      buildSunflowers(parts, ctx, { count, height, season });
      return finish(parts.build('sunflower'), { footprint: { r: 0.4 }, spots: { look: spot([0, 0, 0.75], 180, 'stand') }, height });
    },
  },

  garden: {
    label: 'Vegetable patch',
    about: 'A wooden raised bed of soft soil with rows of carrots, cabbages, turnips or staked tomatoes (or a mix). Sprouts in spring, crops in summer and autumn, bare soil in winter.',
    params: {
      crop: { default: 'mixed', options: CROPS, about: 'what grows in it' },
      length: { default: 1.6, min: 0.8, max: 4, about: 'bed length' },
      rows: { default: 2, min: 1, max: 4, about: 'rows of crops' },
    },
    examples: [{}, { crop: 'cabbage' }, { crop: 'tomato', rows: 1 }, { crop: 'turnip', length: 1.0 }, { crop: 'carrot', rows: 3, length: 2.4 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const crop = oneOf(p.crop, CROPS, 'mixed');
      const length = num(p.length, 1.6, 0.5, 6);
      const rows = int(p.rows, 2, 1, 5);
      const parts = new Parts();
      const { w, d } = buildGarden(parts, ctx, { crop, length, rows, season });
      return finish(parts.build(`garden-${crop}`), {
        footprint: { w: w + 0.05, d: d + 0.05 },
        spots: { tend: spot([0, 0, d / 2 + 0.28], 180, 'kneel'), tend2: spot([-w / 4, 0, -d / 2 - 0.28], 0, 'kneel') },
        height: 0.3,
      });
    },
  },
};
