import * as THREE from 'three';
import {
  Parts, finish, spot, light, roundBox, box, roundCyl, cyl, cone, sphere, lathe, blob, ring, xform,
  PALETTE, SCALE, seasonal, shade as kitShade, mix, noise3, signMaterial, rng, WORLD_UNIFORMS,
} from '../kit.js';

// Prop family: buildings. Cottages, mills, barns, towers, bridges and walls in a chunky,
// toy-like Animal Crossing spirit. See ../kit.js for the conventions (origin at the center of
// the footprint on the ground, front facing +Z, one mesh per material slot via Parts).

/* ───────────────────────── shared look rules ───────────────────────── */
// Kept word for word the same in every prop family (nature, buildings, village, waterside), so the
// families agree on what a color name means, how dark a shaded color may get and how soft leaves look.

/**
 * Friendly color names in the kit's soft tones: a 'red' stall, a 'red' boat and a 'red' door match,
 * and 'black', 'brown' or 'grey' never turn harsh.
 */
const SOFT_NAMES = {
  red: PALETTE.cloth.red, blue: PALETTE.cloth.blue, green: PALETTE.cloth.green, yellow: PALETTE.cloth.yellow,
  white: PALETTE.cloth.white, purple: PALETTE.cloth.purple, orange: PALETTE.cloth.orange, pink: PALETTE.cloth.pink,
  teal: PALETTE.cloth.teal, cream: PALETTE.wallCream, brown: PALETTE.woodDark, tan: PALETTE.woodLight, wood: PALETTE.wood,
  grey: '#9aa1a8', gray: '#9aa1a8', black: '#3a3a42', navy: '#3d5a8c', gold: PALETTE.gold, silver: '#c3c9d1',
  bronze: '#a27c48', copper: PALETTE.copper, iron: PALETTE.iron, stone: PALETTE.stone, lilac: '#b9a3e3',
  mint: '#8fd3b0', sky: '#8cc2ea', lemon: '#f5dc6e', peach: '#f4b48c', rose: '#ec8fa6', coral: '#f07a5f',
};
/** Any other CSS color name, softened into the kit's range: no neon, no pure black or white. */
function softCss(name) {
  const c = new THREE.Color(name);
  const hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.5), Math.min(Math.max(hsl.l, 0.2), 0.92), THREE.SRGBColorSpace);
  return `#${c.getHexString()}`;
}
/**
 * The kit's `shade` with a floor. It works in linear light, so darkening an already dark color (a dark
 * wood, soot, a deep roof) used to clamp to pure black; now it stops at a deep tone of its own hue.
 */
const SHADE_FLOOR = 0.13;
function shade(color, light = 0, opts) {
  const out = kitShade(color, light, opts);
  if (!(light < 0)) return out;
  const c = new THREE.Color(out);
  const hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.l >= SHADE_FLOOR) return out;
  if (hsl.l < 0.005) new THREE.Color(color).getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s, SHADE_FLOOR, THREE.SRGBColorSpace);
  return `#${c.getHexString()}`;
}
/** Leaf sheen: the soft velvet of the nature family's canopies, for every other leaf, moss tuft and petal. */
const LEAF_SHEEN = 0.28;

/* ───────────────────────── params ───────────────────────── */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A color param: '#rrggbb', a PALETTE key ('roofRed'), a friendly name ('teal', 'brown') or a CSS name (softened). */
function colorOr(v, fallback) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (HEX.test(s)) return s.toLowerCase();
    if (typeof PALETTE[s] === 'string') return PALETTE[s];
    if (PALETTE.cloth[s]) return PALETTE.cloth[s];
    const low = s.toLowerCase();
    if (SOFT_NAMES[low]) return SOFT_NAMES[low];
    const names = THREE.Color.NAMES ?? {};
    if (Object.prototype.hasOwnProperty.call(names, low)) return softCss(low);
  } else if (typeof v === 'number' && Number.isFinite(v)) {
    return `#${new THREE.Color().setHex(v & 0xffffff).getHexString()}`;
  }
  return fallback;
}
function oneOf(v, options, fallback) { return options.includes(v) ? v : fallback; }
function numOr(v, fallback, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
function boolOr(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === 0 || v === '0' || v === 'false' || v === 'no' || v === 'off' || v === '' || v === null) return false;
  return fallback;
}
function textOr(v, fallback = '') {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' ? v.trim().slice(0, 32) : fallback;
}
function seasonOf(ctx) { return ['spring', 'summer', 'autumn', 'winter'].includes(ctx?.season) ? ctx.season : 'summer'; }
/**
 * A separate seeded stream for one aspect of a prop ('deco' for flowers and moss, 'anim' for
 * animation phases). Season-dependent draws come from these, never from ctx.rng, so the layout
 * of a prop is the same in every season.
 */
function stream(ctx, tag) { return rng(`${ctx?.seed ?? ctx?.id ?? 1}:${tag}`); }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const TAU = Math.PI * 2;

/* ───────────────────────── geometry helpers ───────────────────────── */

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const v3 = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

/** A matrix whose local X runs along `xDir` and local Y leans toward `upHint`. */
function basis(origin, xDir, upHint = [0, 1, 0]) {
  const x = v3(xDir).normalize();
  let up = v3(upHint);
  const z = new THREE.Vector3().crossVectors(x, up);
  if (z.lengthSq() < 1e-8) {
    up = Math.abs(x.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    z.crossVectors(x, up);
  }
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(v3(origin));
}

/** A rounded board from a to b: `w` wide (local Z), `h` thick (local Y, toward `up`). */
function plank(P, a, b, w, h, look, { r = 0.02, seg = 1, up = [0, 1, 0] } = {}) {
  const A = v3(a), B = v3(b);
  const len = Math.max(A.distanceTo(B), 0.01);
  const g = roundBox(len, h, w, Math.min(r, h * 0.45, w * 0.45), seg).translate(0, -h / 2, 0);
  P.add(g, look, { matrix: basis(A.clone().add(B).multiplyScalar(0.5), B.clone().sub(A), up) });
}

/** A rounded rod (cylinder) from a to b. */
function rod(P, a, b, r, look, { seg = 10, bevel = null } = {}) {
  const A = v3(a), B = v3(b);
  const d = B.clone().sub(A);
  const len = Math.max(d.length(), 0.01);
  const g = roundCyl(r, len, { segments: seg, bevel: bevel ?? Math.min(r * 0.45, len * 0.3), steps: 1 });
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  P.add(g, look, { matrix: new THREE.Matrix4().compose(A, q, ONE) });
}

/** A plain (crisp) box between two points, for thin hidden-ish sticks. */
function stick(P, a, b, w, h, look, up = [0, 1, 0]) {
  const A = v3(a), B = v3(b);
  const len = Math.max(A.distanceTo(B), 0.01);
  P.add(new THREE.BoxGeometry(len, h, w), look, { matrix: basis(A.clone().add(B).multiplyScalar(0.5), B.clone().sub(A), up) });
}

function roundRectPath(path, x0, y0, x1, y1, r) {
  const rr = Math.max(0.001, Math.min(r, (x1 - x0) / 2 - 1e-4, (y1 - y0) / 2 - 1e-4));
  path.moveTo(x0 + rr, y0);
  path.lineTo(x1 - rr, y0);
  path.absarc(x1 - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  path.lineTo(x1, y1 - rr);
  path.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false);
  path.lineTo(x0 + rr, y1);
  path.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false);
  path.lineTo(x0, y0 + rr);
  path.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
  return path;
}
/** Rectangle with a semicircular top, from (x0, y0) to the arch's crown at y1. */
function archPath(path, x0, y0, x1, y1) {
  const r = (x1 - x0) / 2, cx = (x0 + x1) / 2;
  const spring = Math.max(y0 + 0.01, y1 - r);
  path.moveTo(x0, y0);
  path.lineTo(x1, y0);
  path.lineTo(x1, spring);
  path.absarc(cx, spring, r, 0, Math.PI, false);
  path.lineTo(x0, y0);
  return path;
}
function circlePath(path, cx, cy, r) { path.absarc(cx, cy, r, 0, Math.PI * 2, false); return path; }
function outlineShape(points) { return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))); }

/** Extrude a shape along Z (centered on z = 0) with soft bevelled edges. */
function slab(shape, depth, { bevel = 0.02, seg = 2, curve = 10 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth, 0.002), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments: curve, steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Frame shapes (outer outline with the opening as a hole). */
function frameShape(shape, w, h, b) {
  const s = new THREE.Shape();
  const hole = new THREE.Path();
  if (shape === 'round') {
    circlePath(s, 0, 0, w / 2 + b);
    circlePath(hole, 0, 0, w / 2);
  } else if (shape === 'arch') {
    archPath(s, -w / 2 - b, -h / 2 - b, w / 2 + b, h / 2 + b);
    archPath(hole, -w / 2, -h / 2, w / 2, h / 2);
  } else {
    roundRectPath(s, -w / 2 - b, -h / 2 - b, w / 2 + b, h / 2 + b, b * 0.9);
    roundRectPath(hole, -w / 2, -h / 2, w / 2, h / 2, 0.025);
  }
  s.holes.push(hole);
  return s;
}
function paneShape(shape, w, h) {
  const s = new THREE.Shape();
  if (shape === 'round') circlePath(s, 0, 0, w / 2 + 0.01);
  else if (shape === 'arch') archPath(s, -w / 2 - 0.01, -h / 2 - 0.01, w / 2 + 0.01, h / 2 + 0.01);
  else roundRectPath(s, -w / 2 - 0.01, -h / 2 - 0.01, w / 2 + 0.01, h / 2 + 0.01, 0.03);
  return s;
}

/** Sample a cubic Bezier ([x, y] points). */
function bezier(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}
/** Offset a 2D polyline sideways (to the left of its direction) by d. */
function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [p[0] - (ty / l) * d, p[1] + (tx / l) * d];
  });
}
function lerpY(pts, x) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if ((x >= x0 && x <= x1) || (x <= x0 && x >= x1)) return y0 + ((x - x0) / ((x1 - x0) || 1)) * (y1 - y0);
  }
  return pts[x < pts[0][0] ? 0 : pts.length - 1][1];
}

/** Hip roof as a closed, flat-shaded solid: eave rectangle (±ex, ±ez) at yE up to a ridge at yR, fascia `tf` deep. */
function hipRoofGeometry(ex, ez, yE, yR, tf) {
  const rx = Math.max(ex - ez, 0), rz = Math.max(ez - ex, 0);
  const pos = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-6;
  const tri = (a, b, c) => { if (!same(a, b) && !same(b, c) && !same(a, c)) pos.push(...a, ...b, ...c); };
  const q = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  const FL = [-ex, yE, ez], FR = [ex, yE, ez], BR = [ex, yE, -ez], BL = [-ex, yE, -ez];
  const rFL = [-rx, yR, rz], rFR = [rx, yR, rz], rBR = [rx, yR, -rz], rBL = [-rx, yR, -rz];
  q(FL, FR, rFR, rFL);
  q(FR, BR, rBR, rFR);
  q(BR, BL, rBL, rBR);
  q(BL, FL, rFL, rBL);
  const yb = yE - tf;
  const d = (p) => [p[0], yb, p[2]];
  q(d(FL), d(FR), FR, FL);
  q(d(FR), d(BR), BR, FR);
  q(d(BR), d(BL), BL, BR);
  q(d(BL), d(FL), FL, BL);
  q(d(FL), d(BL), d(BR), d(FR));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/* ───────────────────────── looks ───────────────────────── */

const TRIM = '#fbf4e6';
const MOSS = { spring: '#86c46a', summer: '#69a957', autumn: '#929a4c', winter: '#7d8a6c' };
const HOLE = '#3e322b';
const SOOT = '#3a3330';
function glassLook(kind) {
  if (kind === 'lit') return { slot: 'glass', color: '#a6cde0' };
  if (kind === 'dark') return { slot: 'glass', color: '#6d8593', glowAmount: 0 };
  return HOLE; // an empty window: a dark opening
}
const LAMP = { slot: 'lamp', color: '#fff1cf' };
const METAL = (c = PALETTE.iron) => ({ slot: 'metal', color: c });
/** Trim that reads against the walls: cream on colored walls, warm wood on very pale ones. */
function autoTrim(walls) {
  const hsl = {};
  new THREE.Color(walls).getHSL(hsl);
  return hsl.l > 0.9 && hsl.s < 0.5 ? PALETTE.woodLight : TRIM;
}
function flowerColors(season, rand) {
  if (season === 'winter') return [];
  if (season === 'autumn') return [PALETTE.flower.orange, PALETTE.flower.red, PALETTE.flower.yellow];
  const all = [PALETTE.flower.red, PALETTE.flower.yellow, PALETTE.flower.pink, PALETTE.flower.white, PALETTE.flower.purple, PALETTE.flower.blue];
  const a = rand.pick(all);
  let b = rand.pick(all);
  if (b === a) b = PALETTE.flower.white;
  return [a, b];
}

/* ───────────────────────── windows and doors ───────────────────────── */

/**
 * A window facing +Z with the wall surface at z = 0 (its center at the origin).
 * o: { w, h, shape: square|round|arch, frame, glass: lit|dark|hole, shutters: color|null,
 *      flowerbox, boarded, season, rand, sill }
 */
function windowParts(o) {
  const { w = 0.5, h = 0.6, frame = TRIM, glass = 'lit', shutters = null, flowerbox = false, boarded = false, season = 'summer', rand, sill = true } = o;
  const shape = o.shape === 'round' || o.shape === 'arch' ? o.shape : 'square';
  const hh = shape === 'round' ? w : Math.max(h, shape === 'arch' ? w * 0.9 : 0.2);
  const P = new Parts();
  const b = 0.075;
  const curve = shape === 'square' ? 2 : shape === 'round' ? 7 : 5;
  // pane, then the frame proud of it
  P.add(slab(paneShape(shape, w, hh), 0.03, { bevel: 0, curve }), o.pane ?? glassLook(glass), { at: [0, 0, 0.015] });
  P.add(slab(frameShape(shape, w, hh, b), 0.07, { bevel: 0.022, seg: 1, curve }), frame, { at: [0, 0, 0.045] });
  if (glass !== 'hole') {
    // mullions: one extruded cross
    const m = 0.022;
    const cy = shape === 'arch' ? hh / 2 - w / 2 : 0;
    const top = hh / 2 - (shape === 'square' ? 0 : 0.02);
    const cross = outlineShape([
      [-m, -hh / 2], [m, -hh / 2], [m, cy - m], [w / 2, cy - m], [w / 2, cy + m], [m, cy + m], [m, top], [-m, top],
      [-m, cy + m], [-w / 2, cy + m], [-w / 2, cy - m], [-m, cy - m],
    ]);
    P.add(slab(cross, 0.02, { bevel: 0.012, seg: 1 }), frame, { at: [0, 0, 0.05] });
  }
  const bottom = -hh / 2 - b;
  if (sill && shape !== 'round') P.add(roundBox(w + 2 * b + 0.1, 0.07, 0.15, 0.03, 1), frame, { at: [0, bottom - 0.05, 0.06] });
  if (shutters) {
    const sw = w * 0.5 + 0.05, sh = hh + 2 * b - 0.06;
    for (const s of [-1, 1]) {
      const x = s * (w / 2 + b + sw / 2 + 0.015);
      P.add(roundBox(sw, sh, 0.05, 0.025, 1), shutters, { at: [x, -sh / 2, 0.03] });
      for (let i = 0; i < 4; i++) P.add(box(sw - 0.09, 0.03, 0.02), shade(shutters, -0.08), { at: [x, -sh / 2 + sh * (0.17 + i * 0.22), 0.075] });
    }
  }
  if (flowerbox && rand) {
    const bw = w + 2 * b + 0.06, by = bottom - 0.1 - 0.17;
    P.add(roundBox(bw, 0.17, 0.2, 0.035, 1), PALETTE.woodRed, { at: [0, by, 0.12] });
    P.add(box(bw - 0.06, 0.03, 0.16), PALETTE.woodDark, { at: [0, by + 0.15, 0.12] });
    const leaf = season === 'winter' ? '#6f7f5f' : season === 'autumn' ? '#9a8a45' : seasonal(PALETTE.leaf, season);
    const n = Math.max(3, Math.round(bw / 0.2));
    for (let i = 0; i < n; i++) {
      const x = -bw / 2 + 0.09 + (i * (bw - 0.18)) / (n - 1);
      P.add(blob(0.085, { detail: 1, amp: 0.15, seed: i * 7 + 3, squash: [1.1, 0.8, 0.9] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(leaf, rand.float(-0.04, 0.04)) }, { at: [x, by + 0.2, 0.12 + rand.float(-0.02, 0.03)] });
    }
    const cols = flowerColors(season, rand);
    if (cols.length) {
      for (let i = 0; i < n + 1; i++) {
        const x = -bw / 2 + 0.07 + (i * (bw - 0.14)) / n;
        P.add(sphere(0.052, 6, 4), { slot: 'foliage', sheen: LEAF_SHEEN, color: cols[i % cols.length] }, { at: [x, by + 0.27 + rand.float(-0.02, 0.03), 0.15 + rand.float(-0.04, 0.04)], scale: [1, 0.8, 1] });
      }
    }
  }
  if (boarded) {
    const bw = shape === 'round' ? w + 0.2 : w + 0.24;
    const wood = shade(PALETTE.woodGrey, -0.05);
    plank(P, [-bw / 2, -hh / 2, 0.11], [bw / 2, hh / 2, 0.11], 0.13, 0.035, wood, { up: [0, 0, 1] });
    plank(P, [-bw / 2, hh / 2 - 0.05, 0.13], [bw / 2, -hh / 2 + 0.05, 0.13], 0.13, 0.035, shade(wood, 0.04), { up: [0, 0, 1] });
  }
  return P;
}

/**
 * A chunky door facing +Z, its bottom center at the origin and the wall surface at z = 0.
 * o: { w, h, color, frame, arch, knob, glass, state: closed|boarded|missing|open }
 */
function doorParts(o) {
  const { w = 0.72, h = 1.22, color = PALETTE.wood, frame = TRIM, arch = true, knob = PALETTE.gold, glass = 'lit', state = 'closed' } = o;
  const P = new Parts();
  const fb = 0.1;
  // frame: an inverted U around the opening
  const fs = new THREE.Shape();
  if (arch) {
    const sp = h - w / 2;
    fs.moveTo(-w / 2 - fb, 0);
    fs.lineTo(-w / 2 - fb, sp);
    fs.absarc(0, sp, w / 2 + fb, Math.PI, 0, true);
    fs.lineTo(w / 2 + fb, 0);
    fs.lineTo(w / 2, 0);
    fs.lineTo(w / 2, sp);
    fs.absarc(0, sp, w / 2, 0, Math.PI, false);
    fs.lineTo(-w / 2, 0);
  } else {
    fs.moveTo(-w / 2 - fb, 0);
    fs.lineTo(-w / 2 - fb, h + fb);
    fs.lineTo(w / 2 + fb, h + fb);
    fs.lineTo(w / 2 + fb, 0);
    fs.lineTo(w / 2, 0);
    fs.lineTo(w / 2, h);
    fs.lineTo(-w / 2, h);
    fs.lineTo(-w / 2, 0);
  }
  P.add(slab(fs, 0.1, { bevel: 0.025, curve: 16 }), frame, { at: [0, 0, 0.05] });
  const leafShape = arch ? archPath(new THREE.Shape(), -w / 2, 0, w / 2, h) : roundRectPath(new THREE.Shape(), -w / 2, 0, w / 2, h, 0.03);
  // the dark opening behind the leaf (seen when the door is missing or open)
  P.add(slab(arch ? archPath(new THREE.Shape(), -w / 2 - 0.01, 0, w / 2 + 0.01, h + 0.01) : roundRectPath(new THREE.Shape(), -w / 2 - 0.01, 0, w / 2 + 0.01, h + 0.01, 0.03), 0.02, { bevel: 0 }), HOLE, { at: [0, 0, 0.01] });
  if (state !== 'missing') {
    const leaf = new Parts();
    leaf.add(slab(leafShape, 0.06, { bevel: 0.018, curve: 16 }), color, { at: [0, 0, 0] });
    const inset = shade(color, -0.06);
    for (const s of [-1, 1]) leaf.add(roundBox(w * 0.3, h * 0.34, 0.03, 0.03, 1), inset, { at: [s * w * 0.19, h * 0.1, 0.035] });
    // a little round window up top
    const wy = h * (arch ? 0.66 : 0.72);
    leaf.add(cyl(0.12, 0.02, { segments: 16 }), glassLook(glass === 'hole' ? 'dark' : glass), { at: [0, wy, 0.03], rot: [Math.PI / 2, 0, 0] });
    leaf.add(ring(0.12, 0.028, { radial: 6, tubular: 18 }), shade(color, 0.12), { at: [0, wy, 0.045], rot: [Math.PI / 2, 0, 0] });
    leaf.add(sphere(0.048, 10, 8), METAL(knob), { at: [w * 0.32, h * 0.46, 0.07] });
    leaf.add(roundCyl(0.03, 0.04, { segments: 10, bevel: 0.01, steps: 1 }), METAL(knob), { at: [w * 0.32, h * 0.46, 0.03], rot: [Math.PI / 2, 0, 0] });
    if (state === 'open') P.merge(leaf, xform([-w / 2, 0, 0.06], [0, -1.75, 0]));
    else P.merge(leaf, xform([0, 0, 0.05]));
  }
  if (state === 'boarded') {
    const wood = shade(PALETTE.woodGrey, -0.04);
    for (const [y, tilt] of [[h * 0.3, 0.12], [h * 0.68, -0.1]]) {
      const dx = (w / 2 + 0.16), dy = Math.tan(tilt) * dx;
      plank(P, [-dx, y - dy, 0.16], [dx, y + dy, 0.16], 0.15, 0.04, shade(wood, tilt > 0 ? 0 : 0.05), { up: [0, 0, 1] });
    }
  }
  return P;
}

/** Puffs of chimney smoke: a few soft spheres that rise, grow and shrink away (cheap transforms only). */
function smokePuffs(group, at, { count = 4, scale = 1, phase = 0 } = {}) {
  const cluster = new Parts();
  const look = { slot: 'clear', color: '#eef0f2', rough: 0.95, opacity: 0.6 };
  cluster.add(sphere(0.15 * scale, 10, 8), look);
  cluster.add(sphere(0.11 * scale, 9, 7), look, { at: [0.12 * scale, 0.04 * scale, 0.03 * scale] });
  cluster.add(sphere(0.1 * scale, 9, 7), look, { at: [-0.1 * scale, 0.05 * scale, -0.04 * scale] });
  const mesh = cluster.build('smoke').children[0];
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const m = i === 0 ? mesh : new THREE.Mesh(mesh.geometry, mesh.material);
    m.castShadow = false;
    m.position.set(at[0], at[1], at[2]);
    m.rotation.y = i * 1.7;
    m.scale.setScalar(0.001);
    group.add(m);
    puffs.push(m);
  }
  return (time) => {
    const t = time + phase;
    const wind = WORLD_UNIFORMS.uWind.value;
    puffs.forEach((m, i) => {
      const ph = (((t * 0.2 + i / count) % 1) + 1) % 1;
      m.position.set(at[0] + ph * (0.3 + wind * 0.9) + Math.sin(t * 1.3 + i) * 0.04, at[1] + ph * 1.6 * scale, at[2] + Math.sin(t * 0.7 + i * 2) * 0.05);
      const s = Math.sin(Math.min(ph * 1.1, 1) * Math.PI) * (0.55 + ph * 1.2);
      m.scale.setScalar(Math.max(s, 0.001));
    });
  };
}

/* ───────────────────────── roofs ───────────────────────── */

/**
 * Builds a roof over walls W × D (x × z) whose tops are at y0. style gable | hip | round.
 * Returns { ridge, eaveZ, eaveTop, eaveBottom, topAt(x, z) } for placing chimneys and signs.
 */
function addRoof(P, { style, W, D, y0, rise, over = 0.42, overX = 0.34, t = 0.27, color, trim, walls, gableWindow = null, shingles = true }) {
  const c = D / 2;
  const dark = shade(color, -0.07);
  const ridgeC = shade(color, -0.12);
  if (style === 'hip') {
    const a = Math.atan2(rise, c), ta = Math.tan(a), ca = Math.cos(a), sa = Math.sin(a);
    const ex = W / 2 + over * 0.85, ez = c + over;
    const yE = y0 + t / ca - over * ta;
    const yR = yE + Math.min(ex, ez) * ta;
    const tf = t / ca;
    P.add(hipRoofGeometry(ex, ez, yE, yR, tf), color);
    const rx = Math.max(ex - ez, 0), rz = Math.max(ez - ex, 0);
    const cap = 0.09;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      rod(P, [sx * ex, yE + 0.02, sz * ez], [sx * rx, yR + 0.03, sz * rz], cap, ridgeC, { seg: 8 });
      P.add(sphere(cap * 1.3, 8, 6), ridgeC, { at: [sx * ex, yE + 0.02, sz * ez] });
    }
    if (rx > 0.01 || rz > 0.01) rod(P, [-rx, yR + 0.03, -rz], [rx, yR + 0.03, rz], cap * 1.15, ridgeC, { seg: 10 });
    P.add(sphere(cap * 1.55, 10, 8), ridgeC, { at: [rx, yR + 0.05, rz] });
    if (rx > 0.01 || rz > 0.01) P.add(sphere(cap * 1.55, 10, 8), ridgeC, { at: [-rx, yR + 0.05, -rz] });
    // eave rim, a darker band around the fascia
    for (const [ax, az, bx, bz, nx, nz] of [[-ex, ez, ex, ez, 0, 1], [-ex, -ez, ex, -ez, 0, -1], [ex, -ez, ex, ez, 1, 0], [-ex, -ez, -ex, ez, -1, 0]]) {
      plank(P, [ax + nx * 0.03, yE - tf / 2, az + nz * 0.03], [bx + nx * 0.03, yE - tf / 2, bz + nz * 0.03], 0.07, tf + 0.05, dark);
    }
    // shingle courses on every face (their ends tuck under the hip caps)
    if (shingles) {
      for (const f of [0.22, 0.44, 0.66]) {
        const y = yE + (yR - yE) * f + 0.014;
        const insZ = (ez - rz) * f, insX = (ex - rx) * f;
        const halfX = ex - insX - 0.03, halfZ = ez - insZ - 0.03;
        if (halfX > 0.12) for (const sz of [1, -1]) plank(P, [-halfX, y, sz * (ez - insZ)], [halfX, y, sz * (ez - insZ)], 0.1, 0.045, dark, { up: [0, ca, sz * sa] });
        if (halfZ > 0.12) for (const sx of [1, -1]) plank(P, [sx * (ex - insX), y, -halfZ], [sx * (ex - insX), y, halfZ], 0.1, 0.045, dark, { up: [sx * sa, ca, 0] });
      }
    }
    const topAt = (x, z) => Math.min(yR, yE + ta * Math.min(ez - Math.abs(z), ex - Math.abs(x)));
    return { ridge: yR + cap * 1.5, eaveZ: ez + 0.06, eaveTop: yE, eaveBottom: yE - tf, topAt, underAt: (x, z) => topAt(x, z) - tf };
  }

  // gable and round: one extruded profile along X. `under` and `top` are the true surfaces;
  // the extrusion outline is shrunk by the bevel, which grows it back.
  const bev = 0.035;
  let under, top, inU, inT, rimT, rimU, slopeAt;
  if (style === 'round') {
    const ze = c + over * 0.8;
    const yTop = y0 + rise * 1.05;
    const yEave = y0 - over * 0.9;
    const half = bezier([0, yTop], [ze * 0.55, yTop], [ze - 0.42, yEave + 0.48], [ze, yEave], 9);
    under = [...half.slice(1).reverse().map(([z, y]) => [-z, y]), ...half];
    const shift = lerpY(under, c) - (y0 - 0.02);
    under = under.map(([z, y]) => [z, y - shift]);
    top = offsetLine(under, t);
    inU = offsetLine(under, bev);
    inT = offsetLine(under, t - bev);
    rimT = offsetLine(under, t + 0.012);
    rimU = offsetLine(under, -0.012);
  } else {
    const a = Math.atan2(rise, c), ta = Math.tan(a), ca = Math.cos(a);
    const ze = c + over;
    const yu = (z) => y0 + rise - Math.abs(z) * ta;
    const line = (zEnd, dy) => [[-zEnd, yu(zEnd) + dy], [0, yu(0) + dy], [zEnd, yu(zEnd) + dy]];
    under = line(ze, 0);
    top = line(ze, t / ca);
    inU = line(ze - bev, bev / ca);
    inT = line(ze - bev, (t - bev) / ca);
    rimT = line(ze + 0.012, (t + 0.012) / ca);
    rimU = line(ze + 0.012, -0.012 / ca);
  }
  const outline = [...inT, ...inU.slice().reverse()];
  const roofLen = W + 2 * overX;
  P.add(slab(outlineShape(outline), roofLen - 2 * bev, { bevel: bev, seg: 2 }), color, { rot: [0, -Math.PI / 2, 0] });
  // rims over both roof ends (barge boards)
  const rimShape = outlineShape([...rimT, ...rimU.slice().reverse()]);
  for (const sx of [-1, 1]) P.add(slab(rimShape, 0.05, { bevel: 0.02, seg: 1 }), trim, { at: [sx * (roofLen / 2 - 0.01), 0, 0], rot: [0, -Math.PI / 2, 0] });
  // attic gables: fill under the roof between the walls
  const inner = under.filter(([z]) => Math.abs(z) < c - 0.01).slice().reverse();
  const attic = [[-c, y0 - 0.01], [c, y0 - 0.01], [c, Math.max(lerpY(under, c), y0)], ...inner, [-c, Math.max(lerpY(under, -c), y0)]];
  P.add(slab(outlineShape(attic), W, { bevel: 0 }), walls, { rot: [0, -Math.PI / 2, 0] });
  const ridge = top.reduce((m, p) => Math.max(m, p[1]), -Infinity);
  if (style === 'gable') rod(P, [-roofLen / 2 - 0.02, ridge - 0.03, 0], [roofLen / 2 + 0.02, ridge - 0.03, 0], 0.12, ridgeC, { seg: 12 });
  // eave boards along the front and back edges
  for (const end of [0, 1]) {
    const T = end ? top[top.length - 1] : top[0], U = end ? under[under.length - 1] : under[0];
    const dir = new THREE.Vector3(0, T[1] - U[1], T[0] - U[0]);
    const len = dir.length();
    dir.normalize();
    const out = new THREE.Vector3(0, -dir.z, dir.y).multiplyScalar(end ? 1 : -1);
    const mid = new THREE.Vector3(0, (T[1] + U[1]) / 2, (T[0] + U[0]) / 2).addScaledVector(out, 0.03);
    plank(P, [-roofLen / 2 + 0.03, mid.y, mid.z], [roofLen / 2 - 0.03, mid.y, mid.z], 0.06, len + 0.03, dark, { up: [0, dir.y, dir.z] });
  }
  // shingle courses
  if (shingles) {
    const rows = [];
    for (const s of [-1, 1]) for (const f of style === 'round' ? [0.2, 0.42, 0.63, 0.83] : [0.24, 0.46, 0.68, 0.88]) rows.push(s * f);
    const zEnd = top[top.length - 1][0];
    for (const r of rows) {
      const z = r * zEnd;
      const y = lerpY(top, z);
      const slope = (lerpY(top, z + 0.02) - lerpY(top, z - 0.02)) / 0.04;
      const n = new THREE.Vector3(0, 1, -slope).normalize();
      plank(P, [-roofLen / 2 + 0.04, y + 0.016 * n.y, z + 0.016 * n.z], [roofLen / 2 - 0.04, y + 0.016 * n.y, z + 0.016 * n.z], 0.1, 0.045, dark, { up: [0, n.y, n.z] });
    }
  }
  if (gableWindow) {
    const gy = y0 + (ridge - t - y0) * 0.36;
    for (const sx of [-1, 1]) P.merge(gableWindow, xform([sx * W / 2, gy, 0], [0, sx * Math.PI / 2, 0]));
  }
  const eave = top[top.length - 1], eaveU = under[under.length - 1];
  return {
    ridge: ridge + (style === 'gable' ? 0.1 : 0), eaveZ: Math.max(eave[0], eaveU[0]) + 0.06, eaveTop: eave[1], eaveBottom: eaveU[1],
    topAt: (x, z) => lerpY(top, THREE.MathUtils.clamp(z, top[0][0], top[top.length - 1][0])),
    underAt: (x, z) => lerpY(under, THREE.MathUtils.clamp(z, under[0][0], under[under.length - 1][0])),
  };
}

/**
 * A shop sign standing on the front slope of a roof just above the eave, as on AC shops: the
 * board leans back a little, its foot rests on the roof and two struts brace it to the slope.
 * It moves up the slope until the roof behind it no longer cuts through the board (round roofs
 * are steep at the eave).
 */
function roofSign(P, roof, { text, w, h = 0.46, frame = PALETTE.woodDark, lean = 0.2 }) {
  const bw = w + 0.14, bh = h + 0.14, th = 0.08;
  const sl = Math.sin(lean), cl = Math.cos(lean);
  const top = (z) => Math.max(roof.topAt(0, z), roof.topAt(bw / 2, z), roof.topAt(-bw / 2, z));
  let zf = roof.eaveZ - 0.16, yf = top(zf) - 0.03;
  for (let k = 0; k < 40; k++) {
    yf = top(zf) - 0.03;
    let clear = true;
    // the front face must stay above the roof from just over the foot, the back face higher up
    for (let s = 0.08; s <= bh + 1e-6 && clear; s += 0.04) {
      if (yf + s * cl < top(zf - s * sl) + 0.02) clear = false;
      if (s >= 0.34 && yf + s * cl - th * sl < top(zf - s * sl - th * cl)) clear = false;
    }
    if (clear) break;
    zf -= 0.04;
  }
  const board = new Parts();
  board.add(roundBox(bw, bh, th, 0.04, 1), frame, { at: [0, -bh / 2, -th / 2] });
  board.add(new THREE.PlaneGeometry(w, h), signMaterial(text, { bg: '#f7ecd2', fg: '#6a3f22', border: '#b7864e', borderWidth: 8, font: 'bold 92px Georgia, "Times New Roman", serif' }), { at: [0, 0, 0.002] });
  P.merge(board, xform([0, yf + (bh / 2) * cl, zf - (bh / 2) * sl], [-lean, 0, 0]));
  // struts from the back of the board down to the roof just behind it (never climbing the slope)
  const s = bh * 0.55;
  const zb = zf - s * sl - th * cl, yb = yf + s * cl - th * sl;
  let reach = 0.42;
  while (reach > 0.14 && top(zb - reach) > yb - 0.04) reach -= 0.04;
  for (const sx of [-1, 1]) {
    const x = sx * Math.min(0.34 * w, w / 2 - 0.12);
    rod(P, [x, yb, zb + 0.02], [x, top(zb - reach) - 0.03, zb - reach], 0.028, METAL(), { seg: 6 });
  }
  return { foot: [zf, yf], top: yf + bh * cl };
}

/* ───────────────────────── house ───────────────────────── */

const HOUSE_SIZES ={ small: [2.7, 2.4], medium: [3.3, 2.8], large: [4.2, 3.2] };
const STATES = ['intact', 'boarded', 'ruined', 'burnt'];

/**
 * One wall slab with a crumbled, stepped top edge. Local X runs along the wall (0..len), Y up,
 * Z out of the wall (the slab is centered on z = 0). `height(u)` is the wanted height at u.
 * A `notch` { u0, u1, h } cuts a doorway; when no lintel would survive, the wall splits in two.
 */
function crumbleWall(P, { len, t, height, rand, color, matrix, notch = null, step = [0.1, 0.22], jitter = 0.07 }) {
  const ledges = [];
  const piece = (a0, a1, cut) => {
    if (a1 - a0 < 0.08) return;
    const tops = [];
    let u = a0;
    while (u < a1 - 1e-4) {
      let w = rand.float(step[0], step[1]);
      if (a1 - (u + w) < step[0] * 0.6) w = a1 - u;
      tops.push([u, u + w, Math.max(0.3, height(u + w / 2) - rand.float(0, jitter))]);
      u += w;
    }
    const pts = [[a0, 0]];
    if (cut) pts.push([cut.u0, 0], [cut.u0, cut.h], [cut.u1, cut.h], [cut.u1, 0]);
    pts.push([a1, 0]);
    for (let i = tops.length - 1; i >= 0; i--) pts.push([tops[i][1], tops[i][2]], [tops[i][0], tops[i][2]]);
    ledges.push(...tops);
    const clean = pts.filter((p, i) => {
      const q = pts[(i + pts.length - 1) % pts.length];
      return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-4;
    });
    P.add(slab(outlineShape(clean), Math.max(t - 0.04, 0.02), { bevel: 0.02, seg: 1 }), color, { matrix });
    // a loose block perched on the broken top now and then
    for (const [a, b, h] of tops) {
      if (h > 0.8 && rand.chance(0.18)) {
        const m = matrix.clone().multiply(xform([(a + b) / 2 + rand.float(-0.04, 0.04), h - 0.02, 0], [0, rand.float(-0.25, 0.25), rand.float(-0.12, 0.12)]));
        P.add(roundBox(Math.min(b - a, 0.22) * 0.8, 0.11, t * 0.85, 0.03, 1), shade(color, -0.03), { matrix: m });
      }
    }
  };
  if (notch) {
    let lowest = Infinity;
    for (let u = notch.u0; u <= notch.u1; u += 0.05) lowest = Math.min(lowest, height(u));
    if (lowest > notch.h + 0.3) piece(0, len, notch);
    else { piece(0, notch.u0, null); piece(notch.u1, len, null); }
  } else piece(0, len, null);
  return ledges;
}

/**
 * Broken walls for ruins: a hollow shell of four crumbled slabs (front, back, right, left).
 * Returns heightAt(wall, u) (u 0..1 along the wall) so windows can skip the gaps.
 */
function brokenShell(P, { W, D, H, gableRise = 0, t = 0.16, color, rand, doorX = 0, doorW = 0.9, doorH = 1.35, damage = 1 }) {
  const c = D / 2;
  const keepGable = rand.int(2, 3);
  const profiles = [0, 1, 2, 3].map((wi) => {
    const gable = wi >= 2;
    const dips = [];
    const nd = wi === 0 ? 1 : rand.int(1, 2);
    for (let k = 0; k < nd; k++) dips.push({ u: rand.float(0.22, 0.78), w: rand.float(0.1, 0.2), d: rand.float(0.3, 0.6) * damage });
    if (wi === keepGable) dips.forEach((d) => { d.d *= 0.4; });
    return (u) => {
      let h = H;
      if (gable && gableRise > 0) h += gableRise * Math.max(0, 1 - Math.abs(u - 0.5) * 2) * (wi === keepGable ? 1 : 0.6);
      let k = 0;
      for (const d of dips) k = Math.max(k, d.d * Math.exp(-((u - d.u) ** 2) / (2 * d.w * d.w)));
      h *= 1 - k;
      if (u < 0.07 || u > 0.93) h = Math.max(h, H * 0.92);
      return h;
    };
  });
  const sideLen = D - 2 * t;
  const walls = [
    { len: W, m: new THREE.Matrix4().makeTranslation(-W / 2, 0, c - t / 2) },
    { len: W, m: new THREE.Matrix4().makeRotationY(Math.PI).setPosition(W / 2, 0, -c + t / 2) },
    { len: sideLen, m: new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(W / 2 - t / 2, 0, c - t) },
    { len: sideLen, m: new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(-W / 2 + t / 2, 0, -c + t) },
  ];
  walls.forEach((wl, wi) => {
    const notch = wi === 0 ? { u0: doorX + W / 2 - doorW / 2, u1: doorX + W / 2 + doorW / 2, h: doorH } : null;
    crumbleWall(P, { len: wl.len, t, height: (u) => profiles[wi](u / wl.len), rand, color, matrix: wl.m, notch, jitter: 0.08 * damage + 0.02 });
  });
  return (wall, u) => profiles[wall](u);
}

function rubble(P, rand, { count = 8, x0, x1, z0, z1, color, wood = null }) {
  for (let i = 0; i < count; i++) {
    const r = rand.float(0.08, 0.17);
    P.add(blob(r, { detail: 1, amp: 0.2, seed: i * 13 + 5, squash: [1.2, 0.7, 1] }), shade(color, rand.float(-0.08, 0.03)), { at: [rand.float(x0, x1), r * 0.45, rand.float(z0, z1)], rot: [0, rand.angle(), 0] });
  }
  if (wood) {
    for (let i = 0; i < 3; i++) {
      const x = rand.float(x0, x1), z = rand.float(z0, z1), a = rand.angle(), l = rand.float(0.5, 1.0);
      plank(P, [x - Math.cos(a) * l / 2, 0.05, z - Math.sin(a) * l / 2], [x + Math.cos(a) * l / 2, 0.05 + rand.float(0, 0.12), z + Math.sin(a) * l / 2], 0.12, 0.05, shade(wood, rand.float(-0.05, 0.05)));
    }
  }
}

/** Weeds and moss tufts (seasonal) for ruins. */
function weeds(P, rand, season, spots) {
  const leaf = seasonal(MOSS, season);
  spots.forEach(([x, y, z, r = 0.14], i) => {
    P.add(blob(r, { detail: 1, amp: 0.18, seed: i * 5 + 11, squash: [1.25, 0.62, 1.1] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(leaf, rand.float(-0.06, 0.04)) }, { at: [x, y + r * 0.25, z] });
  });
}

/** A wall lantern: bracket, glass and cap. Its front faces +Z from the wall at z = 0. */
function wallLantern(P, at, lit) {
  const [x, y, z] = at;
  P.add(roundBox(0.07, 0.2, 0.07, 0.02, 1), METAL(), { at: [x, y - 0.02, z + 0.035] });
  plank(P, [x, y + 0.12, z + 0.03], [x, y + 0.12, z + 0.2], 0.035, 0.035, METAL(), { r: 0.012 });
  P.add(roundCyl(0.07, 0.17, { top: 0.085, bevel: 0.02, segments: 12, steps: 1 }), lit ? LAMP : { slot: 'glass', color: '#e9e2cf', glowAmount: 0 }, { at: [x, y - 0.1, z + 0.2] });
  P.add(cone(0.115, 0.09, 12), METAL(), { at: [x, y + 0.06, z + 0.2] });
  P.add(sphere(0.025, 8, 6), METAL(), { at: [x, y + 0.16, z + 0.2] });
}

const HOUSE = {
  label: 'House',
  about: 'A cottage with a big friendly roof, a chunky door and framed windows. Shops get a sign board over the eave and a striped awning over a display window. It can be boarded up, ruined or burnt, and its windows glow at night.',
  params: {
    walls: { default: PALETTE.wallCream, type: 'color', about: 'wall color' },
    roof: { default: PALETTE.roofRed, type: 'color', about: 'roof color' },
    roofStyle: { default: 'gable', options: ['gable', 'hip', 'round'], about: 'roof shape' },
    size: { default: 'medium', options: ['small', 'medium', 'large'], about: 'footprint: small 2.7 × 2.4, medium 3.3 × 2.8, large 4.2 × 3.2' },
    stories: { default: 1, options: [1, 2], min: 1, max: 2, about: 'storeys (1.9 of wall each)' },
    door: { default: '#5d8fc4', type: 'color', about: 'door color' },
    windows: { default: 'square', options: ['square', 'round', 'arch'], about: 'window shape' },
    chimney: { default: true, about: 'a brick chimney on the roof' },
    smoke: { default: false, about: 'smoke puffs drifting from the chimney' },
    porch: { default: false, about: 'a wooden porch with a little canopy over the door' },
    sign: { default: '', about: 'shop name on a board over the front eave (empty = no sign)' },
    awning: { default: '', type: 'color', about: 'color of a striped shop awning over a display window (empty = none)' },
    shutters: { default: false, about: 'window shutters (true, or a color)' },
    flowerbox: { default: false, about: 'flower boxes under the front windows (seasonal)' },
    trim: { default: '', type: 'color', about: 'frames, sills and barge boards (empty = automatic)' },
    state: { default: 'intact', options: STATES, about: 'intact, boarded up, ruined (roof caved in) or burnt' },
    lit: { default: true, about: 'windows glow at night, with a warm lantern by the door' },
  },
  examples: [
    {},
    { walls: PALETTE.wallMint, roof: PALETTE.roofBlue, roofStyle: 'hip', size: 'small', door: '#e0a03c', windows: 'round', flowerbox: true },
    { walls: PALETTE.wallPeach, roof: PALETTE.roofGreen, roofStyle: 'round', door: PALETTE.woodRed, shutters: true, porch: true, smoke: true },
    { walls: PALETTE.wallLemon, roof: PALETTE.roofOrange, size: 'large', stories: 2, door: '#4f9e8c', windows: 'arch', flowerbox: true, shutters: '#5f9e6e' },
    { walls: PALETTE.wallSky, roof: PALETTE.roofTeal, sign: 'Bakery', awning: PALETTE.cloth.red, door: PALETTE.wallCream, smoke: true },
    { walls: PALETTE.wallPink, roof: PALETTE.roofPurple, size: 'small', state: 'boarded' },
    { walls: PALETTE.wallCream, roof: PALETTE.roofBrown, state: 'ruined' },
    { walls: PALETTE.wallTimber, roof: PALETTE.roofSlate, state: 'burnt', size: 'large' },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const state = oneOf(p.state, STATES, 'intact');
    const wrecked = state === 'ruined' || state === 'burnt';
    const sizeName = oneOf(p.size, Object.keys(HOUSE_SIZES), 'medium');
    const [W, D] = HOUSE_SIZES[sizeName];
    const stories = Math.round(numOr(p.stories, 1, 1, 2));
    const roofStyle = oneOf(p.roofStyle, ['gable', 'hip', 'round'], 'gable');
    const winShape = oneOf(p.windows, ['square', 'round', 'arch'], 'square');
    let walls = colorOr(p.walls, PALETTE.wallCream);
    let roofC = colorOr(p.roof, PALETTE.roofRed);
    let doorC = colorOr(p.door, '#5d8fc4');
    let trim = colorOr(p.trim, null) ?? autoTrim(walls);
    let shutters = typeof p.shutters === 'string' ? colorOr(p.shutters, null) : null;
    if (!shutters && boolOr(p.shutters, false)) shutters = shade(roofC, -0.02, { sat: -0.1 });
    const awning = colorOr(p.awning, null);
    const sign = textOr(p.sign, '');
    const lit = boolOr(p.lit, true) && state === 'intact';
    const chimney = boolOr(p.chimney, true);
    const smoke = boolOr(p.smoke, false) && chimney && state === 'intact';
    const porch = boolOr(p.porch, false) && !wrecked;
    const flowerbox = boolOr(p.flowerbox, false) && state === 'intact';
    let stone = PALETTE.stone;
    if (state === 'boarded') {
      walls = mix(walls, '#b9b2a6', 0.28); roofC = mix(roofC, '#8f8a84', 0.3); doorC = mix(doorC, '#8f8a84', 0.4); trim = mix(trim, '#b9b2a6', 0.3);
      if (shutters) shutters = mix(shutters, '#8f8a84', 0.35);
    } else if (state === 'ruined') {
      walls = mix(walls, '#a39a8c', 0.38); roofC = mix(roofC, '#7f7a74', 0.4); trim = mix(trim, '#a39a8c', 0.35); stone = PALETTE.stoneDark;
      shutters = null;
    } else if (state === 'burnt') {
      walls = mix(walls, SOOT, 0.62); roofC = mix(roofC, SOOT, 0.7); trim = mix(trim, SOOT, 0.6); stone = mix(PALETTE.stoneDark, SOOT, 0.4);
      shutters = null;
    }
    const glass = state === 'intact' ? (lit ? 'lit' : 'dark') : state === 'boarded' ? 'dark' : 'hole';

    const P = new Parts();
    const group = new THREE.Group();
    const H = 1.9 * stories;
    const c = D / 2;
    const rise = 0.38 * D + 0.05;

    // walls on a stone plinth
    P.add(roundBox(W + 0.14, 0.2, D + 0.14, 0.05, 1), stone);
    if (!wrecked) {
      P.add(roundBox(W, H, D, 0.06, 2), walls);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(roundBox(0.15, H - 0.14, 0.15, 0.05, 1), trim, { at: [sx * (W / 2 - 0.045), 0.14, sz * (c - 0.045)] });
      if (stories === 2) P.add(roundBox(W + 0.07, 0.11, D + 0.07, 0.04, 1), trim, { at: [0, 1.86, 0] });
    }

    // front layout: door, windows, display window. A shop has its door at the left with room
    // for a lantern beside it (or for a porch, whose canopy must stop short of the awning).
    let doorX = 0;
    const frontWins = [];
    let display = null;
    let porchR = null;
    const ww = sizeName === 'large' ? 0.62 : 0.5, wh = winShape === 'round' ? ww : 0.62;
    if (awning) {
      doorX = porch ? -(W / 2 - 0.75) : -(W / 2 - 0.95);
      const dr = W / 2 - 0.42;
      let dl = doorX + 0.86;
      if (porch) {
        porchR = clamp(dr - 0.6 - 0.43, doorX + 0.55, doorX + 0.9);
        dl = porchR + 0.43;
      }
      const w = Math.max(0.6, dr - dl);
      display = { x: porch ? dl + w / 2 : (dl + dr) / 2, w };
    } else if (W < 3) {
      doorX = -0.4;
      frontWins.push(0.66);
    } else {
      const x = sizeName === 'large' ? W / 2 - 0.95 : W / 2 - 0.72;
      frontWins.push(-x, x);
    }
    const aw = display ? display.w + 0.36 : 0;
    // the lantern goes on the wall beside the door where there is room, else it hangs from the eave
    const obstacles = [...frontWins.map((x) => [x - ww / 2 - 0.075, x + ww / 2 + 0.075]), ...(display ? [[display.x - aw / 2 - 0.06, display.x + aw / 2 + 0.06]] : [])];
    let leftEdge = -W / 2 + 0.14, rightEdge = W / 2 - 0.14;
    const doorL = doorX - 0.46, doorR = doorX + 0.46;
    for (const [a, b] of obstacles) { if (b <= doorL) leftEdge = Math.max(leftEdge, b); if (a >= doorR) rightEdge = Math.min(rightEdge, a); }
    const spaceL = doorL - leftEdge, spaceR = rightEdge - doorR;
    const lantern = Math.max(spaceL, spaceR) >= 0.3
      ? { x: spaceR >= spaceL ? doorR + Math.min(spaceR / 2, 0.22) : doorL - Math.min(spaceL / 2, 0.22), hang: false }
      : { x: doorX + (spaceR >= spaceL ? 0.62 : -0.62), hang: true };
    const winY = 1.05;
    const doorState = state === 'boarded' ? 'boarded' : wrecked ? 'missing' : 'closed';
    const winOpts = { w: ww, h: wh, shape: winShape, frame: trim, glass, season, rand: stream(ctx, 'deco'), boarded: state === 'boarded' };
    const frontWin = windowParts({ ...winOpts, shutters, flowerbox });
    const upperWin = windowParts({ ...winOpts, shutters });
    const sideWin = windowParts({ ...winOpts, shutters: null, w: Math.min(ww, 0.5) });

    let wallH = null;
    if (wrecked) {
      wallH = brokenShell(P, { W, D, H, gableRise: stories === 1 ? rise * 0.9 : 0, color: walls, rand, doorX, doorW: 0.92, doorH: 1.4, damage: state === 'burnt' ? 0.75 : 1 });
      P.add(roundBox(W - 0.3, 0.05, D - 0.3, 0.02, 1), state === 'burnt' ? '#2e2724' : PALETTE.woodDark, { at: [0, 0.2, 0] });
    }
    const fits = (wall, u, top) => !wallH || wallH(wall, u) > top + 0.12;
    // door, step and mat
    P.merge(doorParts({ color: doorC, frame: trim, arch: true, glass, state: doorState }), xform([doorX, 0.08, c]));
    P.add(roundBox(1.0, 0.09, 0.44, 0.035, 1), stone, { at: [doorX, 0, c + 0.21] });
    if (state === 'intact' && !porch) P.add(roundBox(0.62, 0.025, 0.3, 0.012, 1), { slot: 'cloth', color: PALETTE.cloth.green }, { at: [doorX, 0.09, c + 0.25] });

    // windows (front, sides, back, upstairs)
    const winTop = winY + wh / 2 + 0.08;
    for (const x of frontWins) if (fits(0, (x + W / 2) / W, winTop)) P.merge(frontWin, xform([x, winY, c]));
    const sideZ = sizeName === 'small' ? 0 : -0.12;
    if (fits(2, (c - sideZ) / D, winTop)) P.merge(sideWin, xform([W / 2, winY, sideZ], [0, Math.PI / 2, 0]));
    if (fits(3, (sideZ + c) / D, winTop)) P.merge(sideWin, xform([-W / 2, winY, sideZ], [0, -Math.PI / 2, 0]));
    if (fits(1, 0.5 - 0.22, winTop)) P.merge(sideWin, xform([W * 0.22, winY, -c], [0, Math.PI, 0]));
    if (stories === 2) {
      const upY = 1.9 + 1.02;
      const ups = W < 3 ? [-0.55, 0.55] : [-(W / 2 - 0.78), 0, W / 2 - 0.78];
      for (const x of ups) if (fits(0, (x + W / 2) / W, upY + 0.4)) P.merge(upperWin, xform([x, upY, c]));
      if (fits(2, 0.5, upY + 0.4)) P.merge(sideWin, xform([W / 2, upY, 0], [0, Math.PI / 2, 0]));
      if (fits(3, 0.5, upY + 0.4)) P.merge(sideWin, xform([-W / 2, upY, 0], [0, -Math.PI / 2, 0]));
    }
    if (display) {
      const dw = display.w, dh = 0.8;
      P.merge(windowParts({ w: dw, h: dh, shape: 'square', frame: trim, glass, boarded: state === 'boarded' }), xform([display.x, 0.98, c]));
      if (glass !== 'hole') for (const f of [-1 / 6, 1 / 6]) P.add(roundBox(0.045, dh, 0.04, 0.015, 1), trim, { at: [display.x + f * dw, 0.98 - dh / 2, c + 0.05] });
    }

    // roof
    let roof = null;
    if (!wrecked) {
      const gableWin = windowParts({ w: 0.36, h: 0.36, shape: 'round', frame: trim, glass: glass === 'lit' ? 'dark' : glass, sill: false });
      roof = addRoof(P, { style: roofStyle, W, D, y0: H, rise, color: roofC, trim, walls, gableWindow: roofStyle === 'hip' ? null : gableWin });
    } else {
      // a caved-in roof: the ridge beam, rafters and (when ruined) a few surviving panels
      const a = Math.atan2(rise, c), ta = Math.tan(a), sa = Math.sin(a), ca = Math.cos(a);
      const beam = state === 'burnt' ? '#3d322c' : PALETTE.woodDark;
      const L = W + 0.4;
      const ridgeY = H + rise;
      const brokenAt = rand.float(-0.2, 0.25) * W;
      plank(P, [-L / 2, ridgeY, 0], [brokenAt - 0.1, ridgeY, 0], 0.14, 0.14, beam);
      plank(P, [brokenAt + 0.15, ridgeY - 0.08, 0], [L / 2 - 0.1, ridgeY - 0.45, 0.06], 0.14, 0.14, shade(beam, 0.03));
      const n = Math.round(W / 0.55);
      for (let i = 0; i <= n; i++) {
        const x = -W / 2 + 0.06 + (i * (W - 0.12)) / n;
        const sag = x > brokenAt ? 0.06 + (x - brokenAt) / (L / 2 - brokenAt) * 0.37 : 0;
        for (const sz of [-1, 1]) {
          if (rand.chance(state === 'burnt' ? 0.35 : 0.2)) continue;
          const keep = rand.chance(0.5) ? 1 : rand.float(0.35, 0.8);
          const z1 = sz * (c + 0.25) * keep;
          const y1 = ridgeY - Math.abs(z1) * ta;
          plank(P, [x, ridgeY - 0.06 - sag, 0], [x, y1 - 0.04 - sag * (1 - keep), z1], 0.08, 0.1, shade(beam, rand.float(-0.04, 0.04)));
        }
      }
      if (state === 'ruined') {
        // surviving roof panels on the back slope, and a strip on the front
        const pw = 0.62;
        const cnt = Math.floor(L / pw);
        for (let i = 0; i < cnt; i++) {
          const x = -L / 2 + pw / 2 + i * pw;
          if (Math.abs(x - brokenAt) < 0.8 || rand.chance(0.25)) continue;
          plank(P, [x, ridgeY + 0.12, -0.02], [x, ridgeY + 0.12 - (c + 0.3) * ta, -(c + 0.3)], pw - 0.03, 0.14, shade(roofC, rand.float(-0.05, 0.03)), { up: [0, ca, -sa] });
        }
        for (let i = 0; i < cnt; i++) {
          const x = -L / 2 + pw / 2 + i * pw;
          if (x > brokenAt - 0.9) break;
          plank(P, [x, ridgeY + 0.12, 0.02], [x, ridgeY + 0.12 - (c + 0.3) * ta, c + 0.3], pw - 0.03, 0.14, shade(roofC, rand.float(-0.05, 0.03)), { up: [0, ca, sa] });
        }
        plank(P, [brokenAt - 0.5, 0.25, 0.4], [brokenAt + 0.5, 1.0, -0.3], 0.6, 0.12, shade(roofC, -0.05), { up: [0.3, 1, 0.2] });
        weeds(P, rand, season, [[-W / 2 - 0.1, 0, c + 0.1, 0.18], [W / 2 + 0.05, 0, -c * 0.4, 0.2], [W * 0.3, 0.2, c * 0.2, 0.16], [-W * 0.25, 0.2, -c * 0.3, 0.2]]);
      }
      rubble(P, rand, { count: 10, x0: -W / 2 - 0.4, x1: W / 2 + 0.4, z0: c + 0.2, z1: c + 0.95, color: state === 'burnt' ? '#4a4440' : stone, wood: beam });
      rubble(P, rand, { count: 6, x0: -W / 2 + 0.4, x1: W / 2 - 0.4, z0: -c + 0.4, z1: c - 0.5, color: state === 'burnt' ? '#3e3733' : stone });
    }

    // chimney: on the roof, or a lone brick stack standing in a ruin
    let puffs = null;
    if (chimney) {
      const brick = wrecked ? mix(PALETTE.brick, state === 'burnt' ? SOOT : '#8a817a', 0.45) : PALETTE.brick;
      const cx = W / 2 - 0.42, cz = roofStyle === 'hip' && !wrecked ? -c * 0.3 : -c * 0.4;
      if (wrecked) {
        const top = H + rise * rand.float(0.45, 0.8);
        P.add(roundBox(0.46, top, 0.46, 0.05, 1), brick, { at: [W / 2 - 0.3, 0, -c * 0.35] });
        P.add(roundBox(0.3, 0.16, 0.36, 0.04, 1), shade(brick, -0.04), { at: [W / 2 - 0.36, top - 0.04, -c * 0.35 + 0.03], rot: [0, 0, 0.12] });
      } else {
        const base = roof.topAt(cx, cz - 0.24) - 0.12;
        const topY = Math.max(roof.ridge + 0.3, roof.topAt(cx, cz + 0.24) + 0.55);
        P.add(roundBox(0.46, topY - base, 0.46, 0.05, 1), brick, { at: [cx, base, cz] });
        P.add(roundBox(0.58, 0.14, 0.58, 0.045, 1), PALETTE.stoneLight, { at: [cx, topY - 0.02, cz] });
        P.add(box(0.3, 0.02, 0.3), HOLE, { at: [cx, topY + 0.11, cz] });
        for (const yy of [0.3, 0.58]) P.add(box(0.47, 0.035, 0.47), shade(brick, -0.08), { at: [cx, topY - yy, cz] });
        if (smoke) puffs = smokePuffs(group, [cx, topY + 0.28, cz], { phase: stream(ctx, 'anim').float(0, 5) });
      }
    }

    // porch: deck, posts, railing and a little canopy tucked under the eave
    let porchSpot = null;
    let porchLamp = null;
    let porchSpan = null;
    const deck = 0.16;
    if (porch) {
      const pa = Math.max(-W / 2 + 0.06, doorX - 1.15), pb = porchR ?? Math.min(W / 2 - 0.06, doorX + 1.15);
      const pw = pb - pa, pd = 1.0, px = (pa + pb) / 2;
      const front = c + pd + 0.12;
      porchSpan = [pa, pb];
      P.add(roundBox(pw, deck, pd, 0.03, 1), PALETTE.wood, { at: [px, 0, c + pd / 2] });
      for (let i = 1; i < 5; i++) P.add(box(pw - 0.04, 0.012, 0.014), PALETTE.woodDark, { at: [px, deck - 0.008, c + (i * pd) / 5] });
      P.add(roundBox(0.8, 0.08, 0.3, 0.025, 1), PALETTE.woodDark, { at: [px, 0, c + pd + 0.14] });
      // the canopy tucks under the eave of a cottage, or sits over the ground floor of a two-storey house
      const s = stories === 2 ? 0.3 : 0.2;
      const yAt = stories === 2 ? (z) => 2.1 - (z - c) * s : (z) => roof.eaveBottom - 0.05 - (z - roof.eaveZ) * s;
      const y1 = yAt(front);
      for (const sx of [-1, 1]) {
        const x = px + sx * (pw / 2 - 0.08);
        P.add(roundBox(0.11, y1 - 0.06 - deck, 0.11, 0.03, 1), trim, { at: [x, deck, c + pd - 0.08] });
        P.add(roundBox(0.07, 0.07, pd - 0.15, 0.02, 1), trim, { at: [x, deck + 0.42, c + pd / 2 - 0.02] });
        for (let k = 0; k < 3; k++) P.add(roundBox(0.05, 0.42, 0.05, 0.015, 1), trim, { at: [x, deck, c + 0.2 + k * 0.25] });
      }
      plank(P, [px, yAt(c) - 0.05, c - 0.02], [px, y1 - 0.05, front], pw + 0.3, 0.1, roofC, { up: [0, 1, s], r: 0.035 });
      plank(P, [px - pw / 2 - 0.15, y1 - 0.06, front], [px + pw / 2 + 0.15, y1 - 0.06, front], 0.07, 0.12, trim);
      // the porch spot stands beside the door on the roomier side, at least 0.6 from the door spot
      const roomL = doorX - pa, roomR = pb - doorX;
      const side = roomR >= roomL ? 1 : -1;
      const dx = clamp(Math.max(roomL, roomR) - 0.34, 0.3, 0.7);
      const pz = dx >= 0.6 ? c + 0.5 : Math.min(c + 0.4 + Math.sqrt(0.36 - dx * dx), c + pd - 0.2);
      porchSpot = spot([doorX + side * dx, deck, pz], 0, 'stand');
      // the lamp hangs just under the canopy near the wall on the other side of the door, clear of heads
      const lz = c + 0.26;
      const lroom = side > 0 ? roomL : roomR;
      const lx = doorX - side * clamp(lroom - 0.16, 0.3, 0.45);
      porchLamp = [lx, yAt(lz) - 0.22, lz];
      if (state === 'intact') {
        rod(P, [lx, porchLamp[1] + 0.1, lz], [lx, yAt(lz) - 0.06, lz], 0.014, METAL(), { seg: 6 });
        P.add(sphere(0.1, 12, 10), lit ? LAMP : { slot: 'glass', color: '#e9e2cf', glowAmount: 0 }, { at: porchLamp });
        P.add(cone(0.11, 0.07, 12), METAL(), { at: [lx, porchLamp[1] + 0.06, lz] });
      }
    }

    // awning over the display window: stripes with a scalloped valance and iron brackets
    if (display && !wrecked) {
      const n = Math.max(5, Math.round(aw / 0.2)) | 1;
      const sw = aw / n;
      const yTop = 1.7, yLow = 1.42, out = 0.64;
      const cream = '#f7efe0';
      const ac = state === 'boarded' ? mix(awning, '#8f8a84', 0.4) : awning;
      const slope = new THREE.Vector3(0, yLow - yTop, out).normalize();
      const nrm = [0, slope.z, -slope.y];
      for (let i = 0; i < n; i++) {
        const x = display.x - aw / 2 + sw * (i + 0.5);
        const col = i % 2 ? cream : ac;
        plank(P, [x, yTop, c + 0.02], [x, yLow, c + out], sw + 0.002, 0.04, { slot: 'cloth', color: col }, { up: nrm, r: 0.012 });
        const flap = new THREE.Shape();
        flap.moveTo(-sw / 2, 0);
        flap.lineTo(sw / 2, 0);
        flap.absarc(0, 0, sw / 2, 0, -Math.PI, true);
        P.add(slab(flap, 0.02, { bevel: 0.008, seg: 1, curve: 6 }), { slot: 'cloth', color: col }, { at: [x, yLow + 0.005, c + out + 0.005] });
      }
      plank(P, [display.x - aw / 2 - 0.02, yLow + 0.01, c + out], [display.x + aw / 2 + 0.02, yLow + 0.01, c + out], 0.05, 0.05, METAL());
      for (const sx of [-1, 1]) rod(P, [display.x + sx * aw / 2, yLow - 0.35, c + 0.02], [display.x + sx * aw / 2, yLow + 0.01, c + out - 0.02], 0.018, METAL(), { seg: 6 });
    }

    // shop sign standing on the roof just above the front eave, clear of the awning and the door
    if (sign && !wrecked) {
      roofSign(P, roof, { text: sign, w: Math.min(W * 0.58, 1.9), frame: state === 'boarded' ? PALETTE.woodGrey : PALETTE.woodDark });
    }

    // a warm lantern by the door, and one lit window
    const lights = [];
    if (state === 'intact' && !porch) {
      if (!lantern.hang) {
        wallLantern(P, [lantern.x, 1.3, c], lit);
        if (lit) lights.push(light([lantern.x, 1.25, c + 0.38], { intensity: 0.9, distance: 4.5 }));
      } else {
        const lz = c + 0.3, lx = lantern.x;
        const yU = roof.underAt(lx, lz);
        const ly = Math.max(1.5, Math.min(yU - 0.3, 1.62));
        rod(P, [lx, ly + 0.08, lz], [lx, yU + 0.03, lz], 0.013, METAL(), { seg: 6 });
        P.add(roundCyl(0.072, 0.17, { top: 0.088, bevel: 0.02, segments: 12, steps: 1 }), lit ? LAMP : { slot: 'glass', color: '#e9e2cf', glowAmount: 0 }, { at: [lx, ly - 0.085, lz] });
        P.add(cone(0.12, 0.08, 12), METAL(), { at: [lx, ly + 0.08, lz] });
        P.add(sphere(0.028, 8, 6), METAL(), { at: [lx, ly - 0.1, lz] });
        if (lit) lights.push(light([lx, ly - 0.05, lz + 0.12], { intensity: 0.9, distance: 4.5 }));
      }
    } else if (porchLamp && lit) {
      lights.push(light([porchLamp[0], porchLamp[1] - 0.05, porchLamp[2]], { intensity: 0.9, distance: 4.5 }));
    }
    if (lit) {
      const wx = display ? display.x : frontWins.length ? frontWins[frontWins.length - 1] : 0;
      lights.push(light([wx, winY, c + 0.42], { intensity: 0.55, distance: 3 }));
    }

    group.add(P.build('house'));
    const doorSpot = spot([doorX, porch ? deck : 0.09, porch ? c + 0.4 : c + 0.28], 0, 'stand');
    // the window spot looks in at a front window; on a porch it stands on the deck clear of the
    // railings and the other spots, or else at a side window
    const taken = [doorSpot, porchSpot].filter(Boolean).map((s) => [s.at[0], s.at[2]]);
    let windowSpot = null;
    for (const x of display ? [display.x] : [...frontWins].reverse()) {
      if (!porchSpan || x < porchSpan[0] - 0.3 || x > porchSpan[1] + 0.3) { windowSpot = spot([x, 0, c + 0.62], 180, 'stand'); break; }
      const sx = clamp(x, porchSpan[0] + 0.36, porchSpan[1] - 0.36);
      if (taken.every(([qx, qz]) => Math.hypot(sx - qx, c + 0.62 - qz) >= 0.55)) { windowSpot = spot([sx, deck, c + 0.62], 180, 'stand'); break; }
    }
    windowSpot ??= spot([W / 2 + 0.62, 0, sideZ], -90, 'stand');
    // without a porch, the porch spot waits in front of the house on the side away from the window
    porchSpot ??= spot([doorX + (windowSpot.at[0] > doorX ? -1.05 : 1.05), 0, c + 1.0], 0, 'stand');
    const spots = { door: doorSpot, porch: porchSpot, window: windowSpot };
    return finish(group, {
      footprint: wrecked ? { w: W + 1.4, d: D + 2.4 } : { w: W + 0.8, d: D + (porch ? 2.8 : 1.4) },
      spots,
      lights,
      tick: puffs,
      height: wrecked ? H + rise : roof.ridge,
    });
  },
};

/* ───────────────────────── shared bits for the bigger buildings ───────────────────────── */

/** A lathe with flat faces (`segments` sides, one face toward +Z). */
function facetLathe(profile, segments = 8) {
  const g = lathe(profile, segments);
  g.rotateY(Math.PI / segments);
  g.deleteAttribute('normal');
  return g;
}

/** A flag hanging from `at` along +X in a few segments that wave in the wind. */
function wavingFlag(group, at, { w = 0.7, h = 0.42, color = PALETTE.cloth.red, stripe = null, segs = 4, phase = 0 } = {}) {
  const root = new THREE.Group();
  root.position.set(at[0], at[1], at[2]);
  group.add(root);
  const segW = w / segs;
  const nodes = [];
  let parent = root;
  for (let i = 0; i < segs; i++) {
    const hh = h * (1 - i * 0.07);
    const piece = new Parts().add(roundBox(segW + 0.006, hh, 0.028, 0.012, 1), { slot: 'cloth', color }, { at: [segW / 2, -hh / 2 - h / 2, 0] });
    if (stripe) piece.add(roundBox(segW + 0.006, hh * 0.22, 0.034, 0.01, 1), { slot: 'cloth', color: stripe }, { at: [segW / 2, -h / 2 - hh * 0.11, 0] });
    const node = new THREE.Group();
    node.position.x = i === 0 ? 0 : segW;
    node.add(piece.build('flag'));
    parent.add(node);
    nodes.push(node);
    parent = node;
  }
  return (time) => {
    const t = time + phase;
    const wind = 0.45 + WORLD_UNIFORMS.uWind.value;
    nodes.forEach((n, i) => { n.rotation.y = Math.sin(t * 3.4 - i * 0.95) * (0.16 + 0.06 * i) * wind; });
    root.rotation.y = Math.sin(t * 0.6) * 0.15 * wind;
  };
}

/* ───────────────────────── windmill ───────────────────────── */

function sailBlade(P, { L, wood, cloth, cut = 1, clothOn = true }) {
  const len = Math.max(0.35, L * cut);
  plank(P, [0, 0.12, 0], [0, len, 0], 0.14, 0.1, wood, { up: [0, 0, 1] });
  if (len < 0.9) return;
  const y0 = 0.72;
  for (const x of [0.11, 0.64]) plank(P, [x, y0, 0.01], [x, len - 0.04, 0.01], 0.055, 0.055, wood, { up: [0, 0, 1], r: 0.018 });
  for (let y = y0; y <= len - 0.02; y += 0.27) stick(P, [-0.07, y, 0.025], [0.68, y, 0.025], 0.045, 0.035, wood, [0, 0, 1]);
  if (clothOn && len > y0 + 0.4) plank(P, [0.37, y0 + 0.05, -0.03], [0.37, len - 0.08, -0.03], 0.5, 0.025, { slot: 'cloth', color: cloth }, { up: [0, 0, 1], r: 0.01 });
  if (cut < 1) {
    // a splintered end
    plank(P, [0, len - 0.02, 0], [0.09, len + 0.16, 0.02], 0.08, 0.07, shade(wood, 0.06), { up: [0, 0, 1], r: 0.01 });
    plank(P, [0.64, len - 0.1, 0.01], [0.6, len + 0.05, 0.03], 0.045, 0.045, shade(wood, 0.06), { up: [0, 0, 1], r: 0.01 });
  }
}

const WINDMILL = {
  label: 'Windmill',
  about: 'An eight-sided wooden windmill on a stone base, with a rounded cap and four lattice sails that turn in the wind. Broken: sails snapped and still.',
  params: {
    body: { default: '#efe2c4', type: 'color', about: 'tower color' },
    roof: { default: PALETTE.roofRed, type: 'color', about: 'cap color' },
    sails: { default: '#f7f1e4', type: 'color', about: 'sail cloth color' },
    state: { default: 'intact', options: ['intact', 'broken'], about: 'intact (turning) or broken (snapped sails, not turning)' },
    speed: { default: 0.5, min: 0, max: 2.5, about: 'how fast the sails turn (radians per second)' },
    lit: { default: true, about: 'windows and a door lantern glow at night' },
  },
  examples: [
    {},
    { body: '#d6b68a', roof: PALETTE.roofBlue, sails: '#f3dcae' },
    { body: PALETTE.wallMint, roof: PALETTE.roofGreen, speed: 1.1 },
    { state: 'broken' },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const broken = oneOf(p.state, ['intact', 'broken'], 'intact') === 'broken';
    let body = colorOr(p.body, '#efe2c4'), roofC = colorOr(p.roof, PALETTE.roofRed), cloth = colorOr(p.sails, '#f7f1e4');
    const speed = numOr(p.speed, 0.5, 0, 2.5);
    let wood = PALETTE.woodDark, trim = PALETTE.wood;
    if (broken) { body = mix(body, '#a89e8e', 0.35); roofC = mix(roofC, '#7f7a74', 0.35); cloth = mix(cloth, '#b9ad98', 0.35); wood = mix(wood, '#6d6359', 0.3); trim = mix(trim, '#8f857a', 0.35); }
    const P = new Parts();
    const group = new THREE.Group();
    const cos8 = Math.cos(Math.PI / 8);
    // stone base and the tapering octagonal body
    const baseH = 0.32, y1 = 4.45, r0 = 1.34, r1 = 0.94;
    P.add(facetLathe([[0, 0], [1.55, 0], [1.58, 0.06], [1.55, baseH - 0.05], [1.5, baseH], [0, baseH]], 8), PALETTE.stone);
    P.add(facetLathe([[0, baseH], [r0, baseH], [r1, y1], [0, y1]], 8), body);
    const rAt = (y) => r0 + (r1 - r0) * (y - baseH) / (y1 - baseH);
    const tilt = Math.atan(((r0 - r1) * cos8) / (y1 - baseH));
    for (const y of [baseH, 1.75, 3.1, y1 - 0.14]) {
      const r = rAt(y) + 0.045, rr = rAt(y + 0.14) + 0.045;
      P.add(facetLathe([[rAt(y) - 0.1, y], [r, y], [r + 0.01, y + 0.05], [rr, y + 0.14], [rAt(y + 0.14) - 0.1, y + 0.14]], 8), trim);
    }
    // corner posts down the eight edges
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      rod(P, [Math.sin(a) * (r0 + 0.01), baseH, Math.cos(a) * (r0 + 0.01)], [Math.sin(a) * (r1 + 0.01), y1, Math.cos(a) * (r1 + 0.01)], 0.05, trim, { seg: 6 });
    }
    // door and windows mounted on the leaning front faces
    const mount = (y, ang = 0) => {
      const ap = rAt(y) * cos8;
      return new THREE.Matrix4().makeRotationY(ang).multiply(xform([0, y, ap], [-tilt, 0, 0]));
    };
    P.merge(doorParts({ color: broken ? '#7d6a58' : '#7d5236', frame: trim, arch: true, glass: broken ? 'hole' : 'lit', state: broken ? 'open' : 'closed', w: 0.66, h: 1.15 }), mount(baseH));
    P.add(roundBox(1.0, 0.16, 0.42, 0.04, 1), PALETTE.stoneDark, { at: [0, 0, 1.55 * cos8 + 0.12] });
    const lit = boolOr(p.lit, true) && !broken;
    const wl = new Parts();
    wallLantern(wl, [0, 0, 0], lit);
    P.merge(wl, mount(1.8));
    const win = windowParts({ w: 0.42, h: 0.42, shape: 'round', frame: trim, glass: broken ? 'hole' : lit ? 'lit' : 'dark', sill: false });
    P.merge(win, mount(2.45).multiply(xform([0, 0, 0])));
    P.merge(win, mount(3.55, Math.PI / 2));
    P.merge(win, mount(2.2, -Math.PI / 2));
    P.merge(windowParts({ w: 0.42, h: 0.42, shape: 'round', frame: trim, glass: broken ? 'hole' : 'dark', sill: false }), mount(3.0, Math.PI));
    if (broken) {
      // missing boards: dark gaps on a few faces
      for (const [y, ang] of [[1.2, 1.2], [2.8, -0.8], [3.7, 2.3]]) {
        const m = mount(y, Math.round(ang / (Math.PI / 4)) * (Math.PI / 4));
        P.add(roundBox(0.5, 0.22, 0.02, 0.01, 1), HOLE, { matrix: m.multiply(xform([rand.float(-0.15, 0.15), 0, 0.005])) });
      }
    }
    // cap
    const capY = y1 - 0.04;
    const cap = new Parts();
    cap.add(lathe([[0, 0], [1.14, 0], [1.2, 0.06], [1.17, 0.18], [1.05, 0.42], [0.86, 0.78], [0.6, 1.08], [0.32, 1.27], [0.1, 1.34], [0, 1.35]], 20), roofC);
    cap.add(ring(1.12, 0.07, { radial: 6, tubular: 28 }), shade(roofC, -0.12), { at: [0, 0.07, 0] });
    cap.add(sphere(0.13, 12, 10), METAL(PALETTE.gold), { at: [0, 1.42, 0] });
    cap.add(cyl(0.035, 0.25, { segments: 8 }), METAL(PALETTE.gold), { at: [0, 1.3, 0] });
    // axle housing
    cap.add(roundBox(0.42, 0.42, 0.6, 0.08, 1), shade(roofC, -0.05), { at: [0, 0.32, 0.88] });
    P.merge(cap, xform([0, capY, 0], [0, 0, broken ? 0.07 : 0]));
    // sails on a tilted hub
    const hub = new THREE.Group();
    const hubY = capY + 0.55 + (broken ? 0.06 : 0), hubZ = 1.38;
    hub.position.set(broken ? -0.05 : 0, hubY, hubZ);
    hub.rotation.x = -0.14;
    group.add(hub);
    const spin = new THREE.Group();
    hub.add(spin);
    const S = new Parts();
    rod(S, [0, 0, -0.55], [0, 0, 0.12], 0.1, wood, { seg: 10 });
    S.add(roundCyl(0.22, 0.18, { bevel: 0.05, segments: 16, steps: 2 }), trim, { at: [0, 0, 0.04], rot: [Math.PI / 2, 0, 0] });
    S.add(sphere(0.1, 10, 8), METAL(PALETTE.gold), { at: [0, 0, 0.24] });
    const L = 3.05;
    const cuts = broken ? [1, 0.42, 0.12, 0.7] : [1, 1, 1, 1];
    const clothOn = broken ? [false, true, false, false] : [true, true, true, true];
    for (let i = 0; i < 4; i++) {
      const blade = new Parts();
      sailBlade(blade, { L, wood, cloth, cut: cuts[i], clothOn: clothOn[i] });
      S.merge(blade, xform([0, 0, 0.05], [0, 0, (i * Math.PI) / 2]));
    }
    spin.add(S.build('sails'));
    const phase = broken ? 0.5 : rand.float(0, Math.PI / 2);
    spin.rotation.z = phase;
    if (broken) {
      // a fallen sail lying against the base
      const fallen = new Parts();
      sailBlade(fallen, { L: 1.9, wood, cloth, cut: 0.8, clothOn: true });
      P.merge(fallen, xform([1.35, 0.05, 1.0], [1.15, 0.6, 0.25]));
      weeds(P, rand, seasonOf(ctx), [[-1.5, 0, 0.6, 0.2], [1.2, 0, -1.1, 0.22], [-0.6, 0, -1.55, 0.18]]);
    }
    group.add(P.build('windmill'));
    const tick = broken || speed === 0 ? null : (t) => { spin.rotation.z = phase - t * speed; };
    return finish(group, {
      footprint: { r: broken ? 2.65 : 1.85 },
      spots: { door: spot([0, 0, 1.55 * cos8 + 0.55], 0, 'stand') },
      lights: lit ? [light([0, 1.72, 1.55 * cos8 + 0.55], { intensity: 0.6, distance: 3.5 })] : [],
      tick,
      height: hubY + L,
    });
  },
};

/* ───────────────────────── watermill ───────────────────────── */

const WATERMILL = {
  label: 'Watermill',
  about: 'A stone-and-timber mill house on a river bank with a big water wheel on its +X side that turns in the stream. The wheel reaches below the bank to the water (surface at y = -0.3), so set the +X side over the river.',
  params: {
    walls: { default: PALETTE.wallCream, type: 'color', about: 'plaster above the stone' },
    stone: { default: PALETTE.stone, type: 'color', about: 'stone lower walls' },
    roof: { default: PALETTE.roofBrown, type: 'color', about: 'roof color' },
    wheel: { default: PALETTE.wood, type: 'color', about: 'water wheel wood' },
    speed: { default: 0.45, min: 0, max: 2, about: 'wheel speed (radians per second)' },
    lit: { default: true, about: 'windows glow at night' },
  },
  examples: [
    {},
    { roof: PALETTE.roofRed, walls: PALETTE.wallPeach, wheel: PALETTE.woodRed },
    { roof: PALETTE.roofSlate, walls: PALETTE.wallTimber, stone: PALETTE.stoneLight, speed: 0.9 },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const walls = colorOr(p.walls, PALETTE.wallCream), stone = colorOr(p.stone, PALETTE.stone), roofC = colorOr(p.roof, PALETTE.roofBrown), wheelC = colorOr(p.wheel, PALETTE.wood);
    const speed = numOr(p.speed, 0.45, 0, 2);
    const lit = boolOr(p.lit, true);
    const glass = lit ? 'lit' : 'dark';
    const P = new Parts();
    const group = new THREE.Group();
    const W = 3.2, D = 2.8, H = 2.4, sH = 1.0, c = D / 2;
    const beam = PALETTE.woodDark;
    // foundation down to the river bed on every side, stone lower storey, plaster above
    P.add(roundBox(W + 0.22, 1.25, D + 0.22, 0.06, 1), shade(stone, -0.08), { at: [0, -1.05, 0] });
    P.add(roundBox(W + 0.06, sH, D + 0.06, 0.06, 2), stone);
    P.add(roundBox(W, H - sH + 0.02, D, 0.05, 2), walls, { at: [0, sH - 0.02, 0] });
    // stones standing out of the lower walls
    for (let i = 0; i < 16; i++) {
      const side = rand.pick([0, 0, 1, 2]);
      const w = rand.float(0.26, 0.42), h = rand.float(0.16, 0.24);
      const u = rand.float(-0.42, 0.42), y = rand.float(0.12, sH - 0.2);
      const col = shade(stone, rand.float(-0.07, 0.05));
      if (side === 0) P.add(roundBox(w, h, 0.08, 0.035, 1), col, { at: [u * W, y, c + 0.03] });
      else if (side === 1) P.add(roundBox(0.08, h, w, 0.035, 1), col, { at: [W / 2 + 0.03, y, u * D] });
      else P.add(roundBox(0.08, h, w, 0.035, 1), col, { at: [-W / 2 - 0.03, y, u * D] });
    }
    // half-timbering on the plaster
    const fy0 = sH + 0.02, fy1 = H - 0.04;
    for (const z of [c + 0.025, -c - 0.025]) {
      plank(P, [-W / 2, fy0, z], [W / 2, fy0, z], 0.06, 0.12, beam);
      plank(P, [-W / 2, fy1, z], [W / 2, fy1, z], 0.06, 0.12, beam);
    }
    for (const x of [W / 2 + 0.025, -W / 2 - 0.025]) {
      plank(P, [x, fy0, -c], [x, fy0, c], 0.06, 0.12, beam);
      plank(P, [x, fy1, -c], [x, fy1, c], 0.06, 0.12, beam);
      plank(P, [x, fy0, -c + 0.3], [x, fy1, -0.15], 0.06, 0.11, beam, { up: [0, 0, 1] });
    }
    for (const x of [-W / 2 + 0.05, -0.15, 0.25, W / 2 - 0.05]) P.add(roundBox(0.12, fy1 - fy0, 0.06, 0.02, 1), beam, { at: [x, fy0, c + 0.025] });
    // door, windows, a sack or two of flour
    const doorX = -0.62;
    P.merge(doorParts({ color: PALETTE.woodRed, frame: beam, arch: false, glass, w: 0.74, h: 1.24 }), xform([doorX, 0.08, c + 0.03]));
    P.add(roundBox(1.02, 0.09, 0.44, 0.035, 1), shade(stone, -0.05), { at: [doorX, 0, c + 0.23] });
    const win = windowParts({ w: 0.5, h: 0.5, shape: 'square', frame: TRIM, glass, sill: true });
    P.merge(win, xform([0.95, 1.6, c + 0.03]));
    P.merge(win, xform([-W / 2 - 0.03, 1.62, 0.2], [0, -Math.PI / 2, 0]));
    P.merge(win, xform([W / 2 + 0.03, 1.75, -0.55], [0, Math.PI / 2, 0]));
    P.merge(win, xform([0, 1.62, -c - 0.03], [0, Math.PI, 0]));
    for (const [x, z, s] of [[0.2, c + 0.42, 1], [0.48, c + 0.3, 0.85]]) {
      P.add(blob(0.2 * s, { detail: 2, amp: 0.06, seed: 3, squash: [1, 1.25, 0.9] }), '#efe4cc', { at: [x, 0.22 * s, z] });
      P.add(sphere(0.06 * s, 8, 6), '#e2d4b6', { at: [x, 0.5 * s, z] });
      P.add(ring(0.07 * s, 0.018, { radial: 5, tubular: 12 }), PALETTE.woodDark, { at: [x, 0.44 * s, z] });
    }
    // roof
    const gableWin = windowParts({ w: 0.34, h: 0.34, shape: 'round', frame: TRIM, glass: 'dark', sill: false });
    const roof = addRoof(P, { style: 'gable', W: W + 0.06, D: D + 0.06, y0: H, rise: 0.4 * D + 0.1, color: roofC, trim: PALETTE.woodLight, walls, gableWindow: gableWin });
    // the wheel on the +X side, turning about X
    const R = 1.15, wx = W / 2 + 0.47, wy = 0.75, wz = 0.15;
    const wheel = new THREE.Group();
    wheel.position.set(wx, wy, wz);
    group.add(wheel);
    const Wp = new Parts();
    for (const x of [-0.27, 0.27]) {
      Wp.add(ring(R, 0.065, { radial: 6, tubular: 30 }), wheelC, { at: [x, 0, 0], rot: [0, 0, Math.PI / 2] });
      Wp.add(ring(R - 0.3, 0.045, { radial: 5, tubular: 24 }), wheelC, { at: [x, 0, 0], rot: [0, 0, Math.PI / 2] });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        stick(Wp, [x, 0, 0], [x, Math.cos(a) * (R - 0.03), Math.sin(a) * (R - 0.03)], 0.07, 0.07, shade(wheelC, -0.05));
      }
    }
    const nPad = 16;
    for (let k = 0; k < nPad; k++) {
      const a = ((k + 0.5) / nPad) * Math.PI * 2;
      const rc = R - 0.12;
      plank(Wp, [-0.33, Math.cos(a) * rc, Math.sin(a) * rc], [0.33, Math.cos(a) * rc, Math.sin(a) * rc], 0.34, 0.05, shade(wheelC, k % 2 ? 0.03 : -0.02), { up: [0, -Math.sin(a), Math.cos(a)] });
    }
    rod(Wp, [-0.36, 0, 0], [0.36, 0, 0], 0.17, shade(wheelC, -0.1), { seg: 12 });
    wheel.add(Wp.build('wheel'));
    const phase = rand.float(0, TAU);
    wheel.rotation.x = phase;
    // axle into the wall, an outer bearing post standing in the river
    rod(P, [W / 2 - 0.1, wy, wz], [wx + 0.62, wy, wz], 0.07, METAL(PALETTE.ironLight), { seg: 10 });
    const px = wx + 0.5;
    const gy = wy + R + 0.22;
    P.add(roundBox(0.2, gy + 1.05, 0.24, 0.04, 1), beam, { at: [px, -1.05, wz] });
    P.add(roundBox(0.28, 0.22, 0.32, 0.05, 1), shade(beam, 0.05), { at: [px, wy - 0.11, wz] });
    plank(P, [px, -0.6, wz - 0.8], [px, wy - 0.15, wz - 0.06], 0.12, 0.12, beam, { up: [1, 0, 0] });
    plank(P, [W / 2 - 0.05, gy, wz], [px + 0.1, gy, wz], 0.16, 0.14, beam);
    // white water where the paddles meet the stream
    for (const [dz, s] of [[-0.55, 0.22], [0.0, 0.3], [0.5, 0.2], [0.9, 0.15]]) {
      P.add(blob(s, { detail: 1, amp: 0.25, seed: Math.round(dz * 10) + 7, squash: [1.4, 0.35, 1] }), { slot: 'clear', color: '#f4fbff', opacity: 0.75, rough: 0.4 }, { at: [wx + rand.float(-0.1, 0.1), -0.29, wz + dz] });
    }
    group.add(P.build('watermill'));
    const lights = lit ? [light([doorX, 1.2, c + 0.5], { intensity: 0.6, distance: 3.5 }), light([0.95, 1.6, c + 0.45], { intensity: 0.55, distance: 3 })] : [];
    return finish(group, {
      footprint: { w: W + 0.6, d: D + 1.2 },
      spots: { door: spot([doorX, 0.09, c + 0.32], 0, 'stand'), bank: spot([W / 2 + 0.1, 0, c + 0.7], 90, 'stand') },
      lights,
      tick: speed > 0 ? (t) => { wheel.rotation.x = phase - t * speed; } : null,
      height: roof.ridge,
    });
  },
};

/* ───────────────────────── barn ───────────────────────── */

/** Gambrel outline points (x, y) from the left eave over the ridge to the right eave. */
function gambrel(halfW, yWall, over, t, lift = 0) {
  const x0 = halfW + over, kneeX = halfW * 0.62, ridgeY = yWall + halfW * 1.02 + lift;
  const kneeY = yWall + (halfW - kneeX) * 2.1;
  const eaveY = yWall - over * 2.1;
  return [[-x0, eaveY], [-kneeX, kneeY], [0, ridgeY], [kneeX, kneeY], [x0, eaveY]];
}

const BARN = {
  label: 'Barn',
  about: 'A big red barn with a gambrel roof, white-trimmed double doors that open onto a hay-filled front bay (someone can stand inside), a hay loft door with a pulley beam, a cupola with a rooster vane and a hay bale to sit on. Old: faded, patched and missing boards.',
  params: {
    walls: { default: '#c2473a', type: 'color', about: 'board color' },
    roof: { default: PALETTE.roofSlate, type: 'color', about: 'roof color' },
    trim: { default: '#f6efe2', type: 'color', about: 'trim and door braces' },
    state: { default: 'intact', options: ['intact', 'old'], about: 'intact or old (faded, patched, a door hanging)' },
    doors: { default: 'closed', options: ['closed', 'open'], about: 'big doors closed or swung open' },
    lit: { default: true, about: 'a gooseneck lamp over the doors glows at night' },
  },
  examples: [
    {},
    { doors: 'open', roof: PALETTE.roofBrown },
    { walls: '#7f9c6b', roof: PALETTE.roofRed, trim: '#f4ead2' },
    { state: 'old' },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const old = oneOf(p.state, ['intact', 'old'], 'intact') === 'old';
    const open = oneOf(p.doors, ['closed', 'open'], 'closed') === 'open';
    let walls = colorOr(p.walls, '#c2473a'), roofC = colorOr(p.roof, PALETTE.roofSlate), trim = colorOr(p.trim, '#f6efe2');
    if (old) { walls = mix(walls, '#9a8a7a', 0.4); roofC = mix(roofC, '#8a847c', 0.3); trim = mix(trim, '#b8ad9c', 0.35); }
    const P = new Parts();
    const group = new THREE.Group();
    const W = 4.6, D = 5.4, Hw = 2.3, hw = W / 2, c = D / 2;
    const groove = shade(walls, -0.1);
    const lit = boolOr(p.lit, true) && !old;
    // stone footing; solid walls behind an open front bay that the big doors close
    const dw = 2.1, dh = 2.05, dz = c + 0.02;
    const bay = 1.7, tw = 0.14;
    P.add(roundBox(W + 0.16, 0.24, D + 0.16, 0.05, 1), PALETTE.stoneDark);
    P.add(roundBox(W, Hw, D - bay, 0.06, 2), walls, { at: [0, 0, -bay / 2] });
    for (const s of [-1, 1]) {
      P.add(roundBox(tw, Hw, bay + 0.04, 0.04, 1), walls, { at: [s * (hw - tw / 2), 0, c - (bay + 0.04) / 2] });
      const fw = hw - dw / 2 + 0.03;
      P.add(roundBox(fw, Hw, tw, 0.04, 1), walls, { at: [s * (dw / 2 - 0.03 + fw / 2), 0, c - tw / 2] });
    }
    // inside the bay: a plank floor, board lining, a ceiling with beams, hay bales and a lamp
    const inW = W - 2 * tw, inD = bay - tw, inZ = c - tw - inD / 2;
    const woodIn = '#87633f', woodInDark = '#654a33';
    P.add(roundBox(inW, 0.03, inD, 0.01, 1), shade(woodIn, 0.05), { at: [0, 0.235, inZ] });
    for (let x = -inW / 2 + 0.32; x < inW / 2 - 0.1; x += 0.32) P.add(box(0.02, 0.006, inD - 0.04), woodInDark, { at: [x, 0.262, inZ] });
    P.add(roundBox(inW, Hw - 0.24, 0.04, 0.01, 1), woodIn, { at: [0, 0.24, c - bay + 0.02] });
    for (let x = -inW / 2 + 0.3; x < inW / 2 - 0.1; x += 0.3) P.add(box(0.02, Hw - 0.36, 0.006), woodInDark, { at: [x, 0.3, c - bay + 0.042] });
    for (const s of [-1, 1]) P.add(roundBox(0.04, Hw - 0.24, inD, 0.01, 1), shade(woodIn, -0.03), { at: [s * (inW / 2 - 0.02), 0.24, inZ] });
    P.add(roundBox(inW, 0.06, inD, 0.01, 1), woodInDark, { at: [0, Hw - 0.07, inZ] });
    for (const z of [c - bay + 0.42, c - 0.5]) P.add(roundBox(inW, 0.14, 0.12, 0.03, 1), woodInDark, { at: [0, Hw - 0.2, z] });
    const bale = (x, y, z, ry = 0) => {
      const m = xform([x, y, z], [0, ry, 0]);
      P.add(roundBox(0.82, 0.46, 0.5, 0.09, 2), PALETTE.thatch, { matrix: m });
      for (const bx of [-0.2, 0.2]) P.add(roundBox(0.035, 0.47, 0.52, 0.015, 1), '#a8864a', { matrix: m.clone().multiply(xform([bx, 0, 0])) });
    };
    bale(-1.5, 0.24, c - bay + 0.36, 0.04);
    bale(-1.45, 0.7, c - bay + 0.38, -0.1);
    bale(-0.62, 0.24, c - bay + 0.36, 0.08);
    P.add(blob(0.42, { detail: 2, amp: 0.14, seed: 5, squash: [1.5, 0.6, 0.9] }), PALETTE.thatch, { at: [1.32, 0.33, c - bay + 0.5] });
    const lampIn = [0.75, Hw - 0.62, c - 1.0];
    rod(P, [lampIn[0], lampIn[1] + 0.1, lampIn[2]], [lampIn[0], Hw - 0.1, lampIn[2]], 0.012, METAL(), { seg: 6 });
    P.add(roundCyl(0.06, 0.15, { top: 0.075, bevel: 0.02, segments: 10, steps: 1 }), lit ? LAMP : { slot: 'glass', color: '#e9e2cf', glowAmount: 0 }, { at: [lampIn[0], lampIn[1] - 0.08, lampIn[2]] });
    P.add(cone(0.1, 0.07, 10), METAL(), { at: [lampIn[0], lampIn[1] + 0.06, lampIn[2]] });
    // gable ends: gambrel-shaped fill
    const prof = gambrel(hw, Hw, 0, 0);
    P.add(slab(outlineShape([[-hw, Hw - 0.01], [hw, Hw - 0.01], [hw, Hw], [prof[3][0], prof[3][1] - 0.02], [0, prof[2][1] - 0.02], [prof[1][0], prof[1][1] - 0.02], [-hw, Hw]]), D, { bevel: 0 }), walls);
    // vertical board grooves on both gable walls
    const ridgeY = prof[2][1];
    for (const z of [c + 0.006, -c - 0.006]) {
      for (let x = -hw + 0.3; x < hw - 0.1; x += 0.3) {
        if (z > 0 && Math.abs(x) < 1.12) continue;
        const ax = Math.abs(x);
        const top = ax < prof[3][0] ? ridgeY - (ridgeY - prof[3][1]) * (ax / prof[3][0]) : prof[3][1] - (prof[3][1] - Hw) * ((ax - prof[3][0]) / (hw - prof[3][0]));
        P.add(box(0.025, top - 0.35, 0.012), groove, { at: [x, 0.26, z] });
      }
    }
    // roof: thick gambrel slab with white rims
    const t = 0.24, over = 0.3, bev = 0.03;
    const under = gambrel(hw, Hw, over, 0);
    const topL = offsetLine(under, t);
    const inU = offsetLine(under, bev), inT = offsetLine(under, t - bev);
    const roofLen = D + 0.6;
    P.add(slab(outlineShape([...inT, ...inU.slice().reverse()]), roofLen - 2 * bev, { bevel: bev, seg: 2 }), roofC);
    const rim = outlineShape([...offsetLine(under, t + 0.012), ...offsetLine(under, -0.012).reverse()]);
    for (const s of [-1, 1]) P.add(slab(rim, 0.05, { bevel: 0.02, seg: 1 }), trim, { at: [0, 0, s * (roofLen / 2 - 0.01)] });
    rod(P, [0, topL[2][1] - 0.02, -roofLen / 2 - 0.02], [0, topL[2][1] - 0.02, roofLen / 2 + 0.02], 0.1, shade(roofC, -0.1), { seg: 10 });
    // roof courses
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 4]]) {
      for (const f of [0.33, 0.66]) {
        const x = topL[a][0] + (topL[b][0] - topL[a][0]) * f, y = topL[a][1] + (topL[b][1] - topL[a][1]) * f;
        const n = new THREE.Vector3(-(topL[b][1] - topL[a][1]), topL[b][0] - topL[a][0], 0).normalize();
        plank(P, [x + n.x * 0.015, y + n.y * 0.015, -roofLen / 2 + 0.04], [x + n.x * 0.015, y + n.y * 0.015, roofLen / 2 - 0.04], 0.1, 0.045, shade(roofC, -0.07), { up: [n.x, n.y, 0] });
      }
    }
    if (old) {
      for (const [z, sx, col] of [[-1.1, 1, '#a0684a'], [1.2, -1, '#7d8b6a'], [0.2, 1, '#8a6e58']]) {
        const a = sx > 0 ? 3 : 0, b = sx > 0 ? 4 : 1;
        const x = (topL[a][0] + topL[b][0]) / 2, y = (topL[a][1] + topL[b][1]) / 2;
        const n = new THREE.Vector3(-(topL[b][1] - topL[a][1]), topL[b][0] - topL[a][0], 0).normalize();
        plank(P, [x + n.x * 0.03, y + n.y * 0.03, z - 0.35], [x + n.x * 0.03, y + n.y * 0.03, z + 0.35], 0.55, 0.04, col, { up: [n.x, n.y, 0] });
      }
    }
    // white corner boards
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(roundBox(0.16, Hw - 0.2, 0.16, 0.05, 1), trim, { at: [sx * (hw - 0.05), 0.22, sz * (c - 0.05)] });
    // big double doors with white frames and X braces
    const leaf = (sign) => {
      const L = new Parts();
      const lw = dw / 2;
      L.add(roundBox(lw, dh, 0.08, 0.03, 1), walls, { at: [sign * lw / 2, 0, 0] });
      for (let x = 0.2; x < lw - 0.1; x += 0.24) L.add(box(0.022, dh - 0.3, 0.012), groove, { at: [sign * x, 0.15, 0.045] });
      const fw = 0.11;
      L.add(roundBox(lw, fw, 0.05, 0.02, 1), trim, { at: [sign * lw / 2, 0, 0.05] });
      L.add(roundBox(lw, fw, 0.05, 0.02, 1), trim, { at: [sign * lw / 2, dh - fw, 0.05] });
      L.add(roundBox(fw, dh, 0.05, 0.02, 1), trim, { at: [sign * (lw - fw / 2), 0, 0.05] });
      L.add(roundBox(fw, dh, 0.05, 0.02, 1), trim, { at: [sign * fw / 2, 0, 0.05] });
      plank(L, [sign * fw, fw, 0.06], [sign * (lw - fw), dh - fw, 0.06], 0.1, 0.045, trim, { up: [0, 0, 1] });
      plank(L, [sign * fw, dh - fw, 0.065], [sign * (lw - fw), fw, 0.065], 0.1, 0.045, trim, { up: [0, 0, 1] });
      L.add(roundBox(0.06, 0.24, 0.04, 0.015, 1), METAL(), { at: [sign * 0.12, dh * 0.45, 0.1] });
      return L;
    };
    for (const sign of [-1, 1]) {
      const hingeX = -sign * dw / 2;
      let ang = 0, roll = 0;
      if (open) ang = -sign * 1.85;
      if (old && sign === -1) { ang = open ? ang : 0.14; roll = 0.07; }
      P.merge(leaf(sign), xform([hingeX, 0.25, dz + 0.04], [0, ang, roll]));
    }
    // the sliding-door rail over the doors, a gooseneck lamp above it
    P.add(roundBox(dw + 0.9, 0.12, 0.1, 0.03, 1), trim, { at: [0, 0.25 + dh + 0.04, c + 0.05] });
    const ly0 = 0.25 + dh + 0.42;
    const neck = [[0, ly0 - 0.1, c + 0.02], [0, ly0 + 0.14, c + 0.06], [0, ly0 + 0.2, c + 0.22], [0, ly0 + 0.08, c + 0.36]];
    P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(neck.map((q) => new THREE.Vector3(...q))), 10, 0.022, 6, false), METAL(PALETTE.iron));
    P.add(lathe([[0, 0], [0.2, -0.02], [0.18, 0.03], [0.06, 0.1], [0, 0.11]], 14), METAL(old ? '#6f6a5e' : '#4d6b5a'), { at: [0, ly0 - 0.04, c + 0.38] });
    P.add(sphere(0.07, 10, 6), lit ? LAMP : { slot: 'glass', color: '#e9e2cf', glowAmount: 0 }, { at: [0, ly0 - 0.06, c + 0.38], scale: [1, 0.6, 1] });
    // hay loft door, hay peeking out, a pulley beam at the peak
    const ly = 3.05, lw = 0.95, lh = 0.9;
    P.add(roundBox(lw + 0.2, lh + 0.2, 0.06, 0.03, 1), trim, { at: [0, ly - 0.1, c + 0.02] });
    if (old) P.add(roundBox(lw, lh, 0.04, 0.01, 1), HOLE, { at: [0, ly, c + 0.05] });
    else {
      P.add(roundBox(lw, lh, 0.04, 0.01, 1), HOLE, { at: [0, ly, c + 0.05] });
      P.add(blob(0.34, { detail: 2, amp: 0.18, seed: 9, squash: [1.25, 0.65, 0.8] }), PALETTE.thatch, { at: [0, ly + 0.17, c + 0.07] });
      // the loft door, swung open to the side
      const ld = new Parts();
      ld.add(roundBox(lw / 2, lh, 0.06, 0.02, 1), walls, { at: [lw / 4, 0, 0] });
      plank(ld, [0.05, 0.08, 0.04], [lw / 2 - 0.05, lh - 0.08, 0.04], 0.08, 0.035, trim, { up: [0, 0, 1] });
      P.merge(ld, xform([lw / 2 + 0.06, ly, c + 0.06], [0, 1.9, 0]));
    }
    plank(P, [0, ridgeY + 0.06, c - 0.3], [0, ridgeY + 0.06, c + 0.75], 0.14, 0.16, PALETTE.woodDark);
    rod(P, [0, ridgeY - 0.5, c + 0.66], [0, ridgeY - 0.02, c + 0.66], 0.012, '#d9c9a2', { seg: 5 });
    P.add(ring(0.06, 0.016, { radial: 5, tubular: 12 }), METAL(), { at: [0, ridgeY - 0.56, c + 0.66], rot: [Math.PI / 2, 0, 0] });
    // side windows
    const sw = windowParts({ w: 0.5, h: 0.5, shape: 'square', frame: trim, glass: old ? 'hole' : 'dark', sill: false });
    for (const z of [-1.3, 1.1]) {
      P.merge(sw, xform([hw, 1.45, z], [0, Math.PI / 2, 0]));
      P.merge(sw, xform([-hw, 1.45, z], [0, -Math.PI / 2, 0]));
    }
    // cupola with a rooster weather vane
    const cy = topL[2][1] - 0.08;
    P.add(roundBox(0.68, 0.62, 0.68, 0.05, 1), trim, { at: [0, cy, 0] });
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (let k = 0; k < 3; k++) P.add(box(0.4, 0.035, 0.03), shade(trim, -0.15), { matrix: new THREE.Matrix4().makeRotationY(r).multiply(xform([0, cy + 0.17 + k * 0.12, 0.345], [-0.4, 0, 0])) });
    }
    P.add(facetLathe([[0, 0], [0.64, 0], [0.64, 0.06], [0, 0.5]], 4), roofC, { at: [0, cy + 0.6, 0] });
    const vy = cy + 1.08;
    rod(P, [0, vy - 0.06, 0], [0, vy + 0.5, 0], 0.02, METAL(), { seg: 6 });
    const vane = new Parts();
    vane.add(blob(0.11, { detail: 1, amp: 0.08, seed: 2, squash: [1.3, 1, 0.35] }), METAL(PALETTE.iron), { at: [0, 0.1, 0] });
    vane.add(sphere(0.06, 8, 6), METAL(PALETTE.iron), { at: [0.12, 0.2, 0], scale: [1, 1, 0.5] });
    vane.add(cone(0.09, 0.18, 4), METAL(PALETTE.iron), { at: [-0.15, 0.12, 0], rot: [0, 0, 0.9], scale: [1, 1, 0.3] });
    plank(vane, [-0.3, 0, 0], [0.32, 0, 0], 0.025, 0.025, METAL(PALETTE.iron), { r: 0.008 });
    vane.add(cone(0.05, 0.1, 4), METAL(PALETTE.iron), { at: [0.36, 0, 0], rot: [0, 0, -Math.PI / 2] });
    P.merge(vane, xform([0, vy + 0.32, 0], [0, rand.float(0, Math.PI * 2), old ? 0.25 : 0]));
    for (const a of [0, Math.PI / 2]) plank(P, [-0.18 * Math.cos(a), vy + 0.18, -0.18 * Math.sin(a)], [0.18 * Math.cos(a), vy + 0.18, 0.18 * Math.sin(a)], 0.018, 0.018, METAL(), { r: 0.006 });
    // a hay bale to sit on and a pitchfork against the wall
    const bx = hw + 0.75, bz = c + 0.1;
    P.add(roundBox(0.82, 0.46, 0.5, 0.09, 2), PALETTE.thatch, { at: [bx, 0, bz] });
    for (const x of [-0.2, 0.2]) P.add(roundBox(0.035, 0.47, 0.52, 0.015, 1), '#a8864a', { at: [bx + x, 0, bz] });
    rod(P, [-hw - 0.25, 0.02, c + 0.35], [-hw - 0.05, 1.35, c + 0.18], 0.022, PALETTE.wood, { seg: 6 });
    for (const dx of [-0.07, 0, 0.07]) rod(P, [-hw - 0.25 + dx, 0.02, c + 0.36], [-hw - 0.24 + dx * 0.8, 0.3, c + 0.34], 0.012, METAL(PALETTE.ironLight), { seg: 5 });
    if (old) {
      for (const [x, y] of [[-1.6, 1.0], [1.5, 1.6], [-1.2, 2.5]]) P.add(roundBox(0.24, 0.6, 0.02, 0.01, 1), HOLE, { at: [x, y - 0.3, c + 0.01] });
      weeds(P, rand, season, [[-hw - 0.1, 0, c - 0.6, 0.2], [hw + 0.1, 0, -c + 0.5, 0.24], [-hw + 0.4, 0, -c - 0.1, 0.2], [hw - 0.3, 0, c + 0.15, 0.16]]);
    }
    group.add(P.build('barn'));
    return finish(group, {
      lights: lit ? [light([0, ly0 - 0.25, c + 0.5], { intensity: 1.0, distance: 5 }), ...(open ? [light([lampIn[0], lampIn[1] - 0.1, lampIn[2]], { intensity: 0.5, distance: 3 })] : [])] : [],
      footprint: { w: W + 2.4, d: D + (open ? 2.2 : 1.2) },
      spots: {
        door: spot([0, 0, c + 0.7], 0, 'stand'),
        bale: spot([bx, 0.46, bz + 0.12], 0, 'sit'),
        inside: spot([0, 0.24, c - 0.9], 0, 'stand'),
      },
      height: ridgeY + 1.9,
    });
  },
};

/* ───────────────────────── tower ───────────────────────── */

const TOWER = {
  label: 'Tower',
  about: 'A round stone tower with a conical roof and a waving flag. Watch: a sturdy lookout with a timber top room. Wizard: tall, wonky and starry, with a bent witch-hat roof and windows that glow violet.',
  params: {
    variant: { default: 'watch', options: ['watch', 'wizard'], about: 'watch tower or wizard tower' },
    stone: { default: '', type: 'color', about: 'stone color (empty = by variant)' },
    roof: { default: '', type: 'color', about: 'roof color (empty = by variant)' },
    flag: { default: '', type: 'color', about: 'flag color (empty = by variant)' },
  },
  examples: [
    {},
    { variant: 'wizard' },
    { roof: PALETTE.roofBlue, flag: PALETTE.cloth.yellow },
    { variant: 'wizard', roof: PALETTE.roofTeal, stone: '#c9c2d6', flag: PALETTE.cloth.pink },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const wizard = oneOf(p.variant, ['watch', 'wizard'], 'watch') === 'wizard';
    const stone = colorOr(p.stone, wizard ? '#c3bdd0' : PALETTE.stone);
    const roofC = colorOr(p.roof, wizard ? PALETTE.roofPurple : PALETTE.roofRed);
    const flagC = colorOr(p.flag, wizard ? PALETTE.cloth.purple : PALETTE.cloth.red);
    const P = new Parts();
    const group = new THREE.Group();
    const dark = shade(stone, -0.08);
    const glow = wizard ? { slot: 'glass', color: '#b9a7ea', glow: '#cdb2ff', glowAmount: 1.8 } : glassLook('lit');
    let top, roofBase, rTop, lights = [];
    if (!wizard) {
      const H = 4.4, r0 = 1.2, r1 = 1.08;
      P.add(roundCyl(r0 + 0.16, 0.34, { bevel: 0.06, segments: 22, steps: 2 }), dark);
      P.add(lathe([[0, 0.3], [r0, 0.3], [r1, H], [0, H]], 22), stone);
      // stone courses and a few proud stones
      for (let i = 0; i < 4; i++) {
        const y = 0.9 + i * 0.9, r = r0 + (r1 - r0) * (y / H);
        P.add(ring(r + 0.005, 0.03, { radial: 4, tubular: 28 }), dark, { at: [0, y, 0] });
      }
      for (let i = 0; i < 14; i++) {
        const a = rand.angle(), y = rand.float(0.5, H - 0.3), r = r0 + (r1 - r0) * (y / H);
        if (Math.abs(Math.sin(a)) < 0.45 && Math.cos(a) > 0 && y < 2.1) continue;
        P.add(roundBox(rand.float(0.26, 0.4), rand.float(0.16, 0.24), 0.12, 0.04, 1), shade(stone, rand.float(-0.06, 0.05)), { matrix: new THREE.Matrix4().makeRotationY(a).multiply(xform([0, y - 0.1, r - 0.03])) });
      }
      // doorway block with an arched door
      P.add(roundBox(1.15, 1.78, 0.5, 0.06, 1), shade(stone, 0.04), { at: [0, 0.3, r0 - 0.12] });
      P.merge(doorParts({ color: PALETTE.woodRed, frame: dark, arch: true, glass: 'lit' }), xform([0, 0.32, r0 + 0.13]));
      P.add(roundBox(1.15, 0.32, 0.42, 0.04, 1), dark, { at: [0, 0, r0 + 0.3] });
      P.add(roundBox(1.35, 0.16, 0.4, 0.04, 1), shade(dark, -0.03), { at: [0, 0, r0 + 0.62] });
      // arrow slits
      for (const [a, y] of [[0, 2.7], [Math.PI / 2, 2.1], [-Math.PI / 2, 3.2], [Math.PI, 2.4]]) {
        const r = r0 + (r1 - r0) * (y / H);
        P.merge(windowParts({ w: 0.16, h: 0.52, shape: 'arch', frame: dark, glass: 'dark', sill: false }), new THREE.Matrix4().makeRotationY(a).multiply(xform([0, y, r - 0.02])));
      }
      // corbelled ring, then a timber lookout room
      const cy = H;
      P.add(lathe([[r1 - 0.1, cy - 0.3], [r1 + 0.02, cy - 0.3], [r1 + 0.28, cy], [r1 + 0.28, cy + 0.14], [r1 - 0.1, cy + 0.14]], 22), dark);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        P.add(roundBox(0.16, 0.26, 0.24, 0.04, 1), dark, { matrix: new THREE.Matrix4().makeRotationY(a).multiply(xform([0, cy - 0.52, r1 + 0.02])) });
      }
      const rr = r1 + 0.1, rh = 1.05;
      P.add(roundCyl(rr, rh, { bevel: 0.04, segments: 22, steps: 1 }), PALETTE.wallCream, { at: [0, cy + 0.12, 0] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        P.add(roundBox(0.12, rh, 0.1, 0.03, 1), PALETTE.woodDark, { matrix: new THREE.Matrix4().makeRotationY(a).multiply(xform([0, cy + 0.12, rr - 0.01])) });
        if (i % 2 === 0) P.merge(windowParts({ w: 0.36, h: 0.46, shape: 'arch', frame: PALETTE.woodDark, glass: 'lit', sill: false }), new THREE.Matrix4().makeRotationY(a + Math.PI / 8).multiply(xform([0, cy + 0.66, rr - 0.04])));
      }
      top = cy + 0.12 + rh;
      roofBase = top - 0.02;
      rTop = rr + 0.42;
      // conical roof with a soft flare
      P.add(lathe([[0, 0], [rTop, 0], [rTop + 0.02, 0.07], [rTop - 0.12, 0.22], [rTop * 0.62, 0.9], [rTop * 0.3, 1.6], [0.06, 2.1], [0, 2.14]], 24), roofC, { at: [0, roofBase, 0] });
      P.add(ring(rTop - 0.04, 0.06, { radial: 5, tubular: 28 }), shade(roofC, -0.12), { at: [0, roofBase + 0.08, 0] });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const s = Math.sin(a), co = Math.cos(a);
        rod(P, [s * (rTop - 0.08), roofBase + 0.16, co * (rTop - 0.08)], [s * 0.1, roofBase + 2.02, co * 0.1], 0.035, shade(roofC, -0.08), { seg: 5 });
      }
      const fy = roofBase + 2.14;
      P.add(sphere(0.12, 12, 10), METAL(PALETTE.gold), { at: [0, fy + 0.05, 0] });
      rod(P, [0, fy, 0], [0, fy + 1.2, 0], 0.03, METAL(PALETTE.ironLight), { seg: 8 });
      P.add(sphere(0.05, 8, 6), METAL(PALETTE.gold), { at: [0, fy + 1.22, 0] });
      top = fy + 1.25;
      lights = [light([0, cy + 0.7, 0], { intensity: 0.8, distance: 4 })];
      const wave = wavingFlag(group, [0.03, fy + 1.15, 0], { w: 0.78, h: 0.46, color: flagC, stripe: PALETTE.cloth.white, phase: stream(ctx, 'anim').float(0, TAU) });
      group.add(P.build('tower'));
      return finish(group, { footprint: { r: 2.1 }, spots: { door: spot([0, 0, r0 + 1.08], 0, 'stand') }, lights, tick: wave, height: top });
    }
    // wizard: three wonky drums, a bent hat, stars and glowing round windows
    const drums = [[0.98, 0, 2.1], [0.9, 2.1, 2.0], [0.84, 4.1, 1.7]];
    P.add(roundCyl(1.15, 0.3, { bevel: 0.06, segments: 20, steps: 2 }), dark);
    let off = [0, 0];
    const centers = [];
    drums.forEach(([r, y, h], i) => {
      const nx = i === 0 ? 0 : off[0] + rand.float(-0.08, 0.08), nz = i === 0 ? 0 : off[1] + rand.float(-0.06, 0.04);
      off = [nx, nz];
      centers.push([nx, y, nz, r]);
      P.add(roundCyl(r, h + 0.08, { top: r - 0.04, bevel: 0.05, segments: 20, steps: 1 }), shade(stone, i % 2 ? 0.03 : 0), { at: [nx, y + 0.2, nz], rot: [rand.float(-0.03, 0.03), 0, rand.float(-0.04, 0.04)] });
      P.add(ring(r + 0.01, 0.06, { radial: 5, tubular: 26 }), dark, { at: [nx, y + 0.22, nz] });
    });
    // stones peeking out
    for (let i = 0; i < 10; i++) {
      const d = rand.pick(centers), a = rand.angle(), y = d[1] + rand.float(0.4, 1.6);
      if (Math.cos(a) > 0.6 && y < 1.6) continue;
      P.add(roundBox(rand.float(0.22, 0.34), rand.float(0.14, 0.2), 0.1, 0.035, 1), shade(stone, rand.float(-0.08, 0.04)), { matrix: new THREE.Matrix4().makeRotationY(a).multiply(xform([d[0] * Math.cos(a) - d[2] * Math.sin(a), y, d[3] - 0.04])) });
    }
    // door in a little stone porch
    P.add(roundBox(1.0, 1.65, 0.46, 0.06, 1), shade(stone, 0.04), { at: [0, 0.3, 0.84] });
    P.merge(doorParts({ color: '#4f7fa8', frame: dark, arch: true, glass: 'lit', knob: PALETTE.gold, w: 0.66, h: 1.15 }), xform([0, 0.32, 1.08]));
    P.add(roundBox(1.0, 0.32, 0.38, 0.04, 1), dark, { at: [0, 0, 1.23] });
    P.add(roundBox(1.2, 0.16, 0.36, 0.04, 1), shade(dark, -0.03), { at: [0, 0, 1.53] });
    // round windows that glow
    const rw = (d, a, y, s = 0.4) => {
      const w = windowParts({ w: s, h: s, shape: 'round', frame: PALETTE.gold, glass: 'lit', pane: glow, sill: false });
      P.merge(w, new THREE.Matrix4().makeTranslation(d[0], 0, d[2]).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(xform([0, y, d[3] - 0.03])));
    };
    rw(centers[0], 0.6, 1.75);
    rw(centers[1], -0.4, 3.0, 0.46);
    rw(centers[1], 2.4, 3.4);
    rw(centers[2], 0.2, 4.95, 0.5);
    rw(centers[2], Math.PI, 5.0);
    // a balcony ring under the hat
    const tc = centers[2];
    const hatY = tc[1] + 0.2 + 1.78;
    P.add(roundCyl(tc[3] + 0.32, 0.16, { bevel: 0.05, segments: 20, steps: 1 }), dark, { at: [tc[0], hatY - 0.12, tc[2]] });
    // the witch hat: a cone that bends over at the tip
    const hatProfile = [[0, 0], [1.38, 0], [1.4, 0.06], [1.2, 0.2], [0.85, 0.7], [0.58, 1.3], [0.36, 1.95], [0.18, 2.5], [0.06, 2.9], [0, 3.0]];
    const hatR = (y) => { for (let i = 3; i < hatProfile.length; i++) if (y <= hatProfile[i][1]) { const [ra, ya] = hatProfile[i - 1], [rb, yb] = hatProfile[i]; return ra + (rb - ra) * (y - ya) / (yb - ya); } return 0; };
    const hat = lathe(hatProfile, 22);
    const pos = hat.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), k = Math.max(0, (y - 1.2) / 1.8);
      pos.setX(i, pos.getX(i) + k * k * 0.75);
      pos.setY(i, y - k * k * 0.25);
    }
    hat.computeVertexNormals();
    P.add(hat, roofC, { at: [tc[0], hatY, tc[2]] });
    P.add(ring(1.3, 0.08, { radial: 5, tubular: 28 }), shade(roofC, -0.14), { at: [tc[0], hatY + 0.12, tc[2]] });
    // a band that hugs the hat below the bend, with a gold buckle in front
    const bandY0 = 0.9, bandY1 = 1.14;
    const bandProfile = [[hatR(bandY0) - 0.03, bandY0], [hatR(bandY0) + 0.03, bandY0 + 0.005], [hatR(bandY0 + 0.04) + 0.045, bandY0 + 0.04]];
    for (let k = 1; k < 4; k++) { const y = bandY0 + 0.04 + ((bandY1 - bandY0 - 0.08) * k) / 4; bandProfile.push([hatR(y) + 0.045, y]); }
    bandProfile.push([hatR(bandY1 - 0.04) + 0.045, bandY1 - 0.04], [hatR(bandY1) + 0.03, bandY1 - 0.005], [hatR(bandY1) - 0.03, bandY1]);
    P.add(lathe(bandProfile, 22), shade(roofC, -0.2, { sat: -0.1 }), { at: [tc[0], hatY, tc[2]] });
    const bandMid = (bandY0 + bandY1) / 2;
    const slopeTilt = (y) => Math.atan(-(hatR(y + 0.05) - hatR(y - 0.05)) / 0.1);
    const buckle = new THREE.Matrix4().makeTranslation(tc[0], hatY, tc[2]).multiply(xform([0, bandMid, hatR(bandMid) + 0.06], [-slopeTilt(bandMid), 0, 0]));
    P.add(slab(frameShape('square', 0.15, 0.13, 0.04), 0.03, { bevel: 0.012, seg: 1 }), METAL(PALETTE.gold), { matrix: buckle });
    // stars on the hat, clear of the band; the ones above it follow the bend
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.045 : 0.11;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const starG = slab(star, 0.025, { bevel: 0.012, seg: 1 });
    const deco = stream(ctx, 'deco');
    for (const [a, y] of [[0.45, 0.5], [1.9, 0.7], [-1.0, 0.4], [3.6, 0.62], [-2.4, 0.74], [2.6, 1.38], [-0.9, 1.44]]) {
      const r = hatR(y) + 0.012;
      const k = Math.max(0, (y - 1.2) / 1.8);
      const m = new THREE.Matrix4().makeTranslation(tc[0] + k * k * 0.75, hatY - k * k * 0.25, tc[2]).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(xform([0, y, r], [-slopeTilt(y), 0, deco.float(-0.4, 0.4)]));
      P.add(starG, { slot: 'emit', color: '#ffd76a', emit: 0.6 }, { matrix: m });
    }
    // a glowing star on the drooping tip, with a little pennant on a pole rising from it
    const tipX = tc[0] + 0.75, tipY = hatY + 2.75;
    P.add(sphere(0.1, 10, 8), { slot: 'emit', color: '#ffe08a', emit: 0.8 }, { at: [tipX, tipY, tc[2]] });
    rod(P, [tipX, tipY + 0.05, tc[2]], [tipX, tipY + 0.82, tc[2]], 0.02, METAL(PALETTE.ironLight), { seg: 6 });
    P.add(sphere(0.04, 8, 6), METAL(PALETTE.gold), { at: [tipX, tipY + 0.84, tc[2]] });
    const wave = wavingFlag(group, [tipX + 0.02, tipY + 0.78, tc[2]], { w: 0.5, h: 0.3, color: flagC, stripe: '#ffd76a', phase: stream(ctx, 'anim').float(0, TAU) });
    lights = [light([tc[0], tc[1] + 0.9, tc[2] + tc[3] + 0.3], { color: '#d9b8ff', intensity: 0.9, distance: 4.5 })];
    group.add(P.build('tower'));
    return finish(group, { footprint: { r: 1.9 }, spots: { door: spot([0, 0, 1.95], 0, 'stand') }, lights, tick: wave, height: tipY + 0.9 });
  },
};


/* ───────────────────────── lighthouse ───────────────────────── */

let beamMaterial = null;
function lighthouseBeam(length = 11, radius = 1.4) {
  beamMaterial ??= new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const pos = [];
  for (const dir of [1, -1]) {
    const g = new THREE.ConeGeometry(radius, length, 18, 7, true).translate(0, -length / 2, 0).rotateZ(dir * Math.PI / 2).toNonIndexed();
    pos.push(...g.attributes.position.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const warm = new THREE.Color('#ffe9b0');
  for (let i = 0; i < p.count; i++) {
    const d = Math.abs(p.getX(i)) / length;
    const k = Math.pow(Math.max(0, 1 - d), 2.2) * 0.8;
    col[i * 3] = warm.r * k; col[i * 3 + 1] = warm.g * k; col[i * 3 + 2] = warm.b * k;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Measure the beam as the lantern room only: framing boxes (Box3.setFromObject, boundsOf) and
  // camera blockers must not grow to the beam's reach. The sphere stays full size for culling.
  g.computeBoundingSphere();
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.6, -0.5, -0.6), new THREE.Vector3(0.6, 0.5, 0.6));
  const mesh = new THREE.Mesh(g, beamMaterial);
  mesh.castShadow = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return mesh;
}

const LIGHTHOUSE = {
  label: 'Lighthouse',
  about: 'A striped lighthouse on a stone base, with a railed gallery and a glowing lantern room whose beam sweeps around at night.',
  params: {
    stripes: { default: PALETTE.cloth.red, type: 'color', about: 'stripe color' },
    base: { default: PALETTE.wallWhite, type: 'color', about: 'the other stripe' },
    cap: { default: '', type: 'color', about: 'dome and gallery color (empty = stripe color)' },
    height: { default: 6.5, min: 4, max: 10, about: 'tower height up to the gallery' },
    beam: { default: true, about: 'a sweeping light beam at night' },
  },
  examples: [
    {},
    { stripes: PALETTE.cloth.blue, cap: PALETTE.roofSlate },
    { stripes: '#3f9c7c', height: 4.6 },
    { stripes: PALETTE.cloth.red, base: PALETTE.wallLemon, height: 8.5 },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const stripe = colorOr(p.stripes, PALETTE.cloth.red), base = colorOr(p.base, PALETTE.wallWhite);
    const capC = colorOr(p.cap, null) ?? shade(stripe, -0.04);
    const H = numOr(p.height, 6.5, 4, 10);
    const beamOn = boolOr(p.beam, true);
    const P = new Parts();
    const group = new THREE.Group();
    const stoneC = PALETTE.stoneDark;
    // stone platform and rocks
    P.add(roundCyl(1.75, 0.42, { bevel: 0.08, segments: 24, steps: 2 }), PALETTE.stone);
    P.add(roundCyl(1.92, 0.16, { bevel: 0.05, segments: 24, steps: 1 }), stoneC);
    for (let i = 0; i < 7; i++) {
      const a = rand.angle();
      if (Math.cos(a) > 0.75) continue;
      const r = rand.float(0.22, 0.42);
      P.add(blob(r, { detail: 1, amp: 0.18, seed: i * 17 + 1, squash: [1.2, 0.75, 1] }), shade(PALETTE.stone, rand.float(-0.1, 0)), { at: [Math.sin(a) * 1.95, r * 0.35, Math.cos(a) * 1.95] });
    }
    // striped tapering tower
    const y0 = 0.42, r0 = 1.12, r1 = 0.7;
    const rAt = (y) => r0 + (r1 - r0) * (y - y0) / (H - y0);
    const bands = Math.max(4, Math.round((H - y0) / 1.15));
    for (let i = 0; i < bands; i++) {
      const ya = y0 + (i * (H - y0)) / bands, yb = y0 + ((i + 1) * (H - y0)) / bands;
      P.add(lathe([[rAt(ya) - 0.05, ya], [rAt(ya), ya], [rAt(yb), yb], [rAt(yb) - 0.05, yb]], 24), i % 2 ? stripe : base);
    }
    // door in a little porch block, steps up from the ground to the platform, small windows up the tower
    P.add(roundBox(1.1, 1.66, 0.5, 0.06, 1), base, { at: [0, y0, r0 - 0.16] });
    P.add(roundBox(1.24, 0.16, 0.62, 0.05, 1), stripe, { at: [0, y0 + 1.62, r0 - 0.12] });
    P.merge(doorParts({ color: '#4f7fa8', frame: stripe, arch: true, glass: 'lit', w: 0.66, h: 1.15 }), xform([0, y0, r0 + 0.09]));
    P.add(roundBox(0.96, 0.28, 0.4, 0.05, 1), shade(PALETTE.stone, 0.02), { at: [0, 0, 1.86] });
    P.add(roundBox(1.12, 0.14, 0.36, 0.04, 1), shade(PALETTE.stone, -0.03), { at: [0, 0, 2.18] });
    for (let k = 1; k < bands; k++) {
      const y = y0 + ((k + 0.5) * (H - y0)) / bands, a = k * 2.2 + 0.5;
      P.merge(windowParts({ w: 0.3, h: 0.4, shape: 'arch', frame: PALETTE.wallWhite, glass: 'lit', sill: false }), new THREE.Matrix4().makeRotationY(a).multiply(xform([0, y, rAt(y) - 0.015])));
    }
    // gallery: corbels, deck and railing
    const gR = r1 + 0.5;
    P.add(lathe([[r1 - 0.1, H - 0.36], [r1, H - 0.36], [gR - 0.05, H - 0.04], [gR - 0.05, H], [r1 - 0.1, H]], 24), capC);
    P.add(roundCyl(gR, 0.14, { bevel: 0.04, segments: 24, steps: 1 }), capC, { at: [0, H - 0.02, 0] });
    const railY = H + 0.55;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      rod(P, [Math.sin(a) * (gR - 0.08), H + 0.1, Math.cos(a) * (gR - 0.08)], [Math.sin(a) * (gR - 0.08), railY, Math.cos(a) * (gR - 0.08)], 0.025, METAL(PALETTE.iron), { seg: 6 });
    }
    P.add(ring(gR - 0.08, 0.04, { radial: 6, tubular: 32 }), METAL(PALETTE.iron), { at: [0, railY, 0] });
    P.add(ring(gR - 0.08, 0.022, { radial: 5, tubular: 32 }), METAL(PALETTE.iron), { at: [0, H + 0.32, 0] });
    // lantern room: glowing glass between iron mullions, under a dome
    const lr = 0.5, lb = H + 0.12, lh = 0.9;
    P.add(roundCyl(lr + 0.08, 0.2, { bevel: 0.04, segments: 20, steps: 1 }), capC, { at: [0, lb, 0] });
    P.add(cyl(lr, lh, { segments: 16 }), { slot: 'lamp', color: '#fff4d2' }, { at: [0, lb + 0.2, 0] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rod(P, [Math.sin(a) * lr, lb + 0.2, Math.cos(a) * lr], [Math.sin(a) * lr, lb + 0.2 + lh, Math.cos(a) * lr], 0.03, METAL(PALETTE.iron), { seg: 6 });
    }
    const dy = lb + 0.2 + lh;
    P.add(roundCyl(lr + 0.14, 0.12, { bevel: 0.04, segments: 20, steps: 1 }), capC, { at: [0, dy, 0] });
    P.add(lathe([[0, 0], [lr + 0.1, 0], [lr + 0.06, 0.16], [lr - 0.08, 0.36], [0.24, 0.52], [0.08, 0.58], [0, 0.6]], 20), capC, { at: [0, dy + 0.1, 0] });
    P.add(sphere(0.12, 12, 10), METAL(PALETTE.gold), { at: [0, dy + 0.74, 0] });
    rod(P, [0, dy + 0.78, 0], [0, dy + 1.25, 0], 0.02, METAL(PALETTE.iron), { seg: 6 });
    group.add(P.build('lighthouse'));
    const lampY = lb + 0.2 + lh / 2;
    const lights = [{ ...light([0, lampY, 0], { intensity: 2.2, distance: 14 }), halo: 2.4 }];
    let tick = null;
    if (beamOn) {
      const beam = lighthouseBeam();
      const phase = stream(ctx, 'anim').angle();
      beam.position.set(0, lampY, 0);
      beam.rotation.y = phase;
      group.add(beam);
      tick = (t) => {
        const glow = WORLD_UNIFORMS.uGlow.value;
        const k = THREE.MathUtils.smoothstep(glow, 0.25, 0.8);
        beam.visible = k > 0.01;
        beamMaterial.opacity = 0.38 * k;
        beam.rotation.y = phase + t * 0.8;
      };
    }
    return finish(group, {
      footprint: { r: 2.35 },
      spots: {
        door: spot([0, y0, 1.52], 0, 'stand'),
        steps: spot([0, 0, 2.62], 0, 'stand'),
        gallery: spot([0, H + 0.12, gR - 0.32], 0, 'stand'),
      },
      lights,
      tick,
      height: dy + 1.25,
    });
  },
};

/* ───────────────────────── tent ───────────────────────── */

const TENT = {
  label: 'Tent',
  about: 'A camping tent: an A-frame ridge tent or a round dome tent, door flaps rolled open (or zipped shut), with guy ropes and pegs. One camper can lie inside; another can sit in front.',
  params: {
    variant: { default: 'aframe', options: ['aframe', 'dome'], about: 'ridge tent or dome tent' },
    color: { default: PALETTE.cloth.orange, type: 'color', about: 'canvas color' },
    open: { default: true, about: 'door rolled open (false = zipped shut)' },
    lit: { default: true, about: 'a lantern inside makes the canvas glow at night' },
  },
  examples: [
    {},
    { variant: 'dome', color: PALETTE.cloth.teal },
    { color: 'green', open: false },
    { variant: 'dome', color: 'yellow', open: false },
  ],
  build(p, ctx) {
    const dome = oneOf(p.variant, ['aframe', 'dome'], 'aframe') === 'dome';
    const color = colorOr(p.color, PALETTE.cloth.orange);
    const open = boolOr(p.open, true);
    const lit = boolOr(p.lit, true);
    const P = new Parts();
    const glowCanvas = (c, extra = {}) => (lit ? { slot: 'glass', color: c, rough: 0.9, glow: mix(color, '#ffc26e', 0.45), glowAmount: 0.36, snow: true, wet: true, ...extra } : { slot: 'cloth', color: c, ...extra });
    const cloth = glowCanvas(color);
    const lights = [];
    const lantern = (at) => {
      P.add(roundCyl(0.05, 0.11, { top: 0.06, bevel: 0.015, segments: 8, steps: 1 }), lit ? LAMP : { slot: 'glass', color: '#e9e2cf', glowAmount: 0 }, { at: [at[0], at[1] - 0.06, at[2]] });
      P.add(cone(0.075, 0.05, 8), METAL(), { at: [at[0], at[1] + 0.05, at[2]] });
      if (lit) lights.push(light([at[0], at[1], at[2]], { intensity: 0.5, distance: 3 }));
    };
    const darker = shade(color, -0.1);
    const trimC = shade(color, -0.18, { sat: -0.1 });
    const rope = '#e8dcc0';
    const pole = PALETTE.woodDark;
    const peg = (x, z) => P.add(cone(0.035, 0.14, 6), METAL(PALETTE.ironLight), { at: [x, -0.04, z] });
    const guy = (a, b) => { rod(P, a, b, 0.009, rope, { seg: 4 }); peg(b[0], b[2]); };
    let spots;
    if (!dome) {
      const L = 2.0, hw = 0.8, H = 1.22, z0 = -L / 2, z1 = L / 2;
      // groundsheet
      P.add(roundBox(hw * 2 + 0.12, 0.03, L + 0.12, 0.012, 1), shade(PALETTE.cloth.blue, -0.15), { at: [0, 0, 0] });
      // the two slopes
      for (const s of [-1, 1]) {
        plank(P, [0, H, 0], [s * hw, 0.04, 0], L, 0.045, cloth, { up: [s * H, hw, 0], r: 0.018 });
        plank(P, [s * (hw - 0.02), 0.08, 0], [s * (hw + 0.005), 0.05, 0], L + 0.01, 0.06, trimC, { up: [s * H, hw, 0], r: 0.02 });
      }
      rod(P, [0, H + 0.02, z0 - 0.02], [0, H + 0.02, z1 + 0.02], 0.035, trimC, { seg: 8 });
      // back wall
      const tri = outlineShape([[-hw + 0.03, 0.03], [hw - 0.03, 0.03], [0, H - 0.03]]);
      P.add(slab(tri, 0.03, { bevel: 0.01, seg: 1 }), glowCanvas(darker), { at: [0, 0, z0 + 0.02] });
      rod(P, [0, H - 0.02, -0.25], [0, H - 0.22, -0.25], 0.008, METAL(), { seg: 4 });
      lantern([0, H - 0.3, -0.25]);
      if (open) {
        // flaps rolled back to the sides and tied
        for (const s of [-1, 1]) {
          rod(P, [s * 0.06, H - 0.08, z1 + 0.04], [s * (hw - 0.05), 0.1, z1 + 0.04], 0.07, darker, { seg: 10 });
          P.add(ring(0.075, 0.016, { radial: 4, tubular: 12 }), rope, { at: [s * hw * 0.5, H * 0.52, z1 + 0.04], rot: [0, 0, s * (Math.PI / 2 - Math.atan2(H, hw))] });
        }
      } else {
        for (const s of [-1, 1]) {
          const flap = outlineShape([[0, 0.03], [s * (hw - 0.03), 0.03], [0, H - 0.04]]);
          P.add(slab(flap, 0.03, { bevel: 0.01, seg: 1 }), glowCanvas(shade(color, 0.03)), { at: [s * 0.005, 0, z1 - 0.02] });
        }
        P.add(roundBox(0.035, H - 0.12, 0.02, 0.01, 1), trimC, { at: [0, 0.05, z1 + 0.005] });
        P.add(sphere(0.03, 6, 4), METAL(PALETTE.ironLight), { at: [0.04, 0.45, z1 + 0.02] });
      }
      // poles, guy ropes, pegs
      for (const z of [z0 - 0.04, z1 + 0.08]) {
        rod(P, [0, 0, z], [0, H + 0.16, z], 0.025, pole, { seg: 6 });
        P.add(sphere(0.045, 8, 6), pole, { at: [0, H + 0.17, z] });
        guy([0, H + 0.12, z], [0, 0, z + Math.sign(z) * 0.85]);
      }
      for (const s of [-1, 1]) for (const z of [z0 + 0.2, z1 - 0.2]) guy([s * hw, 0.08, z], [s * (hw + 0.45), 0, z + Math.sign(z) * 0.25]);
      spots = { inside: spot([0, 0.03, 0.22], 0, 'lie'), front: spot([0.42, 0, z1 + 0.42], 0, 'floor') };
    } else {
      const R = 1.08, Hd = 1.0;
      P.add(roundCyl(R + 0.06, 0.03, { bevel: 0.01, segments: 24, steps: 1 }), shade(PALETTE.cloth.blue, -0.15));
      // dome shell (an ellipsoid with smooth normals) and an arched door: the opening is cut
      // along the arch itself, snapping the cut triangles' corners onto it, so its edge is clean
      const A = 0.38, Y0 = 0.5, B = 0.28;
      const archY = (x) => Y0 + B * Math.sqrt(Math.max(0, 1 - (x / A) ** 2));
      const inDoor = (x, y, z) => z > 0.2 && Math.abs(x) < A && y < archY(x);
      const onEllipsoid = (x, y) => [x, y, R * Math.sqrt(Math.max(0, 1 - (x / R) ** 2 - (y / Hd) ** 2))];
      const toEdge = (x, y) => {
        // the nearest point on the door outline (two sides and the arch), in the front view
        const side = Math.min(Math.max(y, 0), Y0);
        const th = Math.atan2(Math.max(y - Y0, 0) / B, x / A);
        let best = null, bd = Infinity;
        for (const [ex, ey] of [[-A, side], [A, side], [A * Math.cos(th), Y0 + B * Math.sin(th)]]) {
          const d = (ex - x) ** 2 + (ey - y) ** 2;
          if (d < bd) { bd = d; best = [ex, ey]; }
        }
        return onEllipsoid(best[0], best[1]);
      };
      const shellG = new THREE.SphereGeometry(1, 32, 13, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
      shellG.scale(R, Hd, R);
      const sp = shellG.attributes.position;
      const whole = [], cut = [], panel = [];
      for (let i = 0; i < sp.count; i += 3) {
        const v = [0, 1, 2].map((k) => [sp.getX(i + k), sp.getY(i + k), sp.getZ(i + k)]);
        const ins = v.map(([x, y, z]) => inDoor(x, y, z));
        whole.push(...v.flat());
        // the shell keeps every triangle with a corner outside the door, its inside corners on the arch;
        // the door panel is the opposite
        if (ins.some((b) => !b)) cut.push(...v.map((q, k) => (ins[k] ? toEdge(q[0], q[1]) : q)).flat());
        if (ins.some((b) => b)) panel.push(...v.map((q, k) => (ins[k] ? q : toEdge(q[0], q[1]))).flat());
      }
      const mk = (arr, grow = 1) => {
        const g = new THREE.BufferGeometry();
        const nrm = new Float32Array(arr.length);
        for (let k = 0; k < arr.length; k += 3) {
          const n = new THREE.Vector3(arr[k] / (R * R), arr[k + 1] / (Hd * Hd), arr[k + 2] / (R * R)).normalize();
          nrm.set([n.x, n.y, n.z], k);
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr.map((c) => c * grow), 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        return g;
      };
      if (open) {
        P.add(mk(cut), glowCanvas(color, { double: true }));
      } else {
        P.add(mk(whole), glowCanvas(color, { double: true }));
        P.add(mk(panel, 1.012), glowCanvas(shade(color, 0.06), { double: true }));
      }
      rod(P, [0, Hd - 0.02, -0.1], [0, Hd - 0.2, -0.1], 0.008, METAL(), { seg: 4 });
      lantern([0, Hd - 0.28, -0.1]);
      // door trim following the outline on the shell
      const out = (x, y, d) => {
        const [px, py, pz] = onEllipsoid(x, y);
        const n = new THREE.Vector3(px / (R * R), py / (Hd * Hd), pz / (R * R)).normalize();
        return new THREE.Vector3(px + n.x * d, py + n.y * d, pz + n.z * d);
      };
      const trimPts = [];
      for (let k = 0; k <= 3; k++) trimPts.push(out(-A, 0.03 + (Y0 - 0.03) * (k / 3), 0.02));
      for (let k = 1; k < 12; k++) { const th = Math.PI * (1 - k / 12); trimPts.push(out(A * Math.cos(th), Y0 + B * Math.sin(th), 0.02)); }
      for (let k = 0; k <= 3; k++) trimPts.push(out(A, Y0 - (Y0 - 0.03) * (k / 3), 0.02));
      P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trimPts, false, 'centripetal'), 28, 0.028, 5, false), trimC);
      if (!open) {
        // a zip down the middle of the closed door, with its pull
        const zipPts = [];
        for (let k = 0; k <= 6; k++) zipPts.push(out(0, 0.05 + (archY(0) - 0.08) * (k / 6), 0.018));
        P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(zipPts), 8, 0.012, 4, false), trimC);
        const pull = out(0.035, 0.46, 0.035);
        P.add(sphere(0.03, 6, 4), METAL(PALETTE.ironLight), { at: [pull.x, pull.y, pull.z] });
      }
      if (open) {
        // the door flap rolled up over the arch, curving with the dome, tied with two cords
        const rollY = 0.86, rollR = 0.068;
        const rollPts = [];
        for (let k = 0; k <= 10; k++) rollPts.push(out(-0.44 + 0.88 * (k / 10), rollY, rollR + 0.005));
        const roll = new THREE.CatmullRomCurve3(rollPts);
        P.add(new THREE.TubeGeometry(roll, 12, rollR, 8, false), darker);
        for (const e of [rollPts[0], rollPts[rollPts.length - 1]]) P.add(sphere(rollR, 8, 6), darker, { at: [e.x, e.y, e.z] });
        for (const u of [0.22, 0.78]) {
          const at = roll.getPointAt(u), tan = roll.getTangentAt(u);
          const q = new THREE.Quaternion().setFromUnitVectors(UP, tan);
          P.add(ring(rollR + 0.012, 0.014, { radial: 4, tubular: 14 }), rope, { matrix: new THREE.Matrix4().compose(at, q, ONE) });
        }
      }
      // two crossing poles over the top and a skirt band
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const pts = [];
        for (let i = 0; i <= 18; i++) {
          const t = -Math.PI / 2 + (i / 18) * Math.PI;
          pts.push(new THREE.Vector3(Math.sin(t) * Math.cos(a) * (R + 0.025), Math.cos(t) * (Hd + 0.025), Math.sin(t) * Math.sin(a) * (R + 0.025)));
        }
        P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.022, 5, false), pole);
      }
      P.add(ring(R + 0.005, 0.035, { radial: 4, tubular: 30 }), trimC, { at: [0, 0.06, 0] });
      for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) {
        const x = Math.sin(a), z = Math.cos(a);
        guy([x * R * 0.8, Hd * 0.6, z * R * 0.8], [x * (R + 0.6), 0, z * (R + 0.6)]);
      }
      spots = { inside: spot([0, 0.03, 0.22], 0, 'lie'), front: spot([0.45, 0, R + 0.42], 0, 'floor') };
    }
    return finish(P.build('tent'), {
      footprint: dome ? { r: 1.75 } : { w: 2.6, d: 4.1 },
      spots,
      lights,
    });
  },
};

/* ───────────────────────── hut ───────────────────────── */

/** A shaggy thatch tier: a lathe whose radius and hem wobble with noise. */
function thatchTier(rBottom, rTop, yBottom, yTop, { seed = 0, hem = 0.07, bulge = 0.08 } = {}) {
  const prof = [];
  const n = 5;
  prof.push([rBottom - 0.15, yBottom + 0.12]);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const r = rBottom + (rTop - rBottom) * f + Math.sin(f * Math.PI) * bulge;
    prof.push([Math.max(r, 0.001), yBottom + (yTop - yBottom) * f]);
  }
  prof.push([0, yTop + 0.01]);
  const g = lathe(prof, 26);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r < 0.01) continue;
    const ang = Math.atan2(v.x, v.z);
    const nn = noise3(Math.cos(ang) * 2.2 + seed, v.y * 1.6, Math.sin(ang) * 2.2);
    const k = 1 + 0.05 * nn;
    v.x *= k; v.z *= k;
    if (Math.abs(v.y - yBottom) < 0.02) v.y += hem * (Math.sin(ang * 9 + seed) * 0.6 + nn * 0.8);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

const HUT = {
  label: 'Hut',
  about: 'A round hut with woven walls and a big shaggy thatched roof, for beaches and jungles. On stilts it gets a deck and a ladder.',
  params: {
    walls: { default: '#dcbb88', type: 'color', about: 'woven wall color' },
    roof: { default: PALETTE.thatch, type: 'color', about: 'thatch color' },
    curtain: { default: PALETTE.cloth.teal, type: 'color', about: 'door curtain color' },
    stilts: { default: false, about: 'raised on stilts with a deck and a ladder' },
    lit: { default: true, about: 'a warm glow in the doorway and windows at night' },
  },
  examples: [
    {},
    { stilts: true, curtain: PALETTE.cloth.red },
    { walls: '#c79d68', roof: '#c49a52', curtain: PALETTE.cloth.yellow },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const walls = colorOr(p.walls, '#dcbb88'), roofC = colorOr(p.roof, PALETTE.thatch), curtain = colorOr(p.curtain, PALETTE.cloth.teal);
    const stilts = boolOr(p.stilts, false);
    const lit = boolOr(p.lit, true);
    const inside = lit ? { slot: 'glass', color: '#3b2f27', rough: 0.95, glow: '#ffb85c', glowAmount: 1.1 } : HOLE;
    const P = new Parts();
    const lift = stilts ? 0.8 : 0;
    const R = 1.15, Hw = 1.38;
    const pole = shade(PALETTE.wood, 0.05);
    if (stilts) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        rod(P, [Math.sin(a) * 1.25, -0.05, Math.cos(a) * 1.25], [Math.sin(a) * 1.25, lift, Math.cos(a) * 1.25], 0.08, pole, { seg: 8 });
      }
      P.add(roundCyl(1.62, 0.13, { bevel: 0.04, segments: 24, steps: 1 }), PALETTE.wood, { at: [0, lift - 0.13, 0] });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        P.add(box(3.15 * Math.cos(Math.PI / 6) * 0.98, 0.012, 0.018), PALETTE.woodDark, { at: [0, lift - 0.006, 0], rot: [0, a, 0] });
      }
      // ladder up to the door
      const lz0 = 1.6, lz1 = 2.15;
      for (const x of [-0.24, 0.24]) rod(P, [x, 0, lz1], [x, lift + 0.15, lz0], 0.035, pole, { seg: 6 });
      for (let k = 1; k <= 3; k++) {
        const f = k / 4;
        rod(P, [-0.26, lift * f, lz1 + (lz0 - lz1) * f], [0.26, lift * f, lz1 + (lz0 - lz1) * f], 0.025, pole, { seg: 6 });
      }
    } else {
      P.add(roundCyl(1.42, 0.12, { bevel: 0.04, segments: 24, steps: 1 }), shade(PALETTE.sand, -0.1));
    }
    // woven wall: a drum ringed by poles and two rope bands
    P.add(roundCyl(R, Hw, { bevel: 0.04, segments: 24, steps: 1 }), walls, { at: [0, lift, 0] });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17;
      if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) > 0) continue;
      rod(P, [Math.sin(a) * (R + 0.01), lift, Math.cos(a) * (R + 0.01)], [Math.sin(a) * (R + 0.01), lift + Hw, Math.cos(a) * (R + 0.01)], 0.035, shade(pole, rand.float(-0.06, 0.04)), { seg: 6 });
    }
    for (const y of [0.42, 1.0]) P.add(ring(R + 0.03, 0.03, { radial: 4, tubular: 30 }), '#b08a55', { at: [0, lift + y, 0] });
    // doorway: a dark opening framed by poles, with a curtain tied to one side
    const dW = 0.74, dH = 1.18;
    P.add(roundBox(dW, dH, 0.06, 0.02, 1), inside, { at: [0, lift + 0.02, R - 0.04] });
    for (const s of [-1, 1]) rod(P, [s * (dW / 2 + 0.05), lift, R + 0.02], [s * (dW / 2 + 0.05), lift + dH + 0.12, R + 0.02], 0.05, pole, { seg: 8 });
    rod(P, [-dW / 2 - 0.16, lift + dH + 0.06, R + 0.04], [dW / 2 + 0.16, lift + dH + 0.06, R + 0.04], 0.045, pole, { seg: 8 });
    plank(P, [-dW / 2 + 0.12, lift + dH + 0.02, R + 0.06], [-dW / 2 + 0.06, lift + 0.08, R + 0.07], 0.22, 0.03, { slot: 'cloth', color: curtain }, { up: [0, 0, 1], r: 0.012 });
    plank(P, [-dW / 2 + 0.28, lift + dH + 0.02, R + 0.065], [-dW / 2 + 0.16, lift + 0.32, R + 0.08], 0.18, 0.03, { slot: 'cloth', color: shade(curtain, -0.06) }, { up: [0, 0, 1], r: 0.012 });
    P.add(ring(0.07, 0.016, { radial: 4, tubular: 10 }), '#b08a55', { at: [-dW / 2 + 0.1, lift + 0.55, R + 0.08], rot: [Math.PI / 2, 0, 0] });
    // two little windows, side and back
    for (const a of [Math.PI / 2 + 0.3, -Math.PI / 2 - 0.2]) {
      const m = new THREE.Matrix4().makeRotationY(a).multiply(xform([0, lift + 0.82, R - 0.02]));
      P.add(roundBox(0.36, 0.32, 0.05, 0.03, 1), inside, { matrix: m.clone().multiply(xform([0, -0.16, 0])) });
      P.add(roundBox(0.46, 0.05, 0.08, 0.02, 1), pole, { matrix: m.clone().multiply(xform([0, -0.2, 0.03])) });
    }
    // shaggy thatch in three tiers with a topknot
    const ry = lift + Hw - 0.06;
    P.add(thatchTier(1.82, 1.02, ry, ry + 0.95, { seed: 1.3, hem: 0.07, bulge: 0.06 }), roofC);
    P.add(thatchTier(1.2, 0.5, ry + 0.78, ry + 1.5, { seed: 4.1, hem: 0.05, bulge: 0.05 }), shade(roofC, 0.03));
    P.add(thatchTier(0.58, 0.06, ry + 1.36, ry + 1.95, { seed: 7.7, hem: 0.04, bulge: 0.03 }), shade(roofC, -0.02));
    P.add(blob(0.16, { detail: 1, amp: 0.25, seed: 3, squash: [1, 1.3, 1] }), shade(roofC, -0.06), { at: [0, ry + 2.0, 0] });
    rod(P, [0, ry + 1.9, 0], [0.04, ry + 2.35, 0.02], 0.025, pole, { seg: 6 });
    const doorSpot = stilts ? spot([0, lift, R + 0.38], 0, 'stand') : spot([0, 0, R + 0.45], 0, 'stand');
    return finish(P.build('hut'), {
      lights: lit ? [light([0, lift + 0.7, R + 0.35], { intensity: 0.6, distance: 3.5 })] : [],
      footprint: { r: stilts ? 2.25 : 1.75 },
      spots: stilts ? { door: doorSpot, ladder: spot([0.55, 0, 2.3], 0, 'stand') } : { door: doorSpot },
      height: ry + 2.35,
    });
  },
};

/* ───────────────────────── town hall ───────────────────────── */

function clockFace(P, at, rotY, { hour = 12, r = 0.5, frame = PALETTE.gold, hands = PALETTE.iron } = {}) {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(at[0], at[1], at[2]);
  const C = new Parts();
  C.add(cyl(r, 0.04, { segments: 22 }), { slot: 'lamp', color: '#fdf6e3', glowAmount: 1.4 }, { rot: [Math.PI / 2, 0, 0] });
  C.add(ring(r + 0.02, 0.06, { radial: 4, tubular: 22 }), METAL(frame), { at: [0, 0, 0.04], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const big = i % 3 === 0;
    C.add(box(big ? 0.05 : 0.03, big ? 0.12 : 0.07, 0.02), hands, { matrix: new THREE.Matrix4().makeRotationZ(-a).multiply(xform([0, r - 0.1 - (big ? 0.06 : 0.035), 0.045])) });
  }
  const h = ((Number.isFinite(hour) ? hour : 12) % 12 + 12) % 12;
  const hourA = (h / 12) * Math.PI * 2, minA = (h % 1) * Math.PI * 2;
  C.add(roundBox(0.06, r * 0.52, 0.025, 0.01, 1), hands, { matrix: new THREE.Matrix4().makeRotationZ(-hourA).multiply(xform([0, -0.04, 0.06])) });
  C.add(roundBox(0.04, r * 0.78, 0.02, 0.008, 1), hands, { matrix: new THREE.Matrix4().makeRotationZ(-minA).multiply(xform([0, -0.04, 0.085])) });
  C.add(sphere(0.045, 6, 4), METAL(frame), { at: [0, 0, 0.09] });
  P.merge(C, m);
}

const HALL = {
  label: 'Town hall',
  about: 'The village centerpiece: a two-storey civic hall with a hip roof and a clock tower that rises through it over the arched double doors (its four clocks show the scene hour), steps up to a landing, lanterns, flower planters and a flag.',
  params: {
    walls: { default: '#f1e4c8', type: 'color', about: 'wall color' },
    roof: { default: PALETTE.roofTeal, type: 'color', about: 'roof color' },
    trim: { default: '#fbf6ec', type: 'color', about: 'columns, frames and cornices' },
    door: { default: PALETTE.woodRed, type: 'color', about: 'door color' },
    sign: { default: 'Town Hall', about: 'name plaque over the doors (empty = none)' },
    flag: { default: PALETTE.cloth.yellow, type: 'color', about: 'flag color' },
  },
  examples: [
    {},
    { walls: '#e7c9a8', roof: PALETTE.roofRed, door: '#4f7fa8', sign: 'Village Hall' },
    { walls: PALETTE.wallSky, roof: PALETTE.roofSlate, flag: PALETTE.cloth.red, sign: '' },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const walls = colorOr(p.walls, '#f1e4c8'), roofC = colorOr(p.roof, PALETTE.roofTeal), trim = colorOr(p.trim, '#fbf6ec'), doorC = colorOr(p.door, PALETTE.woodRed);
    const flagC = colorOr(p.flag, PALETTE.cloth.yellow);
    const sign = textOr(p.sign, 'Town Hall');
    const P = new Parts();
    const group = new THREE.Group();
    const W = 7.4, D = 4.4, c = D / 2, base = 0.36, H = base + 3.7;
    const stone = PALETTE.stoneLight;
    // plinth, walls, quoins, belt course and cornice
    P.add(roundBox(W + 0.3, base, D + 0.3, 0.06, 1), stone);
    P.add(roundBox(W, H - base, D, 0.06, 2), walls, { at: [0, base, 0] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const y = base + 0.08 + k * 0.6, wide = k % 2 === 0;
        if (sz > 0) P.add(roundBox(wide ? 0.42 : 0.3, 0.5, 0.06, 0.03, 1), trim, { at: [sx * (W / 2 - (wide ? 0.2 : 0.14)), y, c + 0.02] });
        else P.add(box(wide ? 0.42 : 0.3, 0.5, 0.06), trim, { at: [sx * (W / 2 - (wide ? 0.2 : 0.14)), y, -c - 0.02] });
        P.add(box(0.06, 0.5, wide ? 0.3 : 0.42), trim, { at: [sx * (W / 2 + 0.02), y, sz * (c - (wide ? 0.14 : 0.2))] });
      }
    }
    P.add(roundBox(W + 0.1, 0.12, D + 0.1, 0.04, 1), trim, { at: [0, base + 1.85, 0] });
    P.add(roundBox(W + 0.18, 0.16, D + 0.18, 0.05, 1), trim, { at: [0, H - 0.12, 0] });
    // the roof
    const roof = addRoof(P, { style: 'hip', W, D, y0: H, rise: 1.35, color: roofC, trim, walls, over: 0.45 });
    // the clock tower bay in the middle of the front: it stands proud of the eave, so the roof
    // runs into its sides, and a cornice band wraps it at eave height
    const tw = 2.1, tz = c + 0.62, topY = roof.ridge + 1.9;
    const zL = tz + 0.45; // front of the landing before the doors
    P.add(roundBox(tw + 0.3, base, zL - (c - 0.1), 0.06, 1), stone, { at: [0, 0, (zL + c - 0.1) / 2] });
    P.add(roundBox(tw, topY - base, tw, 0.06, 2), walls, { at: [0, base, tz - tw / 2] });
    for (const sx of [-1, 1]) P.add(roundBox(0.2, topY - base - 0.1, 0.2, 0.05, 1), trim, { at: [sx * (tw / 2 - 0.06), base, tz - 0.06] });
    P.add(roundBox(tw + 0.18, 0.16, tz - c + 0.29, 0.04, 1), trim, { at: [0, H - 0.12, (tz + 0.09 + c - 0.2) / 2] });
    // two steps rising to the landing, which is flush with the plinth
    P.add(roundBox(2.45, base * 2 / 3, 0.42, 0.04, 1), shade(stone, -0.03), { at: [0, 0, zL + 0.1] });
    P.add(roundBox(2.75, base / 3, 0.42, 0.04, 1), shade(stone, -0.06), { at: [0, 0, zL + 0.4] });
    // double doors under an arch
    const dd = doorParts({ color: doorC, frame: trim, arch: true, glass: 'lit', w: 1.3, h: 1.95 });
    P.merge(dd, xform([0, base, tz]));
    P.add(roundBox(0.035, 1.6, 0.03, 0.01, 1), shade(doorC, -0.15), { at: [0, base + 0.05, tz + 0.12] });
    P.add(sphere(0.05, 8, 6), METAL(PALETTE.gold), { at: [-0.12, base + 0.9, tz + 0.15] });
    // name plaque between the door arch and the window over it
    if (sign) {
      const sw = 1.5, sh = 0.36;
      P.add(roundBox(sw + 0.12, sh + 0.12, 0.08, 0.04, 1), PALETTE.gold, { at: [0, base + 2.22, tz] });
      P.add(new THREE.PlaneGeometry(sw, sh), signMaterial(sign, { bg: '#fbf3df', fg: '#4f3a26', border: '#c99b44', borderWidth: 8, font: 'bold 84px Georgia, "Times New Roman", serif' }), { at: [0, base + 2.28 + sh / 2, tz + 0.085] });
    }
    // belfry: arched openings, a cornice, clock faces on three sides
    const by = roof.ridge - 0.25;
    P.add(roundBox(tw + 0.16, 0.14, tw + 0.16, 0.04, 1), trim, { at: [0, by - 0.5, tz - tw / 2] });
    const clockY = by + 0.55;
    const hour = numOr(ctx.hour, 12, 0, 24);
    clockFace(P, [0, clockY, tz + 0.02], 0, { hour, r: 0.56 });
    clockFace(P, [tw / 2 + 0.02, clockY, tz - tw / 2], Math.PI / 2, { hour, r: 0.56 });
    clockFace(P, [-tw / 2 - 0.02, clockY, tz - tw / 2], -Math.PI / 2, { hour, r: 0.56 });
    clockFace(P, [0, clockY, tz - tw - 0.02], Math.PI, { hour, r: 0.56 });
    P.add(roundBox(tw + 0.24, 0.16, tw + 0.24, 0.05, 1), trim, { at: [0, topY - 0.12, tz - tw / 2] });
    // spire: a tall pyramid with a ball and a flag
    const spire = facetLathe([[0, 0], [tw * 0.78, 0], [tw * 0.8, 0.08], [tw * 0.5, 0.7], [0.08, 1.9], [0, 1.95]], 4);
    P.add(spire, roofC, { at: [0, topY + 0.02, tz - tw / 2] });
    P.add(sphere(0.13, 12, 10), METAL(PALETTE.gold), { at: [0, topY + 2.02, tz - tw / 2] });
    rod(P, [0, topY + 2.05, tz - tw / 2], [0, topY + 3.0, tz - tw / 2], 0.025, METAL(PALETTE.ironLight), { seg: 6 });
    const wave = wavingFlag(group, [0.025, topY + 2.95, tz - tw / 2], { w: 0.8, h: 0.48, color: flagC, stripe: PALETTE.cloth.white, phase: stream(ctx, 'anim').float(0, TAU) });
    // tall arched windows on both floors of each wing
    const deco = stream(ctx, 'deco');
    const win = windowParts({ w: 0.6, h: 1.0, shape: 'arch', frame: trim, glass: 'lit', season, rand: deco, flowerbox: false });
    const winBox = windowParts({ w: 0.6, h: 1.0, shape: 'arch', frame: trim, glass: 'lit', season, rand: deco, flowerbox: true });
    for (const sx of [-1, 1]) {
      for (const x of [1.75, 2.95]) {
        P.merge(winBox, xform([sx * x, base + 1.0, c]));
        P.merge(win, xform([sx * x, base + 2.75, c]));
      }
      P.merge(win, xform([sx * W / 2, base + 1.0, 0], [0, sx * Math.PI / 2, 0]));
      P.merge(win, xform([sx * W / 2, base + 2.75, 0], [0, sx * Math.PI / 2, 0]));
    }
    for (const x of [-2.2, 2.2]) P.merge(win, xform([x, base + 1.9, -c], [0, Math.PI, 0]));
    P.merge(windowParts({ w: 0.46, h: 0.62, shape: 'arch', frame: trim, glass: 'lit', sill: false }), xform([0, base + 3.14, tz]));
    // lanterns flanking the doors, round planters with seasonal flowers
    const lights = [];
    for (const sx of [-1, 1]) {
      wallLantern(P, [sx * 0.82, base + 1.55, tz], true);
      lights.push(light([sx * 0.82, base + 1.5, tz + 0.4], { intensity: 1.0, distance: 5 }));
      const px = sx * 2.0, pz = c + 0.95;
      P.add(roundCyl(0.42, 0.42, { top: 0.48, bevel: 0.05, segments: 18, steps: 1 }), stone, { at: [px, 0, pz] });
      P.add(cyl(0.42, 0.03, { segments: 16 }), PALETTE.dirt, { at: [px, 0.42, pz] });
      const leaf = season === 'winter' ? '#6f7f5f' : seasonal(PALETTE.leaf, season);
      P.add(blob(0.36, { detail: 1, amp: 0.1, seed: sx + 4, squash: [1.05, 0.7, 1.05] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: leaf }, { at: [px, 0.6, pz] });
      const cols = flowerColors(season, deco);
      for (let k = 0; cols.length && k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + deco.float(0, 0.4), rr = deco.float(0.12, 0.3);
        P.add(sphere(0.062, 6, 4), { slot: 'foliage', sheen: LEAF_SHEEN, color: cols[k % cols.length] }, { at: [px + Math.sin(a) * rr, 0.74 + deco.float(-0.04, 0.06) - rr * 0.25, pz + Math.cos(a) * rr] });
      }
    }
    group.add(P.build('hall'));
    return finish(group, {
      footprint: { w: W + 0.8, d: D + 3.6 },
      spots: {
        door: spot([0, base, tz + 0.25], 0, 'stand'),
        steps: spot([0, 0, zL + 0.95], 0, 'stand'),
        left: spot([-2.75, 0, c + 1.5], 0, 'stand'),
        right: spot([2.75, 0, c + 1.5], 0, 'stand'),
      },
      lights,
      tick: wave,
      height: topY + 3.0,
    });
  },
};

/* ───────────────────────── bridge ───────────────────────── */

/** An outline in XY between a top curve y(x) and that curve dropped by `thick`, from x0 to x1. */
function bandShape(yTop, x0, x1, thick, n = 16) {
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    top.push([x, yTop(x)]);
    bot.push([x, yTop(x) - thick]);
  }
  return outlineShape([...bot, ...top.reverse()]);
}
/** A curved beam along X following y(x) (its top), `w` deep in Z, centered at z. */
function bandBeam(P, yTop, x0, x1, thick, w, z, look, n = 16) {
  if (x1 - x0 < 0.05) return;
  const bev = Math.min(0.02, thick * 0.3, w * 0.3);
  P.add(slab(bandShape((x) => yTop(x) - bev, x0 + bev, x1 - bev, Math.max(thick - 2 * bev, 0.005), n), Math.max(w - 2 * bev, 0.005), { bevel: bev, seg: 1 }), look, { at: [0, 0, z] });
}

const BRIDGE = {
  label: 'Bridge',
  about: 'A bridge across a river, running along local X: wooden planks on pilings, a humped stone arch, or a swaying rope bridge. The ends rest on the banks (y = 0), the middle crosses over the water (surface y = -0.3) and posts or piers reach the river bed (about -1). Broken: missing planks, a gap in the middle and a snapped rail. New: fresh pale wood.',
  params: {
    length: { default: 5, min: 2.5, max: 12, about: 'span along X, bank to bank' },
    width: { default: 1.6, min: 0.9, max: 3.5, about: 'deck width' },
    style: { default: 'wood', options: ['wood', 'stone', 'rope'], about: 'wooden plank bridge, stone arch or rope bridge' },
    state: { default: 'intact', options: ['intact', 'broken', 'new'], about: 'intact, broken (gap in the middle) or brand new' },
  },
  examples: [
    {},
    { style: 'stone' },
    { style: 'rope', length: 6, width: 1.2 },
    { state: 'broken' },
    { state: 'new', length: 4 },
    { style: 'stone', state: 'broken', length: 6 },
    { style: 'rope', state: 'broken' },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const style = oneOf(p.style, ['wood', 'stone', 'rope'], 'wood');
    const state = oneOf(p.state, ['intact', 'broken', 'new'], 'intact');
    const L = numOr(p.length, 5, 2.5, 12), Wd = numOr(p.width, 1.6, 0.9, 3.5);
    const broken = state === 'broken';
    const hw = Wd / 2;
    const gapHalf = Math.min(0.5, L * 0.1);
    const inGap = (x) => broken && Math.abs(x) < gapHalf;
    const P = new Parts();
    let yAt;
    let wood = state === 'new' ? '#e6c690' : broken ? '#9c8468' : PALETTE.wood;
    const woodD = shade(wood, -0.1);
    // planks: spots stand on plank centres, and a broken deck never loses the plank under a spot
    const nPl = Math.max(6, Math.round(L / 0.2)), pwPl = L / nPl;
    const onPlank = (x) => -L / 2 + pwPl * (clamp(Math.floor((x + L / 2) / pwPl), 0, nPl - 1) + 0.5);
    const spotX = { middle: broken ? -(gapHalf + 0.38) : 0, left: -L / 2 + 0.35, right: L / 2 - 0.35 };
    const plankRow = (yTop, { skip = 0, ropeGap = 0.02, thick = 0.07, jitter = 0.04 } = {}) => {
      const n = nPl, pw = pwPl;
      const keep = Object.values(spotX).map(onPlank);
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + pw * (i + 0.5);
        if (inGap(x)) continue;
        if (broken && rand.chance(skip) && !keep.some((k) => Math.abs(k - x) < pw * 0.6)) continue;
        const s = (yTop(x + 0.01) - yTop(x - 0.01)) / 0.02;
        const tilt = rand.float(-jitter, jitter);
        const y = yTop(x) - thick / 2;
        const up = new THREE.Vector3(-s + tilt, 1, 0).normalize();
        plank(P, [x - up.x * thick / 2, y - thick / 2 * up.y + thick / 2, -hw + rand.float(0, 0.03)], [x - up.x * thick / 2, y - thick / 2 * up.y + thick / 2, hw - rand.float(0, 0.03)], pw - ropeGap, thick, shade(wood, rand.float(-0.05, 0.04)), { up: [up.x, up.y, 0], r: 0.018 });
      }
    };
    const spotsFor = (y, planks = true) => {
      // plank tops sit about 0.03 under the deck curve
      const at = (x) => (planks ? onPlank(x) : x), top = (x) => y(x) - (planks ? 0.03 : 0);
      const [mx, lx, rx] = [at(spotX.middle), at(spotX.left), at(spotX.right)];
      return {
        middle: spot([mx, top(mx), 0], 0, 'stand'),
        left: spot([lx, top(lx), 0], 90, 'stand'),
        right: spot([rx, top(rx), 0], -90, 'stand'),
      };
    };
    let spots;
    if (style === 'wood') {
      const rise = Math.min(0.5, 0.07 * L);
      yAt = (x) => rise * (1 - (2 * x / L) ** 2);
      // stone abutments on the banks
      for (const sx of [-1, 1]) P.add(roundBox(0.7, 0.55, Wd + 0.3, 0.06, 1), PALETTE.stone, { at: [sx * (L / 2 - 0.2), -0.5, 0] });
      // stringers under the deck
      const under = (x) => yAt(x) - 0.07;
      for (const z of [-hw + 0.16, 0, hw - 0.16]) {
        if (broken) { bandBeam(P, under, -L / 2, -gapHalf - 0.15, 0.16, 0.12, z, woodD); bandBeam(P, under, gapHalf + 0.15, L / 2, 0.16, 0.12, z, woodD); }
        else bandBeam(P, under, -L / 2, L / 2, 0.16, 0.12, z, woodD);
      }
      plankRow(yAt, { skip: 0.15 });
      // pilings with a cap beam and cross braces, standing on the river bed
      const nPile = Math.max(2, Math.round((L - 1.4) / 2.1));
      for (let k = 0; k < nPile; k++) {
        const x = -L / 2 + 1.0 + ((L - 2.0) * k) / Math.max(nPile - 1, 1);
        if (inGap(x)) continue;
        const top = under(x) - 0.16;
        for (const z of [-hw + 0.12, hw - 0.12]) rod(P, [x, -1.1, z], [x, top, z], 0.085, woodD, { seg: 10 });
        plank(P, [x, top, -hw - 0.05], [x, top, hw + 0.05], 0.16, 0.13, woodD);
        plank(P, [x, -0.85, -hw + 0.12], [x, top - 0.08, hw - 0.12], 0.06, 0.08, shade(woodD, -0.05), { up: [1, 0, 0] });
        plank(P, [x, -0.85, hw - 0.12], [x, top - 0.08, -hw + 0.12], 0.06, 0.08, shade(woodD, -0.05), { up: [1, 0, 0] });
      }
      // railings: posts, a top rail and a middle rail on each side
      const railH = SCALE.rail + 0.05;
      const nPost = Math.max(3, Math.round(L / 0.85) + 1);
      for (const sz of [-1, 1]) {
        const z = sz * (hw - 0.04);
        const snapped = broken && sz > 0;
        for (let k = 0; k < nPost; k++) {
          const x = -L / 2 + 0.1 + ((L - 0.2) * k) / (nPost - 1);
          if (inGap(x) || (snapped && Math.abs(x) < gapHalf + 0.3)) continue;
          P.add(roundBox(0.1, railH + 0.16, 0.1, 0.03, 1), wood, { at: [x, yAt(x) - 0.14, z] });
          P.add(roundBox(0.13, 0.06, 0.13, 0.025, 1), shade(wood, 0.05), { at: [x, yAt(x) + railH + 0.02, z] });
        }
        const topRail = (x) => yAt(x) + railH;
        const midRail = (x) => yAt(x) + railH * 0.5;
        const a0 = -L / 2 + 0.05, a1 = L / 2 - 0.05;
        if (!broken) {
          bandBeam(P, topRail, a0, a1, 0.08, 0.08, z, wood);
          bandBeam(P, midRail, a0, a1, 0.06, 0.05, z, wood);
        } else {
          const cut = snapped ? gapHalf + 0.38 : gapHalf;
          bandBeam(P, topRail, a0, -cut, 0.08, 0.08, z, wood);
          bandBeam(P, topRail, cut, a1, 0.08, 0.08, z, wood);
          bandBeam(P, midRail, a0, -cut, 0.06, 0.05, z, wood);
          bandBeam(P, midRail, cut, a1, 0.06, 0.05, z, wood);
          if (snapped) {
            // the snapped rail droops toward the water
            plank(P, [-cut, topRail(-cut) - 0.03, z], [-cut + 0.45, topRail(-cut) - 0.42, z + 0.06], 0.07, 0.07, shade(wood, 0.06));
            plank(P, [cut, midRail(cut) - 0.02, z], [cut - 0.38, midRail(cut) - 0.5, z + 0.04], 0.05, 0.06, shade(wood, 0.06));
          }
        }
      }
      if (broken) {
        // planks dangling into the gap and a couple floating below
        plank(P, [-gapHalf, yAt(-gapHalf) - 0.04, -0.2], [-gapHalf + 0.25, yAt(0) - 0.6, -0.05], 0.18, 0.06, shade(wood, 0.05), { up: [1, 0.4, 0] });
        plank(P, [gapHalf, yAt(gapHalf) - 0.04, 0.35], [gapHalf - 0.15, yAt(0) - 0.55, 0.5], 0.18, 0.06, shade(wood, -0.03), { up: [-1, 0.4, 0] });
      }
      spots = spotsFor(yAt);
    } else if (style === 'stone') {
      const stone = state === 'new' ? PALETTE.stoneLight : broken ? mix(PALETTE.stone, '#8f877c', 0.35) : PALETTE.stone;
      const rise = Math.min(0.75, 0.11 * L);
      yAt = (x) => rise * (1 - (2 * x / L) ** 2);
      const a = L * 0.31, by = -1.08, crown = yAt(0) - 0.46, bArch = crown - by;
      const archPt = (th) => [a * Math.cos(th), by + bArch * Math.sin(th)];
      const deckY = (x) => yAt(x) - 0.06;
      const ex = L / 2 + 0.12;
      const half = (side) => {
        // one side of the body (side -1 left, +1 right); whole when not broken
        const pts = [];
        const g = broken ? gapHalf : 0;
        const thG = Math.acos(THREE.MathUtils.clamp(g / a, -1, 1));
        if (side < 0) {
          pts.push([-ex, by - 0.05], [-a, by - 0.05]);
          const th0 = Math.PI, th1 = broken ? Math.PI - thG : 0;
          for (let i = 0; i <= 14; i++) pts.push(archPt(th0 + (th1 - th0) * (i / 14)));
          if (broken) {
            const yb = archPt(th1)[1], yt = deckY(-g);
            for (let k = 1; k <= 5; k++) pts.push([-g - (k % 2 ? 0.1 : 0.02) * rand.float(0.6, 1.3), yb + (yt - yb) * (k / 6)]);
            pts.push([-g, yt]);
          } else {
            pts.push([a, by - 0.05], [ex, by - 0.05]);
          }
          const xEnd = broken ? -g : ex;
          for (let i = 0; i <= 16; i++) { const x = xEnd + (-ex - xEnd) * (i / 16); pts.push([x, deckY(x)]); }
        } else {
          pts.push([a, by - 0.05], [ex, by - 0.05]);
          for (let i = 0; i <= 16; i++) { const x = ex + (gapHalf - ex) * (i / 16); pts.push([x, deckY(x)]); }
          const yt = deckY(gapHalf), yb = archPt(thG)[1];
          for (let k = 1; k <= 5; k++) pts.push([gapHalf + (k % 2 ? 0.1 : 0.02) * rand.float(0.6, 1.3), yt + (yb - yt) * (k / 6)]);
          for (let i = 0; i <= 8; i++) pts.push(archPt(thG * (1 - i / 8)));
        }
        const clean = pts.filter((q, i) => { const r = pts[(i + pts.length - 1) % pts.length]; return Math.abs(q[0] - r[0]) + Math.abs(q[1] - r[1]) > 1e-4; });
        P.add(slab(outlineShape(clean), Wd - 0.08, { bevel: 0.04, seg: 1 }), stone);
      };
      half(-1);
      if (broken) half(1);
      // voussoirs around the arch on both faces, with a keystone
      const nv = 13;
      for (const sz of [-1, 1]) {
        for (let k = 1; k < nv; k++) {
          const th = Math.PI * (1 - k / nv);
          const [x, y] = archPt(th);
          if (inGap(x)) continue;
          const nx = Math.cos(th) / a, ny = Math.sin(th) / bArch;
          const nl = Math.hypot(nx, ny);
          const key = k === Math.floor(nv / 2) || k === Math.ceil(nv / 2);
          const ang = Math.atan2(ny / nl, nx / nl) - Math.PI / 2;
          P.add(roundBox(key ? 0.28 : 0.22, key ? 0.38 : 0.3, 0.07, 0.03, 1), shade(stone, k % 2 ? 0.05 : -0.03), { matrix: new THREE.Matrix4().makeRotationZ(ang).setPosition(x + (nx / nl) * 0.03, y + (ny / nl) * 0.03 - (key ? 0.04 : 0), sz * (Wd / 2 - 0.01)) });
        }
        for (let i = 0; i < Math.round(L * 1.4); i++) {
          const x = rand.float(-L / 2 + 0.3, L / 2 - 0.3), y = rand.float(-0.25, deckY(x) - 0.2);
          if (inGap(x)) continue;
          const ell = (x / (a + 0.25)) ** 2 + ((y - by) / (bArch + 0.25)) ** 2;
          if (ell < 1) continue;
          P.add(roundBox(rand.float(0.22, 0.36), rand.float(0.14, 0.2), 0.06, 0.03, 1), shade(stone, rand.float(-0.07, 0.04)), { at: [x, y, sz * (Wd / 2 - 0.01)] });
        }
      }
      // parapets with coping, a path along the top, end posts with balls
      const parTop = (x) => yAt(x) + 0.42;
      for (const sz of [-1, 1]) {
        const z = sz * (hw - 0.1);
        const segs = broken ? (sz > 0 ? [[-ex, -gapHalf - 0.5], [gapHalf + 0.2, ex]] : [[-ex, -gapHalf], [gapHalf, ex]]) : [[-ex, ex]];
        for (const [x0, x1] of segs) {
          bandBeam(P, parTop, x0, x1, 0.5, 0.2, z, shade(stone, 0.02), 14);
          bandBeam(P, (x) => parTop(x) + 0.07, x0 - 0.03, x1 + 0.03, 0.1, 0.28, z, shade(stone, 0.1), 14);
        }
        for (const sx of [-1, 1]) {
          P.add(roundBox(0.36, 0.72, 0.36, 0.06, 1), shade(stone, 0.06), { at: [sx * (ex - 0.06), yAt(sx * ex) - 0.06, z] });
          P.add(sphere(0.15, 12, 9), shade(stone, 0.1), { at: [sx * (ex - 0.06), yAt(sx * ex) + 0.8, z] });
        }
      }
      const path = shade(PALETTE.dirt, 0.12);
      const pathSegs = broken ? [[-ex + 0.05, -gapHalf], [gapHalf, ex - 0.05]] : [[-ex + 0.05, ex - 0.05]];
      for (const [x0, x1] of pathSegs) bandBeam(P, (x) => yAt(x) + 0.0, x0, x1, 0.08, Wd - 0.42, 0, path, 14);
      if (broken) {
        for (let i = 0; i < 6; i++) P.add(blob(rand.float(0.14, 0.24), { detail: 1, amp: 0.2, seed: i + 5, squash: [1.2, 0.8, 1] }), shade(stone, rand.float(-0.06, 0.03)), { at: [rand.float(-0.5, 0.5), -0.42 + rand.float(0, 0.12), rand.float(-hw, hw)] });
      }
      if (season !== 'winter') {
        const moss = seasonal(MOSS, season);
        for (const sx of [-1, 1]) P.add(blob(0.16, { detail: 1, amp: 0.2, seed: sx + 9, squash: [1.4, 0.5, 1] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(moss, -0.05) }, { at: [sx * (ex - 0.25), yAt(sx * ex) + 0.42, hw - 0.1] });
      }
      spots = spotsFor(yAt, false);
    } else {
      // rope bridge: planks on two foot ropes, hand ropes sagging between end posts
      const sag = Math.min(0.22, 0.025 * L);
      yAt = (x) => -sag * (1 - (2 * x / L) ** 2);
      const rope = state === 'new' ? '#efe2c4' : broken ? '#b8a580' : '#d8c59c';
      const postC = state === 'new' ? '#d9b27a' : woodD;
      plankRow(yAt, { skip: 0.18, ropeGap: 0.05, thick: 0.06, jitter: 0.08 });
      const curve = (fn, x0, x1, n = 14) => { const pts = []; for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; pts.push(new THREE.Vector3(x, ...fn(x))); } return pts; };
      const ropeT = (pts, r) => P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 2), r, 6, false), rope);
      const px = L / 2 + 0.14;
      const handY = (x) => yAt(x) + 0.62 + 0.3 * (2 * x / L) ** 2;
      for (const sz of [-1, 1]) {
        const z = sz * (hw - 0.07), zh = sz * (hw + 0.02);
        if (!broken) ropeT(curve((x) => [yAt(x) - 0.07, z], -px, px), 0.028);
        else { ropeT(curve((x) => [yAt(x) - 0.07, z], -px, -gapHalf + 0.05, 8), 0.028); ropeT(curve((x) => [yAt(x) - 0.07, z], gapHalf - 0.05, px, 8), 0.028); }
        const snapped = broken && sz > 0;
        if (!snapped) ropeT(curve((x) => [handY(x), zh], -px, px, 18), 0.032);
        else {
          ropeT([...curve((x) => [handY(x), zh], -px, -0.3, 10), new THREE.Vector3(-0.2, handY(-0.3) - 0.45, zh + 0.05), new THREE.Vector3(-0.15, yAt(0) - 0.25, zh + 0.1)], 0.032);
          ropeT([new THREE.Vector3(0.35, yAt(0) - 0.15, zh + 0.08), new THREE.Vector3(0.5, handY(0.6) - 0.3, zh + 0.04), ...curve((x) => [handY(x), zh], 0.6, px, 8)], 0.032);
        }
        for (let k = 1; k < Math.round(L / 0.5); k++) {
          const x = -L / 2 + (k * L) / Math.round(L / 0.5);
          if (inGap(x) || (snapped && x > -0.35 && x < 0.65)) continue;
          rod(P, [x, yAt(x) - 0.06, z], [x, handY(x), zh], 0.012, rope, { seg: 4 });
        }
        for (const sx of [-1, 1]) {
          rod(P, [sx * px, -0.35, sz * (hw + 0.08)], [sx * px, 1.02, sz * (hw + 0.08)], 0.075, postC, { seg: 10 });
          P.add(sphere(0.09, 10, 8), postC, { at: [sx * px, 1.04, sz * (hw + 0.08)] });
          for (const y of [0.9, 0.82]) P.add(ring(0.085, 0.022, { radial: 4, tubular: 12 }), rope, { at: [sx * px, y, sz * (hw + 0.08)] });
        }
      }
      // planks resting on the banks at each end
      for (const sx of [-1, 1]) P.add(roundBox(0.6, 0.1, Wd + 0.1, 0.03, 1), PALETTE.stone, { at: [sx * (L / 2 + 0.05), -0.12, 0] });
      spots = spotsFor(yAt);
    }
    return finish(P.build('bridge'), {
      footprint: { w: L + 0.4, d: Wd + 0.6 },
      spots,
      height: (yAt?.(0) ?? 0) + 1,
    });
  },
};

/* ───────────────────────── wall ───────────────────────── */

const WALL = {
  label: 'Wall',
  about: 'A wall segment along local X: rounded fieldstones with capstones, neat brick with a coping, or a crumbling mossy ruin. Low walls can be sat on.',
  params: {
    length: { default: 3, min: 0.8, max: 12, about: 'length along X' },
    height: { default: 0.9, min: 0.3, max: 3, about: 'height' },
    style: { default: 'stone', options: ['stone', 'brick', 'ruined'], about: 'fieldstone, brick or ruined' },
    color: { default: '', type: 'color', about: 'stone or brick color (empty = by style)' },
  },
  examples: [
    {},
    { style: 'brick' },
    { style: 'ruined', length: 4, height: 1.6 },
    { length: 2, height: 0.55 },
    { style: 'brick', height: 1.8, length: 2.4, color: '#b8765a' },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const style = oneOf(p.style, ['stone', 'brick', 'ruined'], 'stone');
    const L = numOr(p.length, 3, 0.8, 12), H = numOr(p.height, 0.9, 0.3, 3);
    const P = new Parts();
    let T = 0.36;
    if (style === 'brick') {
      const brick = colorOr(p.color, PALETTE.brick);
      T = 0.3;
      P.add(roundBox(L + 0.06, 0.16, T + 0.08, 0.04, 1), PALETTE.stoneDark);
      P.add(box(L - 0.02, H - 0.24, T - 0.04), '#e4dccb', { at: [0, 0.14, 0] });
      const rows = Math.min(16, Math.max(1, Math.round((H - 0.26) / 0.13)));
      const rh = (H - 0.26) / rows;
      const per = Math.min(36, Math.max(2, Math.ceil(L / 0.28)));
      const bw = L / per;
      for (const sz of [-1, 1]) {
        for (let r = 0; r < rows; r++) {
          const off = r % 2 ? bw / 2 : 0;
          for (let i = -1; i < per; i++) {
            let x0 = -L / 2 + i * bw + off, x1 = x0 + bw;
            x0 = Math.max(x0, -L / 2 + 0.005); x1 = Math.min(x1, L / 2 - 0.005);
            if (x1 - x0 < 0.04) continue;
            P.add(box(x1 - x0 - 0.024, rh - 0.024, 0.05), shade(brick, rand.float(-0.06, 0.04)), { at: [(x0 + x1) / 2, 0.15 + r * rh + 0.012, sz * (T / 2 - 0.01)] });
          }
        }
      }
      P.add(roundBox(L + 0.08, 0.13, T + 0.14, 0.04, 1), PALETTE.stoneLight, { at: [0, H - 0.13, 0] });
    } else if (style === 'stone') {
      const stone = colorOr(p.color, PALETTE.stone);
      P.add(roundBox(L - 0.04, H - 0.1, T - 0.08, 0.04, 1), shade(stone, -0.12), { at: [0, 0, 0] });
      const sh = Math.max(0.24, (H - 0.16) / 6), rows = Math.max(1, Math.round((H - 0.16) / sh));
      const rh = (H - 0.16) / rows;
      const target = Math.max(0.42, L / 14);
      for (const sz of [-1, 1]) {
        for (let r = 0; r < rows; r++) {
          let x = -L / 2;
          while (x < L / 2 - 0.05) {
            let w = target * rand.float(0.75, 1.25);
            if (L / 2 - (x + w) < target * 0.4) w = L / 2 - x;
            P.add(roundBox(w - 0.035, rh - 0.035, 0.14, Math.min(0.06, rh * 0.3), 1), shade(stone, rand.float(-0.07, 0.05)), { at: [x + w / 2, r * rh + 0.01, sz * (T / 2 - 0.05)] });
            x += w;
          }
        }
      }
      // rounded capstones
      let x = -L / 2;
      while (x < L / 2 - 0.05) {
        let w = target * rand.float(0.8, 1.2);
        if (L / 2 - (x + w) < target * 0.4) w = L / 2 - x;
        P.add(roundBox(w - 0.03, 0.17, T + 0.06, 0.07, 1), shade(stone, rand.float(-0.02, 0.07)), { at: [x + w / 2, H - 0.18, 0] });
        x += w;
      }
    } else {
      const stone = colorOr(p.color, mix(PALETTE.stone, '#9e968a', 0.3));
      const dips = [{ u: rand.float(0.3, 0.7), w: rand.float(0.12, 0.22), d: rand.float(0.45, 0.7) }, { u: rand.chance(0.5) ? 0.05 : 0.95, w: 0.12, d: 0.35 }];
      const prof = (u) => { let k = 0; for (const d of dips) k = Math.max(k, d.d * Math.exp(-((u - d.u) ** 2) / (2 * d.w * d.w))); return H * (1 - k); };
      const ledges = crumbleWall(P, { len: L, t: T, height: (u) => prof(u / L), rand, color: stone, matrix: new THREE.Matrix4().makeTranslation(-L / 2, 0, 0), step: [0.12, 0.26], jitter: 0.1 });
      const n = Math.min(40, Math.round(L * H * 3));
      for (let i = 0; i < n; i++) {
        const sz = rand.sign(), u = rand.float(0.05, 0.95), x = -L / 2 + u * L, y = rand.float(0.05, prof(u) - 0.3);
        if (y < 0.05) continue;
        P.add(roundBox(rand.float(0.22, 0.38), rand.float(0.14, 0.22), 0.06, 0.03, 1), shade(stone, rand.float(-0.07, 0.05)), { at: [x, y, sz * (T / 2 + 0.005)] });
      }
      for (let i = 0; i < Math.round(L * 1.5); i++) {
        const r = rand.float(0.08, 0.18);
        P.add(blob(r, { detail: 1, amp: 0.2, seed: i + 3, squash: [1.2, 0.75, 1] }), shade(stone, rand.float(-0.08, 0.02)), { at: [rand.float(-L / 2 - 0.2, L / 2 + 0.2), r * 0.4, rand.sign() * rand.float(T / 2 + 0.15, T / 2 + 0.6)] });
      }
      const mossC = seasonal(MOSS, season);
      for (const [a, b, h] of ledges) {
        if (!rand.chance(0.32)) continue;
        const r = Math.min(0.16, (b - a) * 0.55);
        P.add(blob(r, { detail: 1, amp: 0.22, seed: Math.round(a * 37), squash: [1.3, 0.42, 1.3] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(mossC, rand.float(-0.06, 0.04)) }, { at: [-L / 2 + (a + b) / 2, h + 0.01, rand.float(-0.04, 0.04)] });
      }
      for (let i = 0; i < Math.round(L * 1.2); i++) {
        const r = rand.float(0.1, 0.17);
        P.add(blob(r, { detail: 1, amp: 0.22, seed: i * 3 + 1, squash: [1.4, 0.6, 1.1] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(mossC, rand.float(-0.06, 0.04)) }, { at: [rand.float(-L / 2, L / 2), r * 0.3, rand.sign() * (T / 2 + 0.06)] });
      }
    }
    const spots = { lean: spot([0, 0, T / 2 + 0.2], 0, 'lean'), back: spot([0, 0, -T / 2 - 0.2], 180, 'lean') };
    if (H <= 0.7 && style !== 'ruined') spots.sit = spot([L > 1.6 ? -L / 4 : 0, H, T / 2 - 0.1], 0, 'sit');
    return finish(P.build('wall'), { footprint: { w: L + 0.1 + (style === 'ruined' ? 0.4 : 0), d: T + (style === 'ruined' ? 1.4 : 0.3) }, spots, height: H });
  },
};

/* ───────────────────────── gate ───────────────────────── */

const GATE = {
  label: 'Gate',
  about: 'A village entrance arch to walk through: round posts with a curved beam, a flower garland and a hanging name board (wood), or stone pillars with a keystone arch and lanterns (stone).',
  params: {
    variant: { default: 'wood', options: ['wood', 'stone'], about: 'wooden arch or stone arch' },
    width: { default: 2.6, min: 1.4, max: 6, about: 'clear width between the posts' },
    sign: { default: 'Welcome', about: 'text on the board (empty = none)' },
    color: { default: '', type: 'color', about: 'wood or stone color (empty = by variant)' },
  },
  examples: [
    {},
    { variant: 'stone', sign: 'Maple Village' },
    { sign: '', width: 2.0, color: 'woodRed' },
    { variant: 'stone', width: 3.6, sign: '' },
  ],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const stoneV = oneOf(p.variant, ['wood', 'stone'], 'wood') === 'stone';
    const Wg = numOr(p.width, 2.6, 1.4, 6);
    const sign = textOr(p.sign, 'Welcome');
    const P = new Parts();
    const hx = Wg / 2;
    const lights = [];
    let topY;
    if (!stoneV) {
      const wood = colorOr(p.color, PALETTE.wood), dark = shade(wood, -0.12);
      const H = 2.75;
      for (const sx of [-1, 1]) {
        const x = sx * (hx + 0.16);
        P.add(roundCyl(0.3, 0.3, { top: 0.25, bevel: 0.06, segments: 14, steps: 1 }), PALETTE.stone, { at: [x, 0, 0] });
        P.add(roundCyl(0.16, H, { top: 0.14, bevel: 0.05, segments: 14, steps: 1 }), wood, { at: [x, 0.25, 0] });
        for (const y of [0.9, 1.7]) P.add(ring(0.155, 0.025, { radial: 4, tubular: 14 }), dark, { at: [x, y, 0] });
        P.add(sphere(0.16, 12, 9), dark, { at: [x, H + 0.32, 0] });
      }
      // a curved top beam and a straight one below
      const span = hx + 0.55;
      const arc = (x) => H + 0.28 + 0.24 * (1 - (x / span) ** 2);
      bandBeam(P, arc, -span, span, 0.2, 0.22, 0, wood, 18);
      plank(P, [-hx - 0.3, H - 0.18, 0], [hx + 0.3, H - 0.18, 0], 0.16, 0.15, dark);
      for (const sx of [-1, 1]) plank(P, [sx * (hx + 0.12), H - 0.65, 0.03], [sx * (hx - 0.45), H - 0.12, 0.03], 0.09, 0.08, dark, { up: [0, 0, 1] });
      // garland of leaves and flowers along the curved beam (seasonal)
      const leaf = season === 'winter' ? PALETTE.pine.winter : season === 'autumn' ? PALETTE.leaf.autumn : seasonal(PALETTE.leaf, season);
      const deco = stream(ctx, 'deco');
      const cols = flowerColors(season, deco);
      const n = Math.round(Wg * 4);
      for (let i = 0; i <= n; i++) {
        const x = -span + 0.15 + ((2 * span - 0.3) * i) / n;
        P.add(blob(0.1, { detail: 1, amp: 0.2, seed: i + 2 }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(leaf, deco.float(-0.06, 0.04)) }, { at: [x, arc(x) + 0.04, 0.1] });
        if (cols.length && i % 2 === 0) P.add(sphere(0.055, 6, 4), { slot: 'foliage', sheen: LEAF_SHEEN, color: cols[(i / 2) % cols.length] }, { at: [x + 0.03, arc(x) + 0.08, 0.18] });
      }
      if (sign) {
        const sw = Math.min(Wg * 0.62, 1.8), sh = 0.4;
        const sy = H - 0.62;
        for (const sx of [-1, 1]) rod(P, [sx * sw * 0.36, sy + sh / 2 - 0.02, 0.0], [sx * sw * 0.36, H - 0.26, 0.0], 0.014, METAL(), { seg: 5 });
        P.add(roundBox(sw + 0.12, sh + 0.12, 0.08, 0.04, 1), dark, { at: [0, sy - (sh + 0.12) / 2, 0] });
        const face = signMaterial(sign, { bg: '#f6ead0', fg: '#5a3a22', border: '#b7864e', borderWidth: 8, font: 'bold 88px Georgia, "Times New Roman", serif' });
        P.add(new THREE.PlaneGeometry(sw, sh), face, { at: [0, sy, 0.042] });
        P.add(new THREE.PlaneGeometry(sw, sh), face, { at: [0, sy, -0.042], rot: [0, Math.PI, 0] });
      }
      // small lanterns hanging from the posts
      for (const sx of [-1, 1]) {
        const x = sx * (hx + 0.16), z = 0.24;
        plank(P, [x, 1.95, 0.1], [x, 1.95, z + 0.02], 0.035, 0.035, METAL(), { r: 0.012 });
        P.add(roundCyl(0.065, 0.15, { top: 0.08, bevel: 0.02, segments: 10, steps: 1 }), LAMP, { at: [x, 1.72, z] });
        P.add(cone(0.1, 0.08, 10), METAL(), { at: [x, 1.86, z] });
        lights.push(light([x, 1.78, z + 0.1], { intensity: 0.7, distance: 4 }));
      }
      topY = H + 0.6;
    } else {
      const stone = colorOr(p.color, PALETTE.stoneLight), dark = shade(stone, -0.1);
      const pw = 0.62, ph = 2.3;
      for (const sx of [-1, 1]) {
        const x = sx * (hx + pw / 2);
        P.add(roundBox(pw + 0.16, 0.24, pw + 0.16, 0.05, 1), dark, { at: [x, 0, 0] });
        P.add(roundBox(pw, ph, pw, 0.06, 2), stone, { at: [x, 0.2, 0] });
        for (let k = 0; k < 4; k++) P.add(box(pw + 0.02, 0.03, pw + 0.02), dark, { at: [x, 0.7 + k * 0.5, 0] });
        P.add(roundBox(pw + 0.14, 0.16, pw + 0.14, 0.05, 1), shade(stone, 0.06), { at: [x, ph + 0.18, 0] });
        // lantern on a bracket facing out
        const lz = pw / 2 + 0.18;
        plank(P, [x, 1.75, pw / 2], [x, 1.75, lz + 0.03], 0.04, 0.04, METAL(), { r: 0.012 });
        P.add(roundCyl(0.075, 0.17, { top: 0.09, bevel: 0.02, segments: 10, steps: 1 }), LAMP, { at: [x, 1.5, lz] });
        P.add(cone(0.12, 0.09, 10), METAL(), { at: [x, 1.66, lz] });
        lights.push(light([x, 1.56, lz + 0.12], { intensity: 0.8, distance: 4.5 }));
      }
      // semicircular arch of voussoirs with a keystone, spanning between the pillars
      const r0 = hx, cy = ph + 0.3;
      const n = Math.max(9, Math.round(Wg * 4.2)) | 1;
      for (let k = 0; k < n; k++) {
        const th = Math.PI * (1 - (k + 0.5) / n);
        const key = k === (n - 1) / 2;
        const rr = r0 + 0.2;
        P.add(roundBox(Math.PI * rr / n - 0.03, key ? 0.52 : 0.42, pw - 0.08, 0.04, 1), shade(stone, key ? 0.08 : (k % 2 ? 0.03 : -0.03)), { matrix: new THREE.Matrix4().makeRotationZ(th - Math.PI / 2).setPosition(Math.cos(th) * (r0 - (key ? 0.02 : 0)), cy + Math.sin(th) * (r0 - (key ? 0.02 : 0)), 0) });
      }
      // spandrel fill above the arch up to a flat cornice
      const capY = cy + r0 + 0.55;
      const fill = [[-hx - pw + 0.04, cy - 0.02]];
      for (let i = 0; i <= 14; i++) { const th = Math.PI * (1 - i / 14); fill.push([Math.cos(th) * (r0 + 0.12), cy + Math.sin(th) * (r0 + 0.12)]); }
      fill.push([hx + pw - 0.04, cy - 0.02], [hx + pw - 0.04, capY], [-hx - pw + 0.04, capY]);
      P.add(slab(outlineShape(fill), pw - 0.16, { bevel: 0.03, seg: 1 }), shade(stone, -0.02));
      P.add(roundBox(Wg + 2 * pw + 0.2, 0.2, pw + 0.1, 0.05, 1), shade(stone, 0.06), { at: [0, capY, 0] });
      for (const sx of [-1, 1]) {
        P.add(sphere(0.2, 12, 9), shade(stone, 0.08), { at: [sx * (hx + pw / 2), capY + 0.38, 0] });
        P.add(roundCyl(0.14, 0.12, { bevel: 0.03, segments: 10, steps: 1 }), shade(stone, 0.04), { at: [sx * (hx + pw / 2), capY + 0.16, 0] });
      }
      if (sign) {
        const sw = Math.min(Wg * 0.7, 2.0), sh = 0.32;
        P.add(roundBox(sw + 0.1, sh + 0.1, 0.06, 0.03, 1), PALETTE.gold, { at: [0, capY - 0.5 - sh / 2, pw / 2 - 0.06] });
        P.add(new THREE.PlaneGeometry(sw, sh), signMaterial(sign, { bg: '#fbf3df', fg: '#4f3a26', border: '#c99b44', borderWidth: 7, font: 'bold 80px Georgia, "Times New Roman", serif' }), { at: [0, capY - 0.5, pw / 2 + 0.03] });
      }
      if (season !== 'winter') {
        const ivy = seasonal(PALETTE.leaf, season);
        const deco = stream(ctx, 'deco');
        for (let i = 0; i < 7; i++) P.add(blob(0.12, { detail: 1, amp: 0.2, seed: i + 7, squash: [1.2, 1, 0.6] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(ivy, deco.float(-0.08, 0.03)) }, { at: [-(hx + pw) + 0.05 + deco.float(-0.05, 0.1), 0.25 + i * 0.3, pw / 2 + 0.02] });
      }
      topY = capY + 0.6;
    }
    return finish(P.build('gate'), {
      footprint: { w: Wg + 1.6, d: 1.0 },
      spots: {
        through: spot([0, 0, 0], 0, 'stand'),
        front: spot([0, 0, 1.1], 180, 'stand'),
        left: spot([-hx - 0.9, 0, 0.7], 0, 'stand'),
        right: spot([hx + 0.9, 0, 0.7], 0, 'stand'),
      },
      lights,
      height: topY,
    });
  },
};

/* ───────────────────────── ruin ───────────────────────── */

function column(P, { h, r = 0.25, stone, broken = false, rand, capital = true }) {
  P.add(roundBox(r * 2.5, 0.18, r * 2.5, 0.04, 1), shade(stone, -0.04));
  P.add(lathe([[0, 0.17], [r * 1.12, 0.17], [r * 1.12, 0.25], [r, 0.3], [r, 0.3]], 16), shade(stone, 0.02));
  const shaftTop = broken ? h : h - 0.36;
  P.add(roundCyl(r, shaftTop - 0.3, { top: r * 0.92, bevel: 0.03, segments: 14, steps: 1 }), stone, { at: [0, 0.3, 0] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    P.add(box(0.035, shaftTop - 0.42, 0.03), shade(stone, -0.07), { at: [Math.sin(a) * r * 0.97, 0.36, Math.cos(a) * r * 0.97], rot: [0, a, 0] });
  }
  if (!broken && capital) {
    P.add(lathe([[0, 0], [r * 0.95, 0], [r * 1.25, 0.16], [r * 1.3, 0.2], [0, 0.2]], 16), shade(stone, 0.04), { at: [0, shaftTop, 0] });
    P.add(roundBox(r * 2.8, 0.16, r * 2.8, 0.04, 1), shade(stone, 0.06), { at: [0, shaftTop + 0.2, 0] });
  } else if (broken) {
    // a jagged broken top: a tilted stub and a chip
    P.add(roundCyl(r * 0.9, 0.22, { top: r * 0.6, bevel: 0.04, segments: 12, steps: 1 }), shade(stone, 0.03), { at: [rand.float(-0.03, 0.03), shaftTop - 0.05, 0], rot: [rand.float(-0.3, 0.3), 0, rand.float(-0.3, 0.3)] });
  }
}

const RUIN = {
  label: 'Ruin',
  about: 'Crumbled ancient walls with an archway, broken columns on a cracked stone floor, a lintel still resting on the tallest pair, a fallen column in pieces beside the entrance steps, rubble and moss.',
  params: {
    size: { default: 'medium', options: ['small', 'medium', 'large'], about: 'how much of it is left' },
    stone: { default: '#d2c9b6', type: 'color', about: 'stone color' },
    moss: { default: true, about: 'moss and weeds (seasonal)' },
  },
  examples: [{}, { size: 'small' }, { size: 'large', stone: '#cbc3d4' }],
  build(p, ctx) {
    const rand = ctx.rng;
    // moss comes from its own stream, so the stones lie the same in every season and with or without moss
    const deco = stream(ctx, 'deco');
    const season = seasonOf(ctx);
    const size = oneOf(p.size, ['small', 'medium', 'large'], 'medium');
    const stone = colorOr(p.stone, '#d2c9b6');
    const mossOn = boolOr(p.moss, true);
    const mossC = seasonal(MOSS, season);
    const P = new Parts();
    const [Wf, Df] = size === 'small' ? [3.2, 2.6] : size === 'large' ? [6.4, 4.6] : [4.8, 3.6];
    const fy = 0.24;
    const backL = Wf - 0.2;
    const doorU0 = backL * 0.3, doorU1 = backL * 0.3 + 0.9, doorH = 1.5;
    const ax = -backL / 2 + (doorU0 + doorU1) / 2, ar = (doorU1 - doorU0) / 2;
    const center = [-0.2, 0.3], archAt = [ax, -Df / 2 + 0.3];
    // cracked floor slabs on a low platform (never missing or tilted under a spot), steps at the front
    const nx = Math.round(Wf / 1.1), nz = Math.round(Df / 1.1);
    const sw = Wf / nx, sd = Df / nz;
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const gone = rand.chance(0.08), dh = rand.float(-0.03, 0.03), col = rand.float(-0.08, 0.02), tx = rand.float(-0.02, 0.02), tz = rand.float(-0.02, 0.02);
      const x = -Wf / 2 + sw * (i + 0.5), z = -Df / 2 + sd * (k + 0.5);
      const under = [center, archAt].some(([qx, qz]) => Math.abs(qx - x) < sw / 2 + 0.2 && Math.abs(qz - z) < sd / 2 + 0.2);
      if (gone && !under) continue;
      P.add(roundBox(sw - 0.05, under ? fy : fy + dh, sd - 0.05, 0.04, 1), shade(stone, col), { at: [x, 0, z], rot: under ? [0, 0, 0] : [tx, 0, tz] });
    }
    const stepW = Wf * 0.55, stepTop = fy * 0.66 + 0.02;
    for (let s = 0; s < 2; s++) P.add(roundBox(stepW - s * 0.3, fy * (0.66 - s * 0.33) + 0.02, 0.32, 0.04, 1), shade(stone, -0.04 - s * 0.02), { at: [0, 0, Df / 2 + 0.14 + s * 0.3] });
    // columns along the front and sides, some whole, most broken
    const cols = [];
    const nFront = size === 'small' ? 2 : size === 'large' ? 4 : 3;
    for (let i = 0; i < nFront; i++) cols.push([-Wf / 2 + 0.5 + ((Wf - 1) * i) / Math.max(nFront - 1, 1), Df / 2 - 0.45]);
    if (size !== 'small') cols.push([Wf / 2 - 0.5, 0], [-Wf / 2 + 0.5, 0.1]);
    const wholeH = 2.7;
    cols.forEach(([x, z], i) => {
      const whole = i === 1 || (size === 'large' && i === 3);
      const h = whole ? wholeH : rand.float(0.7, 2.1);
      const C = new Parts();
      column(C, { h, stone, broken: !whole, rand });
      P.merge(C, xform([x, fy, z], [0, rand.float(0, 1), 0]));
      // a cushion of moss on the top (whole columns end flat at h, broken ones in a tilted stub)
      const mossy = deco.chance(0.6);
      if (mossOn && season !== 'winter' && mossy) P.add(blob(0.2, { detail: 1, amp: 0.2, seed: i + 1, squash: [1.3, 0.45, 1.3] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(mossC, -0.06) }, { at: [x, fy + (whole ? h + 0.06 : h + 0.1), z] });
    });
    // a lintel still resting on the capitals of the whole pair
    if (size === 'large') plank(P, [cols[1][0] - 0.38, fy + wholeH + 0.3, cols[1][1]], [cols[3][0] + 0.38, fy + wholeH + 0.3, cols[3][1]], 0.5, 0.3, shade(stone, 0.04));
    // back wall with an arched doorway, and a side wall
    const wallH = size === 'small' ? 1.9 : 2.6;
    const dips = [{ u: rand.float(0.65, 0.85), w: 0.12, d: 0.55 }, { u: 0.06, w: 0.08, d: 0.3 }];
    const prof = (u) => { let k = 0; for (const d of dips) k = Math.max(k, d.d * Math.exp(-((u - d.u) ** 2) / (2 * d.w * d.w))); return wallH * (1 - k); };
    crumbleWall(P, { len: backL, t: 0.4, height: (u) => (u > doorU0 - 0.25 && u < doorU1 + 0.25 ? Math.max(prof(u / backL), doorH + 0.8) : prof(u / backL)), rand, color: stone, matrix: new THREE.Matrix4().makeTranslation(-backL / 2, fy, -Df / 2 + 0.3), notch: { u0: doorU0, u1: doorU1, h: doorH }, step: [0.14, 0.3], jitter: 0.12 });
    // the arch over the doorway
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const th = Math.PI * (1 - (k + 0.5) / 7);
        P.add(roundBox(0.22, 0.26, 0.08, 0.03, 1), shade(stone, k === 3 ? 0.08 : 0.03), { matrix: new THREE.Matrix4().makeRotationZ(th - Math.PI / 2).setPosition(ax + Math.cos(th) * (ar + 0.1), fy + doorH - ar + 0.15 + Math.sin(th) * (ar + 0.1), -Df / 2 + 0.3 + sz * 0.2) });
      }
    }
    if (size !== 'small') {
      const sideL = Df * 0.6;
      const sp = (u) => wallH * 0.8 * (1 - 0.65 * u) - rand.float(0, 0.05);
      crumbleWall(P, { len: sideL, t: 0.36, height: (u) => Math.max(0.3, sp(u / sideL)), rand, color: shade(stone, -0.02), matrix: new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(Wf / 2 - 0.25, fy, -Df / 2 + 0.5), step: [0.14, 0.3], jitter: 0.12 });
    }
    // a fallen column in pieces, lying in the grass beside the steps (clear of the way in)
    const drums = size === 'small' ? 2 : 3;
    const dl = 0.62, dg = 0.06, fa = 0.35;
    const ux = Math.cos(fa), uz = -Math.sin(fa), nxs = Math.sin(fa), nzs = Math.cos(fa);
    const x0 = stepW / 2 + 0.42, z0 = Df / 2 + 0.95;
    const seat = Math.floor(drums / 2);
    let sitSpot = null, farX = x0;
    for (let i = 0; i < drums; i++) {
      const t = i * (dl + dg);
      const off = i === seat ? 0 : rand.float(-0.05, 0.05), yaw = i === seat ? 0 : rand.float(-0.12, 0.12);
      const sx = x0 + ux * t + nxs * off, sz = z0 + uz * t + nzs * off;
      const dir = new THREE.Vector3(ux, 0, uz).applyAxisAngle(UP, yaw);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      P.add(roundCyl(0.25, dl, { bevel: 0.04, segments: 14, steps: 1 }), shade(stone, rand.float(-0.04, 0.03)), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(sx, 0.25, sz), q, ONE) });
      farX = Math.max(farX, sx + dir.x * dl + 0.1);
      if (i === seat) {
        // sit on top of this drum, a little forward of its axis
        const mx = sx + ux * dl / 2 + nxs * 0.1, mz = sz + uz * dl / 2 + nzs * 0.1;
        sitSpot = spot([mx, 0.25 + Math.sqrt(0.25 ** 2 - 0.1 ** 2), mz], THREE.MathUtils.radToDeg(fa), 'sit');
      }
    }
    // rubble, kept off the steps
    for (let i = 0; i < Math.round(Wf * 2.5); i++) {
      const r = rand.float(0.08, 0.2);
      const onFloor = rand.chance(0.5);
      let x = rand.float(-Wf / 2 - 0.4, Wf / 2 + 0.4);
      const zf = rand.float(-Df / 2 + 0.6, Df / 2 - 0.2), zo = rand.sign() * rand.float(Df / 2 + 0.3, Df / 2 + 1.2), col = rand.float(-0.1, 0.02);
      const z = onFloor ? zf : zo;
      if (!onFloor && z > 0 && Math.abs(x) < stepW / 2 + 0.25) x = Math.sign(x || 1) * (stepW / 2 + 0.25 + Math.abs(x) * 0.25);
      if (onFloor && Math.hypot(x - center[0], z - center[1]) < 0.45) continue;
      P.add(blob(r, { detail: 1, amp: 0.2, seed: i * 7 + 2, squash: [1.25, 0.7, 1] }), shade(stone, col), { at: [x, (onFloor ? fy : 0) + r * 0.4, z] });
    }
    if (mossOn) {
      for (let i = 0; i < Math.round(Wf * 2.4); i++) {
        const r = deco.float(0.12, 0.26), x = deco.float(-Wf / 2, Wf / 2), z = deco.float(-Df / 2 + 0.5, Df / 2), col = deco.float(-0.07, 0.04);
        if (Math.hypot(x - center[0], z - center[1]) < 0.4) continue;
        P.add(blob(r, { detail: 1, amp: 0.22, seed: i * 5 + 3, squash: [1.4, 0.45, 1.2] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(mossC, col) }, { at: [x, fy - 0.02 + r * 0.15, z] });
      }
      for (let i = 0; i < 5; i++) P.add(blob(0.18, { detail: 1, amp: 0.2, seed: i + 40, squash: [1.3, 0.5, 0.9] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(mossC, -0.04) }, { at: [-backL / 2 + deco.float(0.2, backL - 0.2), fy + deco.float(0.6, 1.4), -Df / 2 + 0.52] });
    }
    return finish(P.build('ruin'), {
      footprint: { w: 2 * Math.max(Wf / 2 + 0.6, farX + 0.3), d: Df + 2.8 },
      spots: {
        center: spot([center[0], fy, center[1]], 0, 'stand'),
        steps: spot([0, stepTop, Df / 2 + 0.14], 0, 'stand'),
        sit: sitSpot,
        arch: spot([archAt[0], fy, archAt[1]], 0, 'stand'),
      },
      height: wallH + fy,
    });
  },
};

/* ───────────────────────── shed ───────────────────────── */

const SHED = {
  label: 'Shed',
  about: 'A little wooden garden shed with board siding, a Z-braced door, a small window and tools leaning by the door: a shovel, a rake, a watering can and flower pots.',
  params: {
    walls: { default: '#8fb5a0', type: 'color', about: 'board color' },
    roof: { default: PALETTE.roofBrown, type: 'color', about: 'roof color' },
    door: { default: '', type: 'color', about: 'door color (empty = trim)' },
    open: { default: false, about: 'door left ajar' },
  },
  examples: [{}, { walls: PALETTE.wood, roof: PALETTE.roofGreen, open: true }, { walls: '#d9b9a0', roof: PALETTE.roofRed, door: '#5d8fc4' }],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const walls = colorOr(p.walls, '#8fb5a0'), roofC = colorOr(p.roof, PALETTE.roofBrown);
    const trim = '#f6efe0';
    const doorC = colorOr(p.door, null) ?? shade(walls, 0.12);
    const open = boolOr(p.open, false);
    const P = new Parts();
    const W = 1.9, D = 1.6, H = 1.7, c = D / 2;
    P.add(roundBox(W + 0.12, 0.14, D + 0.12, 0.04, 1), PALETTE.stoneDark);
    P.add(roundBox(W, H, D, 0.05, 2), walls, { at: [0, 0.1, 0] });
    // board grooves
    for (let x = -W / 2 + 0.2; x < W / 2 - 0.1; x += 0.2) {
      if (Math.abs(x + 0.35) < 0.42) continue;
      P.add(box(0.02, H - 0.2, 0.01), shade(walls, -0.1), { at: [x, 0.2, c + 0.002] });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(roundBox(0.1, H - 0.05, 0.1, 0.03, 1), trim, { at: [sx * (W / 2 - 0.03), 0.12, sz * (c - 0.03)] });
    const roof = addRoof(P, { style: 'gable', W, D, y0: H + 0.1, rise: 0.62, over: 0.26, overX: 0.22, t: 0.16, color: roofC, trim, walls, shingles: true });
    // Z-braced door, opened a little when asked
    const dw = 0.68, dh = 1.32, dx = -0.35;
    P.add(roundBox(dw + 0.04, dh + 0.02, 0.03, 0.01, 1), HOLE, { at: [dx, 0.12, c + 0.005] });
    const leaf = new Parts();
    leaf.add(roundBox(dw, dh, 0.06, 0.02, 1), doorC, { at: [dw / 2, 0, 0] });
    for (let x = 0.17; x < dw - 0.05; x += 0.17) leaf.add(box(0.015, dh - 0.1, 0.01), shade(doorC, -0.12), { at: [x, 0.05, 0.032] });
    for (const y of [0.14, dh - 0.24]) leaf.add(roundBox(dw - 0.06, 0.1, 0.03, 0.015, 1), trim, { at: [dw / 2, y, 0.045] });
    plank(leaf, [0.08, 0.24, 0.05], [dw - 0.08, dh - 0.24, 0.05], 0.09, 0.03, trim, { up: [0, 0, 1] });
    leaf.add(sphere(0.035, 8, 6), METAL(PALETTE.gold), { at: [dw - 0.1, dh * 0.48, 0.07] });
    P.merge(leaf, xform([dx - dw / 2, 0.12, c + 0.02], [0, open ? -0.75 : 0, 0]));
    P.add(roundBox(dw + 0.18, 0.08, 0.06, 0.02, 1), trim, { at: [dx, 0.12 + dh, c + 0.03] });
    // a small window
    const deco = stream(ctx, 'deco');
    P.merge(windowParts({ w: 0.42, h: 0.42, shape: 'square', frame: trim, glass: 'lit', sill: true, flowerbox: true, season, rand: deco }), xform([0.48, 1.05, c]));
    P.merge(windowParts({ w: 0.36, h: 0.36, shape: 'square', frame: trim, glass: 'dark', sill: true }), xform([W / 2, 1.05, 0], [0, Math.PI / 2, 0]));
    // tools leaning on the wall, a watering can and pots
    const handle = PALETTE.woodLight;
    rod(P, [-0.92, 0.02, c + 0.32], [-0.84, 1.3, c + 0.06], 0.022, handle, { seg: 6 });
    P.add(roundBox(0.2, 0.24, 0.03, 0.03, 1), METAL(PALETTE.ironLight), { at: [-0.92, 0.0, c + 0.33], rot: [-0.2, 0, 0] });
    rod(P, [W / 2 + 0.22, 0.02, c - 0.2], [W / 2 + 0.06, 1.35, c - 0.35], 0.02, handle, { seg: 6 });
    P.add(roundBox(0.36, 0.04, 0.04, 0.015, 1), METAL(PALETTE.iron), { at: [W / 2 + 0.23, 0.02, c - 0.19] });
    for (let i = 0; i < 6; i++) P.add(box(0.015, 0.09, 0.015), METAL(PALETTE.iron), { at: [W / 2 + 0.08 + i * 0.06, 0.0, c - 0.17] });
    const cx = 0.75, cz = c + 0.45;
    P.add(roundCyl(0.13, 0.22, { top: 0.11, bevel: 0.03, segments: 14, steps: 1 }), METAL('#6fa3c9'), { at: [cx, 0, cz] });
    rod(P, [cx + 0.1, 0.12, cz], [cx + 0.3, 0.3, cz], 0.02, METAL('#6fa3c9'), { seg: 6 });
    P.add(ring(0.08, 0.016, { radial: 4, tubular: 12 }), METAL('#6fa3c9'), { at: [cx - 0.02, 0.3, cz], rot: [Math.PI / 2, 0, 0] });
    const cols = flowerColors(season, deco);
    for (const [x, z, s] of [[1.12, c + 0.1, 1], [1.2, c - 0.3, 0.8]]) {
      P.add(roundCyl(0.12 * s, 0.18 * s, { top: 0.14 * s, bevel: 0.02, segments: 12, steps: 1 }), '#c8754a', { at: [x, 0, z] });
      P.add(blob(0.12 * s, { detail: 1, amp: 0.15, seed: 3 }), { slot: 'foliage', sheen: LEAF_SHEEN, color: season === 'winter' ? '#6f7f5f' : seasonal(PALETTE.leaf, season) }, { at: [x, 0.24 * s, z] });
      if (cols.length) P.add(sphere(0.05, 6, 4), { slot: 'foliage', sheen: LEAF_SHEEN, color: cols[0] }, { at: [x + 0.03, 0.32 * s, z + 0.05] });
    }
    return finish(P.build('shed'), {
      footprint: { w: W + 0.9, d: D + 1.0 },
      spots: { door: open ? spot([dx - 0.1, 0, c + 0.68], 0, 'stand') : spot([dx, 0, c + 0.55], 0, 'stand'), tools: spot([0.4, 0, c + 0.75], 180, 'stand') },
      height: roof.ridge,
    });
  },
};

/* ───────────────────────── greenhouse ───────────────────────── */

const GREENHOUSE = {
  label: 'Greenhouse',
  about: 'A glass greenhouse on a low brick base: white frames, a glass gable roof with a ridge vent, and potting benches of seasonal plants and flowers inside. Someone can stand at the bench.',
  params: {
    frame: { default: '#f7f3ea', type: 'color', about: 'frame color' },
    base: { default: PALETTE.brick, type: 'color', about: 'base wall color' },
    size: { default: 'medium', options: ['small', 'medium', 'large'], about: 'small 2.2 × 2.6, medium 2.6 × 3.4, large 3.2 × 4.4' },
  },
  examples: [{}, { frame: '#5f8f6e', base: PALETTE.stone, size: 'small' }, { size: 'large', frame: '#e9dcc0' }],
  build(p, ctx) {
    const rand = ctx.rng;
    const season = seasonOf(ctx);
    const frame = colorOr(p.frame, '#f7f3ea'), baseC = colorOr(p.base, PALETTE.brick);
    const size = oneOf(p.size, ['small', 'medium', 'large'], 'medium');
    const [W, D] = size === 'small' ? [2.2, 2.6] : size === 'large' ? [3.2, 4.4] : [2.6, 3.4];
    const P = new Parts();
    const glassL = { slot: 'clear', color: '#d8eef2', opacity: 0.32 };
    const bh = 0.45, H = 1.85, hw = W / 2, c = D / 2;
    const rise = W * 0.36;
    // brick base with a stone cap, a path tile floor
    for (const [w, d, x, z] of [[W, 0.16, 0, c - 0.08], [W, 0.16, 0, -c + 0.08], [0.16, D - 0.3, hw - 0.08, 0], [0.16, D - 0.3, -hw + 0.08, 0]]) {
      if (z > 0) {
        for (const sx of [-1, 1]) P.add(roundBox((W - 0.8) / 2, bh, 0.16, 0.03, 1), baseC, { at: [sx * (0.4 + (W - 0.8) / 4), 0, z] });
      } else P.add(roundBox(w, bh, d, 0.03, 1), baseC, { at: [x, 0, z] });
    }
    P.add(roundBox(W + 0.06, 0.06, 0.24, 0.02, 1), PALETTE.stoneLight, { at: [0, bh, -c + 0.08] });
    for (const sx of [-1, 1]) {
      P.add(roundBox(0.24, 0.06, D + 0.06, 0.02, 1), PALETTE.stoneLight, { at: [sx * (hw - 0.08), bh, 0] });
      P.add(roundBox((W - 0.8) / 2 + 0.04, 0.06, 0.24, 0.02, 1), PALETTE.stoneLight, { at: [sx * (0.4 + (W - 0.8) / 4), bh, c - 0.08] });
    }
    P.add(roundBox(W - 0.3, 0.03, D - 0.3, 0.01, 1), '#cdbb97', { at: [0, 0, 0] });
    // glass walls and roof
    const gy = bh + 0.06;
    for (const sx of [-1, 1]) P.add(box(0.02, H - gy, D - 0.1), glassL, { at: [sx * (hw - 0.08), gy, 0] });
    P.add(box(W - 0.16, H - gy, 0.02), glassL, { at: [0, gy, -c + 0.08] });
    for (const sx of [-1, 1]) P.add(box((W - 0.84) / 2, H - gy, 0.02), glassL, { at: [sx * (0.42 + (W - 0.84) / 4), gy, c - 0.08] });
    P.add(box(0.8, H - 1.95 + 0.6, 0.02), glassL, { at: [0, 1.95, c - 0.08] });
    const gab = outlineShape([[-hw + 0.08, H], [hw - 0.08, H], [0, H + rise - 0.04]]);
    for (const z of [c - 0.08, -c + 0.08]) P.add(slab(gab, 0.02, { bevel: 0 }), glassL, { at: [0, 0, z] });
    const slopeL = Math.hypot(hw, rise);
    for (const sx of [-1, 1]) plank(P, [0, H + rise, 0], [sx * hw, H, 0], D, 0.02, glassL, { up: [sx * rise, hw, 0], r: 0.005 });
    // white frame: corner posts, mullions, rafters, ridge with a vent
    const fr = (a, b, w = 0.07) => plank(P, a, b, w, w, frame, { r: 0.02 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fr([sx * (hw - 0.08), gy, sz * (c - 0.08)], [sx * (hw - 0.08), H, sz * (c - 0.08)], 0.09);
    const bays = Math.round(D / 0.7);
    for (let k = 0; k <= bays; k++) {
      const z = -c + 0.08 + ((D - 0.16) * k) / bays;
      for (const sx of [-1, 1]) {
        fr([sx * (hw - 0.07), gy, z], [sx * (hw - 0.07), H, z]);
        fr([sx * (hw - 0.04), H, z], [0, H + rise + 0.02, z]);
      }
    }
    for (const sx of [-1, 1]) {
      fr([sx * (hw - 0.07), H, -c + 0.05], [sx * (hw - 0.07), H, c - 0.05]);
      fr([sx * (hw - 0.07), gy + 0.62, -c + 0.05], [sx * (hw - 0.07), gy + 0.62, c - 0.05], 0.05);
    }
    for (const z of [c - 0.06, -c + 0.06]) {
      fr([-hw + 0.08, H, z], [hw - 0.08, H, z]);
      for (const sx of [-1, 1]) fr([sx * (hw - 0.04), H, z], [0, H + rise + 0.02, z]);
    }
    for (const sx of [-1, 1]) fr([sx * 0.42, gy, c - 0.06], [sx * 0.42, 1.95, c - 0.06], 0.08);
    fr([-0.42, 1.95, c - 0.06], [0.42, 1.95, c - 0.06], 0.08);
    rod(P, [0, H + rise + 0.03, -c - 0.06], [0, H + rise + 0.03, c + 0.06], 0.07, frame, { seg: 10 });
    plank(P, [0.02, H + rise + 0.02, -c * 0.6], [0.02, H + rise + 0.02, c * 0.2], 0.5, 0.03, glassL, { up: [0.35, 1, 0], r: 0.008 });
    // door: a framed glass door, a little open
    const door = new Parts();
    door.add(roundBox(0.78, 1.42, 0.05, 0.02, 1), frame, { at: [0.39, 0, 0] });
    door.add(box(0.6, 1.0, 0.06), glassL, { at: [0.39, 0.3, 0] });
    door.add(sphere(0.03, 8, 6), METAL(PALETTE.gold), { at: [0.68, 0.7, 0.05] });
    P.merge(door, xform([-0.4, gy, c - 0.05], [0, -0.5, 0]));
    // benches with pots along both sides
    const leaf = season === 'winter' ? '#5e8a62' : seasonal(PALETTE.leaf, season);
    const cols = season === 'winter' ? [PALETTE.flower.red, PALETTE.flower.white] : flowerColors(season, stream(ctx, 'deco'));
    for (const sx of [-1, 1]) {
      const bx = sx * (hw - 0.42);
      P.add(roundBox(0.5, 0.06, D - 0.7, 0.02, 1), PALETTE.wood, { at: [bx, 0.74, -0.1] });
      for (const z of [-c + 0.45, c - 0.65]) for (const dx of [-0.2, 0.2]) P.add(box(0.05, 0.74, 0.05), PALETTE.woodDark, { at: [bx + dx, 0, z] });
      const n = Math.round((D - 0.9) / 0.38);
      for (let i = 0; i < n; i++) {
        const z = -c + 0.5 + i * 0.38;
        P.add(roundCyl(0.1, 0.15, { top: 0.12, bevel: 0.02, segments: 10, steps: 1 }), '#c8754a', { at: [bx, 0.8, z] });
        const tall = rand.chance(0.4);
        P.add(blob(tall ? 0.15 : 0.12, { detail: 1, amp: 0.18, seed: i * 3 + (sx > 0 ? 1 : 0), squash: tall ? [0.9, 1.4, 0.9] : [1.1, 0.9, 1.1] }), { slot: 'foliage', sheen: LEAF_SHEEN, color: shade(leaf, rand.float(-0.06, 0.05)) }, { at: [bx, tall ? 1.1 : 1.02, z] });
        if (cols.length && !tall) P.add(sphere(0.05, 6, 4), { slot: 'foliage', sheen: LEAF_SHEEN, color: cols[i % cols.length] }, { at: [bx + 0.04, 1.12, z + 0.03] });
        if (tall && season !== 'winter') P.add(sphere(0.045, 6, 4), { slot: 'foliage', sheen: LEAF_SHEEN, color: PALETTE.flower.red }, { at: [bx + 0.08, 1.12, z + 0.05] });
      }
    }
    return finish(P.build('greenhouse'), {
      footprint: { w: W + 0.4, d: D + 0.6 },
      spots: { door: spot([0, 0, c + 0.5], 0, 'stand'), bench: spot([-hw + 0.95, 0.03, 0.1], -90, 'stand') },
      height: H + rise + 0.1,
    });
  },
};

/* ───────────────────────── shrine ───────────────────────── */

const SHRINE = {
  label: 'Shrine',
  about: 'A little wayside shrine: a wooden hut with a swooping roof on a stone base, a rope with paper streamers, an offering box, two stone lanterns and a small vermilion torii in front. Someone can kneel to pray.',
  params: {
    color: { default: '#d4553f', type: 'color', about: 'vermilion accents and the torii' },
    roof: { default: PALETTE.roofSlate, type: 'color', about: 'roof color' },
    torii: { default: true, about: 'a small torii gate in front' },
  },
  examples: [{}, { color: 'gold', roof: PALETTE.roofGreen, torii: false }, { roof: PALETTE.roofBrown }],
  build(p, ctx) {
    const rand = ctx.rng;
    const red = colorOr(p.color, '#d4553f'), roofC = colorOr(p.roof, PALETTE.roofSlate);
    const torii = boolOr(p.torii, true);
    const P = new Parts();
    const wood = PALETTE.wood, stone = PALETTE.stone;
    // stone base with a step
    P.add(roundBox(1.5, 0.36, 1.3, 0.05, 1), stone, { at: [0, 0, -0.3] });
    P.add(roundBox(0.9, 0.18, 0.35, 0.04, 1), shade(stone, 0.04), { at: [0, 0, 0.52] });
    // the shrine house
    const hx = 0.42, hz = 0.36, by = 0.36;
    P.add(roundBox(1.0, 0.1, 0.86, 0.03, 1), wood, { at: [0, by, -0.3] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(roundBox(0.09, 0.82, 0.09, 0.025, 1), red, { at: [sx * hx, by + 0.1, -0.3 + sz * hz] });
    P.add(roundBox(hx * 2 - 0.04, 0.78, hz * 2 - 0.04, 0.03, 1), PALETTE.woodLight, { at: [0, by + 0.1, -0.33] });
    // doors with lattice
    for (const sx of [-1, 1]) {
      P.add(roundBox(hx - 0.04, 0.6, 0.03, 0.01, 1), shade(PALETTE.woodLight, 0.05), { at: [sx * (hx / 2), by + 0.18, -0.3 + hz - 0.02] });
      for (let k = 1; k < 4; k++) P.add(box(0.012, 0.56, 0.012), PALETTE.woodDark, { at: [sx * (hx / 2) - (hx - 0.04) / 2 + k * (hx - 0.04) / 4, by + 0.2, -0.3 + hz] });
      for (let k = 1; k < 5; k++) P.add(box(hx - 0.06, 0.012, 0.012), PALETTE.woodDark, { at: [sx * (hx / 2), by + 0.18 + k * 0.12, -0.3 + hz] });
    }
    P.add(roundBox(hx * 2 + 0.1, 0.08, 0.1, 0.02, 1), red, { at: [0, by + 0.86, -0.3 + hz] });
    // swooping roof: a curved profile extruded along X
    const ry = by + 0.94;
    const half = bezier([0, 0.62], [0.28, 0.6], [0.5, 0.18], [0.78, 0.02], 8);
    const top = [...half.slice(1).reverse().map(([z, y]) => [-z, y]), ...half];
    const under = offsetLine(top, -0.09);
    const roofShape = outlineShape([...top.map(([z, y]) => [z, y - 0.01]), ...under.reverse()]);
    P.add(slab(roofShape, 1.3, { bevel: 0.025, seg: 1 }), roofC, { at: [0, ry, -0.3], rot: [0, -Math.PI / 2, 0] });
    rod(P, [-0.72, ry + 0.63, -0.3], [0.72, ry + 0.63, -0.3], 0.06, shade(roofC, -0.1), { seg: 10 });
    for (const sx of [-1, 1]) P.add(sphere(0.07, 10, 8), METAL(PALETTE.gold), { at: [sx * 0.74, ry + 0.64, -0.3] });
    P.add(slab(outlineShape([[-hz, 0], [hz, 0], [0, 0.52]]), hx * 2, { bevel: 0 }), PALETTE.woodLight, { at: [0, ry - 0.02, -0.3], rot: [0, -Math.PI / 2, 0] });
    // sacred rope with paper streamers, a bell, an offering box
    const rope = [];
    for (let i = 0; i <= 10; i++) { const x = -0.5 + i * 0.1; rope.push(new THREE.Vector3(x, by + 0.84 - 0.08 * Math.sin((i / 10) * Math.PI), -0.3 + hz + 0.1)); }
    P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rope), 20, 0.03, 6, false), '#e8d6a6');
    for (const x of [-0.28, 0, 0.28]) {
      const y = by + 0.84 - 0.08 * Math.sin(((x + 0.5) / 1) * Math.PI);
      P.add(slab(outlineShape([[-0.04, 0], [0.04, 0], [0.04, -0.06], [-0.02, -0.06], [-0.02, -0.12], [0.03, -0.12], [0.03, -0.2], [-0.04, -0.2]]), 0.01, { bevel: 0 }), PALETTE.wallWhite, { at: [x, y - 0.03, -0.3 + hz + 0.11] });
    }
    P.add(sphere(0.07, 10, 8), METAL(PALETTE.gold), { at: [0.36, by + 0.66, -0.3 + hz + 0.12] });
    rod(P, [0.36, by + 0.7, -0.3 + hz + 0.12], [0.36, by + 0.84, -0.3 + hz + 0.1], 0.012, '#d9534a', { seg: 5 });
    P.add(roundBox(0.5, 0.3, 0.3, 0.03, 1), PALETTE.woodDark, { at: [0, by, 0.22] });
    for (let k = 0; k < 4; k++) P.add(box(0.44, 0.015, 0.025), PALETTE.woodLight, { at: [0, by + 0.31, 0.12 + k * 0.065] });
    // stone lanterns
    for (const sx of [-1, 1]) {
      const x = sx * 1.05, z = 0.35;
      P.add(roundBox(0.34, 0.1, 0.34, 0.03, 1), stone, { at: [x, 0, z] });
      P.add(roundCyl(0.07, 0.5, { bevel: 0.02, segments: 8, steps: 1 }), stone, { at: [x, 0.1, z] });
      P.add(roundBox(0.3, 0.08, 0.3, 0.03, 1), stone, { at: [x, 0.6, z] });
      P.add(roundBox(0.2, 0.2, 0.2, 0.02, 1), LAMP, { at: [x, 0.68, z] });
      P.add(facetLathe([[0, 0], [0.26, 0], [0.24, 0.05], [0.05, 0.2], [0, 0.22]], 4), stone, { at: [x, 0.88, z] });
      P.add(sphere(0.045, 8, 6), stone, { at: [x, 1.11, z] });
    }
    // a small torii in front
    let tz = 0;
    if (torii) {
      tz = 1.55;
      for (const sx of [-1, 1]) {
        P.add(roundCyl(0.075, 1.75, { top: 0.065, bevel: 0.03, segments: 12, steps: 1 }), red, { at: [sx * 0.62, 0, tz] });
        P.add(roundCyl(0.1, 0.16, { bevel: 0.03, segments: 12, steps: 1 }), PALETTE.iron, { at: [sx * 0.62, 0, tz] });
      }
      plank(P, [-0.82, 1.42, tz], [0.82, 1.42, tz], 0.1, 0.09, red);
      const kasagi = (x) => 1.78 + 0.06 * (x / 1.0) ** 2;
      bandBeam(P, kasagi, -1.0, 1.0, 0.13, 0.16, tz, red, 12);
      bandBeam(P, (x) => kasagi(x) + 0.07, -1.06, 1.06, 0.07, 0.2, tz, PALETTE.iron, 12);
      P.add(roundBox(0.1, 0.3, 0.06, 0.02, 1), red, { at: [0, 1.46, tz] });
    }
    return finish(P.build('shrine'), {
      footprint: { w: 2.6, d: torii ? 3.4 : 2.0 },
      spots: { pray: spot([0, 0, 0.95], 180, 'kneel'), torii: spot([0, 0, torii ? tz + 0.6 : 1.4], 180, 'stand') },
      lights: [light([-1.05, 0.78, 0.45], { intensity: 0.45, distance: 2.5 }), light([1.05, 0.78, 0.45], { intensity: 0.45, distance: 2.5 })],
      height: ry + 0.7,
    });
  },
};

export const BUILDINGS = {
  house: HOUSE,
  windmill: WINDMILL,
  watermill: WATERMILL,
  barn: BARN,
  tower: TOWER,
  lighthouse: LIGHTHOUSE,
  tent: TENT,
  hut: HUT,
  hall: HALL,
  bridge: BRIDGE,
  wall: WALL,
  gate: GATE,
  ruin: RUIN,
  shed: SHED,
  greenhouse: GREENHOUSE,
  shrine: SHRINE,
};
