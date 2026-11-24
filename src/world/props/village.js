import * as THREE from 'three';
import {
  Parts, finish, spot, light, roundBox, box, roundCyl, cyl, cone, sphere, lathe, blob, tube, extrude, ring, xform,
  material, patchMaterial, PALETTE, SCALE, SEASONS, shade, mix, rng, noise3, signMaterial, waterMaterial,
} from '../kit.js';

// Prop family: village (street furniture and small props). See ../kit.js for the conventions:
// origin at the center of the footprint on the ground, front facing +Z, one mesh per slot.
//
// Look: chunky, soft, toy-like. Most pieces are `softBox` (a 44-triangle box with smooth
// rounded edges) or low-segment lathes, painted with vertex colors (stone blocks, staves,
// weaves, checks) so props stay cheap enough to fill a market square.

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
/** Deterministic hash in [0, 1) for painting patterns (never Math.random). */
const hash = (a, b = 0, c = 0) => fract(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453);

/* ───────────────────────── params ───────────────────────── */

function num(v, d, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : d;
}
/** A positive size: zero, negative or junk values fall back to the default. */
function size(v, d, lo, hi) {
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
  if (v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === 0 || v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return d;
}
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Friendly color names, mapped to the family's soft tones. */
const NAMED = {
  ...PALETTE.cloth, cream: PALETTE.wallCream, brown: PALETTE.woodDark, tan: PALETTE.woodLight, wood: PALETTE.wood,
  grey: '#9aa1a8', gray: '#9aa1a8', black: '#3a3a42', navy: '#3d5a8c', gold: PALETTE.gold, lilac: '#b9a3e3',
  mint: '#8fd3b0', sky: '#8cc2ea', lemon: '#f5dc6e', peach: '#f4b48c', rose: '#ec8fa6', iron: PALETTE.iron,
  stone: PALETTE.stone, copper: PALETTE.copper, silver: '#c3c9d1', bronze: '#a27c48', green: PALETTE.cloth.green,
};
/** A usable color: '#rgb' / '#rrggbb', a PALETTE key ('roofRed'), a friendly name ('teal') or a CSS name. */
function colorOr(v, d) {
  if (typeof v === 'number' && Number.isFinite(v)) return `#${new THREE.Color().setHex(v & 0xffffff).getHexString()}`;
  if (typeof v !== 'string') return d;
  const s = v.trim();
  if (HEX.test(s)) return s.toLowerCase();
  if (typeof PALETTE[s] === 'string') return PALETTE[s];
  const low = s.toLowerCase();
  if (NAMED[low]) return NAMED[low];
  if (THREE.Color.NAMES && Object.prototype.hasOwnProperty.call(THREE.Color.NAMES, low)) return `#${new THREE.Color(low).getHexString()}`;
  return d;
}
function textOr(v, d = '', max = 28) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' ? v.trim().slice(0, max) : d;
}
/** A list of short texts: an array (or a single string) of labels. */
function textsOr(v, d, max = 6) {
  let list = null;
  if (Array.isArray(v)) list = v;
  else if (typeof v === 'string' || typeof v === 'number') list = [v];
  if (!list) return d;
  return list.map((x) => textOr(x, '', 22)).filter((x) => x !== null).slice(0, max);
}
/** A list of colors: an array or a comma-separated string. Unusable entries are dropped. */
function colorsOr(v, d) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
  if (!list) return d;
  const out = list.map((c) => colorOr(c, null)).filter(Boolean).slice(0, 12);
  return out.length ? out : d;
}
const seasonOf = (ctx) => (SEASONS.includes(ctx?.season) ? ctx.season : 'summer');
/** A seeded random stream for one aspect of a prop, stable across seasons and hours. */
const rand = (ctx, tag) => rng(`${ctx?.seed ?? 1}:${tag}`);

/* ───────────────────────── geometry ───────────────────────── */

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

/**
 * A soft box standing on y = 0: 44 triangles, chamfered edges with smoothly blended normals,
 * so it reads like a rounded toy block at a fraction of RoundedBoxGeometry's cost.
 */
function softBox(w, h, d, c = 0.02) {
  const X = Math.max(w, 1e-3) / 2, Y = Math.max(h, 1e-3) / 2, Z = Math.max(d, 1e-3) / 2;
  const k = Math.max(1e-4, Math.min(c, X * 0.9, Y * 0.9, Z * 0.9));
  const xi = X - k, yi = Y - k, zi = Z - k;
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const sx = i & 4 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 1 ? 1 : -1;
    pts.push([sx * X, sy * yi, sz * zi], [sx * xi, sy * Y, sz * zi], [sx * xi, sy * yi, sz * Z]);
  }
  const id = (sx, sy, sz, f) => ((sx > 0 ? 4 : 0) | (sy > 0 ? 2 : 0) | (sz > 0 ? 1 : 0)) * 3 + f;
  const quads = [];
  for (const s of [-1, 1]) {
    quads.push([id(s, -1, -1, 0), id(s, 1, -1, 0), id(s, 1, 1, 0), id(s, -1, 1, 0)]);
    quads.push([id(-1, s, -1, 1), id(1, s, -1, 1), id(1, s, 1, 1), id(-1, s, 1, 1)]);
    quads.push([id(-1, -1, s, 2), id(1, -1, s, 2), id(1, 1, s, 2), id(-1, 1, s, 2)]);
  }
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      quads.push([id(a, b, -1, 0), id(a, b, 1, 0), id(a, b, 1, 1), id(a, b, -1, 1)]); // edges along z
      quads.push([id(-1, a, b, 1), id(1, a, b, 1), id(1, a, b, 2), id(-1, a, b, 2)]); // edges along x
      quads.push([id(a, -1, b, 0), id(a, 1, b, 0), id(a, 1, b, 2), id(a, -1, b, 2)]); // edges along y
    }
  }
  const tris = [];
  for (const [a, b, cc, dd] of quads) tris.push([a, b, cc], [a, cc, dd]);
  for (let i = 0; i < 8; i++) tris.push([i * 3, i * 3 + 1, i * 3 + 2]);
  const pos = new Float32Array(tris.length * 9);
  const nor = new Float32Array(tris.length * 9);
  let o = 0;
  for (const t of tris) {
    const [A, B, C] = t.map((i) => pts[i]);
    const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
    const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const outward = nx * (A[0] + B[0] + C[0]) + ny * (A[1] + B[1] + C[1]) + nz * (A[2] + B[2] + C[2]) >= 0;
    for (const P of outward ? [A, B, C] : [A, C, B]) {
      const qx = P[0] - clamp(P[0], -xi, xi), qy = P[1] - clamp(P[1], -yi, yi), qz = P[2] - clamp(P[2], -zi, zi);
      const l = Math.hypot(qx, qy, qz) || 1;
      pos[o] = P[0]; pos[o + 1] = P[1] + Y; pos[o + 2] = P[2];
      nor[o] = qx / l; nor[o + 1] = qy / l; nor[o + 2] = qz / l;
      o += 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** A soft box whose top is scaled by (tx, tz): tubs, troughs, tapered plinths. */
function taperBox(w, h, d, c, tx = 1, tz = tx) {
  const g = softBox(w, h, d, c);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) * lerp(1, tx, t));
    p.setZ(i, p.getZ(i) * lerp(1, tz, t));
  }
  g.computeVertexNormals();
  return g;
}

/** Matrix whose local X runs along `dir` and local Y leans toward `upHint`, at `origin`. */
function basis(origin, dir, upHint = [0, 1, 0]) {
  const x = v3(dir).normalize();
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

/** Matrix that stands a Y-up primitive on `a` with its axis running to `b`. */
function along(a, b) {
  const A = v3(a), B = v3(b);
  const d = B.clone().sub(A);
  const len = Math.max(d.length(), 1e-4);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.divideScalar(len));
  return { matrix: new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1)), len };
}

/** A rod (cylinder) from a to b. `soft` rounds its ends. */
function rod(P, a, b, r, look, { seg = 8, soft = false, top = null } = {}) {
  const { matrix, len } = along(a, b);
  const g = soft
    ? roundCyl(r, len, { top: top ?? r, segments: seg, steps: 1, bevel: Math.min(r * 0.5, len * 0.3) })
    : cyl(r, len, { top: top ?? r, segments: seg });
  P.add(g, look, { matrix });
}

/** A board from a to b: `w` wide (local Z), `h` thick (local Y, toward `up`). */
function plank(P, a, b, w, h, look, { up = [0, 1, 0], c = null } = {}) {
  const A = v3(a), B = v3(b);
  const len = Math.max(A.distanceTo(B), 0.005);
  const g = softBox(len, h, w, c ?? Math.min(h, w) * 0.3).translate(0, -h / 2, 0);
  P.add(g, look, { matrix: basis(A.clone().add(B).multiplyScalar(0.5), B.clone().sub(A), up) });
}

/** Points along a hanging string between a and b (x, y, z arrays), sagging by `sag`. */
function sagPoints(a, b, sag, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)]);
  }
  return out;
}

/** An arc of a circle in the XY plane as a tube (handles, hoops). */
function arcTube(r, tubeR, a0, a1, { radial = 6, segments = 12 } = {}) {
  return new THREE.TorusGeometry(r, tubeR, radial, segments, a1 - a0).rotateZ(a0);
}

/* ───────────────────────── painting ───────────────────────── */

function lookMaterial(look) {
  if (look?.isMaterial) return look;
  if (look && typeof look === 'object') {
    const { slot = 'solid', color, ...rest } = look; // eslint-disable-line no-unused-vars
    return material(slot, rest);
  }
  return material('solid');
}
const _paint = new THREE.Color();
/**
 * Add a piece and repaint its vertices. `fn(color, x, y, z, nx, ny, nz, index)` gets the look's
 * color and a vertex in prop space (after the transform) and changes the color. With `flat`, it
 * is called once per triangle (at its center), for crisp blocks, stripes and checks.
 */
function paint(P, geometry, look, opts, fn, { flat = false } = {}) {
  P.add(geometry, look, opts);
  const list = P.slots.get(lookMaterial(look).uuid).geometries;
  const g = list[list.length - 1];
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  const base = new THREE.Color(look?.isMaterial ? '#ffffff' : typeof look === 'object' ? look.color ?? '#ffffff' : look);
  if (flat) {
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const nx = nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2);
      const ny = nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2);
      const nz = nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2);
      const l = Math.hypot(nx, ny, nz) || 1;
      _paint.copy(base);
      fn(_paint, x, y, z, nx / l, ny / l, nz / l, i / 3);
      for (let k = 0; k < 3; k++) col.setXYZ(i + k, _paint.r, _paint.g, _paint.b);
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      _paint.copy(base);
      fn(_paint, pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), i);
      col.setXYZ(i, _paint.r, _paint.g, _paint.b);
    }
  }
  return g;
}
const C = (c) => new THREE.Color(c);

/**
 * Stone courses on a lathe of `segs` segments: each block spans two segments, staggered every
 * other course, with its own tone. Paint it `flat` so whole quads share a block.
 */
function masonry(base, { cx = 0, cz = 0, courses = [0, 1], segs = 32, seed = 0, spread = 0.07 } = {}) {
  const lo = C(shade(base, -spread)), hi = C(shade(base, spread * 0.8));
  return (c, x, y, z) => {
    let k = 0;
    while (k < courses.length - 2 && y > courses[k + 1]) k++;
    const seg = Math.floor(fract(0.25 - Math.atan2(z - cz, x - cx) / TAU) * segs);
    const h = hash(Math.floor((seg + (k % 2)) / 2), k, seed);
    c.lerp(h < 0.5 ? lo : hi, Math.abs(h - 0.5) * 2);
  };
}

/** Wooden staves around an axis: alternating tones, a little darker toward both ends. */
function staves(base, { cx = 0, cz = 0, n = 14, y0 = 0, y1 = 1, seed = 0 } = {}) {
  const dark = C(shade(base, -0.1)), light = C(shade(base, 0.06));
  return (c, x, y, z) => {
    const a = (Math.atan2(z - cz, x - cx) / TAU + 0.5) * n;
    const h = hash(Math.floor(a), seed);
    c.lerp(h < 0.5 ? dark : light, 0.25 + Math.abs(h - 0.5) * 0.7);
    const t = (y - y0) / Math.max(y1 - y0, 1e-3);
    c.lerp(dark, (1 - smooth(0, 0.35, t)) * 0.25 + smooth(0.8, 1, t) * 0.12);
  };
}

/* ───────────────────────── shared materials ───────────────────────── */

let fallMat = null;
/** Falling water: soft white streaks scrolling down (the texture offset moves in a tick). */
function fallMaterial() {
  if (fallMat) return fallMat;
  const W = 128, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(214,240,250,0.32)';
  g.fillRect(0, 0, W, H);
  const r = rng('village-falling-water');
  g.filter = 'blur(1.2px)';
  // soft vertical streaks, each fading in and out along its length; drawn wrapped so it tiles
  for (let i = 0; i < 120; i++) {
    const x = r.float(0, W), y = r.float(0, H), w = r.float(1.5, 5), h = r.float(30, 150);
    const a = r.float(0.35, 0.85);
    for (const dx of [0, -W, W]) {
      for (const dy of [0, -H]) {
        const grad = g.createLinearGradient(0, y + dy, 0, y + dy + h);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.3, `rgba(255,255,255,${a.toFixed(2)})`);
        grad.addColorStop(0.75, `rgba(250,254,255,${(a * 0.8).toFixed(2)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx, y + dy, w, h);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(4, 1);
  fallMat = new THREE.MeshStandardMaterial({
    name: 'village-falling-water', map: tex, color: '#eefaff', emissive: '#6fb3c8', emissiveIntensity: 0.22,
    vertexColors: true, transparent: true, opacity: 0.8, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide,
  });
  fallMat.userData.slot = 'water';
  fallMat.userData.castShadow = false;
  return fallMat;
}

const flagMats = new Map();
/**
 * Waving cloth (flags): a kit material (snow, rain) whose vertices ripple away from the pole,
 * driven by the world's time and wind in the vertex shader. `uv.x` is 0 at the pole.
 */
function flagMaterial(map = null) {
  const key = map ? map.uuid : 'plain';
  if (flagMats.has(key)) return flagMats.get(key);
  const m = new THREE.MeshStandardMaterial({ name: 'village-flag', color: 0xffffff, map, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  patchMaterial(m, {});
  const kitCompile = m.onBeforeCompile;
  m.onBeforeCompile = (shader) => {
    kitCompile(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float flagU = uv.x;
        float flagPh = flagU * 6.3 - uTime * (4.2 + 2.5 * uWind) + modelMatrix[3].x * 0.9 + modelMatrix[3].z * 0.7;
        float flagA = (0.035 + 0.05 * uWind);
        float flagZ = flagA * flagU * sin(flagPh) + flagA * 0.35 * flagU * sin(flagPh * 0.5 + uv.y * 2.0);
        float flagD = flagA * (sin(flagPh) + flagU * 6.3 * cos(flagPh)) / 0.9;
        objectNormal = normalize(objectNormal + vec3(-flagD, 0.0, 0.0));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += flagZ;
        transformed.x -= abs(flagZ) * 0.25;`);
  };
  m.customProgramCacheKey = () => 'village-flag-1';
  m.userData.slot = 'flag';
  flagMats.set(key, m);
  return m;
}

/** A painted label (signs, boards, plaques): text on a board-colored background. */
function label(text, { bg = '#f2e2bf', fg = '#5a3a22', border = null, width = 512, height = 140, font = 'bold 80px Georgia, "Times New Roman", serif' } = {}) {
  return signMaterial(text, { bg, fg, border: border ?? bg, borderWidth: border ? 8 : 0, width, height, font, radius: 18 });
}

/** A water surface disc (kit water material) with a deep center and lighter edges. */
function waterDisc(P, r, y, { at = [0, 0, 0], deep = PALETTE.water, shallow = PALETTE.waterShallow, segs = 28 } = {}) {
  const g = new THREE.CircleGeometry(r, segs).rotateX(-Math.PI / 2);
  const D = C(deep), S = C(shallow);
  paint(P, g, waterMaterial(), { at: [at[0], y, at[2]] }, (c, x, yy, z) => {
    const d = Math.hypot(x - at[0], z - at[2]) / r;
    c.copy(D).lerp(S, smooth(0.35, 1, d) * 0.85);
  });
}

/* ───────────────────────── small reusable pieces ───────────────────────── */

const FRUIT = {
  apple: ['#e2473f', '#c93a35'], orange: ['#f39a2e', '#e8862a'], pear: ['#c8d65a', '#b2c44a'],
  lemon: ['#f6d84a', '#efc93c'], plum: ['#8e5ab5', '#7a4aa0'], peach: ['#f7a98a', '#f08f78'],
};

/** A heap of round fruit (spheres) filling an ellipse of rx × rz at height y. */
function fruitHeap(P, R, kind, { at = [0, 0, 0], rx = 0.15, rz = 0.12, r = 0.05, layers = 2, tilt = 0 } = {}) {
  const [c0, c1] = FRUIT[kind] ?? FRUIT.apple;
  const g = sphere(r, 7, 5);
  let n = 0;
  for (let layer = 0; layer < layers; layer++) {
    const shrink = 1 - layer * 0.42;
    const cols = Math.max(1, Math.round((rx * 2 * shrink) / (r * 1.85)));
    const rows = Math.max(1, Math.round((rz * 2 * shrink) / (r * 1.85)));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const u = cols === 1 ? 0 : (i / (cols - 1) - 0.5) * 2;
        const v = rows === 1 ? 0 : (j / (rows - 1) - 0.5) * 2;
        if (u * u + v * v > 1.35) continue;
        const x = at[0] + u * (rx * shrink - r * 0.8) + R.float(-0.008, 0.008);
        const z = at[2] + v * (rz * shrink - r * 0.8) + R.float(-0.008, 0.008);
        const y = at[1] + r * 0.85 + layer * r * 1.45 - (z - at[2]) * Math.tan(tilt);
        P.add(g, shade(n++ % 3 ? c0 : c1, R.float(-0.04, 0.04)), { at: [x, y, z], scale: R.float(0.9, 1.08) });
      }
    }
  }
  if (kind === 'apple' || kind === 'pear') {
    // a stem and a leaf on the top fruit
    const ty = at[1] + r * (layers === 1 ? 1.7 : 3.15);
    P.add(cyl(0.006, 0.03, { segments: 4 }), PALETTE.woodDark, { at: [at[0], ty, at[2]] });
    P.add(sphere(0.02, 6, 4), { slot: 'foliage', color: '#62b356' }, { at: [at[0] + 0.018, ty + 0.022, at[2]], scale: [1.4, 0.4, 0.8], rot: [0, 0, 0.5] });
  }
}

/** A small wooden bucket or tin pail (used by the bucket prop and the flower stall). */
function pail(P, R, { at = [0, 0, 0], h = 0.28, r = 0.15, tin = false, color = null, handle = true } = {}) {
  const [x0, y0, z0] = at;
  const body = color ?? (tin ? '#aeb6bf' : PALETTE.woodLight);
  const rb = r * 0.8;
  const prof = [[0, 0], [rb - 0.012, 0], [rb, 0.012], [r, h - 0.01], [r - 0.006, h], [r - 0.022, h], [r - 0.024, h - 0.02], [rb - 0.02, 0.03], [0, 0.03]];
  if (tin) {
    P.add(lathe(prof, 16), { slot: 'metal', color: body }, { at });
    P.add(ring(r + 0.002, 0.009, { radial: 5, tubular: 18 }), { slot: 'metal', color: shade(body, 0.06) }, { at: [x0, y0 + h - 0.004, z0] });
    for (const t of [0.25]) P.add(ring(lerp(rb, r, t) + 0.004, 0.006, { radial: 4, tubular: 18 }), { slot: 'metal', color: shade(body, -0.06) }, { at: [x0, y0 + h * t, z0] });
  } else {
    paint(P, lathe(prof, 14), body, { at }, staves(body, { cx: x0, cz: z0, n: 14, y0, y1: y0 + h, seed: R.int(0, 999) }), { flat: true });
    for (const t of [0.2, 0.78]) {
      const rr = lerp(rb, r, t) + 0.006;
      P.add(lathe([[rr - 0.004, -0.018], [rr, -0.014], [rr, 0.014], [rr - 0.004, 0.018]], 14), PALETTE.ironLight, { at: [x0, y0 + h * t, z0] });
    }
  }
  if (handle) {
    P.add(arcTube(r + 0.01, 0.008, 0, Math.PI, { radial: 4, segments: 10 }), tin ? { slot: 'metal', color: '#c9cfd6' } : PALETTE.iron, { at: [x0, y0 + h - 0.02, z0], rot: [0, R.float(-0.4, 0.4), 0] });
  }
}

/* ───────────────────────── bench ───────────────────────── */

function buildBench(p, ctx) {
  const L = num(p.length, 1.3, 0.8, 2.4);
  const wood = colorOr(p.wood, PALETTE.wood);
  const frame = colorOr(p.frame, PALETTE.iron);
  const back = flag(p.back, true);
  const R = rand(ctx, 'bench');
  const P = new Parts();
  const seat = SCALE.seat, depth = 0.28;
  const slatW = 0.084, gap = (depth - 3 * slatW) / 2;
  for (let i = 0; i < 3; i++) {
    const z = depth / 2 - slatW / 2 - i * (slatW + gap);
    P.add(softBox(L, 0.042, slatW, 0.016), shade(wood, R.float(-0.035, 0.03)), { at: [0, seat - 0.042, z] });
  }
  const legX = L / 2 - 0.08;
  const frames = L > 1.75 ? [-legX, 0, legX] : [-legX, legX];
  const zf = depth / 2 - 0.05, zb = -depth / 2 + 0.05;
  for (const x of frames) {
    const end = x !== 0;
    const armTop = seat + 0.15;
    // legs: chunky cast-iron posts on round feet; the front ones rise to carry the armrest
    P.add(softBox(0.052, (end && back ? armTop : seat - 0.042) - 0.02, 0.052, 0.016), frame, { at: [x, 0.02, zf] });
    P.add(softBox(0.052, seat - 0.04, 0.052, 0.016), frame, { at: [x, 0.02, zb] });
    for (const z of [zf, zb]) P.add(roundCyl(0.042, 0.03, { segments: 10, steps: 1, bevel: 0.012 }), frame, { at: [x, 0, z] });
    P.add(softBox(0.056, 0.038, depth + 0.03, 0.014), frame, { at: [x, seat - 0.08, 0] });
    if (back && end) {
      // the back support leans back, the armrest runs forward to a rounded knob
      plank(P, [x, seat - 0.06, zb], [x, seat + 0.4, zb - 0.09], 0.05, 0.05, frame, { up: [0, 0, 1] });
      P.add(softBox(0.06, 0.036, depth - 0.02, 0.014), frame, { at: [x, armTop, 0.0] });
      P.add(sphere(0.034, 10, 7), frame, { at: [x, armTop + 0.02, depth / 2 - 0.005] });
    }
  }
  if (back) {
    const tilt = Math.atan2(0.09, 0.46);
    for (let i = 0; i < 2; i++) {
      const y = seat + 0.13 + i * 0.15;
      const z = zb - (y - (seat - 0.06)) * Math.tan(tilt) + 0.035;
      P.add(softBox(L - 0.02, 0.085, 0.034, 0.014), shade(wood, R.float(-0.03, 0.03)), { at: [0, y, z], rot: [-tilt, 0, 0] });
    }
  }
  const half = L / 4 + 0.02;
  const spots = {
    left: spot([half, seat, 0.02], 0, 'sit'),
    right: spot([-half, seat, 0.02], 0, 'sit'),
    front: spot([0, 0, depth / 2 + 0.45], 180, 'stand'),
  };
  if (L >= 1.9) spots.middle = spot([0, seat, 0.02], 0, 'sit');
  return finish(P.build('bench'), { footprint: { w: L + 0.1, d: depth + 0.16 }, spots });
}

/* ───────────────────────── lamp ───────────────────────── */

function buildLamp(p) {
  const H = num(p.height, SCALE.lamp, 1.4, 3.4);
  const color = colorOr(p.color, PALETTE.iron);
  const lit = oneOf(p.lit, ['night', 'always', 'never'], 'night');
  const P = new Parts();
  const trim = shade(color, 0.08);
  P.add(lathe([[0, 0], [0.15, 0], [0.16, 0.035], [0.13, 0.08], [0.09, 0.13], [0.07, 0.2], [0.062, 0.26], [0, 0.26]], 16), color);
  P.add(roundCyl(0.075, 0.04, { segments: 12, steps: 1, bevel: 0.015 }), trim, { at: [0, 0.24, 0] });
  P.add(cyl(0.042, H - 0.62, { top: 0.034, segments: 10 }), color, { at: [0, 0.26, 0] });
  P.add(roundCyl(0.056, 0.035, { segments: 12, steps: 1, bevel: 0.012 }), trim, { at: [0, H * 0.42, 0] });
  // ladder rest: a little crossbar with ball ends under the lantern
  const yb = H - 0.56;
  P.add(softBox(0.3, 0.026, 0.026, 0.01), color, { at: [0, yb, 0] });
  for (const x of [-0.15, 0.15]) P.add(sphere(0.022, 8, 6), trim, { at: [x, yb + 0.013, 0] });
  // lantern: glass core inside four posts, a bottom cup and a flared roof with a finial
  P.add(lathe([[0, 0], [0.05, 0], [0.11, 0.05], [0.125, 0.075], [0, 0.075]], 14), color, { at: [0, H - 0.47, 0] });
  const glow = lit === 'never' ? { slot: 'glass', color: '#c4d3d8', glowAmount: 0 }
    : lit === 'always' ? { slot: 'emit', color: '#ffe3ad', emit: 1.4 } : { slot: 'lamp', color: '#fff2cf' };
  P.add(roundCyl(0.105, 0.27, { top: 0.135, bevel: 0.02, segments: 14, steps: 2 }), glow, { at: [0, H - 0.4, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    plank(P, [Math.cos(a) * 0.115, H - 0.405, Math.sin(a) * 0.115], [Math.cos(a) * 0.15, H - 0.12, Math.sin(a) * 0.15], 0.024, 0.024, color, { up: [Math.cos(a), 0, Math.sin(a)] });
  }
  P.add(lathe([[0, 0], [0.2, 0], [0.205, 0.018], [0.17, 0.035], [0.1, 0.1], [0.04, 0.14], [0, 0.145]], 16), color, { at: [0, H - 0.135, 0] });
  P.add(sphere(0.036, 10, 7), trim, { at: [0, H + 0.03, 0] });
  const lights = lit === 'never' ? [] : [light([0, H - 0.27, 0], { intensity: 1.3, distance: 7, when: lit === 'always' ? 'always' : 'night' })];
  return finish(P.build('lamp'), {
    footprint: { r: 0.18 },
    spots: { lean: spot([0, 0, 0.32], 0, 'stand') },
    lights,
    height: H,
  });
}

/* ───────────────────────── fountain ───────────────────────── */

function buildFountain(p, ctx) {
  const s = size(p.size, 1, 0.6, 2);
  const tiers = int(p.tiers, 2, 0, 3);
  const stone = colorOr(p.stone, PALETTE.stone);
  const water = oneOf(p.water, ['running', 'still', 'frozen', 'dry'], 'running');
  const R = 1.45 * s;                 // basin radius at the rim
  const rim = 0.4;                    // rim (seat) height
  const wl = 0.31;                    // water level in the basin
  const inner = R - 0.29;
  const cap = shade(stone, 0.09), dark = shade(stone, -0.1);
  const P = new Parts();
  const seed = rand(ctx, 'fountain').int(0, 999);

  // basin wall (stone courses), a soft light rim cap to sit on, pilasters around it
  const blocks = 2 * Math.max(6, Math.round(10 * s));
  const segs = blocks * 2;
  const wall = [[R + 0.14, 0], [R + 0.15, 0.04], [R + 0.11, 0.09], [R + 0.03, 0.1], [R + 0.03, 0.21], [R + 0.04, 0.3], [R + 0.03, 0.32],
    [inner, 0.32], [inner - 0.01, 0.12], [inner - 0.03, 0.1], [0, 0.1]];
  const courses = masonry(stone, { courses: [0.1, 0.205, 0.33], segs, seed });
  paint(P, lathe(wall, segs), stone, {}, (c, x, y, z) => {
    if (y < 0.099) c.set(dark);
    else if (Math.hypot(x, z) < inner + 0.01) c.set(shade(stone, -0.14));
    else courses(c, x, y, z);
  }, { flat: true });
  P.add(lathe([[R + 0.05, 0.27], [R + 0.075, 0.31], [R + 0.07, rim - 0.025], [R + 0.03, rim], [inner + 0.04, rim], [inner + 0.005, rim - 0.02], [inner - 0.008, 0.29]], 40), cap);
  const nPil = Math.max(6, Math.round(8 * s));
  for (let i = 0; i < nPil; i++) {
    const a = (i / nPil) * TAU + Math.PI / nPil;
    P.add(softBox(0.12, 0.19, 0.08, 0.025), cap, { at: [Math.sin(a) * (R + 0.04), 0.09, Math.cos(a) * (R + 0.04)], rot: [0, a, 0] });
  }

  // the center: baluster pillars carrying chunky bowls, a finial spout on top
  const k = clamp((R - 0.5) / 0.95, 0.42, 1.25);
  const bowls = [];
  let y = 0.1;
  const pillar = (h, r) => {
    P.add(lathe([[r * 1.35, 0], [r * 1.4, 0.04 * k], [r * 0.98, 0.1 * k], [r * 0.82, h * 0.45], [r, h * 0.62], [r * 0.78, h * 0.86], [r * 1.1, h], [0, h + 0.01]], 14), cap, { at: [0, y - 0.01, 0] });
    y += h;
  };
  const bowl = (r) => {
    const y0 = y - 0.03 * k;
    const prof = [[0.09 * k, 0], [r * 0.45, 0.05 * k], [r * 0.8, 0.13 * k], [r * 0.97, 0.19 * k], [r + 0.035 * k, 0.23 * k], [r + 0.045 * k, 0.27 * k],
      [r + 0.025 * k, 0.3 * k], [r - 0.03 * k, 0.305 * k], [r - 0.06 * k, 0.28 * k], [r - 0.08 * k, 0.23 * k], [0, 0.2 * k]];
    paint(P, lathe(prof, 32), stone, { at: [0, y0, 0] }, (c, x, yy) => { if (yy > y0 + 0.24 * k) c.set(cap); });
    bowls.push({ r, y: y0 + 0.262 * k, lip: y0 + 0.3 * k });
    y = y0 + 0.2 * k;
  };
  const TIERS = [[0.62, 0.2, 0.7], [0.34, 0.12, 0.42], [0.22, 0.085, 0.25]];
  for (let i = 0; i < tiers; i++) { pillar(TIERS[i][0] * k, TIERS[i][1] * k); bowl(TIERS[i][2] * k); }
  const footY = tiers ? y : 0.1;
  const fh = tiers ? 0.3 * k : 0.42 * k;
  P.add(lathe([[0.1 * k, 0], [0.11 * k, 0.03 * k], [0.06 * k, fh * 0.32], [0.05 * k, fh * 0.57], [0.085 * k, fh * 0.74], [0.065 * k, fh * 0.92], [0.03 * k, fh], [0, fh]], 12), cap, { at: [0, footY - 0.005, 0] });
  const topY = footY + fh;
  const landY = tiers ? bowls[bowls.length - 1].y : wl;

  // water
  const foam = new Parts();
  const jet = new Parts();
  let tex = null;
  if (water === 'running' || water === 'still') {
    waterDisc(P, inner + 0.005, wl, { segs: 40 });
    for (const b of bowls) waterDisc(P, b.r - 0.06 * k, b.y, { segs: 24 });
  } else if (water === 'frozen') {
    const ice = { slot: 'clear', color: '#d9eef5', opacity: 0.8 };
    P.add(new THREE.CircleGeometry(inner + 0.005, 40).rotateX(-Math.PI / 2), ice, { at: [0, wl, 0] });
    const Ri = rand(ctx, 'icicles');
    for (const b of bowls) {
      P.add(new THREE.CircleGeometry(b.r - 0.06 * k, 24).rotateX(-Math.PI / 2), ice, { at: [0, b.y, 0] });
      const n = Math.round(b.r * 22);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Ri.float(-0.1, 0.1);
        const len = Ri.float(0.07, 0.17) * k;
        P.add(cone(0.02 * k, len, 6).rotateX(Math.PI), ice, { at: [Math.sin(a) * (b.r + 0.03 * k), b.lip - 0.06 * k, Math.cos(a) * (b.r + 0.03 * k)] });
      }
    }
  } else {
    P.add(new THREE.CircleGeometry(inner, 32).rotateX(-Math.PI / 2), shade(stone, -0.18), { at: [0, 0.105, 0] });
  }
  if (water === 'running') {
    const fall = fallMaterial();
    tex = fall.map;
    const fm = { slot: 'clear', color: '#f4fdff', opacity: 0.7 };
    // thin sheets of water spill over each bowl's lip and fall almost straight down
    for (let i = 0; i < bowls.length; i++) {
      const b = bowls[i];
      const yb = i > 0 ? bowls[i - 1].y : wl;
      const r0 = b.r + 0.04 * k, y0 = b.lip - 0.012 * k, drop = y0 - yb;
      const prof = [[r0 - 0.01 * k, y0 + 0.012 * k], [r0 + 0.03 * k, y0 - 0.005], [r0 + 0.06 * k, y0 - drop * 0.12], [r0 + 0.08 * k, y0 - drop * 0.4], [r0 + 0.095 * k, y0 - drop * 0.75], [r0 + 0.1 * k, yb - 0.01]];
      P.add(lathe(prof, 32), fall);
      const rl = r0 + 0.1 * k;
      foam.add(lathe([[rl + 0.08 * k, 0], [rl + 0.03 * k, 0.03 * k], [rl - 0.03 * k, 0.03 * k], [rl - 0.07 * k, 0]], 28), fm, { at: [0, yb - 0.006, 0] });
    }
    // a slim jet from the spout, opening into a little umbrella that falls back around it
    const jh = 0.18 * k, drop = topY - landY;
    jet.add(lathe([[0.014 * k, 0], [0.02 * k, jh * 0.7], [0.035 * k, jh], [0.075 * k, jh * 1.06], [0.11 * k, jh * 0.88], [0.135 * k, jh * 0.35], [0.15 * k, -drop * 0.45], [0.16 * k, -drop + 0.012]], 16), fall);
    foam.add(lathe([[0.22 * k, 0], [0.18 * k, 0.025 * k], [0.13 * k, 0.025 * k], [0.1 * k, 0]], 20), fm, { at: [0, landY - 0.006, 0] });
  }
  const group = P.build('fountain');
  let foamGroup = null, jetGroup = null;
  if (!foam.empty) { foamGroup = foam.build('fountain-foam'); group.add(foamGroup); }
  if (!jet.empty) { jetGroup = jet.build('fountain-jet'); jetGroup.position.set(0, topY - 0.01, 0); group.add(jetGroup); }

  // spots: four rim seats facing out, four stand spots at the diagonals facing in
  const seatR = R + 0.075 - 0.12;
  const standR = R + 0.62;
  const seatSpot = (deg) => spot([Math.sin(deg * D2R) * seatR, rim, Math.cos(deg * D2R) * seatR], deg, 'sit');
  const standSpot = (deg) => spot([Math.sin(deg * D2R) * standR, 0, Math.cos(deg * D2R) * standR], (deg + 180) % 360, 'stand');
  const spots = {
    'seat-front': seatSpot(0), 'seat-left': seatSpot(90), 'seat-back': seatSpot(180), 'seat-right': seatSpot(270),
    'front-left': standSpot(45), 'front-right': standSpot(315), 'back-left': standSpot(135), 'back-right': standSpot(225),
  };
  const tick = water === 'running' ? (t) => {
    tex.offset.y = 1 - fract(t * 0.6);
    if (foamGroup) { const f = 1 + 0.02 * Math.sin(t * 3.1); foamGroup.scale.set(f, 1, f); foamGroup.position.y = 0.003 * Math.sin(t * 4.3); }
    if (jetGroup) jetGroup.scale.set(1 + 0.05 * Math.sin(t * 5.3), 1 + 0.025 * Math.sin(t * 3.7 + 1), 1 + 0.05 * Math.sin(t * 5.3));
  } : null;
  return finish(group, { footprint: { r: R + 0.16 }, spots, tick, height: topY + 0.2 });
}

/* ───────────────────────── well ───────────────────────── */

function buildWell(p, ctx) {
  const stone = colorOr(p.stone, PALETTE.stone);
  const wood = colorOr(p.wood, PALETTE.wood);
  const roof = colorOr(p.roof, PALETTE.roofRed);
  const bucket = flag(p.bucket, true);
  const R = rand(ctx, 'well');
  const P = new Parts();
  const ro = 0.55, ri = 0.39, wallH = 0.56;
  // stacked stone blocks around a dark shaft
  P.add(cyl(ri + 0.07, wallH - 0.02, { segments: 18, open: true }), '#4a4f56');
  P.add(new THREE.CircleGeometry(ri + 0.07, 18).rotateX(-Math.PI / 2), '#3c4148', { at: [0, 0.005, 0] });
  const courses = 3, per = 13, ch = (wallH - 0.02) / courses;
  for (let k = 0; k < courses; k++) {
    for (let i = 0; i < per; i++) {
      const a = ((i + (k % 2) * 0.5) / per) * TAU + R.float(-0.03, 0.03);
      const w = (TAU * (ro - 0.07)) / per - 0.018;
      const rr = ro - 0.075 + R.float(-0.008, 0.008);
      P.add(softBox(w, ch - 0.014, 0.15, 0.032), shade(stone, R.float(-0.08, 0.05)), { at: [Math.sin(a) * rr, k * ch + 0.007, Math.cos(a) * rr], rot: [0, a, R.float(-0.02, 0.02)] });
    }
  }
  // rim cap
  P.add(lathe([[ro + 0.01, 0], [ro + 0.025, 0.03], [ro + 0.01, 0.07], [ro - 0.03, 0.085], [ri + 0.03, 0.085], [ri - 0.005, 0.06], [ri - 0.01, 0.0]], 28), shade(stone, 0.1), { at: [0, wallH - 0.03, 0] });
  // water far down
  waterDisc(P, ri + 0.02, 0.24, { deep: '#2c6f8c', shallow: '#3f8aa6', segs: 20 });
  const top = wallH + 0.055;
  // posts, crossbeam and a little gabled roof
  const px = ro - 0.08, postH = 1.12;
  for (const x of [-px, px]) {
    P.add(softBox(0.09, postH, 0.09, 0.022), wood, { at: [x, top - 0.03, 0] });
    P.add(softBox(0.13, 0.05, 0.13, 0.02), shade(wood, -0.08), { at: [x, top - 0.03, 0] });
  }
  const beamY = top + postH - 0.08;
  P.add(softBox(2 * px + 0.2, 0.08, 0.1, 0.022), shade(wood, -0.05), { at: [0, beamY, 0] });
  const ridge = beamY + 0.34, span = 0.62, roofW = 2 * px + 0.42;
  const pitch = Math.atan2(ridge - beamY, span * 0.82);
  for (const sd of [-1, 1]) {
    const zc = sd * span * 0.45, yc = ridge - Math.tan(pitch) * span * 0.45;
    const M = xform([0, yc - 0.03, zc], [sd * pitch, 0, 0]);
    P.add(softBox(roofW, 0.06, span + 0.06, 0.025), roof, { matrix: M });
    // shingle rows: soft darker ridges across the panel, and a trim along the eave
    for (const t of [-0.12, 0.12]) P.add(softBox(roofW - 0.03, 0.022, 0.06, 0.01), shade(roof, -0.06), { matrix: M.clone().multiply(xform([0, 0.05, sd * t * span])) });
    P.add(softBox(roofW + 0.02, 0.05, 0.06, 0.018), shade(roof, -0.12), { matrix: M.clone().multiply(xform([0, -0.005, sd * (span / 2 + 0.01)])) });
  }
  P.add(roundCyl(0.05, roofW + 0.04, { segments: 10, steps: 1, bevel: 0.02 }), shade(roof, -0.12), { at: [-(roofW + 0.04) / 2, ridge + 0.005, 0], rot: [0, 0, -Math.PI / 2] });
  for (const x of [-px, px]) {
    P.add(extrude([[-span * 0.62, 0], [span * 0.62, 0], [0, ridge - beamY - 0.02]], 0.04, { bevel: 0.008, bevelSegments: 1, curveSegments: 1 }), wood, { at: [x, beamY + 0.04, 0], rot: [0, Math.PI / 2, 0] });
  }
  // the crank: an axle with a rope drum, an iron crank and a handle
  const ay = top + 0.62;
  rod(P, [-px - 0.06, ay, 0], [px + 0.1, ay, 0], 0.028, shade(wood, -0.15), { seg: 8 });
  // rope coiled on a drum: a lathe with one bump per turn
  const coil = [[0.04, 0]];
  for (let i = 0; i <= 12; i++) coil.push([i % 2 ? 0.074 : 0.066, 0.02 + (i / 12) * 0.38]);
  coil.push([0.04, 0.42]);
  P.add(lathe(coil, 10), '#d2b57e', { at: [-0.21, ay, 0], rot: [0, 0, -Math.PI / 2] });
  for (const x of [-0.23, 0.21]) P.add(roundCyl(0.085, 0.025, { segments: 10, steps: 1, bevel: 0.008 }), shade(wood, -0.1), { at: [x, ay, 0], rot: [0, 0, -Math.PI / 2] });
  P.add(softBox(0.035, 0.2, 0.035, 0.012), PALETTE.iron, { at: [px + 0.1, ay - 0.18, 0] });
  rod(P, [px + 0.1, ay - 0.16, 0], [px + 0.24, ay - 0.16, 0], 0.02, PALETTE.iron, { seg: 6 });
  P.add(roundCyl(0.03, 0.12, { segments: 10, steps: 1, bevel: 0.012 }), PALETTE.woodRed, { at: [px + 0.13, ay - 0.16, 0], rot: [0, 0, -Math.PI / 2] });
  // rope down to a hanging bucket
  if (bucket) {
    const by = top + 0.1, bh = 0.2, br = 0.11;
    rod(P, [0, ay - 0.06, 0.0], [0, by + bh - 0.02 + br + 0.01, 0], 0.01, '#c9ad7a', { seg: 5 });
    pail(P, R, { at: [0, by, 0], h: bh, r: br });
  }
  return finish(P.build('well'), {
    footprint: { r: 0.72 },
    spots: { side: spot([0.98, 0, 0.12], 270, 'stand'), front: spot([0, 0, 0.98], 180, 'stand') },
    height: ridge + 0.05,
  });
}

/* ───────────────────────── cloth helpers ───────────────────────── */

/**
 * A soft striped canopy: a bent sheet (double-sided cloth) `w` wide and `len` long, bowed along
 * its length and puffed between the stripes, tilted by `slope` (front lower) and centered at `at`.
 */
function awning(P, { w, len, n, color, cream, at, slope = 0, bow = 0.06, puff = 0.025 }) {
  const sub = 4;
  const g = new THREE.PlaneGeometry(w, len, n * sub, 8).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const u = (x + w / 2) / (w / n);
    const t = z / (len / 2);
    pos.setY(i, bow * (1 - t * t) + puff * Math.sin(Math.PI * fract(u)) * (0.6 + 0.4 * (1 - t * t)));
  }
  g.computeVertexNormals();
  const M = xform(at, [slope, 0, 0]);
  const A = C(color), B = C(cream);
  const inv = M.clone().invert(), q = new THREE.Vector3();
  paint(P, g, { slot: 'cloth', color, double: true }, { matrix: M }, (c, x, y, z) => {
    q.set(x, y, z).applyMatrix4(inv);
    c.copy(Math.floor((q.x + w / 2) / (w / n) + 1e-4) % 2 ? B : A);
  }, { flat: true });
}

let scallopGeo = null;
/** A half-disc valance tab (1 wide), hanging down from y = 0. */
function scallop() {
  scallopGeo ??= extrude(Array.from({ length: 9 }, (_, j) => { const a = Math.PI + (j / 8) * Math.PI; return [Math.cos(a) * 0.5, Math.sin(a) * 0.5]; }), 0.018, { bevel: 0.008, bevelSegments: 1, curveSegments: 1 });
  return scallopGeo;
}

/* ───────────────────────── market stall ───────────────────────── */

const GOODS = ['fruit', 'fish', 'flowers', 'bread', 'pottery', 'toys', 'none'];

/** Goods laid out on a counter: a w × d area whose front edge is at +d/2, top at y. */
function goodsOn(P, R, goods, { at = [0, 0, 0], w = 1.4, d = 0.45 } = {}) {
  const [cx, y, cz] = at;
  const tray = (x, z, tw, td, color = PALETTE.woodLight, tilt = 0.18) => {
    // a shallow crate tilted toward the customer, its front lip following the tilt
    const M = xform([x, y + Math.sin(tilt) * td * 0.5, z], [tilt, 0, 0]);
    P.add(softBox(tw, 0.05, td, 0.014), color, { matrix: M });
    P.add(softBox(tw, 0.08, 0.03, 0.01), shade(color, -0.08), { matrix: M.clone().multiply(xform([0, 0, td / 2 - 0.015])) });
    P.add(softBox(tw, 0.08, 0.03, 0.01), shade(color, -0.08), { matrix: M.clone().multiply(xform([0, 0, -td / 2 + 0.015])) });
    for (const sx of [-1, 1]) P.add(softBox(0.03, 0.08, td, 0.01), shade(color, -0.04), { matrix: M.clone().multiply(xform([sx * (tw / 2 - 0.015), 0, 0])) });
  };
  if (goods === 'fruit') {
    const kinds = ['apple', 'orange', 'pear', 'plum', 'lemon', 'peach'];
    const n = clamp(Math.round(w / 0.42), 2, 5);
    const tw = w / n - 0.03;
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (i + 0.5) * (w / n);
      tray(x, cz, tw, d * 0.9);
      fruitHeap(P, R, kinds[i % kinds.length], { at: [x, y + 0.04 + Math.sin(0.18) * d * 0.45, cz], rx: tw / 2 - 0.035, rz: d * 0.38, r: 0.052, layers: 2, tilt: 0.18 });
    }
  } else if (goods === 'fish') {
    P.add(softBox(w, 0.04, d * 0.95, 0.012), { slot: 'metal', color: '#b9c3cc' }, { at: [cx, y, cz] });
    P.add(blob(0.5, { detail: 1, amp: 0.12, seed: 3, squash: [w * 0.94, 0.05, d * 0.86] }), '#e9f4f8', { at: [cx, y + 0.045, cz] });
    const n = clamp(Math.round(w / 0.24), 3, 9);
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (i + 0.5) * (w / n);
      const col = R.pick(['#8aa3b8', '#9fb4c4', '#f29b84', '#7f97b0']);
      fish(P, R, [x, y + 0.075, cz + R.float(-0.04, 0.04)], col, R.float(0.75, 0.95), R.float(-0.4, 0.4) + Math.PI / 2);
    }
    for (let i = 0; i < 2; i++) P.add(sphere(0.035, 7, 5), '#f6d84a', { at: [cx + (i ? 0.35 : -0.42) * w, y + 0.09, cz + d * 0.28], scale: [1, 0.85, 1.25] });
  } else if (goods === 'flowers') {
    const n = clamp(Math.round(w / 0.36), 2, 6);
    const cols = ['#e9434c', '#f6cf3a', '#f49ac1', '#a57fd9', '#f8f4ea', '#f39a48'];
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (i + 0.5) * (w / n);
      const z = cz + (i % 2 ? -0.06 : 0.05);
      pail(P, R, { at: [x, y, z], h: 0.17, r: 0.1, tin: true, color: R.pick(['#9fb7c9', '#c7a3c8', '#a9c9a4', '#d9b98c']), handle: false });
      bouquet(P, R, [x, y + 0.17, z], cols[(i * 2 + R.int(0, 1)) % cols.length], 7, 0.1);
    }
  } else if (goods === 'bread') {
    const n = clamp(Math.round(w / 0.45), 2, 5);
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (i + 0.5) * (w / n);
      const tw = w / n - 0.05;
      basketTray(P, R, [x, y, cz], tw, d * 0.85);
      const kind = i % 3;
      if (kind === 0) {
        for (let j = 0; j < 3; j++) loaf(P, R, [x + (j - 1) * tw * 0.3, y + 0.07, cz + R.float(-0.03, 0.03)], 'loaf');
      } else if (kind === 1) {
        for (let j = 0; j < 4; j++) loaf(P, R, [x + (j % 2 - 0.5) * tw * 0.42, y + 0.06, cz + (j < 2 ? -0.07 : 0.08)], 'bun');
      } else {
        for (let j = 0; j < 3; j++) loaf(P, R, [x, y + 0.06 + j * 0.0, cz + (j - 1) * 0.11], 'baguette');
      }
    }
  } else if (goods === 'pottery') {
    const n = clamp(Math.round(w / 0.24), 3, 9);
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (i + 0.5) * (w / n);
      const z = cz + (i % 2 ? -0.08 : 0.06);
      vase(P, R, [x, y, z], R.pick(['#c8714a', '#4f86c6', '#f1e3c8', '#5aa56a', '#d98a5a', '#3fa3a0']), i);
    }
  } else if (goods === 'toys') {
    const n = clamp(Math.round(w / 0.3), 3, 7);
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (i + 0.5) * (w / n);
      const z = cz + (i % 2 ? -0.07 : 0.06);
      toy(P, R, [x, y, z], i);
    }
  }
}

/** A fish lying on its side (on ice, in a crate): body, tail fin, belly tint and an eye. */
function fish(P, R, at, color, s, yaw) {
  const M = xform(at, [0, yaw, 0], s);
  paint(P, sphere(0.1, 10, 6), color, { matrix: M.clone().multiply(xform([0, 0, 0], [0, 0, 0], [1, 0.3, 0.46])) }, (c, x, y, z) => {
    const local = new THREE.Vector3(x - at[0], 0, z - at[2]).applyAxisAngle(UP, -yaw);
    if (local.z < -0.012 * s) c.lerp(C('#f3f1ea'), 0.55);
  });
  const tail = extrude([[0, 0], [0.075, 0.05], [0.062, 0], [0.075, -0.05]], 0.01, { bevel: 0.006, bevelSegments: 1, curveSegments: 1 });
  P.add(tail, shade(color, -0.1), { matrix: M.clone().multiply(xform([0.088, 0, 0], [Math.PI / 2, 0, 0])) });
  P.add(extrude([[-0.03, 0], [0.03, 0], [0.01, 0.03]], 0.008, { bevel: 0.004, bevelSegments: 1 }), shade(color, -0.1), { matrix: M.clone().multiply(xform([0, 0, 0.04], [Math.PI / 2, 0, 0])) });
  P.add(sphere(0.013, 6, 4), '#33303a', { matrix: M.clone().multiply(xform([-0.066, 0.026, 0.006])) });
}

function bouquet(P, R, at, color, n = 7, spread = 0.1) {
  const [x0, y0, z0] = at;
  P.add(blob(spread * 0.9, { detail: 1, amp: 0.2, seed: R.int(0, 99), squash: [1, 0.7, 1] }), { slot: 'foliage', color: '#5aa458' }, { at: [x0, y0 + spread * 0.35, z0] });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R.float(-0.3, 0.3);
    const r = i === 0 ? 0 : spread * R.float(0.45, 0.8);
    const c = shade(color, R.float(-0.05, 0.05));
    const bx = x0 + Math.cos(a) * r, bz = z0 + Math.sin(a) * r, by = y0 + spread * 0.8 + R.float(0, 0.05) - r * 0.4;
    P.add(sphere(0.034, 7, 5), { slot: 'foliage', color: c }, { at: [bx, by, bz], scale: [1, 0.8, 1] });
    P.add(sphere(0.013, 5, 4), { slot: 'foliage', color: '#f6d34a' }, { at: [bx, by + 0.026, bz] });
  }
}

function basketTray(P, R, at, w, d) {
  const [x, y, z] = at;
  const wick = '#c99a5b';
  paint(P, softBox(w, 0.06, d, 0.02), wick, { at: [x, y, z] }, (c, px, py, pz) => {
    c.lerp(C(shade(wick, -0.12)), (Math.floor(px * 40) + Math.floor(py * 40) + Math.floor(pz * 40)) % 2 ? 0.5 : 0);
  }, { flat: true });
  P.add(softBox(w - 0.04, 0.012, d - 0.04, 0.005), '#f4efe6', { at: [x, y + 0.055, z] });
}

function loaf(P, R, at, kind) {
  const crust = shade('#c98a46', R.float(-0.04, 0.04));
  const [x, y, z] = at;
  if (kind === 'baguette') {
    P.add(sphere(0.05, 10, 6), crust, { at: [x, y, z], scale: [3.4, 0.75, 0.85], rot: [0, R.float(-0.15, 0.15), 0] });
    for (let i = -1; i <= 1; i++) P.add(softBox(0.06, 0.01, 0.018, 0.004), '#efd29a', { at: [x + i * 0.08, y + 0.032, z], rot: [0, 0.6, 0] });
  } else if (kind === 'bun') {
    P.add(sphere(0.045, 8, 6), crust, { at: [x, y, z], scale: [1, 0.7, 1] });
  } else {
    P.add(sphere(0.06, 10, 6), crust, { at: [x, y + 0.01, z], scale: [1.5, 0.85, 1.05] });
    for (let i = -1; i <= 1; i++) P.add(softBox(0.012, 0.01, 0.07, 0.004), '#efd29a', { at: [x + i * 0.03, y + 0.058, z], rot: [0, 0.4, 0] });
  }
}

function vase(P, R, at, color, i) {
  const shapes = [
    [[0, 0], [0.06, 0], [0.085, 0.06], [0.075, 0.14], [0.04, 0.19], [0.045, 0.22], [0.035, 0.225], [0, 0.2]],
    [[0, 0], [0.05, 0], [0.11, 0.05], [0.115, 0.08], [0.1, 0.09], [0, 0.07]],
    [[0, 0], [0.05, 0], [0.07, 0.08], [0.065, 0.15], [0.05, 0.17], [0.06, 0.2], [0.05, 0.205], [0, 0.18]],
    [[0, 0], [0.07, 0], [0.08, 0.03], [0.07, 0.11], [0.072, 0.13], [0.06, 0.135], [0, 0.12]],
  ];
  const prof = shapes[i % shapes.length];
  paint(P, lathe(prof, 12), color, { at }, (c, x, y) => {
    if (Math.abs(y - at[1] - 0.06) < 0.012) c.set(shade(color, 0.12));
  }, { flat: true });
}

function toy(P, R, at, i) {
  const [x, y, z] = at;
  const k = i % 4;
  if (k === 0) {
    // a beach ball: six colored gores
    const gores = ['#e9434c', '#f8f4ea', '#4f86c6', '#f8f4ea', '#f6cf3a', '#f8f4ea'];
    paint(P, sphere(0.07, 12, 8), '#e9434c', { at: [x, y + 0.07, z], rot: [0.4, 0.3, 0] }, (c, px, py, pz) => {
      const a = (Math.atan2(pz - z, px - x) / TAU + 0.5) * 6;
      c.set(Math.abs(py - (y + 0.07)) > 0.062 ? '#f8f4ea' : gores[Math.floor(a) % 6]);
    }, { flat: true });
  } else if (k === 1) {
    const cols = ['#4f86c6', '#f2c94c', '#5aa56a', '#ee8c3e'];
    P.add(softBox(0.08, 0.08, 0.08, 0.012), cols[0], { at: [x - 0.045, y, z] });
    P.add(softBox(0.08, 0.08, 0.08, 0.012), cols[1], { at: [x + 0.045, y, z + 0.01], rot: [0, 0.3, 0] });
    P.add(softBox(0.08, 0.08, 0.08, 0.012), cols[2], { at: [x, y + 0.08, z], rot: [0, -0.2, 0] });
  } else if (k === 2) {
    const fur = '#c98a52';
    P.add(sphere(0.06, 9, 6), fur, { at: [x, y + 0.06, z], scale: [1, 1.05, 0.9] });
    P.add(sphere(0.05, 9, 6), fur, { at: [x, y + 0.15, z + 0.005] });
    for (const sx of [-1, 1]) {
      P.add(sphere(0.02, 6, 4), fur, { at: [x + sx * 0.035, y + 0.195, z] });
      P.add(sphere(0.022, 6, 4), fur, { at: [x + sx * 0.06, y + 0.07, z + 0.02] });
    }
    P.add(sphere(0.018, 6, 4), '#f0d2a8', { at: [x, y + 0.14, z + 0.045] });
  } else {
    rod(P, [x, y, z], [x, y + 0.26, z], 0.008, PALETTE.woodLight, { seg: 5 });
    const cols = ['#e9434c', '#4f86c6', '#f6cf3a', '#5aa56a'];
    for (let j = 0; j < 4; j++) {
      P.add(extrude([[0, 0], [0.07, 0.0], [0.0, 0.07]], 0.006, { bevel: 0.002, bevelSegments: 1 }), cols[j], { at: [x, y + 0.26, z + 0.012], rot: [0, 0, (j / 4) * TAU + 0.3] });
    }
    P.add(sphere(0.012, 6, 4), '#f4efe6', { at: [x, y + 0.26, z + 0.02] });
  }
}

function buildStall(p, ctx) {
  const color = colorOr(p.color, PALETTE.cloth.red);
  const goods = oneOf(p.goods, GOODS, 'fruit');
  const wood = colorOr(p.wood, PALETTE.wood);
  const W = num(p.width, 1.7, 1.1, 2.8);
  const sign = textOr(p.sign, '', 18);
  const R = rand(ctx, 'stall');
  const P = new Parts();
  const cream = '#f6efe2';
  const top = SCALE.counter;
  const zc0 = -0.08, zc1 = 0.5, dc = zc1 - zc0;
  // counter: a plank front, a colored trim and an overhanging top
  P.add(softBox(W - 0.06, top - 0.06, dc - 0.06, 0.02), shade(wood, 0.08), { at: [0, 0.02, (zc0 + zc1) / 2 - 0.01] });
  const nPl = Math.max(4, Math.round(W / 0.2));
  for (let i = 0; i < nPl; i++) {
    const x = -W / 2 + 0.05 + (i + 0.5) * ((W - 0.1) / nPl);
    P.add(softBox((W - 0.1) / nPl - 0.012, top - 0.1, 0.03, 0.01), shade(PALETTE.woodLight, R.float(-0.05, 0.03)), { at: [x, 0.05, zc1 - 0.035] });
  }
  P.add(softBox(W + 0.02, 0.06, 0.05, 0.015), shade(wood, -0.1), { at: [0, 0, zc1 - 0.03] });
  P.add(softBox(W - 0.06, 0.05, 0.035, 0.012), color, { at: [0, top - 0.1, zc1 - 0.012] });
  P.add(softBox(W + 0.08, 0.05, dc + 0.1, 0.018), wood, { at: [0, top - 0.05, (zc0 + zc1) / 2 + 0.02] });
  // posts: front ones at the counter corners, back ones taller behind the vendor
  const zf = zc1 - 0.06, zb = -0.78, hf = 1.5, hb = 1.84;
  for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) {
    P.add(softBox(0.07, hf, 0.07, 0.02), shade(wood, -0.05), { at: [x, 0, zf] });
    P.add(softBox(0.07, hb, 0.07, 0.02), shade(wood, -0.05), { at: [x, 0, zb] });
    P.add(softBox(0.05, 0.05, zf - zb, 0.015), shade(wood, -0.1), { at: [x, 0.12, (zf + zb) / 2] });
  }
  // a puffy striped awning from the back (high) to the front (low), with a scalloped valance
  const zA0 = zb - 0.14, zA1 = zc1 + 0.3, yA0 = hb + 0.06, yA1 = hf + 0.06;
  const slope = Math.atan2(yA0 - yA1, zA1 - zA0);
  const len = Math.hypot(zA1 - zA0, yA0 - yA1);
  const AW = W + 0.26;
  const n = Math.max(5, Math.round(AW / 0.2) | 1);
  const sw = AW / n;
  awning(P, { w: AW, len, n, color, cream, at: [0, (yA0 + yA1) / 2, (zA0 + zA1) / 2], slope, bow: 0.07, puff: 0.03 });
  for (let i = 0; i < n; i++) {
    const x = -AW / 2 + (i + 0.5) * sw;
    P.add(scallop(), { slot: 'cloth', color: i % 2 ? cream : color }, { at: [x, yA1 - 0.012, zA1 + 0.006], scale: [sw * 1.04, sw * 1.0, 1] });
  }
  P.add(roundCyl(0.03, AW + 0.03, { segments: 8, steps: 1, bevel: 0.012 }), { slot: 'cloth', color: shade(color, -0.12) }, { at: [-(AW + 0.03) / 2, yA1 - 0.012, zA1 + 0.004], rot: [0, 0, -Math.PI / 2] });
  P.add(roundCyl(0.03, AW + 0.03, { segments: 8, steps: 1, bevel: 0.012 }), { slot: 'cloth', color: shade(color, -0.12) }, { at: [-(AW + 0.03) / 2, yA0 - 0.01, zA0], rot: [0, 0, -Math.PI / 2] });
  // a little lantern hanging under the front corner of the awning
  const lx = W / 2 - 0.2, ly = yA1 - 0.36;
  rod(P, [lx, yA1 - 0.07, zA1 - 0.1], [lx, ly + 0.17, zA1 - 0.1], 0.006, PALETTE.iron, { seg: 4 });
  P.add(roundCyl(0.05, 0.03, { segments: 8, steps: 1, bevel: 0.01 }), PALETTE.iron, { at: [lx, ly + 0.14, zA1 - 0.1] });
  P.add(roundCyl(0.045, 0.13, { top: 0.052, segments: 10, steps: 1, bevel: 0.015 }), { slot: 'lamp', color: '#fff0c8' }, { at: [lx, ly + 0.01, zA1 - 0.1] });
  P.add(roundCyl(0.042, 0.025, { segments: 8, steps: 1, bevel: 0.01 }), PALETTE.iron, { at: [lx, ly - 0.01, zA1 - 0.1] });
  // a sign board on top of the awning front
  if (sign) {
    const sw2 = clamp(0.3 + sign.length * 0.075, 0.6, Math.min(1.3, W)), sh = 0.24;
    const sy = yA1 + 0.21;
    P.add(softBox(sw2 + 0.07, sh + 0.07, 0.05, 0.022), shade(wood, -0.08), { at: [0, sy - sh / 2 - 0.035, zA1 - 0.05] });
    P.add(new THREE.PlaneGeometry(sw2, sh), label(sign, { width: Math.round((160 * sw2) / sh), height: 160 }), { at: [0, sy, zA1 - 0.024] });
    for (const x of [-sw2 * 0.35, sw2 * 0.35]) P.add(softBox(0.035, 0.12, 0.035, 0.01), shade(wood, -0.12), { at: [x, sy - sh / 2 - 0.13, zA1 - 0.06] });
  }
  goodsOn(P, R, goods, { at: [0, top, (zc0 + zc1) / 2 + 0.02], w: W - 0.16, d: dc - 0.05 });
  return finish(P.build('stall'), {
    footprint: { w: W + 0.3, d: zA1 - zA0 + 0.2 },
    spots: {
      vendor: spot([0, 0, -0.4], 0, 'stand'),
      customer: spot([0, 0, zc1 + 0.48], 180, 'stand'),
      customer2: spot([W * 0.32, 0, zc1 + 0.55], 195, 'stand'),
    },
    height: sign ? yA1 + 0.36 : yA0 + 0.06,
  });
}

/* ───────────────────────── crates, barrels, sacks ───────────────────────── */

/** Stack layouts for 1–4 small things of size s: [x, y, z, yaw]. */
function stackLayout(count, s, R) {
  const L = [
    [[0, 0, 0, 0]],
    [[-0.53 * s, 0, 0, 0], [0.53 * s, 0, 0.04 * s, 0]],
    [[-0.53 * s, 0, 0, 0], [0.53 * s, 0, 0.03 * s, 0], [0, s, 0, 0]],
    [[-0.53 * s, 0, 0.27 * s, 0], [0.53 * s, 0, 0.3 * s, 0], [0, 0, -0.78 * s, 0], [-0.1 * s, s, -0.1 * s, 0]],
  ][count - 1];
  return L.map(([x, y, z]) => [x + R.float(-0.02, 0.02) * s, y, z + R.float(-0.02, 0.02) * s, R.float(-0.18, 0.18)]);
}

const CRATE_FILL = ['closed', 'empty', 'apples', 'oranges', 'cabbages', 'fish', 'straw'];

function crateAt(P, R, at, S, wood, yaw, fill) {
  const M = xform(at, [0, yaw, 0]);
  const add = (g, look, local) => P.add(g, look, { matrix: local ? M.clone().multiply(local) : M });
  const dark = shade(wood, -0.25), post = shade(wood, -0.1);
  add(box(S - 0.04, S - 0.02, S - 0.04), dark, xform([0, 0.01, 0]));
  const t = S * 0.14;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(softBox(t, S, t, t * 0.28), post, xform([sx * (S / 2 - t / 2), 0, sz * (S / 2 - t / 2)]));
  const ph = S * 0.37;
  for (let side = 0; side < 4; side++) {
    const rot = new THREE.Matrix4().makeRotationY((side * Math.PI) / 2);
    for (const y of [S * 0.07, S * 0.55]) {
      add(softBox(S - 2 * t + 0.012, ph, S * 0.07, 0.01), shade(wood, R.float(-0.05, 0.04)), rot.clone().multiply(xform([0, y, S / 2 - S * 0.045])));
    }
  }
  const top = S;
  if (fill === 'closed') {
    for (let i = 0; i < 3; i++) add(softBox(S + 0.008, S * 0.08, S / 3 - 0.012, 0.01), shade(wood, R.float(-0.04, 0.05)), xform([0, top - S * 0.04, (i - 1) * (S / 3)]));
    return top + S * 0.04;
  }
  const inner = S - 2 * t;
  if (fill === 'empty') {
    add(box(S - 0.05, 0.01, S - 0.05), shade(wood, -0.32), xform([0, S * 0.2, 0]));
    return top;
  }
  if (fill === 'straw') {
    add(blob(0.5, { detail: 1, amp: 0.25, seed: R.int(0, 99), squash: [inner * 0.95, S * 0.25, inner * 0.95] }), '#e4c46a', xform([0, top - S * 0.08, 0]));
    return top;
  }
  if (fill === 'fish') {
    add(box(S - 0.06, 0.01, S - 0.06), '#e9f4f8', xform([0, top - S * 0.12, 0]));
    const pos = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      pos.set((i - 1) * inner * 0.3, top - S * 0.08, R.float(-0.03, 0.03)).applyMatrix4(M);
      fish(P, R, [pos.x, pos.y, pos.z], R.pick(['#8aa3b8', '#f29b84', '#9fb4c4']), S * 2.2, yaw + Math.PI / 2 + R.float(-0.3, 0.3));
    }
    return top;
  }
  const kind = fill === 'oranges' ? 'orange' : fill === 'cabbages' ? 'cabbage' : 'apple';
  const pos = new THREE.Vector3(0, top - S * 0.16, 0).applyMatrix4(M);
  if (kind === 'cabbage') {
    for (let i = 0; i < 4; i++) {
      const q = new THREE.Vector3(((i % 2) - 0.5) * inner * 0.48, top - S * 0.05, (Math.floor(i / 2) - 0.5) * inner * 0.48).applyMatrix4(M);
      P.add(blob(S * 0.17, { detail: 1, amp: 0.18, seed: i + 3, squash: [1, 0.85, 1] }), shade('#8fcf6c', R.float(-0.05, 0.05)), { at: [q.x, q.y, q.z] });
    }
  } else {
    fruitHeap(P, R, kind, { at: [pos.x, pos.y, pos.z], rx: inner / 2, rz: inner / 2, r: S * 0.13, layers: 2 });
  }
  return top;
}

function buildCrate(p, ctx) {
  const S = size(p.size, 0.4, 0.25, 0.8);
  const wood = colorOr(p.color, '#c99a62');
  const count = int(p.count, 1, 1, 4);
  const fill = oneOf(p.contents, CRATE_FILL, 'closed');
  const R = rand(ctx, 'crate');
  const P = new Parts();
  const lay = stackLayout(count, S * 1.02, R);
  let seat = null;
  lay.forEach(([x, y, z, yaw], i) => {
    const onTop = lay.some(([x2, y2, z2], j) => j !== i && y2 > y + 0.01 && Math.hypot(x2 - x, z2 - z) < S);
    const top = crateAt(P, R, [x, y, z], S, wood, yaw, onTop ? 'closed' : i === 0 ? fill : R.pick([fill, 'closed']));
    if (!onTop && !seat && (fill === 'closed' || count > 1)) seat = [x, y + top, z + S / 2 - 0.12];
  });
  const spots = { side: spot([0, 0, S / 2 + 0.42 + (count >= 4 ? 0.3 * S : 0)], 180, 'stand') };
  if (seat && seat[1] < 0.75) spots.sit = spot(seat, 0, 'sit');
  const w = count === 1 ? S : 2.1 * S;
  return finish(P.build('crate'), { footprint: { w: w + 0.12, d: (count >= 4 ? 1.9 * S : S) + 0.12 }, spots });
}

const BARREL_FILL = ['closed', 'open', 'water', 'apples', 'fish'];

function barrelAt(P, R, at, H, wood, hoop, fill, yaw) {
  const [x0, y0, z0] = at;
  const re = 0.19 * (H / 0.52), rb = 0.045 * (H / 0.52);
  const rAt = (y) => re + rb * Math.sin(Math.PI * clamp(y / H, 0, 1));
  const prof = [[re - 0.018, 0], [re - 0.004, 0.012]];
  for (let i = 1; i <= 7; i++) { const y = (i / 8) * H; prof.push([rAt(y), y]); }
  prof.push([re - 0.004, H - 0.012], [re - 0.018, H], [re - 0.03, H], [re - 0.032, H - 0.03], [0, H - 0.03]);
  const seed = R.int(0, 999);
  paint(P, lathe(prof, 16), wood, { at, rot: [0, yaw, 0] }, staves(wood, { cx: x0, cz: z0, n: 16, y0, y1: y0 + H, seed }), { flat: true });
  for (const t of [0.13, 0.33, 0.67, 0.87]) {
    const y = t * H, r = rAt(y) + 0.004;
    P.add(lathe([[r - 0.004, -0.022], [r + 0.004, -0.016], [r + 0.004, 0.016], [r - 0.004, 0.022]], 16), { slot: 'metal', color: hoop }, { at: [x0, y0 + y, z0] });
  }
  const topY = y0 + H - 0.03;
  if (fill === 'closed') {
    P.add(roundCyl(re - 0.03, 0.025, { segments: 16, steps: 1, bevel: 0.008 }), shade(wood, 0.05), { at: [x0, topY - 0.012, z0] });
    for (const dz of [-0.05, 0.05]) P.add(box((re - 0.035) * 2 * Math.sqrt(1 - (dz / re) ** 2), 0.004, 0.006), shade(wood, -0.22), { at: [x0, topY + 0.013, z0 + dz], rot: [0, yaw, 0] });
    return H;
  }
  P.add(new THREE.CircleGeometry(re - 0.03, 14).rotateX(-Math.PI / 2), shade(wood, -0.35), { at: [x0, topY - 0.005, z0] });
  if (fill === 'water') waterDisc(P, re - 0.03, topY - 0.02, { at, segs: 16 });
  else if (fill === 'apples') fruitHeap(P, R, 'apple', { at: [x0, topY - 0.06, z0], rx: re - 0.05, rz: re - 0.05, r: 0.055, layers: 2 });
  else if (fill === 'fish') {
    for (let i = 0; i < 3; i++) fish(P, R, [x0 + (i - 1) * 0.07, topY + 0.02 + i * 0.01, z0 + R.float(-0.04, 0.04)], R.pick(['#8aa3b8', '#f29b84']), 0.9, Math.PI / 2 + (i - 1) * 0.5);
  }
  return H;
}

function buildBarrel(p, ctx) {
  const H = size(p.size, 0.52, 0.3, 1.2);
  const wood = colorOr(p.color, '#b47f4c');
  const hoop = colorOr(p.hoops, '#5d636c');
  const count = int(p.count, 1, 1, 3);
  const fill = oneOf(p.contents, BARREL_FILL, 'closed');
  const R = rand(ctx, 'barrel');
  const P = new Parts();
  const re = 0.235 * (H / 0.52);
  const lay = count === 1 ? [[0, 0, 0]] : count === 2 ? [[-re * 1.05, 0, 0], [re * 1.05, 0, 0.06]] : [[-re * 1.05, 0, 0.12], [re * 1.05, 0, 0.14], [0, 0, -re * 1.6]];
  lay.forEach(([x, y, z], i) => barrelAt(P, R, [x + R.float(-0.02, 0.02), y, z], H * (i === 2 ? 0.94 : 1), wood, hoop, i === 0 ? fill : 'closed', R.angle()));
  const spots = { side: spot([0, 0, re + 0.45 + (count > 1 ? 0.1 : 0)], 180, 'stand') };
  if (fill === 'closed' && H <= 0.7) spots.sit = spot([lay[0][0], H, lay[0][2] + re - 0.16], 0, 'sit');
  return finish(P.build('barrel'), { footprint: count === 1 ? { r: re + 0.05 } : { w: re * 4.3, d: re * (count === 3 ? 4 : 2.3) } , spots });
}

const SACK_STYLE = ['tied', 'open', 'lying'];

function sackAt(P, R, at, color, style, yaw, s, seed) {
  const M = xform(at, [0, yaw, 0], s);
  const add = (g, look, local) => P.add(g, look, { matrix: M.clone().multiply(local) });
  const stripe = shade(color, -0.2, { hue: -0.02 });
  const band = (c, x, y, z) => {
    const q = new THREE.Vector3(x, y, z).applyMatrix4(M.clone().invert());
    const v = style === 'lying' ? q.x : q.y;
    if (Math.abs(v - (style === 'lying' ? -0.05 : 0.2)) < 0.014 || Math.abs(v - (style === 'lying' ? 0.03 : 0.25)) < 0.014) c.set(stripe);
    c.lerp(C(shade(color, -0.12)), clamp(noise3(q.x * 9 + seed, q.y * 9, q.z * 9) * 0.6, 0, 0.35));
  };
  if (style === 'lying') {
    paint(P, blob(0.2, { detail: 2, amp: 0.05, seed, squash: [1.4, 0.58, 0.95], flatBottom: 0.72 }), { slot: 'cloth', color }, { matrix: M.clone().multiply(xform([0, 0.085, 0])) }, band);
    add(blob(0.07, { detail: 1, amp: 0.2, seed: seed + 1, squash: [0.9, 0.8, 1] }), { slot: 'cloth', color: shade(color, 0.03) }, xform([0.3, 0.09, 0]));
    add(ring(0.045, 0.012, { radial: 4, tubular: 12 }), '#a8865a', xform([0.255, 0.09, 0], [0, 0, Math.PI / 2]));
    return 0.17 * s;
  }
  paint(P, blob(0.2, { detail: 2, amp: 0.06, seed, squash: [1, 1.12, 0.86], flatBottom: 0.72 }), { slot: 'cloth', color }, { matrix: M.clone().multiply(xform([0, 0.16, 0])) }, band);
  if (style === 'open') {
    add(ring(0.15, 0.035, { radial: 6, tubular: 18 }), { slot: 'cloth', color: shade(color, 0.04) }, xform([0, 0.34, 0], [0, 0, 0], [1, 1, 0.88]));
    add(blob(0.15, { detail: 1, amp: 0.1, seed: seed + 2, squash: [1, 0.35, 0.86] }), '#e8cf86', xform([0, 0.345, 0]));
    return 0.4 * s;
  }
  add(blob(0.13, { detail: 1, amp: 0.08, seed: seed + 3, squash: [1, 0.75, 0.9] }), { slot: 'cloth', color }, xform([0, 0.33, 0]));
  add(ring(0.052, 0.014, { radial: 4, tubular: 12 }), '#a8865a', xform([0, 0.4, 0]));
  add(blob(0.075, { detail: 1, amp: 0.3, seed: seed + 4, squash: [1.25, 0.75, 1.15] }), { slot: 'cloth', color: shade(color, 0.03) }, xform([0, 0.445, 0]));
  return 0.5 * s;
}

function buildSack(p, ctx) {
  const color = colorOr(p.color, '#d9c18f');
  const style = oneOf(p.style, SACK_STYLE, 'tied');
  const count = int(p.count, 1, 1, 3);
  const R = rand(ctx, 'sack');
  const P = new Parts();
  const lay = count === 1 ? [[0, 0, 0]] : count === 2 ? [[-0.2, 0, 0], [0.21, 0, 0.05]] : [[-0.22, 0, 0.05], [0.22, 0, 0.08], [0.0, 0, -0.3]];
  if (style === 'lying' && count > 1) lay.forEach((l, i) => { l[0] *= 0.1; l[2] = (i - (count - 1) / 2) * 0.36; });
  lay.forEach(([x, y, z], i) => sackAt(P, R, [x, y, z], shade(color, R.float(-0.04, 0.03)), style, style === 'lying' ? R.float(-0.12, 0.12) : R.angle(), R.float(0.92, 1.06), R.int(0, 999)));
  const spots = { side: spot([0, 0, 0.6], 180, 'stand') };
  if (style === 'lying') spots.sit = spot([0, 0.17, 0.06], 0, 'sit');
  return finish(P.build('sack'), { footprint: { r: count === 1 ? 0.28 : 0.5 }, spots });
}

/* ───────────────────────── pots, buckets, baskets ───────────────────────── */

const POT_PLANTS = ['tulip', 'daisy', 'rose', 'sunflower', 'lavender', 'fern', 'cactus', 'none'];
const POT_BLOOM = { tulip: '#e9434c', daisy: '#f8f4ea', rose: '#f49ac1', sunflower: '#f6cf3a', lavender: '#a57fd9', fern: '#62b356', cactus: '#f49ac1', none: '#f8f4ea' };
const LEAF = '#5aa458';

let daisyGeo = null;
function daisyHead() {
  if (daisyGeo) return daisyGeo;
  const pts = [];
  const n = 8, steps = 4;
  for (let i = 0; i < n * steps; i++) {
    const a = (i / (n * steps)) * TAU;
    const lobe = Math.abs(Math.cos((a * n) / 2));
    pts.push([Math.cos(a) * (0.022 + 0.03 * lobe ** 0.7), Math.sin(a) * (0.022 + 0.03 * lobe ** 0.7)]);
  }
  daisyGeo = extrude(pts, 0.008, { bevel: 0.003, bevelSegments: 1 }).rotateX(-Math.PI / 2);
  return daisyGeo;
}
let starGeo = null;
function sunflowerHead() {
  if (starGeo) return starGeo;
  const pts = [];
  const n = 14;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU;
    const r = i % 2 ? 0.05 : 0.085;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  starGeo = extrude(pts, 0.01, { bevel: 0.004, bevelSegments: 1 });
  return starGeo;
}

/** A potted plant on top of soil at `at` (y = soil level), sized by `k`. */
function plant(P, R, kind, at, color, k = 1, season = 'summer') {
  const [x0, y0, z0] = at;
  const leaf = (x, y, z, len, yaw, tilt) => P.add(sphere(0.05, 7, 5), { slot: 'foliage', color: shade(LEAF, R.float(-0.04, 0.04)) }, { matrix: xform([x, y, z], [0, yaw, 0]).multiply(xform([0, 0, 0], [tilt, 0, 0])).multiply(xform([0, len * 0.5, 0], [0, 0, 0], [0.32 * k, len / 0.1, 0.75 * k])) });
  const stem = (x, z, h, lean = [0, 0]) => { rod(P, [x, y0, z], [x + lean[0], y0 + h, z + lean[1]], 0.007 * k, { slot: 'foliage', color: '#4f9a4c' }, { seg: 5 }); return [x + lean[0], y0 + h, z + lean[1]]; };
  if (kind === 'tulip') {
    const cup = lathe([[0, 0], [0.022, 0.006], [0.036, 0.028], [0.037, 0.05], [0.029, 0.07], [0.012, 0.062], [0, 0.058]], 10);
    for (let i = 0; i < 4; i++) leaf(x0 + R.float(-0.03, 0.03), y0, z0 + R.float(-0.03, 0.03), 0.15 * k, (i / 4) * TAU + R.float(-0.3, 0.3), 0.45);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + R.float(-0.3, 0.3), r = i === 0 ? 0 : 0.05 * k;
      const h = (0.2 + R.float(-0.03, 0.05) + (i === 0 ? 0.05 : 0)) * k;
      const top = stem(x0 + Math.cos(a) * r * 0.5, z0 + Math.sin(a) * r * 0.5, h, [Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6]);
      P.add(cup, { slot: 'foliage', color: shade(color, R.float(-0.05, 0.05)) }, { at: [top[0], top[1] - 0.01 * k, top[2]], scale: k });
    }
  } else if (kind === 'daisy') {
    P.add(blob(0.09 * k, { detail: 1, amp: 0.18, seed: R.int(0, 99), squash: [1, 0.55, 1] }), { slot: 'foliage', color: LEAF }, { at: [x0, y0 + 0.03 * k, z0] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + R.float(-0.2, 0.2), r = i === 0 ? 0 : 0.065 * k;
      const top = stem(x0 + Math.cos(a) * r * 0.5, z0 + Math.sin(a) * r * 0.5, (0.13 + R.float(0, 0.05)) * k, [Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5]);
      P.add(daisyHead(), { slot: 'foliage', color }, { at: top, rot: [R.float(-0.3, 0.3), R.angle(), R.float(-0.3, 0.3)], scale: k });
      P.add(sphere(0.017, 6, 4), { slot: 'foliage', color: '#f6c93a' }, { at: [top[0], top[1] + 0.008 * k, top[2]], scale: [k, 0.6 * k, k] });
    }
  } else if (kind === 'rose') {
    P.add(blob(0.12 * k, { detail: 2, amp: 0.2, seed: R.int(0, 99), squash: [1, 0.9, 1] }), { slot: 'foliage', color: '#4f9a4c' }, { at: [x0, y0 + 0.1 * k, z0] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + R.float(-0.3, 0.3), up = R.float(0.2, 0.9);
      const d = new THREE.Vector3(Math.cos(a) * (1 - up * 0.6), up, Math.sin(a) * (1 - up * 0.6)).normalize().multiplyScalar(0.115 * k);
      P.add(blob(0.034 * k, { detail: 1, amp: 0.25, seed: i + 7, squash: [1, 0.85, 1] }), { slot: 'foliage', color: shade(color, R.float(-0.06, 0.04)) }, { at: [x0 + d.x, y0 + 0.1 * k + d.y, z0 + d.z] });
    }
  } else if (kind === 'sunflower') {
    for (let i = 0; i < 2; i++) {
      const h = (i ? 0.36 : 0.46) * k, lean = i ? [0.05 * k, -0.03 * k] : [-0.03 * k, 0.02 * k];
      const top = stem(x0 + (i ? 0.03 : -0.02) * k, z0, h, lean);
      leaf(top[0], y0 + h * 0.45, top[2], 0.12 * k, i * 2 + 0.5, 1.0);
      const yaw = i ? 0.5 : -0.3;
      const M = xform(top, [-0.35, yaw, 0], k * (i ? 0.85 : 1));
      P.add(sunflowerHead(), { slot: 'foliage', color }, { matrix: M });
      P.add(roundCyl(0.042, 0.022, { segments: 10, steps: 1, bevel: 0.01 }), { slot: 'foliage', color: '#8a5a35' }, { matrix: M.clone().multiply(xform([0, 0, 0.002], [Math.PI / 2, 0, 0])) });
    }
  } else if (kind === 'lavender') {
    P.add(blob(0.07 * k, { detail: 1, amp: 0.2, seed: R.int(0, 99), squash: [1.2, 0.5, 1.2] }), { slot: 'foliage', color: '#7fae7a' }, { at: [x0, y0 + 0.02 * k, z0] });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + R.float(-0.2, 0.2), r = i === 0 ? 0 : 0.05 * k;
      const h = (0.2 + R.float(-0.03, 0.04)) * k;
      const top = stem(x0 + Math.cos(a) * r * 0.4, z0 + Math.sin(a) * r * 0.4, h, [Math.cos(a) * r, Math.sin(a) * r]);
      P.add(sphere(0.02, 6, 4), { slot: 'foliage', color: shade(color, R.float(-0.05, 0.05)) }, { at: [top[0], top[1] + 0.02 * k, top[2]], scale: [k, 2.6 * k, k] });
    }
  } else if (kind === 'fern') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + R.float(-0.2, 0.2);
      leaf(x0, y0, z0, (0.2 + R.float(-0.03, 0.03)) * k, a, 0.75 + R.float(-0.1, 0.15));
    }
    P.add(blob(0.07 * k, { detail: 1, amp: 0.2, seed: R.int(0, 99) }), { slot: 'foliage', color: '#4c9447' }, { at: [x0, y0 + 0.06 * k, z0] });
  } else if (kind === 'cactus') {
    const green = '#5f9e5a';
    const body = lathe([[0, 0], [0.06, 0.01], [0.075, 0.06], [0.075, 0.15], [0.06, 0.2], [0.03, 0.225], [0, 0.23]], 12);
    paint(P, body, green, { at: [x0, y0 - 0.01, z0], scale: k }, (c, x, y, z) => { if (Math.floor(fract(0.25 - Math.atan2(z - z0, x - x0) / TAU) * 12) % 2) c.set(shade(green, -0.07)); }, { flat: true });
    P.add(lathe([[0, 0], [0.03, 0.01], [0.035, 0.05], [0.028, 0.08], [0, 0.085]], 8), green, { at: [x0 + 0.075 * k, y0 + 0.08 * k, z0], rot: [0, 0, -0.5], scale: k });
    P.add(daisyHead(), { slot: 'foliage', color }, { at: [x0, y0 + 0.22 * k, z0], scale: 0.9 * k });
    P.add(sphere(0.014, 6, 4), { slot: 'foliage', color: '#f6c93a' }, { at: [x0, y0 + 0.228 * k, z0], scale: k });
  }
}

function buildPot(p, ctx) {
  const kind = oneOf(p.flower, POT_PLANTS, 'tulip');
  const color = colorOr(p.color, POT_BLOOM[kind]);
  const potColor = colorOr(p.pot, '#c8714a');
  const k = size(p.size, 1, 0.5, 2.5);
  const R = rand(ctx, 'pot');
  const P = new Parts();
  const prof = [[0, 0], [0.105, 0], [0.115, 0.012], [0.145, 0.19], [0.17, 0.19], [0.178, 0.205], [0.175, 0.255], [0.162, 0.262], [0.148, 0.255], [0.135, 0.22], [0, 0.22]];
  paint(P, lathe(prof, 18), potColor, { scale: k }, (c, x, y) => { if (y > 0.185 * k) c.set(shade(potColor, 0.06)); else c.lerp(C(shade(potColor, -0.08)), 1 - y / (0.19 * k)); });
  P.add(blob(0.14, { detail: 1, amp: 0.12, seed: 4, squash: [1, 0.25, 1] }), '#6b4a32', { at: [0, 0.225 * k, 0], scale: k });
  if (kind !== 'none') plant(P, R, kind, [0, 0.235 * k, 0], color, k, seasonOf(ctx));
  return finish(P.build('pot'), { footprint: { r: 0.2 * k }, spots: { tend: spot([0, 0, 0.2 * k + 0.32], 180, 'kneel') } });
}

const BUCKET_FILL = ['empty', 'water', 'apples', 'fish', 'flowers', 'sand'];

function buildBucket(p, ctx) {
  const tin = oneOf(p.style, ['wood', 'tin'], 'wood') === 'tin';
  const fill = oneOf(p.contents, BUCKET_FILL, 'water');
  const color = colorOr(p.color, tin ? '#aeb6bf' : PALETTE.woodLight);
  const R = rand(ctx, 'bucket');
  const P = new Parts();
  const h = 0.28, r = 0.15;
  pail(P, R, { h, r, tin, color });
  const lv = h - 0.05;
  if (fill === 'water') waterDisc(P, r - 0.025, lv, { segs: 16 });
  else if (fill === 'apples') fruitHeap(P, R, 'apple', { at: [0, lv - 0.04, 0], rx: r - 0.04, rz: r - 0.04, r: 0.055, layers: 2 });
  else if (fill === 'fish') {
    P.add(new THREE.CircleGeometry(r - 0.025, 14).rotateX(-Math.PI / 2), '#9cc8d8', { at: [0, lv - 0.03, 0] });
    for (let i = 0; i < 2; i++) fish(P, R, [i ? 0.03 : -0.03, lv + 0.02 * i, 0], R.pick(['#8aa3b8', '#f29b84']), 1, Math.PI / 2 + (i ? 0.6 : -0.4));
  } else if (fill === 'flowers') bouquet(P, R, [0, lv - 0.02, 0], R.pick(['#e9434c', '#f49ac1', '#f6cf3a', '#a57fd9']), 7, 0.11);
  else if (fill === 'sand') P.add(blob(r - 0.03, { detail: 1, amp: 0.1, seed: 2, squash: [1, 0.3, 1] }), PALETTE.sand, { at: [0, lv - 0.02, 0] });
  else P.add(new THREE.CircleGeometry(r - 0.025, 14).rotateX(-Math.PI / 2), shade(color, -0.3), { at: [0, 0.035, 0] });
  return finish(P.build('bucket'), { footprint: { r: 0.17 }, spots: { side: spot([0, 0, 0.5], 180, 'stand') } });
}

const PRODUCE = ['none', 'apples', 'oranges', 'berries', 'eggs', 'bread', 'flowers', 'veggies', 'mushrooms'];

function buildBasket(p, ctx) {
  const produce = oneOf(p.produce, PRODUCE, 'apples');
  const wick = colorOr(p.color, '#c99a5b');
  const handle = flag(p.handle, true);
  const k = size(p.size, 1, 0.5, 2);
  const R = rand(ctx, 'basket');
  const P = new Parts();
  const rows = 6;
  const prof = [[0, 0], [0.12, 0], [0.13, 0.01]];
  for (let i = 1; i <= rows; i++) prof.push([0.13 + 0.06 * (i / rows) ** 1.3, 0.01 + 0.15 * (i / rows)]);
  prof.push([0.176, 0.16], [0.16, 0.15], [0, 0.13]);
  const segs = 20;
  const dark = C(shade(wick, -0.13)), light = C(shade(wick, 0.05));
  paint(P, lathe(prof, segs), wick, { scale: k }, (c, x, y, z) => {
    const row = Math.floor((y / k - 0.01) / (0.15 / rows));
    const seg = Math.floor(fract(0.25 - Math.atan2(z, x) / TAU) * segs);
    c.copy((row + seg) % 2 ? dark : light);
  }, { flat: true });
  P.add(ring(0.19, 0.018, { radial: 6, tubular: 24 }), shade(wick, -0.06), { at: [0, 0.16 * k, 0], scale: k });
  if (handle) P.add(arcTube(0.19, 0.016, 0, Math.PI, { radial: 5, segments: 14 }), shade(wick, -0.06), { at: [0, 0.16 * k, 0], scale: k });
  const top = 0.13 * k;
  if (produce === 'apples' || produce === 'oranges') fruitHeap(P, R, produce === 'apples' ? 'apple' : 'orange', { at: [0, top - 0.02 * k, 0], rx: 0.15 * k, rz: 0.15 * k, r: 0.055 * k, layers: 2 });
  else if (produce === 'berries') {
    P.add(blob(0.15 * k, { detail: 1, amp: 0.1, seed: 5, squash: [1, 0.35, 1] }), '#5aa458', { at: [0, top, 0] });
    for (let i = 0; i < 22; i++) {
      const a = R.angle(), r = Math.sqrt(R.next()) * 0.13 * k;
      P.add(sphere(0.022 * k, 6, 4), R.pick(['#d9364a', '#c42c44', '#6a4bb0', '#e04a5c']), { at: [Math.cos(a) * r, top + 0.03 * k + (0.13 * k - r) * 0.3, Math.sin(a) * r] });
    }
  } else if (produce === 'eggs') {
    P.add(blob(0.15 * k, { detail: 1, amp: 0.2, seed: 6, squash: [1, 0.3, 1] }), '#e4c46a', { at: [0, top, 0] });
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * TAU, r = i === 6 ? 0 : 0.085 * k;
      P.add(sphere(0.035 * k, 8, 6), R.pick(['#f4ecdc', '#e8c9a0', '#f1e3cc']), { at: [Math.cos(a) * r, top + 0.04 * k + (i === 6 ? 0.02 * k : 0), Math.sin(a) * r], scale: [1, 1.3, 1], rot: [R.float(-0.4, 0.4), 0, R.float(-0.4, 0.4)] });
    }
  } else if (produce === 'bread') {
    checkCloth(P, 0.42 * k, 0.42 * k, 6, PALETTE.cloth.red, [0, top + 0.02 * k, 0], 0.03 * k);
    for (let i = 0; i < 3; i++) loaf(P, R, [(i - 1) * 0.08 * k, top + 0.05 * k, (i % 2 ? 0.03 : -0.03) * k], i === 1 ? 'loaf' : 'bun');
  } else if (produce === 'flowers') {
    bouquet(P, R, [0, top - 0.02 * k, 0], R.pick(['#e9434c', '#f49ac1', '#f6cf3a', '#a57fd9']), 8, 0.13 * k);
  } else if (produce === 'veggies') {
    P.add(blob(0.15 * k, { detail: 1, amp: 0.1, seed: 5, squash: [1, 0.3, 1] }), '#a07d55', { at: [0, top, 0] });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.4;
      const M = xform([Math.cos(a) * 0.06 * k, top + 0.05 * k, Math.sin(a) * 0.06 * k], [0.9, a, 0], k);
      P.add(cone(0.028, 0.18, 8).rotateX(Math.PI).translate(0, 0.18, 0), '#f08a2e', { matrix: M });
      P.add(sphere(0.03, 6, 4), { slot: 'foliage', color: '#5fb04f' }, { matrix: M.clone().multiply(xform([0, 0.2, 0], [0, 0, 0], [0.8, 1.4, 0.8])) });
    }
    P.add(blob(0.065 * k, { detail: 1, amp: 0.15, seed: 9 }), '#8fcf6c', { at: [0.05 * k, top + 0.07 * k, -0.07 * k] });
  } else if (produce === 'mushrooms') {
    P.add(blob(0.15 * k, { detail: 1, amp: 0.1, seed: 5, squash: [1, 0.3, 1] }), '#7aa35a', { at: [0, top, 0] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + R.float(-0.3, 0.3), r = 0.07 * k;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      P.add(cyl(0.015 * k, 0.05 * k, { segments: 6 }), '#f1e6d0', { at: [x, top + 0.02 * k, z] });
      P.add(sphere(0.04 * k, 8, 5), R.pick(['#c0563a', '#b8804a', '#d9534a']), { at: [x, top + 0.07 * k, z], scale: [1, 0.6, 1] });
    }
  }
  return finish(P.build('basket'), { footprint: { r: 0.2 * k }, spots: { pick: spot([0, 0, 0.22 * k + 0.32], 180, 'kneel') } });
}

/** A checked picnic cloth (gingham): a sheet of `n` × `n` checks, draped with a soft sag. */
function checkCloth(P, w, d, n, color, at, droop = 0) {
  const g = new THREE.PlaneGeometry(w, d, n * 2, n * 2).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2), z = pos.getZ(i) / (d / 2);
    const e = Math.max(Math.abs(x), Math.abs(z));
    pos.setY(i, -droop * smooth(0.55, 1, e));
  }
  g.computeVertexNormals();
  const A = C(color), M = C(mix(color, '#f8f4ea', 0.55)), W = C('#f8f4ea');
  paint(P, g, { slot: 'cloth', color, double: true }, { at }, (c, x, y, z) => {
    const i = Math.floor(((x - at[0]) / w + 0.5) * n * 2), j = Math.floor(((z - at[2]) / d + 0.5) * n * 2);
    const a = (i >> 0) % 2, b = (j >> 0) % 2;
    c.copy(a && b ? A : a || b ? M : W);
  }, { flat: true });
}

/* ───────────────────────── signs and boards ───────────────────────── */

function arrowOutline(L, h, dir) {
  const tip = Math.min(0.13, L * 0.25);
  const pts = [[-0.06, -h / 2], [L - tip, -h / 2], [L, 0], [L - tip, h / 2], [-0.06, h / 2]];
  return dir > 0 ? pts : pts.map(([x, y]) => [-x, y]).reverse();
}

function buildSignpost(p, ctx) {
  const labels = textsOr(p.labels, ['Village', 'Beach', 'Forest'], 5);
  const wood = colorOr(p.wood, PALETTE.wood);
  const board = colorOr(p.board, '#ecd3a0');
  const H = num(p.height, 1.75, 1.2, 2.6);
  const R = rand(ctx, 'signpost');
  const P = new Parts();
  P.add(softBox(0.11, H, 0.11, 0.025), wood, { at: [0, 0, 0] });
  P.add(cone(0.1, 0.12, 4), shade(wood, -0.06), { at: [0, H, 0], rot: [0, Math.PI / 4, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + R.float(-0.3, 0.3);
    P.add(blob(0.09, { detail: 1, amp: 0.15, seed: i + R.int(0, 50), squash: [1.2, 0.55, 1] }), shade(PALETTE.stone, R.float(-0.1, 0.02)), { at: [Math.cos(a) * 0.12, 0.02, Math.sin(a) * 0.12] });
  }
  const list = labels.length ? labels : ['', ''];
  const bh = 0.19, gap = 0.255;
  list.forEach((text, i) => {
    const dir = i % 2 ? -1 : 1;
    const L = clamp(0.36 + text.length * 0.052, 0.62, 1.12);
    const y = H - 0.2 - i * gap;
    const yaw = R.float(-0.32, 0.32) + (i === 2 ? 0.25 : 0);
    const M = xform([0, y, 0], [0, yaw, R.float(-0.04, 0.04)]);
    const col = shade(board, R.float(-0.04, 0.03));
    P.add(extrude(arrowOutline(L, bh, dir), 0.04, { bevel: 0.012, bevelSegments: 1 }), col, { matrix: M });
    if (text) {
      const tw = L - 0.24, th = 0.13;
      const mat = label(text, { bg: col, fg: '#5a3a22', width: Math.round((160 * tw) / th), height: 160, font: 'bold 92px Georgia, "Times New Roman", serif' });
      const cx = dir * ((L - 0.13) / 2 - 0.03);
      P.add(new THREE.PlaneGeometry(tw, th), mat, { matrix: M.clone().multiply(xform([cx, 0, 0.0335])) });
      P.add(new THREE.PlaneGeometry(tw, th), mat, { matrix: M.clone().multiply(xform([cx, 0, -0.0335], [0, Math.PI, 0])) });
    }
    P.add(sphere(0.016, 6, 4), PALETTE.iron, { matrix: M.clone().multiply(xform([0, 0, 0.034])) });
  });
  return finish(P.build('signpost'), { footprint: { r: 0.25 }, spots: { read: spot([0.15, 0, 0.75], 190, 'stand') }, height: H + 0.12 });
}

function buildNoticeboard(p, ctx) {
  const wood = colorOr(p.wood, PALETTE.wood);
  const roof = colorOr(p.roof, PALETTE.roofGreen);
  const title = textOr(p.title, 'Notices', 18);
  const papers = int(p.papers, 6, 0, 12);
  const R = rand(ctx, 'noticeboard');
  const P = new Parts();
  const W = 1.24, y0 = 0.62, h = 0.78;
  for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) {
    P.add(softBox(0.1, y0 + h + 0.34, 0.1, 0.025), shade(wood, -0.05), { at: [x, 0, -0.01] });
    P.add(softBox(0.15, 0.06, 0.15, 0.022), shade(wood, -0.15), { at: [x, 0, -0.01] });
  }
  P.add(softBox(W - 0.04, h, 0.06, 0.02), wood, { at: [0, y0, 0] });
  paint(P, softBox(W - 0.18, h - 0.14, 0.03, 0.008), '#cf9f68', { at: [0, y0 + 0.07, 0.03] }, (c, x, y) => c.lerp(C('#b98754'), clamp(noise3(x * 14, y * 14, 3) * 0.8, 0, 0.5)));
  // little gabled roof
  const ry = y0 + h + 0.3, pitch = 0.5, half = 0.24;
  for (const sd of [-1, 1]) {
    P.add(softBox(W + 0.24, 0.05, half * 2 / Math.cos(pitch) * 0.55, 0.02), roof, { matrix: xform([0, ry - Math.sin(pitch) * half * 0.5, sd * half * 0.5], [sd * pitch, 0, 0]) });
  }
  P.add(roundCyl(0.035, W + 0.28, { segments: 8, steps: 1, bevel: 0.015 }), shade(roof, -0.12), { at: [-(W + 0.28) / 2, ry + 0.035, 0], rot: [0, 0, -Math.PI / 2] });
  if (title) {
    const tw = 0.74, th = 0.17;
    P.add(softBox(tw + 0.06, th + 0.06, 0.04, 0.015), shade(wood, -0.12), { at: [0, y0 + h - 0.005, 0.02] });
    P.add(new THREE.PlaneGeometry(tw, th), label(title, { bg: '#f6ecd3', fg: '#5a3a22', width: Math.round((160 * tw) / th), height: 160 }), { at: [0, y0 + h + th / 2 + 0.025, 0.041] });
  }
  // pinned papers with scribbled lines and a round pin
  const cols = ['#fbf3df', '#fde0e4', '#dcefe0', '#dbe8f6', '#fbefb4', '#efe2f7'];
  const pins = ['#e9434c', '#4f86c6', '#f2c94c', '#5aa56a'];
  const cw = W - 0.26, ch = h - 0.2;
  const ncol = Math.ceil(Math.sqrt(papers * 1.6)), nrow = Math.ceil(papers / Math.max(1, ncol));
  for (let i = 0; i < papers; i++) {
    const cx = -cw / 2 + ((i % ncol) + 0.5) * (cw / ncol) + R.float(-0.03, 0.03);
    const cy = y0 + 0.1 + ch - (Math.floor(i / ncol) + 0.5) * (ch / nrow) + R.float(-0.03, 0.03);
    const pw = R.float(0.17, 0.24), ph = R.float(0.2, 0.27) * (nrow > 2 ? 0.8 : 1);
    const M = xform([cx, cy, 0.05], [0, 0, R.float(-0.14, 0.14)]);
    P.add(box(pw, ph, 0.006), cols[i % cols.length], { matrix: M.clone().multiply(xform([0, -ph / 2, 0])) });
    for (let l = 0; l < 3; l++) P.add(box(pw * (l === 2 ? 0.45 : 0.72), 0.012, 0.004), '#9a8f86', { matrix: M.clone().multiply(xform([-(l === 2 ? pw * 0.12 : 0), ph * 0.22 - l * ph * 0.2, 0.004])) });
    P.add(sphere(0.018, 6, 4), pins[i % pins.length], { matrix: M.clone().multiply(xform([0, ph * 0.38, 0.008])) });
  }
  return finish(P.build('noticeboard'), { footprint: { w: W + 0.3, d: 0.5 }, spots: { read: spot([0, 0, 0.72], 180, 'stand'), side: spot([W / 2 + 0.4, 0, 0.45], 225, 'stand') }, height: ry + 0.1 });
}

function buildMailbox(p, ctx) {
  const color = colorOr(p.color, '#d9534a');
  const wood = colorOr(p.post, PALETTE.wood);
  const up = flag(p.flag, true);
  const name = textOr(p.name, '', 14);
  const R = rand(ctx, 'mailbox');
  const P = new Parts();
  const ph = 0.72;
  P.add(softBox(0.09, ph, 0.09, 0.022), wood, { at: [0, 0, -0.02] });
  P.add(softBox(0.16, 0.06, 0.24, 0.02), shade(wood, -0.08), { at: [0, ph - 0.06, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + R.float(-0.3, 0.3);
    P.add(blob(0.07, { detail: 1, amp: 0.15, seed: i + 11, squash: [1.2, 0.6, 1] }), shade(PALETTE.stone, R.float(-0.08, 0.04)), { at: [Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1] });
  }
  const bw = 0.27, bl = 0.44;
  const outline = [[-bw / 2, 0], [bw / 2, 0]];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; outline.push([Math.cos(a) * bw / 2, bw * 0.45 + Math.sin(a) * bw / 2]); }
  const by = ph;
  paint(P, extrude(outline, bl, { bevel: 0.015, bevelSegments: 2 }), color, { at: [0, by, 0] }, (c, x, y) => { if (y < by + 0.02) c.set(shade(color, -0.12)); });
  // door with a knob, a little dark slot outline
  const door = outline.map(([x, y]) => [x * 0.88, 0.012 + y * 0.9]);
  P.add(extrude(door, 0.02, { bevel: 0.006, bevelSegments: 1 }), shade(color, 0.08), { at: [0, by, bl / 2 + 0.012] });
  P.add(sphere(0.022, 8, 6), PALETTE.gold, { at: [0, by + bw * 0.86, bl / 2 + 0.035] });
  // the flag on the right side: up means there is mail
  const fc = color === '#f2c94c' ? PALETTE.cloth.red : '#f2c94c';
  const pivot = [bw / 2 + 0.03, by + 0.11, -0.06];
  const M = xform(pivot, [0, 0, up ? 0 : -Math.PI / 2]);
  P.add(softBox(0.03, 0.24, 0.025, 0.008), fc, { matrix: M });
  P.add(softBox(0.025, 0.09, 0.12, 0.008), fc, { matrix: M.clone().multiply(xform([0.0, 0.16, 0.055])) });
  P.add(roundCyl(0.025, 0.02, { segments: 8, steps: 1, bevel: 0.008 }), PALETTE.ironLight, { at: [bw / 2, pivot[1], pivot[2]], rot: [0, 0, -Math.PI / 2] });
  if (name) {
    const tw = 0.3, th = 0.09;
    P.add(softBox(tw + 0.03, th + 0.03, 0.02, 0.008), shade(wood, -0.15), { at: [0, ph - 0.3, 0.035] });
    P.add(new THREE.PlaneGeometry(tw, th), label(name, { bg: '#f6ecd3', fg: '#5a3a22', width: Math.round((160 * tw) / th), height: 160 }), { at: [0, ph - 0.3 + (th + 0.03) / 2, 0.046] });
  }
  return finish(P.build('mailbox'), { footprint: { r: 0.25 }, spots: { front: spot([0, 0, 0.68], 180, 'stand') }, height: by + bw });
}

/* ───────────────────────── fences ───────────────────────── */

const FENCE_STYLES = ['picket', 'rail', 'stone', 'iron'];
const FENCE_COLOR = { picket: '#f4efe4', rail: '#a8784a', stone: PALETTE.stone, iron: '#3f4a52' };

let picketGeo = null;
function picket() {
  if (picketGeo) return picketGeo;
  const w = 0.078, h = 0.5;
  const pts = [[-w / 2, 0], [w / 2, 0], [w / 2, h - 0.05]];
  for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; pts.push([Math.cos(a) * w / 2, h - 0.05 + Math.sin(a) * 0.05]); }
  pts.push([-w / 2, h - 0.05]);
  picketGeo = extrude(pts, 0.024, { bevel: 0.006, bevelSegments: 1 });
  return picketGeo;
}

function fenceSection(P, R, style, color, x0, x1, opts = {}) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  if (style === 'picket') {
    for (const y of [0.13, 0.36]) P.add(softBox(len + 0.02, 0.05, 0.028, 0.01), shade(color, -0.05), { at: [cx, y, -0.03] });
    const n = Math.max(1, Math.round((len - 0.06) / 0.13));
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.04 + (i + 0.5) * ((len - 0.08) / n);
      const arch = opts.arch ? opts.arch(x) : 0;
      P.add(picket(), shade(color, R.float(-0.025, 0.01)), { at: [x, 0.02, 0.0], scale: [1, 1 + arch, 1] });
    }
  } else if (style === 'rail') {
    for (const [y, h] of [[0.2, 0.075], [0.43, 0.075]]) {
      const lift = R.float(-0.015, 0.015);
      plank(P, [x0 - 0.04, y + lift, 0.06], [x1 + 0.04, y - lift, 0.06], 0.045, h, shade(color, R.float(-0.06, 0.03)), { up: [0, 0, 1] });
    }
  } else if (style === 'iron') {
    P.add(softBox(len + 0.02, 0.1, 0.16, 0.025), PALETTE.stone, { at: [cx, 0, 0] });
    for (const y of [0.17, 0.5]) P.add(softBox(len, 0.025, 0.025, 0.008), color, { at: [cx, y, 0] });
    const n = Math.max(1, Math.round(len / 0.1));
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * (len / n);
      P.add(cyl(0.012, 0.5, { segments: 6 }), color, { at: [x, 0.1, 0] });
      P.add(cone(0.024, 0.06, 6), color, { at: [x, 0.6, 0] });
      P.add(sphere(0.02, 6, 4), color, { at: [x, 0.6, 0] });
    }
  }
}

function fencePost(P, R, style, color, x, { tall = 0 } = {}) {
  if (style === 'picket') {
    P.add(softBox(0.09, 0.6 + tall, 0.09, 0.022), shade(color, -0.03), { at: [x, 0, -0.01] });
    P.add(sphere(0.055, 10, 7), shade(color, -0.03), { at: [x, 0.62 + tall, -0.01], scale: [1, 0.8, 1] });
  } else if (style === 'rail') {
    const h = 0.6 + tall + R.float(-0.03, 0.03);
    P.add(softBox(0.1, h, 0.1, 0.028), shade(color, R.float(-0.12, -0.04)), { at: [x, 0, 0], rot: [R.float(-0.03, 0.03), R.float(-0.2, 0.2), R.float(-0.03, 0.03)] });
  } else if (style === 'iron') {
    P.add(softBox(0.16, 0.66 + tall, 0.18, 0.03), PALETTE.stone, { at: [x, 0, 0] });
    P.add(softBox(0.2, 0.05, 0.22, 0.02), shade(PALETTE.stone, 0.08), { at: [x, 0.66 + tall, 0] });
    P.add(sphere(0.05, 10, 7), color, { at: [x, 0.74 + tall, 0] });
  }
}

/** A dry-stone wall run: two courses of soft blocks with lighter capstones. */
function stoneRun(P, R, color, x0, x1) {
  const len = x1 - x0;
  for (let k = 0; k < 2; k++) {
    let x = x0;
    const h = 0.2;
    if (k === 1) x += R.float(0.08, 0.16);
    else x += 0.0;
    const first = k === 1 ? x - x0 : 0;
    if (first > 0.04) P.add(softBox(first - 0.012, h - 0.012, 0.3, 0.04), shade(color, R.float(-0.1, 0.04)), { at: [x0 + first / 2, k * h, R.float(-0.01, 0.01)] });
    while (x < x1 - 0.01) {
      const bl = Math.min(R.float(0.26, 0.42), x1 - x);
      P.add(softBox(bl - 0.012, h - 0.012, 0.3 + R.float(-0.02, 0.02), 0.045), shade(color, R.float(-0.1, 0.05)), { at: [x + bl / 2, k * h, R.float(-0.012, 0.012)], rot: [0, R.float(-0.03, 0.03), 0] });
      x += bl;
    }
  }
  let x = x0;
  while (x < x1 - 0.01) {
    const bl = Math.min(R.float(0.34, 0.5), x1 - x);
    P.add(softBox(bl - 0.01, 0.07, 0.36, 0.03), shade(color, R.float(0.04, 0.1)), { at: [x + bl / 2, 0.4, 0] });
    x += bl;
  }
}

function fenceGate(P, R, style, color, gw) {
  const leaf = style === 'stone' ? 'picket' : style;
  const c = style === 'stone' ? '#c08a55' : color;
  const x0 = -gw / 2 + 0.07, x1 = gw / 2 - 0.07;
  if (leaf === 'picket') {
    for (const y of [0.12, 0.38]) P.add(softBox(x1 - x0, 0.055, 0.03, 0.01), shade(c, -0.06), { at: [0, y, -0.032] });
    plank(P, [x0 + 0.03, 0.15, -0.032], [x1 - 0.03, 0.4, -0.032], 0.03, 0.05, shade(c, -0.06), { up: [0, 0, 1] });
    fenceSection(P, R, 'picket', c, x0, x1, { arch: (x) => 0.18 * (1 - (x / (gw / 2)) ** 2) });
  } else if (leaf === 'rail') {
    for (const y of [0.15, 0.32, 0.49]) P.add(softBox(x1 - x0, 0.06, 0.045, 0.015), shade(c, -0.03), { at: [0, y, 0.05] });
    for (const x of [x0 + 0.03, x1 - 0.03]) P.add(softBox(0.06, 0.48, 0.045, 0.015), shade(c, -0.06), { at: [x, 0.1, 0.05] });
    plank(P, [x0 + 0.05, 0.18, 0.075], [x1 - 0.05, 0.5, 0.075], 0.04, 0.055, shade(c, -0.08), { up: [0, 0, 1] });
  } else {
    for (const y of [0.1, 0.45]) P.add(softBox(x1 - x0, 0.03, 0.03, 0.01), c, { at: [0, y, 0] });
    P.add(arcTube((x1 - x0) / 2, 0.016, 0, Math.PI, { radial: 5, segments: 16 }), c, { at: [0, 0.45, 0], scale: [1, 0.45, 1] });
    const n = Math.round((x1 - x0) / 0.09);
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * ((x1 - x0) / n);
      const top = 0.45 + 0.45 * Math.sqrt(Math.max(0, ((x1 - x0) / 2) ** 2 - x * x));
      P.add(cyl(0.011, top - 0.1, { segments: 6 }), c, { at: [x, 0.1, 0] });
    }
    P.add(ring(0.06, 0.012, { radial: 4, tubular: 14 }), PALETTE.gold, { at: [0, 0.3, 0.02], rot: [Math.PI / 2, 0, 0] });
  }
  for (const x of [x0 - 0.01, x1 + 0.01]) for (const y of [0.15, 0.4]) P.add(softBox(0.05, 0.03, 0.05, 0.008), PALETTE.iron, { at: [x, y, 0.0] });
}

function buildFence(p, ctx) {
  const L = size(p.length, 3, 0.6, 12);
  const style = oneOf(p.style, FENCE_STYLES, 'picket');
  const color = colorOr(p.color, FENCE_COLOR[style]);
  const gate = flag(p.gate, false) && L >= 1.7;
  const R = rand(ctx, 'fence');
  const P = new Parts();
  const gw = 0.94;
  const runs = gate ? [[-L / 2, -gw / 2], [gw / 2, L / 2]] : [[-L / 2, L / 2]];
  for (const [a, b] of runs) {
    if (style === 'stone') {
      const pillarAt = (x) => {
        P.add(softBox(0.36, 0.56, 0.4, 0.05), shade(color, -0.04), { at: [x, 0, 0] });
        P.add(softBox(0.42, 0.07, 0.46, 0.03), shade(color, 0.09), { at: [x, 0.56, 0] });
      };
      const inner = [gate && a > 0 ? a + 0.18 : a, gate && b < 0 ? b - 0.18 : b];
      if (inner[1] - inner[0] > 0.05) stoneRun(P, R, color, inner[0], inner[1]);
      if (gate) pillarAt(a > 0 ? a : b);
      continue;
    }
    const n = Math.max(1, Math.round((b - a) / 0.6));
    for (let i = 0; i < n; i++) fenceSection(P, R, style, color, a + (i * (b - a)) / n, a + ((i + 1) * (b - a)) / n);
    for (let i = 0; i <= n; i++) {
      const x = a + (i * (b - a)) / n;
      const atGate = gate && ((i === n && b < 0) || (i === 0 && a > 0));
      fencePost(P, R, style, color, x, { tall: atGate ? 0.12 : 0 });
    }
  }
  if (gate) fenceGate(P, R, style, color, style === 'stone' ? gw - 0.36 : gw);
  const spots = {
    front: spot([gate ? -L / 4 - gw / 4 : 0, 0, 0.55], 180, 'stand'),
    back: spot([gate ? L / 4 + gw / 4 : 0, 0, -0.55], 0, 'stand'),
    lean: spot([gate ? L / 4 + gw / 4 : -Math.min(L / 4, 0.8), 0, style === 'stone' ? 0.36 : 0.24], 0, 'lean'),
  };
  if (gate) { spots.gate = spot([0, 0, 0.55], 180, 'stand'); spots['gate-back'] = spot([0, 0, -0.55], 0, 'stand'); }
  return finish(P.build('fence'), { footprint: { w: L + 0.1, d: style === 'stone' ? 0.46 : 0.26 }, spots });
}

/* ───────────────────────── catalog ───────────────────────── */

export const VILLAGE = {
  bench: {
    label: 'Bench',
    about: 'A park bench with chunky wooden slats on cast-iron legs, with or without a backrest. Two seats facing its front (a third in the middle when it is long).',
    params: {
      length: { default: 1.3, min: 0.8, max: 2.4, about: 'seat length' },
      wood: { default: PALETTE.wood, type: 'color', about: 'slat color' },
      frame: { default: PALETTE.iron, type: 'color', about: 'leg and armrest color' },
      back: { default: true, about: 'with a backrest and armrests' },
    },
    examples: [{}, { back: false, length: 1.0 }, { wood: PALETTE.woodRed, frame: PALETTE.woodDark }, { length: 2.1, wood: '#e6c48f', frame: '#2f6a5a' }],
    build: buildBench,
  },

  lamp: {
    label: 'Lamp post',
    about: 'A cast-iron street lamp with a glass lantern that lights up at dusk.',
    params: {
      height: { default: SCALE.lamp, min: 1.4, max: 3.4, about: 'height to the top of the lantern' },
      color: { default: PALETTE.iron, type: 'color', about: 'post color' },
      lit: { default: 'night', options: ['night', 'always', 'never'], about: 'when it glows' },
    },
    examples: [{}, { height: 1.8, color: PALETTE.woodDark }, { color: '#2f6a5a' }, { lit: 'always', color: '#7d4f8f' }],
    build: buildLamp,
  },

  fountain: {
    label: 'Fountain',
    about: 'A round stone fountain: a basin with a wide rim to sit on and tiered bowls spilling animated water. Rim seats face outward; stand spots at the diagonals face the water.',
    params: {
      size: { default: 1, min: 0.6, max: 2, about: 'basin size (1 is about 3 wide)' },
      tiers: { default: 2, min: 0, max: 3, about: 'bowls stacked above the basin (0 is a basin with a spout)' },
      water: { default: 'running', options: ['running', 'still', 'frozen', 'dry'], about: 'running water, a still pool, ice with icicles, or empty' },
      stone: { default: PALETTE.stone, type: 'color', about: 'stone color' },
    },
    examples: [{}, { tiers: 3, size: 1.3 }, { size: 0.7, tiers: 0 }, { tiers: 1, water: 'still' }, { water: 'frozen' }, { water: 'dry', stone: '#c9b8a0' }],
    build: buildFountain,
  },

  well: {
    label: 'Well',
    about: 'A round stone well with a little gabled wooden roof, a crank and a bucket on its rope.',
    params: {
      roof: { default: PALETTE.roofRed, type: 'color', about: 'roof color' },
      stone: { default: PALETTE.stone, type: 'color', about: 'stone color' },
      wood: { default: PALETTE.wood, type: 'color', about: 'post and beam color' },
      bucket: { default: true, about: 'a bucket hanging on the rope' },
    },
    examples: [{}, { roof: PALETTE.roofBlue }, { roof: PALETTE.thatch, stone: '#b9ab98', bucket: false }],
    build: buildWell,
  },

  stall: {
    label: 'Market stall',
    about: 'A wooden market stall with a striped scalloped awning, a little lantern and goods on the counter. The vendor stands behind it, customers in front.',
    params: {
      color: { default: PALETTE.cloth.red, type: 'color', about: 'awning stripe color' },
      goods: { default: 'fruit', options: GOODS, about: 'what is for sale' },
      width: { default: 1.7, min: 1.1, max: 2.8, about: 'counter width' },
      sign: { default: '', about: 'text on a sign above the awning (empty for none)' },
      wood: { default: PALETTE.wood, type: 'color', about: 'wood color' },
    },
    examples: [{}, { goods: 'fish', color: PALETTE.cloth.blue }, { goods: 'flowers', color: PALETTE.cloth.pink }, { goods: 'bread', color: PALETTE.cloth.yellow, sign: 'Bakery' },
      { goods: 'pottery', color: PALETTE.cloth.teal }, { goods: 'toys', color: PALETTE.cloth.purple, width: 2.2 }, { goods: 'none', color: PALETTE.cloth.green, width: 1.3 }],
    build: buildStall,
  },

  crate: {
    label: 'Crate',
    about: 'A sturdy wooden crate, closed or open with produce, alone or in a little stack. Sit on a closed one.',
    params: {
      size: { default: 0.4, min: 0.25, max: 0.8, about: 'edge length' },
      count: { default: 1, min: 1, max: 4, about: 'how many, stacked' },
      contents: { default: 'closed', options: CRATE_FILL, about: 'a lid, or what is inside' },
      color: { default: '#c99a62', type: 'color', about: 'wood color' },
    },
    examples: [{}, { contents: 'apples' }, { count: 3 }, { contents: 'cabbages', count: 2 }, { contents: 'fish', color: '#b9a48a' }, { count: 4, contents: 'oranges' }, { contents: 'straw', size: 0.5 }],
    build: buildCrate,
  },

  barrel: {
    label: 'Barrel',
    about: 'A wooden barrel with iron hoops: lidded, open, a rain barrel of water, or full of apples or fish. Up to three in a cluster.',
    params: {
      size: { default: 0.52, min: 0.3, max: 1.2, about: 'height' },
      count: { default: 1, min: 1, max: 3, about: 'how many' },
      contents: { default: 'closed', options: BARREL_FILL, about: 'a lid, or what is inside' },
      color: { default: '#b47f4c', type: 'color', about: 'wood color' },
      hoops: { default: '#5d636c', type: 'color', about: 'hoop color' },
    },
    examples: [{}, { contents: 'water' }, { contents: 'apples' }, { count: 3 }, { count: 2, contents: 'fish', color: '#9d7a5a' }],
    build: buildBarrel,
  },

  sack: {
    label: 'Sack',
    about: 'A plump burlap sack of flour or grain: tied at the neck, open with grain showing, or lying down (sandbags).',
    params: {
      style: { default: 'tied', options: SACK_STYLE, about: 'tied, open, or lying on its side' },
      count: { default: 1, min: 1, max: 3, about: 'how many' },
      color: { default: '#d9c18f', type: 'color', about: 'cloth color' },
    },
    examples: [{}, { style: 'open' }, { count: 3 }, { style: 'lying', count: 3 }, { color: '#c9b49a', count: 2 }],
    build: buildSack,
  },

  pot: {
    label: 'Flower pot',
    about: 'A terracotta pot with a plant: tulips, daisies, a rose bush, sunflowers, lavender, a fern or a little cactus.',
    params: {
      flower: { default: 'tulip', options: POT_PLANTS, about: 'what grows in it' },
      color: { default: '', type: 'color', about: 'bloom color (empty for the plant\'s own)' },
      pot: { default: '#c8714a', type: 'color', about: 'pot color' },
      size: { default: 1, min: 0.5, max: 2.5, about: 'scale' },
    },
    examples: [{}, { flower: 'daisy' }, { flower: 'rose', color: 'red' }, { flower: 'sunflower' }, { flower: 'lavender', pot: '#4f86c6' }, { flower: 'fern', pot: '#f1e3c8' }, { flower: 'cactus' }, { flower: 'tulip', color: 'yellow', size: 1.6 }],
    build: buildPot,
  },

  bucket: {
    label: 'Bucket',
    about: 'A wooden or tin bucket with a handle, holding water, apples, fish, flowers or sand.',
    params: {
      style: { default: 'wood', options: ['wood', 'tin'], about: 'material' },
      contents: { default: 'water', options: BUCKET_FILL, about: 'what is inside' },
      color: { default: '', type: 'color', about: 'body color (empty for the material\'s own)' },
    },
    examples: [{}, { style: 'tin', contents: 'empty' }, { contents: 'apples' }, { style: 'tin', contents: 'fish' }, { contents: 'flowers', style: 'tin', color: '#9fb7c9' }, { contents: 'sand', color: '#e9434c', style: 'tin' }],
    build: buildBucket,
  },

  basket: {
    label: 'Basket',
    about: 'A woven wicker basket with a handle, empty or heaped with produce.',
    params: {
      produce: { default: 'apples', options: PRODUCE, about: 'what is in it' },
      handle: { default: true, about: 'with a handle' },
      color: { default: '#c99a5b', type: 'color', about: 'wicker color' },
      size: { default: 1, min: 0.5, max: 2, about: 'scale' },
    },
    examples: [{}, { produce: 'berries' }, { produce: 'eggs' }, { produce: 'bread' }, { produce: 'flowers', handle: false }, { produce: 'veggies' }, { produce: 'mushrooms' }, { produce: 'none', color: '#d9b07a' }],
    build: buildBasket,
  },

  signpost: {
    label: 'Signpost',
    about: 'A wooden post with arrow boards pointing left and right, each with a place name painted on both sides.',
    params: {
      labels: { default: ['Village', 'Beach', 'Forest'], about: 'the names on the boards, top to bottom (up to 5)' },
      height: { default: 1.75, min: 1.2, max: 2.6, about: 'post height' },
      wood: { default: PALETTE.wood, type: 'color', about: 'post color' },
      board: { default: '#ecd3a0', type: 'color', about: 'board color' },
    },
    examples: [{}, { labels: ['Old Mill', 'Saltwind Pier', 'Whisperwood'] }, { labels: ['Town Hall', 'Market'], board: '#f2dfb8', wood: PALETTE.woodDark }, { labels: ['North', 'South', 'East', 'West'], height: 2.1 }],
    build: buildSignpost,
  },

  noticeboard: {
    label: 'Notice board',
    about: 'A bulletin board on two posts under a little roof, with pinned papers and a title plate.',
    params: {
      title: { default: 'Notices', about: 'text on the title plate (empty for none)' },
      papers: { default: 6, min: 0, max: 12, about: 'how many papers are pinned' },
      roof: { default: PALETTE.roofGreen, type: 'color', about: 'roof color' },
      wood: { default: PALETTE.wood, type: 'color', about: 'frame color' },
    },
    examples: [{}, { title: 'Village News', roof: PALETTE.roofRed, papers: 9 }, { title: '', papers: 3, roof: PALETTE.roofBlue }],
    build: buildNoticeboard,
  },

  mailbox: {
    label: 'Mailbox',
    about: 'A round-topped mailbox on a wooden post with a little flag (up when there is mail) and an optional name plate.',
    params: {
      color: { default: '#d9534a', type: 'color', about: 'box color' },
      flag: { default: true, about: 'flag up (there is mail)' },
      name: { default: '', about: 'name on a plate on the post' },
      post: { default: PALETTE.wood, type: 'color', about: 'post color' },
    },
    examples: [{}, { color: '#4f86c6', flag: false, name: 'Mira' }, { color: '#5aa56a', name: 'Biscuit' }, { color: '#f2c94c' }],
    build: buildMailbox,
  },

  fence: {
    label: 'Fence',
    about: 'A straight fence run along local X (centered): white pickets, a rustic rail fence, a dry-stone wall or wrought iron on a stone base, with an optional gate in the middle.',
    params: {
      length: { default: 3, min: 0.6, max: 12, about: 'run length (posts about every 0.6)' },
      style: { default: 'picket', options: FENCE_STYLES, about: 'look' },
      color: { default: '', type: 'color', about: 'paint or stone color (empty for the style\'s own)' },
      gate: { default: false, about: 'a gate in the middle (runs of 1.7 or longer)' },
    },
    examples: [{}, { style: 'rail' }, { style: 'stone' }, { style: 'iron' }, { gate: true, length: 4 }, { style: 'rail', gate: true, length: 4 }, { style: 'stone', gate: true, length: 4.2 }, { style: 'iron', gate: true, length: 4, color: '#2f6a5a' }],
    build: buildFence,
  },
};
