import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Parts, finish, spot, light, roundBox, box, roundCyl, cyl, cone, sphere, lathe, blob, tube, extrude, ring, xform, material,
  PALETTE, SEASONS, shade, mix, rng, noise3,
} from '../kit.js';

// Prop family: waterside. Docks, boats, buoys, lily pads, beach things, and the hand props
// (entries with `held: true`, kinds named "held-…"). See ../kit.js for the conventions.
//
// Things on the water (`floats: true`) have their origin at the waterline; the scene puts them
// on the water level (y = -0.3 in world terms). The dock's origin is its shore end, on the bank.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

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
function flag(v, d) {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === 0 || v === 'false' || v === 'no' || v === 'off') return false;
  return d;
}
function oneOf(v, options, d) {
  if (typeof v !== 'string') return d;
  const s = v.trim().toLowerCase();
  return options.includes(s) ? s : d;
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Friendly color names, in the family's soft saturated tones. */
const NAMED = {
  red: '#e0574c', coral: '#f07a5f', orange: '#f0913f', yellow: '#f5cb4a', lemon: '#f7e07a', green: '#5fae63',
  mint: '#7fd0a6', teal: '#3fa6a2', blue: '#4f8fd0', sky: '#7cbbe6', navy: '#3d5e9e', purple: '#9a76cc',
  lilac: '#bfa0e6', pink: '#f29cbc', rose: '#e8728f', white: '#f6f1e7', cream: '#f4e7cc', brown: '#9a6a44',
  black: '#4a4550', grey: '#a9a49b', gray: '#a9a49b', gold: '#e0b04a',
};
function colorOr(v, d) {
  if (typeof v !== 'string') return d;
  const s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  if (HEX.test(s)) return s;
  return d;
}
const seasonOf = (ctx) => (SEASONS.includes(ctx?.season) ? ctx.season : 'summer');
/** A seeded random stream for one aspect of a prop, stable across seasons and params. */
const rand = (ctx, tag) => rng(`${ctx?.seed ?? 0}:${tag}`);
/** A phase in [0, 2π) for animations, so a row of boats doesn't bob in unison. */
const phaseOf = (ctx, tag = 'phase') => rand(ctx, tag).float(0, TAU);

/* ───────────────────────── painting ───────────────────────── */

const C = (c) => new THREE.Color(c);
const colorOf = (look) => (look && typeof look === 'object' ? look.color : look);
function matOf(look) {
  if (look?.isMaterial) return look;
  if (look && typeof look === 'object') {
    const { slot = 'solid', color, ...rest } = look; // eslint-disable-line no-unused-vars
    return material(slot, rest);
  }
  return material('solid');
}

/**
 * Add a piece and paint it: `painter(color, x, y, z, nx, ny, nz, index)` gets the look's color
 * and a point in the piece's own space (before `at/rot/scale/matrix`) and changes the color.
 * With `perFace` whole triangles take one color (crisp stripes and bands) and `index` is the
 * triangle's index in the geometry's own order; otherwise it is the vertex index.
 */
function addPainted(parts, geometry, look, opts, painter, perFace = false) {
  parts.add(geometry, look, opts);
  const list = parts.slots.get(matOf(look).uuid).geometries;
  const g = list[list.length - 1];
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  const m = opts?.matrix ?? ((opts?.at || opts?.rot || opts?.scale !== undefined) ? xform(opts.at, opts.rot, opts.scale ?? 1) : null);
  const inv = m ? m.clone().invert() : null;
  const nm = m ? new THREE.Matrix3().getNormalMatrix(inv) : null;
  const base = C(colorOf(look) ?? '#ffffff');
  const c = new THREE.Color();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const step = perFace ? 3 : 1;
  for (let i = 0; i < pos.count; i += step) {
    if (perFace) {
      p.set(0, 0, 0); n.set(0, 0, 0);
      for (let k = 0; k < 3; k++) {
        p.x += pos.getX(i + k) / 3; p.y += pos.getY(i + k) / 3; p.z += pos.getZ(i + k) / 3;
        n.x += nor.getX(i + k); n.y += nor.getY(i + k); n.z += nor.getZ(i + k);
      }
    } else {
      p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    if (inv) { p.applyMatrix4(inv); n.applyMatrix3(nm); }
    n.normalize();
    c.copy(base);
    painter(c, p.x, p.y, p.z, n.x, n.y, n.z, perFace ? i / 3 : i);
    for (let k = 0; k < step; k++) col.setXYZ(i + k, c.r, c.g, c.b);
  }
  return g;
}

/* ───────────────────────── geometry ───────────────────────── */

/**
 * A surface through rows of points (all rows the same length): triangles between neighbouring
 * rows. `wrap` rows are closed loops whose last point repeats the first (smooth seam).
 */
function loft(rows, { flip = false, wrap = false } = {}) {
  const n = rows.length, m = rows[0].length;
  const pos = new Float32Array(n * m * 3);
  rows.forEach((row, i) => row.forEach((p, j) => pos.set(p, (i * m + j) * 3)));
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = (i + 1) * m + j, c = a + 1, d = b + 1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (wrap) {
    const nor = g.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = i * m, b = i * m + m - 1;
      v.set(nor.getX(a) + nor.getX(b), nor.getY(a) + nor.getY(b), nor.getZ(a) + nor.getZ(b)).normalize();
      nor.setXYZ(a, v.x, v.y, v.z); nor.setXYZ(b, v.x, v.y, v.z);
    }
  }
  return g;
}

/** A tube along a smooth curve whose radius follows `radius(u)` (u 0…1), with rounded ends. */
function taper(points, radius, { segments = 16, radial = 10, caps = true, capScale = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(segments, false);
  const rows = [];
  const P = new THREE.Vector3();
  const rad = typeof radius === 'function' ? radius : (u) => lerp(radius[0], radius[1], u);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, P);
    const N = frames.normals[i], B = frames.binormals[i];
    const row = [];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const r = rad(u, j === radial ? 0 : a);
      row.push([P.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), P.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), P.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z)]);
    }
    rows.push(row);
  }
  const g = loft(rows, { wrap: true, flip: true });
  if (!caps) return g;
  const geos = [g.toNonIndexed()];
  for (const end of [0, 1]) {
    const r = rad(end, 0);
    curve.getPointAt(end, P);
    const T = curve.getTangentAt(end).multiplyScalar(end ? 1 : -1);
    const cap = new THREE.SphereGeometry(r, radial, 4, 0, TAU, 0, Math.PI / 2);
    cap.scale(1, capScale, 1);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), T));
    cap.translate(P.x, P.y, P.z);
    geos.push(cap.toNonIndexed());
  }
  return mergeAll(geos);
}

/** Merge plain geometries (positions and normals only). */
function mergeAll(geos0) {
  const geos = geos0.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Push every vertex out from the Y axis by `amp * noise` (lumpy stones). */
function lumpy(g, { amp = 0.04, freq = 3, seed = 0 } = {}) {
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const o = (seed % 97) * 1.37;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = noise3(v.x * freq + o, v.y * freq - o, v.z * freq + o * 0.5);
    const d = Math.hypot(v.x, v.z) || 1;
    pos.setXYZ(i, v.x + (v.x / d) * amp * n, v.y, v.z + (v.z / d) * amp * n);
  }
  g.computeVertexNormals();
  return g;
}

/** Weld a geometry's seams (lathes, spheres) so it shades smoothly. */
function weld(g) {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-5);
  w.computeVertexNormals();
  return w;
}

/** Move the meshes of a built Parts group into `target`. */
function adopt(target, group) {
  for (const child of [...group.children]) target.add(child);
  return target;
}

/* ───────────────────────── shapes ───────────────────────── */

/** A cylinder from point a to point b (a stick, a pole, a rail). */
function stick(a, b, r, { top = r, segments = 8, bevel = null } = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = roundCyl(r, d.length(), { top, bevel: bevel ?? Math.min(r, top) * 0.45, segments, steps: 1 });
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}

/**
 * A board along X with a rounded-rectangle section (h tall, d deep), standing on y = 0 and
 * centered in X and Z, with flat sawn ends: planks, boards, beams and seats at about a third of
 * a roundBox's triangles (44 with steps 2, 28 with steps 1).
 */
function bar(len, h, d, r = 0.015, steps = 2) {
  const rr = Math.max(0.0005, Math.min(r, h / 2 - 1e-4, d / 2 - 1e-4));
  // the section in (z, y), counter-clockwise from the bottom of the +Z side, with outward normals
  const sec = [];
  for (const [cz, cy, a0] of [[d / 2 - rr, h - rr, 0], [-d / 2 + rr, h - rr, Math.PI / 2], [-d / 2 + rr, rr, Math.PI], [d / 2 - rr, rr, 1.5 * Math.PI]]) {
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (k / steps) * (Math.PI / 2);
      sec.push([cz + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.cos(a), Math.sin(a)]);
    }
  }
  const n = sec.length, x0 = -len / 2, x1 = len / 2;
  const pos = [], nor = [];
  const vert = (x, [z, y], nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); };
  for (let i = 0; i < n; i++) {
    const a = sec[i], b = sec[(i + 1) % n];
    // side quad (a, b) from x0 to x1, wound to face out
    vert(x0, a, 0, a[3], a[2]); vert(x1, b, 0, b[3], b[2]); vert(x0, b, 0, b[3], b[2]);
    vert(x0, a, 0, a[3], a[2]); vert(x1, a, 0, a[3], a[2]); vert(x1, b, 0, b[3], b[2]);
  }
  for (let i = 1; i < n - 1; i++) {
    // end caps: fans from the first point (the section is convex)
    vert(x1, sec[0], 1, 0, 0); vert(x1, sec[i + 1], 1, 0, 0); vert(x1, sec[i], 1, 0, 0);
    vert(x0, sec[0], -1, 0, 0); vert(x0, sec[i], -1, 0, 0); vert(x0, sec[i + 1], -1, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** A flower cup: soft petals round a center, opening upward (double-sided look needed). */
function petalCup(r, h, petals = 8, { rows = 4, per = 4, open = 1, tipLift = 0.35, phase = 0 } = {}) {
  const cols = petals * per;
  const out = [];
  for (let i = 0; i <= rows; i++) {
    const f = Math.max(i / rows, 0.02);
    const row = [];
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU + phase;
      const lobe = Math.pow(Math.abs(Math.cos((petals * (a - phase)) / 2)), 0.6);
      const rr = r * Math.pow(f, 0.85) * (0.4 + 0.6 * lobe);
      const y = h * (Math.pow(f, 1.3) * (1 - 0.4 * open) + tipLift * f * f * lobe);
      row.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
    }
    out.push(row);
  }
  return loft(out, { wrap: true, flip: true });
}

/** A lily pad: a flat disc with a notch, lying on y = 0. */
function padGeo(r, notch = 0.5, seg = 14) {
  const pts = [[0, 0]];
  for (let i = 0; i <= seg; i++) {
    const a = notch / 2 + (i / seg) * (TAU - notch);
    const k = 1 + 0.03 * Math.sin(a * 5);
    pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
  }
  const g = extrude(pts, 0.008, { bevel: 0.005, bevelSegments: 1, curveSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.009, 0);
  return g;
}

/** A starfish with soft round arms, lying on y = 0. */
function starGeo(R = 0.13, r0 = 0.055, h = 0.034, arms = 5, per = 6) {
  const n = arms * per;
  const center = [], mid = [], rim = [];
  for (let j = 0; j <= n; j++) {
    const a = (j / n) * TAU;
    const k = Math.pow(0.5 + 0.5 * Math.cos(arms * a), 0.8);
    const rr = r0 + (R - r0) * k;
    center.push([0, h, 0]);
    mid.push([Math.cos(a) * rr * 0.55, h * (0.62 + 0.3 * k), Math.sin(a) * rr * 0.55]);
    rim.push([Math.cos(a) * rr, 0.003, Math.sin(a) * rr]);
  }
  return loft([center, mid, rim], { wrap: true, flip: true });
}

/** A scallop shell: a ribbed dome-fan with its hinge at the back (-Z), lying on y = 0. */
function scallopGeo(R = 0.12, H = 0.045, ribs = 7) {
  const nT = 14, nR = 3;
  const rows = [];
  for (let i = 0; i <= nR; i++) {
    const f = i / nR;
    const row = [];
    for (let j = 0; j <= nT; j++) {
      const th = -1.15 + (2.3 * j) / nT;
      const rib = Math.cos((j / nT) * ribs * TAU) * 0.5 + 0.5;
      const rr = R * (0.08 + 0.92 * f) * (1 + 0.07 * rib * f);
      const side = Math.pow(Math.max(0, Math.cos((th / 1.15) * (Math.PI / 2))), 0.45);
      const y = H * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + f * 0.88)), 0.7) * side * (0.75 + 0.25 * rib) + 0.003;
      row.push([Math.sin(th) * rr, y, -R * 0.45 + Math.cos(th) * rr]);
    }
    rows.push(row);
  }
  return loft(rows);
}

/** A spiral sea shell (a whelk): a fat body whorl and a stepped spire, lying on its side along X. */
function whelkGeo(L = 0.19, R = 0.055) {
  const prof = [[0.08, 0], [0.62, 0.09], [1, 0.3], [0.8, 0.45], [0.72, 0.56], [0.5, 0.64], [0.44, 0.74], [0.27, 0.82], [0.18, 0.9], [0, 0.98]];
  const rows = [];
  const radial = 9;
  prof.forEach(([rr, yy]) => {
    const row = [];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      row.push([Math.cos(a) * rr * R, yy * L, Math.sin(a) * rr * R]);
    }
    rows.push(row);
  });
  const g = loft(rows, { wrap: true });
  g.rotateZ(-Math.PI / 2 + 0.1);
  g.translate(-L * 0.42, R * 0.95, 0);
  return g;
}

/** A water lily: three rings of soft spoon-shaped petals round a golden heart. */
function addLily(parts, at, color, { scale = 1, bud = false } = {}) {
  const [cx, cy, cz] = at;
  const deep = shade(color, -0.08, { sat: 0.06 }), tip = shade(color, 0.1);
  const look = { slot: 'solid', color };
  const petal = new THREE.SphereGeometry(1, 6, 4);
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const ringOf = (n, len, wid, tilt, off, lift) => {
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * TAU;
      const d = new THREE.Vector3(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt));
      q.setFromEuler(e.set(-tilt, Math.PI / 2 - a, 0, 'YXZ'));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy + lift * scale, cz).addScaledVector(d, len * 0.9 * scale), q, new THREE.Vector3(wid * scale, 0.013 * scale, len * scale));
      addPainted(parts, petal, look, { matrix: m }, (c, x, y, z) => { c.copy(C(deep)).lerp(C(tip), clamp((z + 1) / 2, 0, 1)); });
    }
  };
  if (bud) {
    ringOf(5, 0.05, 0.026, 1.25, 0, 0.0);
    parts.add(sphere(0.03, 8, 6), { slot: 'foliage', color: '#6fae55' }, { at: [cx, cy + 0.012 * scale, cz], scale: [scale, scale * 0.6, scale] });
    return;
  }
  ringOf(8, 0.075, 0.034, 0.22, 0, 0.0);
  ringOf(7, 0.062, 0.031, 0.62, Math.PI / 7, 0.012);
  ringOf(4, 0.045, 0.026, 1.05, 0.3, 0.024);
  parts.add(sphere(0.026, 8, 5), '#f4c542', { at: [cx, cy + 0.04 * scale, cz], scale: [scale, scale * 0.55, scale] });
}

/* ───────────────────────── boats ───────────────────────── */

/**
 * A boat hull from stations along its length (t 0 = stern, 1 = bow). Returns the outer and inner
 * shells, the rim between them and helpers for fitting seats and rails. Stations crowd toward
 * the bow, where the hull curves most.
 */
function hullModel({ L = 2, B = 0.42, D = 0.14, sheer = 0.24, bowRise = 0.09, sternRise = 0.03, transom = 0.62, th = 0.035, fullness = 0.72, band = [0.012, 0.048], N = 16, MI = 11 } = {}) {
  const half = (t) => (t < 0.45
    ? B * (transom + (1 - transom) * Math.sin((t / 0.45) * (Math.PI / 2)))
    : B * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.45) / 0.55, 2.2))));
  const keelY = (t) => -D + (D * 0.9 + bowRise * 0.6) * Math.pow(smooth(0.52, 1, t), 1.5) + D * 0.35 * (1 - smooth(0, 0.42, t));
  const topY = (t) => sheer + bowRise * Math.pow(smooth(0.42, 1, t), 1.6) + sternRise * (1 - smooth(0, 0.5, t));
  const zOf = (t) => -L / 2 + t * L;
  const section = (b, yk, yt, s) => {
    const a = s * (Math.PI / 2);
    const sx = Math.sign(s) * Math.pow(Math.abs(Math.sin(a)), fullness);
    return [-b * sx, yk + (yt - yk) * (1 - Math.cos(a))];
  };
  /** Where height y falls on a section (0 keel … 1 gunwale), as the section parameter s. */
  const sOf = (y, yk, yt) => (2 / Math.PI) * Math.acos(1 - clamp((y - yk) / Math.max(1e-4, yt - yk), 0, 1));
  // Outer columns per half, gunwale to keel, with rows on the edges of the painted band so the
  // stripe is crisp: kTop segments above the band, one for the band, kBot below it.
  const kTop = 3, kBot = 3;
  const halfCols = (yk, yt) => {
    const sB = sOf(band[1], yk, yt), sA = Math.min(sOf(band[0], yk, yt), sB);
    const out = [];
    for (let k = 0; k < kTop; k++) out.push(lerp(1, sB, k / kTop));
    out.push(sB, sA);
    for (let k = 1; k <= kBot; k++) out.push(lerp(sA, 0, k / kBot));
    return out;
  };
  const innerKeel = (t) => Math.min(keelY(t) + th, topY(t) - 0.01);
  const outer = [], inner = [], rimL = [], rimR = [];
  let M = 0;
  for (let i = 0; i <= N; i++) {
    const t = 1 - Math.pow(1 - i / N, 1.3), z = zOf(t);
    const b = half(t), yk = keelY(t), yt = topY(t);
    const bi = Math.max(0.002, b - th), yki = innerKeel(t);
    const hc = halfCols(yk, yt);
    const cols = [...hc.map((v) => -v), ...hc.slice(0, -1).reverse()];
    M = cols.length;
    const ro = cols.map((s) => { const [x, y] = section(b, yk, yt, s); return [x, y, z]; });
    const ri = [];
    for (let j = 0; j < MI; j++) {
      const s = -1 + (2 * j) / (MI - 1);
      const [xi, yi] = section(bi, yki, yt, s);
      ri.push([xi, yi, z]);
    }
    outer.push(ro); inner.push(ri);
    rimL.push([ro[0], ri[0]]);
    rimR.push([ro[M - 1], ri[MI - 1]]);
  }
  const outerGeo = loft(outer);
  const innerGeo = loft(inner, { flip: true });
  const rimGeo = mergeAll([loft(rimL, { flip: true }), loft(rimR)]);
  /** Which band a face of the outer shell is in: 0 topsides, 1 stripe, 2 bottom. */
  const bandOfFace = (f) => {
    let j = Math.floor(f / 2) % (M - 1);
    if (j >= M - 1 - j) j = M - 2 - j;
    return j < kTop ? 0 : j === kTop ? 1 : 2;
  };
  /** Half-width of the inside at height y, station t. */
  const insideHalf = (t, y) => {
    const b = Math.max(0.002, half(t) - th), yk = innerKeel(t), yt = topY(t);
    return b * Math.pow(Math.sin(sOf(y, yk, yt) * (Math.PI / 2)), fullness);
  };
  /** Half-width of the outside at height y, station t. */
  const outsideHalf = (t, y) => half(t) * Math.pow(Math.sin(sOf(y, keelY(t), topY(t)) * (Math.PI / 2)), fullness);
  /**
   * A flat lid across the inside at height y, reaching halfway into the hull walls: drawn
   * depth-only (see WATERLINE), it keeps a translucent water plane out of the hull.
   */
  const lidGeo = (y, t0 = 0, t1 = 0.9, n = 12) => {
    const rows = [];
    for (let i = 0; i <= n; i++) {
      const t = lerp(t0, t1, i / n);
      const w = Math.max(0.002, (insideHalf(t, y) + outsideHalf(t, y)) / 2);
      rows.push([[-w, y, zOf(t)], [w, y, zOf(t)]]);
    }
    return loft(rows);
  };
  const transomOutline = [];
  for (let j = 0; j < MI; j++) {
    const s = -1 + (2 * j) / (MI - 1);
    transomOutline.push(section(half(0), keelY(0), topY(0), s));
  }
  return { L, B, half, keelY, topY, zOf, insideHalf, outsideHalf, lidGeo, outerGeo, innerGeo, rimGeo, transomOutline, th, bandOfFace };
}

/**
 * The waterline lid's material: writes depth but no color, drawn after the opaque hull and its
 * riders (renderOrder 1) and before the scene's water (transparent, renderOrder 2), so the water
 * plane never shows inside a floating hull. Casts no shadow.
 */
const WATERLINE = new THREE.MeshBasicMaterial({ name: 'waterline-lid', colorWrite: false, side: THREE.DoubleSide });
WATERLINE.userData.slot = 'waterline';
WATERLINE.userData.castShadow = false;

/** Height of the lid above the waterline: clears the gentle bob of a crewed hull. */
const LID_Y = 0.04;

/** After `parts.build`, draw the waterline lid between the opaque pass and the water. */
function orderLid(group) {
  group.traverse((o) => {
    if (o.isMesh && o.material === WATERLINE) { o.renderOrder = 1; o.receiveShadow = false; }
  });
  return group;
}

/** The first station toward the bow where the keel line rises to height y. */
function keelRiseT(h, y) {
  let t = 0.6;
  while (t < 1 && h.keelY(t) < y) t += 0.005;
  return Math.min(t, 0.98);
}

/** The hull pieces of a boat into `parts`: shell, rim, rails, stem, keel, transom, bow deck, ribs. */
function addHull(parts, h, { hull, bottom, stripe, rail, inside, weathered = false, ribs = [0.3, 0.64] }) {
  // a wreck's paint is faded and patchy: painted per vertex, so its bands go soft
  const grime = (c, x, y, z) => {
    const n = noise3(x * 4, y * 6, z * 2.2 + 1.3) * 0.7 + noise3(x * 13, y * 15, z * 9 + 4.1) * 0.3;
    c.lerp(C('#a49e93'), clamp(0.3 + n * 1.4, 0.05, 0.85));
    if (y < 0.07 && y > -0.06) c.lerp(C('#5f7a52'), clamp(0.3 + noise3(z * 9, x * 9, 7.7), 0, 0.55) * (1 - Math.abs(y - 0.005) / 0.065));
  };
  if (weathered) {
    addPainted(parts, h.outerGeo, hull, undefined, (c, x, y, z) => {
      if (y < 0.0) c.set(bottom);
      grime(c, x, y, z);
    });
  } else {
    addPainted(parts, h.outerGeo, hull, undefined, (c, x, y, z, nx, ny, nz, f) => {
      const band = h.bandOfFace(f);
      if (band === 2) c.set(bottom);
      else if (band === 1) c.set(stripe);
    }, true);
  }
  // the inside: darker toward the bottom
  addPainted(parts, h.innerGeo, inside, undefined, (c, x, y, z) => {
    c.offsetHSL(0, 0, clamp((y - 0.1) * 0.35, -0.07, 0.02));
    if (weathered) grime(c, x, y + 0.3, z);
  });
  parts.add(h.rimGeo, rail);
  // rub rails along the sheer, meeting at the bow
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * 0.985;
      pts.push([side * (h.half(t) + 0.004), h.topY(t) - 0.01, h.zOf(t)]);
    }
    parts.add(taper(pts, [0.024, 0.021], { segments: 11, radial: 5 }), rail);
  }
  // a little deck in the bow, between the rails
  const deck = [];
  for (let i = 0; i <= 5; i++) {
    const t = 0.86 + (0.14 * i) / 5;
    const hw = Math.max(0.002, h.half(t) - 0.004), y = h.topY(t) - 0.012;
    deck.push([[hw, y, h.zOf(t)], [0, y + 0.008, h.zOf(t)], [-hw, y, h.zOf(t)]]);
  }
  parts.add(loft(deck, { flip: true }), rail);
  // stem: a rounded post up the bow from the waterline; below it the keel strip, in the bottom
  // paint, runs on from the stern round the forefoot to meet it
  const tw = keelRiseT(h, -0.025);
  const stem = [];
  for (let i = 0; i <= 3; i++) {
    const t = lerp(tw, 1, i / 3);
    stem.push([0, h.keelY(t) - 0.004, h.zOf(t) + 0.003]);
  }
  stem.push([0, h.topY(1) - 0.004, h.zOf(1) + 0.006]);
  parts.add(taper(stem, [0.026, 0.026], { segments: 8, radial: 6 }), rail);
  const keel = [];
  for (let i = 0; i <= 8; i++) {
    const t = lerp(0.03, tw + 0.015, i / 8);
    keel.push([0, h.keelY(t) - 0.008, h.zOf(t)]);
  }
  parts.add(taper(keel, [0.022, 0.022], { segments: 9, radial: 5 }), bottom);
  // transom board (bare wood on its inner face) with a rail across its top
  const tg = extrude(h.transomOutline, 0.03, { bevel: 0.012, bevelSegments: 1, curveSegments: 4 });
  addPainted(parts, tg, weathered ? mix(hull, '#8f8a80', 0.4) : hull, { at: [0, 0, h.zOf(0) + 0.006] }, (c, x, y, z, nx, ny, nz) => {
    if (nz > 0.8) c.set(shade(inside, -0.03)).offsetHSL(0, 0, clamp((y - 0.1) * 0.35, -0.07, 0.02));
    if (weathered) grime(c, x, y, z);
  }, true);
  const hb = h.half(0) + 0.01, yt = h.topY(0) - 0.006;
  parts.add(taper([[hb, yt, h.zOf(0) + 0.006], [0, yt + 0.006, h.zOf(0) + 0.004], [-hb, yt, h.zOf(0) + 0.006]], [0.024, 0.024], { segments: 6, radial: 5 }), rail);
  // ribs inside
  for (const t of ribs) {
    const pts = [];
    for (let j = 0; j <= 8; j++) {
      const s = -1 + (2 * j) / 8;
      const y = lerp(h.topY(t) - 0.03, Math.min(h.keelY(t) + h.th, h.topY(t)) + 0.012, Math.cos(s * Math.PI / 2));
      const hw = h.insideHalf(t, y) - 0.008;
      pts.push([-Math.sign(s) * hw, y, h.zOf(t)]);
    }
    parts.add(taper(pts, [0.013, 0.013], { segments: 8, radial: 4, caps: false }), shade(inside, -0.1));
  }
}

/** One oar: shaft along +X from the handle (origin) with the blade (painted tip) at the far end. */
function oarParts(len = 1.05, wood = PALETTE.woodLight, tip = '#f4efe6', broken = false) {
  const p = new Parts();
  const L = broken ? len * 0.55 : len;
  p.add(roundCyl(0.017, L, { bevel: 0.008, segments: 6, steps: 1 }), wood, { rot: [0, 0, -Math.PI / 2] });
  p.add(roundCyl(0.024, 0.12, { bevel: 0.01, segments: 6, steps: 1 }), shade(wood, -0.08), { rot: [0, 0, -Math.PI / 2] });
  if (!broken) {
    p.add(bar(0.17, 0.016, 0.085, 0.008, 2), wood, { at: [len - 0.175, -0.008, 0] });
    p.add(bar(0.1, 0.018, 0.088, 0.009, 2), tip, { at: [len - 0.045, -0.009, 0] });
  } else {
    p.add(cone(0.02, 0.05, 6), shade(wood, 0.05), { at: [L, 0, 0], rot: [0, 0, -Math.PI / 2] });
  }
  return p;
}

/* ───────────────────────── bobbing ───────────────────────── */

/** A tick that bobs `group` on the water: heave, roll and pitch, phased per prop. */
function bobber(group, phase, { heave = 0.018, roll = 0.035, pitch = 0.02, speed = 1 } = {}) {
  return (t) => {
    const a = t * speed + phase;
    group.position.y = heave * Math.sin(a * 1.7) + heave * 0.4 * Math.sin(a * 2.9 + 1.1);
    group.rotation.z = roll * Math.sin(a * 1.3 + 0.4);
    group.rotation.x = pitch * Math.sin(a * 1.1 + 2.0);
  };
}

/**
 * The gentle bob of a hull with people aboard: small enough that riders placed on its static
 * spots don't visibly sink into or hover over their seats, and that the waterline lid stays
 * above the water (worst case about 0.03 at the ends of the hull).
 */
const CREWED = { heave: 0.008, roll: 0.016, pitch: 0.01 };

/* ───────────────────────── hand props ───────────────────────── */

// Hand props are modeled in a "hand frame": the origin is the middle of the fist, +Y is up,
// +Z is the holder's forward and +X points across the body (the holder's left). HOLD maps that
// frame into the right-hand socket (RightHand_End) as it is in the Idle pose; a tick then keeps
// the prop upright in the world (fully or partly) whatever the arm does, so umbrellas stay over
// the head, lanterns hang and cups don't spill while walking. In a left hand it is mirrored.

const GRIP = new THREE.Vector3(0.026, 0.008, 0); // the middle of the fist, in socket space
const GRIP_L = new THREE.Vector3(-GRIP.x, GRIP.y, GRIP.z);
const HOLD = (() => {
  const up = new THREE.Vector3(0.756, 0.648, 0.09).normalize();
  const fwd = new THREE.Vector3(-0.132, 0.015, 0.991);
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const x = new THREE.Vector3().crossVectors(up, fwd);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, fwd));
})();
const mirrorQ = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
const HOLD_L = mirrorQ(HOLD);

const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _qs = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

function rootBoneOf(o) {
  for (let a = o; a; a = a.parent) if (a.isBone && a.name === 'Root') return a;
  return null;
}

/**
 * Keep a hand prop upright. `upright` 0 holds it rigidly in the fist, 1 keeps its frame level
 * with the holder; `lean` is a fixed tilt (Euler [x, y, z] in the hand frame); `hang` makes it
 * a pendulum of that length (lanterns, baskets) that swings as the hand moves. `level` lists
 * children that always stay level (a flame, a fishing line). `extra(t, dt)` runs after.
 */
function holdTick(group, { upright = 1, lean = [0, 0, 0], hang = 0, level = [], extra = null } = {}) {
  const leanR = new THREE.Quaternion().setFromEuler(new THREE.Euler(...lean));
  const leanL = mirrorQ(leanR);
  group.position.copy(GRIP);
  group.quaternion.copy(HOLD).multiply(leanR);
  let socket = null, root = null, left = false;
  const pend = { x: 0, z: 0, vx: 0, vz: 0, last: new THREE.Vector3(), vel: new THREE.Vector3(), fresh: true };
  return (t, dt) => {
    const parent = group.parent;
    if (parent && parent !== socket) {
      socket = parent;
      root = rootBoneOf(parent);
      left = /left/i.test(parent.name);
      pend.fresh = true;
    }
    if (parent && root) {
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(_p, _qs, _s);
      root.getWorldQuaternion(_qf);
      // the rigid hold and the level hold, blended
      _qa.copy(_qs).multiply(left ? HOLD_L : HOLD);
      _qb.copy(_qf);
      if (upright < 1) _qb.slerp(_qa, 1 - upright);
      if (hang > 0) {
        // a damped pendulum driven by the hand's motion (in the holder's frame)
        const grip = _v1.copy(left ? GRIP_L : GRIP).applyMatrix4(parent.matrixWorld);
        if (pend.fresh) {
          pend.last.copy(grip); pend.vel.set(0, 0, 0); pend.fresh = false;
        } else if (dt > 0) {
          const h = Math.min(dt, 0.05);
          _v2.copy(grip).sub(pend.last).divideScalar(h);
          const acc = _v2.clone().sub(pend.vel).divideScalar(h).applyQuaternion(_qc.copy(_qf).invert());
          pend.vel.copy(_v2);
          pend.last.copy(grip);
          const w2 = 9.8 / hang;
          const ax = clamp(acc.x, -40, 40), az = clamp(acc.z, -40, 40);
          pend.vx += (-w2 * pend.x - ax / hang - 3 * pend.vx) * h;
          pend.vz += (-w2 * pend.z - az / hang - 3 * pend.vz) * h;
          pend.x = clamp(pend.x + pend.vx * h, -0.6, 0.6);
          pend.z = clamp(pend.z + pend.vz * h, -0.6, 0.6);
        }
        _qa.setFromUnitVectors(DOWN, _v1.set(Math.sin(pend.x), -1, Math.sin(pend.z)).normalize());
        _qb.premultiply(_qc.copy(_qf).invert()).premultiply(_qa).premultiply(_qf);
      }
      _qb.multiply(left ? leanL : leanR);
      group.quaternion.copy(_qs).invert().multiply(_qb);
      group.position.copy(left ? GRIP_L : GRIP);
      group.scale.set(left ? -1 : 1, 1, 1);
      // children that stay level: their parent's world rotation is _qb (and the group's own children)
      // (under a mirrored group the level rotation is mirrored too)
      for (const child of level) {
        child.parent.getWorldQuaternion(_qa);
        const q = child.quaternion.copy(_qa).invert().multiply(_qf);
        if (left) q.set(q.x, -q.y, -q.z, q.w);
      }
    }
    extra?.(t, dt);
  };
}

/** Common entry fields for a hand prop. */
const HELD = { held: true, hand: 'rightHand' };

/* ───────────────────────── the family ───────────────────────── */

const DOCK_WOODS = {
  natural: { deck: [PALETTE.woodLight, '#c99a63', '#dcb27c'], frame: PALETTE.wood, post: PALETTE.woodDark, cap: PALETTE.woodLight, trim: PALETTE.wood },
  weathered: { deck: ['#b9ae9c', '#a89d8b', '#c6bcaa'], frame: '#8f8574', post: '#6e6558', cap: '#c2b8a6', trim: '#9a9080' },
  painted: { deck: ['#e6dece', '#d9d2c2', '#e0d8c8'], frame: '#4f86c6', post: '#3f6fae', cap: '#e8e1d2', trim: '#4f86c6' },
};

export const WATERSIDE = {
  dock: {
    label: 'Dock',
    about: 'A wooden pier, budgeted as a structure (about 3k triangles at the default size, up to about 6k at length 12). Its origin is the shore end, on the bank; the deck runs toward +Z over the water at about 0.08 and its posts go down into the water (to about -1.25). Sit at the end with your legs over the edge (end; endLeft and endRight too on docks 1.3 or wider), sit on the side between two posts facing the water (side), or stand (along, shore, ladder). Like every footprint it is centered on the origin: it covers up to 3 units of bank and of near-shore deck, not the far end.',
    params: {
      length: { default: 4, min: 1.5, max: 12, about: 'how far the deck reaches out over the water' },
      width: { default: 1.4, min: 0.8, max: 3, about: 'deck width (1.3 or more seats three at the end)' },
      ladder: { default: true, about: 'a ladder down into the water near the end' },
      lamp: { default: false, about: 'a lantern post at the end that lights up at night' },
      style: { default: 'natural', options: ['natural', 'weathered', 'painted'], about: 'warm wood, sea-grey wood, or cream planks with blue trim' },
    },
    examples: [{}, { style: 'weathered', length: 2.6, ladder: false }, { style: 'painted', length: 5, width: 1.8, lamp: true }],
    build(p, ctx) {
      const L = size(p.length, 4, 1.5, 12), W = size(p.width, 1.4, 0.8, 3);
      const style = oneOf(p.style, ['natural', 'weathered', 'painted'], 'natural');
      const withLadder = flag(p.ladder, true), withLamp = flag(p.lamp, false);
      const pal = DOCK_WOODS[style];
      const r = rand(ctx, 'dock');
      const parts = new Parts();
      const top = 0.08, plankT = 0.05;
      const alongZ = [0, Math.PI / 2, 0];
      // planks across the deck
      const pitch = 0.205, n = Math.max(3, Math.round((L + 0.15) / pitch));
      const step = (L + 0.15) / n;
      for (let i = 0; i < n; i++) {
        const z = -0.15 + (i + 0.5) * step;
        const w = W + r.float(-0.03, 0.03);
        const col = shade(r.pick(pal.deck), r.float(-0.025, 0.025));
        parts.add(bar(w, plankT, step - 0.024, 0.014, 2), col, { at: [r.float(-0.012, 0.012), top - plankT, z], rot: [0, r.float(-0.012, 0.012), 0] });
      }
      // stringers under the planks and a darker fascia board down each side
      for (const s of [1, -1]) {
        parts.add(box(0.09, 0.11, L + 0.12), pal.frame, { at: [s * (W / 2 - 0.16), top - plankT - 0.11, L / 2 - 0.09] });
        parts.add(bar(L + 0.17, 0.11, 0.04, 0.016, 1), pal.trim, { at: [s * (W / 2 + 0.012), top - plankT - 0.085, L / 2 - 0.075], rot: alongZ });
      }
      // end board across the front
      parts.add(bar(W + 0.06, 0.11, 0.04, 0.016, 1), pal.trim, { at: [0, top - plankT - 0.085, L + 0.012] });
      // posts in pairs, sticking up as bollards with round caps; the last pair stands a little
      // back from the end, behind the end sitters
      const bays = Math.max(1, Math.round(L / (L > 6 ? 1.6 : 1.35)));
      const postZ = [];
      for (let i = 0; i <= bays; i++) postZ.push(lerp(0.25, L - 0.3, i / bays));
      const postGeo = lathe([[0.072, -1.25], [0.07, 0.19]], 8);
      const capGeo = lathe([[0.072, 0], [0.08, 0.012], [0.078, 0.034], [0.06, 0.052], [0, 0.056]], 8);
      for (const z of postZ) {
        for (const s of [1, -1]) {
          const x = s * (W / 2 + 0.06);
          parts.add(postGeo, pal.post, { at: [x, 0, z] });
          parts.add(capGeo, pal.cap, { at: [x, 0.185, z] });
        }
        // a cross beam under the deck between the pair
        parts.add(bar(W + 0.1, 0.07, 0.07, 0.02, 1), pal.frame, { at: [0, -0.16, z] });
      }
      // the shore end: a sturdy sill sunk into the bank and a step block resting on it
      parts.add(bar(W + 0.24, 0.16, 0.2, 0.03, 2), pal.post, { at: [0, top - plankT - 0.14, -0.06] });
      parts.add(bar(W * 0.62, 0.11, 0.24, 0.025, 2), pal.deck[1], { at: [0, -0.075, -0.37] });

      // spots: sitters at the end (0.5 apart, so heads don't touch), one on the side in the
      // middle of a bay (legs between the posts), and standing places
      const spots = { end: spot([0, top, L - 0.06], 0, 'sit') };
      if (W >= 1.3) {
        const ex = +Math.min(0.5, W / 2 - 0.2).toFixed(3);
        spots.endLeft = spot([ex, top, L - 0.06], 0, 'sit');
        spots.endRight = spot([-ex, top, L - 0.06], 0, 'sit');
      }
      let bay = 0;
      while (bay < postZ.length - 2 && postZ[bay + 1] < L * 0.55) bay++;
      const sideZ = +((postZ[bay] + postZ[bay + 1]) / 2).toFixed(3);
      spots.side = spot([-(W / 2 - 0.06), top, sideZ], -90, 'sit');
      spots.shore = spot([0, top, 0.25], 0, 'stand');

      // a ladder down into the water in the last bay on the +X side
      const ladderZ = withLadder ? (postZ[postZ.length - 1] + postZ[postZ.length - 2]) / 2 : null;
      if (withLadder) {
        const lx = W / 2 + 0.03, lz = ladderZ;
        const steel = { slot: 'metal', color: '#c9d0d6' };
        for (const dz of [-0.13, 0.13]) {
          parts.add(tube([[lx + 0.02, -0.75, lz + dz], [lx + 0.02, 0.05, lz + dz], [lx - 0.02, 0.27, lz + dz], [lx - 0.18, 0.3, lz + dz], [lx - 0.27, top + 0.01, lz + dz]], 0.018, { segments: 14, radial: 5 }), steel);
        }
        for (let i = 0; i < 4; i++) parts.add(bar(0.28, 0.025, 0.06, 0.01, 1), steel, { at: [lx + 0.03, -0.12 - i * 0.17, lz], rot: alongZ });
      }
      // standing mid-deck, nudged along the deck away from the other spots; then the top of the
      // ladder, if there is room left for it
      const room = (x, z) => Math.min(...Object.values(spots).map((sp) => Math.hypot(sp.at[0] - x, sp.at[2] - z)));
      let walkZ = L * 0.5, best = -1;
      for (const dz of [0, 0.3, -0.3, 0.6, -0.6]) {
        const z = L * 0.5 + dz;
        if (z < 0.25 || z > L - 0.3) continue;
        const d = room(0, z);
        if (d > 0.48) { walkZ = z; break; }
        if (d > best) { best = d; walkZ = z; }
      }
      spots.along = spot([0, top, +walkZ.toFixed(3)], 0, 'stand');
      if (withLadder && room(W / 2 - 0.3, ladderZ) > 0.45) spots.ladder = spot([+(W / 2 - 0.3).toFixed(3), top, +ladderZ.toFixed(3)], 90, 'stand');

      // a rope coiled by a cleat near the edge, clear of the sitters, the ladder and the walkway
      const free = (side, z) => z + 0.25 < L - 0.45 && z - 0.25 > 0.45
        && !(side < 0 && Math.abs(z - sideZ) < 0.5)
        && !(side > 0 && ladderZ != null && Math.abs(z - ladderZ) < 0.55)
        && postZ.every((pz) => Math.abs(z - pz) > 0.14)
        && (W >= 1.2 || Math.abs(z - L * 0.5) > 0.45);
      let coilAt = null;
      for (const side of [-1, 1]) {
        for (let z = L - 0.75; z > 0.6 && !coilAt; z -= 0.05) if (free(side, z)) coilAt = [side, z];
        if (coilAt) break;
      }
      if (coilAt) {
        const [side, zc] = coilAt;
        const rope = { slot: 'cloth', color: '#e9d6a7' };
        const iron = { slot: 'metal', color: '#a3aab3' };
        // the cleat: two rounded horns on a low base, along the edge
        const cx = side * (W / 2 - 0.08), cz = zc - 0.06;
        parts.add(roundBox(0.05, 0.03, 0.08, 0.012, 1), iron, { at: [cx, top - 0.002, cz] });
        parts.add(taper([[cx, top + 0.034, cz - 0.11], [cx, top + 0.044, cz - 0.05], [cx, top + 0.046, cz], [cx, top + 0.044, cz + 0.05], [cx, top + 0.034, cz + 0.11]], (u) => 0.011 + 0.007 * Math.sin(Math.PI * u), { segments: 8, radial: 6 }), iron);
        // the coil inboard of it, its outer turn starting on the cleat's side, and the tail
        const kx = side * (W / 2 - 0.3), kz = zc + 0.1, a0 = side < 0 ? Math.PI : 0;
        const coil = [];
        for (let i = 0; i <= 26; i++) {
          const a = a0 + (i / 26) * TAU * 2.6, rr = 0.11 - (i / 26) * 0.05;
          coil.push([kx + Math.cos(a) * rr, top + 0.018 + (i / 26) * 0.012, kz + Math.sin(a) * rr]);
        }
        parts.add(tube(coil, 0.017, { segments: 32, radial: 5 }), rope);
        parts.add(tube([[kx + side * 0.11, top + 0.018, kz], [cx - side * 0.04, top + 0.024, cz + 0.06], [cx, top + 0.05, cz + 0.015]], 0.016, { segments: 8, radial: 5 }), rope);
      }

      const lights = [];
      if (withLamp) {
        const x = W / 2 + 0.06, z = postZ[postZ.length - 1];
        parts.add(roundCyl(0.03, 0.95, { top: 0.026, bevel: 0.01, segments: 8, steps: 1 }), PALETTE.iron, { at: [x, 0.24, z] });
        parts.add(roundCyl(0.055, 0.03, { bevel: 0.01, segments: 10, steps: 1 }), PALETTE.iron, { at: [x, 1.17, z] });
        parts.add(roundCyl(0.075, 0.19, { top: 0.09, bevel: 0.02, segments: 12, steps: 2 }), { slot: 'lamp', color: '#fff0c8' }, { at: [x, 1.2, z] });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + Math.PI / 4;
          parts.add(stick([x + Math.cos(a) * 0.085, 1.19, z + Math.sin(a) * 0.085], [x + Math.cos(a) * 0.096, 1.4, z + Math.sin(a) * 0.096], 0.01, { segments: 5 }), PALETTE.iron);
        }
        parts.add(lathe([[0, 0], [0.14, 0], [0.13, 0.02], [0.07, 0.08], [0.02, 0.11], [0, 0.11]], 12), PALETTE.iron, { at: [x, 1.39, z] });
        parts.add(sphere(0.025, 8, 6), PALETTE.gold, { at: [x, 1.51, z] });
        lights.push(light([x, 1.3, z], { intensity: 1.2, distance: 7 }));
      }
      return finish(parts.build('dock'), {
        footprint: { w: W + 0.5, d: 2 * Math.min(L, 3) },
        spots,
        lights,
        height: withLamp ? 1.55 : 0.25,
      });
    },
  },

  boat: {
    label: 'Rowboat',
    floats: true,
    about: 'A wooden rowboat. Afloat it bobs gently on the water with its oars resting in the oarlocks (the origin is the waterline; a hidden lid keeps the scene\u2019s water out of the hull); beached it rests tilted on the shore with the oars inside (lift it if the shore is above the water); a wreck is faded, holed, weedy and half sunk, with water inside, and has no spots. One sitter per thwart: row (the middle seat, facing the stern), stern (facing the rower) and bow (facing the rower\u2019s back).',
    params: {
      color: { default: 'blue', type: 'color', about: 'hull paint (a color name or #hex)' },
      state: { default: 'floating', options: ['floating', 'beached', 'wreck'], about: 'afloat, pulled up on the shore, or wrecked' },
      oars: { default: true, about: 'with a pair of oars' },
    },
    examples: [{}, { state: 'beached', color: 'red' }, { state: 'wreck', color: 'teal' }, { color: 'yellow' }, { color: 'green', state: 'beached', oars: false }],
    build(p, ctx) {
      const state = oneOf(p.state, ['floating', 'beached', 'wreck'], 'floating');
      const wreck = state === 'wreck';
      const paint = colorOr(p.color, NAMED.blue);
      const hullCol = wreck ? mix(paint, '#a39e94', 0.62) : paint;
      const h = hullModel({ L: 2.0, B: 0.43, D: 0.13, sheer: 0.24 });
      const outer = new THREE.Group();
      const boat = new Parts();
      const r = rand(ctx, 'boat');
      const rail = wreck ? '#bdb5a6' : '#f4ead6';
      const inside = wreck ? '#a99f8c' : PALETTE.woodLight;
      const seatCol = wreck ? '#9a907d' : PALETTE.wood;
      const hole = wreck ? [-1, 0.1, h.zOf(0.4), 0.14] : null;
      addHull(boat, h, {
        hull: hullCol,
        bottom: wreck ? '#6f6a63' : shade(paint, -0.2, { sat: -0.08 }),
        stripe: wreck ? '#c9c1b2' : '#f6f0e4',
        rail, inside, weathered: wreck,
      });
      // seats (thwarts) on posts; a wreck has lost the middle one's leg and it has slipped
      const seats = [[0.22, 0.1], [0.5, 0.11], [0.78, 0.13]];
      const seatTops = [];
      seats.forEach(([t, y], k) => {
        const z = h.zOf(t), hw = h.insideHalf(t, y) - 0.004;
        const broken = wreck && k === 1;
        boat.add(bar(hw * 2, 0.035, 0.17, 0.014, 2), seatCol, { at: [0, y - 0.035 - (broken ? 0.07 : 0), z], rot: broken ? [0.05, 0, 0.3] : undefined });
        if (!broken) boat.add(box(0.05, Math.max(0.02, y - 0.035 - h.keelY(t) - 0.03), 0.045), shade(seatCol, -0.08), { at: [0, h.keelY(t) + 0.03, z] });
        seatTops.push([z, y]);
      });
      // floor boards
      const fy = h.keelY(0.45) + h.th + 0.004;
      for (const dx of [-0.09, 0, 0.09]) boat.add(box(0.075, 0.016, 0.7), shade(inside, -0.06), { at: [dx, fy, h.zOf(0.45)] });
      // oarlocks on the gunwale at the middle seat
      const zMid = h.zOf(0.5), yTop = h.topY(0.5);
      const steel = { slot: 'metal', color: '#9aa3ab' };
      for (const s of [1, -1]) {
        boat.add(ring(0.03, 0.009, { radial: 4, tubular: 8, arc: Math.PI }), steel, { at: [s * h.half(0.5), yTop + 0.045, zMid], rot: [Math.PI / 2, 0, Math.PI / 2] });
        boat.add(roundCyl(0.012, 0.03, { bevel: 0.004, segments: 6, steps: 1 }), steel, { at: [s * h.half(0.5), yTop - 0.01, zMid] });
      }
      // a brass mooring ring on an eye at the bow
      if (!wreck) {
        const brass = { slot: 'metal', color: '#d9a54a' };
        const ey = h.topY(1) - 0.1, ez = h.zOf(1) + 0.036;
        boat.add(sphere(0.017, 8, 6), brass, { at: [0, ey, ez], scale: [1, 1, 0.8] });
        boat.add(ring(0.05, 0.011, { radial: 5, tubular: 16 }), brass, { at: [0, ey - 0.052, ez + 0.012], rot: [Math.PI / 2, 0, 0] });
      }
      // oars: afloat they rest in the oarlocks with the handles in front of the rower (who faces
      // the stern) and the blades out toward the bow; beached they lie inside; a wreck has one broken
      if (flag(p.oars, true)) {
        const wood = wreck ? '#a59c8b' : PALETTE.woodLight, tip = wreck ? '#b9b1a2' : paint;
        if (state === 'floating') {
          for (const s of [1, -1]) {
            const pivot = new THREE.Vector3(s * h.half(0.5), yTop + 0.045, zMid);
            const handle = new THREE.Vector3(s * 0.15, yTop + 0.115, zMid - 0.17);
            const d = pivot.clone().sub(handle).normalize();
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-d.z, d.x), Math.asin(d.y), 'YXZ'));
            boat.merge(oarParts(1.08, wood, tip), new THREE.Matrix4().compose(handle, q, new THREE.Vector3(1, 1, 1)));
          }
        } else if (wreck) {
          boat.merge(oarParts(1.08, wood, tip, true), xform([-0.05, 0.02, h.zOf(0.3)], [0.1, -Math.PI / 2 + 0.5, 0.15]));
        } else {
          boat.merge(oarParts(1.08, wood, tip), xform([0.1, 0.16, h.zOf(0.18)], [0, -Math.PI / 2 + 0.06, 0]));
          boat.merge(oarParts(1.08, wood, tip), xform([-0.12, 0.165, h.zOf(0.16)], [0, -Math.PI / 2 - 0.05, 0]));
        }
      }
      // wreck: splintered planks round the hole, weed trailing from the rails, barnacles
      if (wreck) {
        const [hx, hy, hz, hr] = hole;
        const tH = (hz + h.L / 2) / h.L;
        const sideX = hx * (h.insideHalf(tH, hy) + h.th);
        boat.add(blob(hr, { detail: 1, amp: 0.28, freq: 2.4, seed: 5, squash: [0.12, 0.62, 1] }), '#3a2f27', { at: [sideX + hx * 0.004, hy, hz] });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + r.float(-0.25, 0.25);
          const len = r.float(0.06, 0.11);
          boat.add(box(len, 0.012, 0.03), '#b2a895', { at: [sideX + hx * 0.01, hy + Math.sin(a) * hr * 0.6, hz + Math.cos(a) * hr * 0.95], rot: [0, hx * r.float(0.1, 0.5), a + r.float(-0.4, 0.4)] });
        }
        const weed = { slot: 'foliage', color: '#5d8f4c', sway: 0.25 };
        for (let i = 0; i < 6; i++) {
          const t = 0.12 + i * 0.15 + r.float(-0.04, 0.04);
          const s = i % 2 ? 1 : -1;
          const x0 = s * (h.half(t) + 0.02), y0 = h.topY(t) - 0.01, z0 = h.zOf(t);
          const len = r.float(0.12, 0.24);
          boat.add(taper([[x0, y0, z0], [x0 + s * 0.04, y0 - len * 0.4, z0 + 0.02], [x0 + s * 0.035, y0 - len, z0 - 0.01]], (u) => 0.016 * (1 - u * 0.6), { segments: 6, radial: 4, caps: false }), { ...weed, color: shade(weed.color, r.float(-0.05, 0.05)) });
        }
        for (let i = 0; i < 9; i++) {
          const t = r.float(0.08, 0.9), s = r.sign();
          const y = r.float(-0.05, 0.03);
          const hw = h.insideHalf(t, y) + h.th + 0.004;
          boat.add(sphere(r.float(0.013, 0.022), 5, 3), '#d9d3c4', { at: [s * hw, y, h.zOf(t)], scale: [0.6, 1, 1] });
        }
      } else {
        // the waterline lid (depth only) keeps the water plane out of a sound hull
        boat.add(h.lidGeo(LID_Y, 0, 0.9), WATERLINE);
      }
      adopt(outer, orderLid(boat.build('boat')));
      const group = new THREE.Group();
      group.add(outer);
      let tick = null;
      if (state === 'floating') tick = bobber(outer, phaseOf(ctx), CREWED);
      else if (state === 'beached') {
        // tilted on the shore with the keel pressed into the sand, but the floor inside stays
        // above the ground (or the ground shows through the hull)
        outer.rotation.set(-0.04, 0, 0.12);
        outer.updateMatrix();
        const pos = h.innerGeo.attributes.position, v = new THREE.Vector3();
        let low = Infinity;
        for (let i = 0; i < pos.count; i++) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(outer.matrix).y);
        outer.position.y = 0.015 - low;
      }
      else { outer.position.y = -0.06; outer.rotation.set(0.12, 0.0, -0.34); }
      outer.updateMatrix();
      // sit spots 0.035 behind the thwart's middle, toward the sitter's back (seats are 0.17 deep)
      const onSeat = (k, dz) => new THREE.Vector3(0, seatTops[k][1], seatTops[k][0] + dz).applyMatrix4(outer.matrix).toArray().map((v) => +v.toFixed(3));
      const spots = wreck ? {} : {
        row: spot(onSeat(1, 0.035), 180, 'sit'),
        stern: spot(onSeat(0, -0.035), 0, 'sit'),
        bow: spot(onSeat(2, 0.035), 180, 'sit'),
      };
      return finish(group, {
        footprint: { w: 1.0, d: 2.1 },
        spots,
        tick,
        height: 0.4,
      });
    },
  },

  steppingstones: {
    label: 'Stepping stones',
    about: 'A line of flat stones across shallow water or a garden path. The stones run along Z (length); their tops sit just above the origin and they reach down into the water.',
    params: {
      length: { default: 3, min: 1, max: 10, about: 'length of the line along Z' },
      color: { default: PALETTE.stone, type: 'color', about: 'stone color' },
      moss: { default: true, about: 'mossy sides' },
    },
    examples: [{}, { length: 1.8 }, { length: 5, moss: false, color: '#c9b8a0' }],
    build(p, ctx) {
      const L = size(p.length, 3, 1, 10);
      const base = colorOr(p.color, PALETTE.stone);
      const mossy = flag(p.moss, true);
      const r = rand(ctx, 'stones');
      const parts = new Parts();
      const n = Math.max(2, Math.round(L / 0.62) + 1);
      const tops = [];
      for (let i = 0; i < n; i++) {
        const z = -L / 2 + (L * i) / (n - 1);
        const x = (i % 2 ? 1 : -1) * r.float(0.04, 0.1);
        const k = r.float(0.82, 1.06), topY = r.float(0.035, 0.06);
        // a rounded boulder: a flat-ish worn top, bulging sides, tucked in below the water
        const prof = [[0, -0.95], [0.21, -0.95], [0.29, -0.5], [0.3, -0.2], [0.275, -0.04], [0.22, 0.0], [0.13, 0.014], [0, 0.018]].map(([pr, py]) => [pr * k, py + topY - 0.018]);
        const g = weld(lathe(prof, 11));
        lumpy(g, { amp: 0.05 * k, freq: 3.2, seed: i * 7 + 3 });
        g.scale(1, 1, r.float(0.8, 0.95));
        g.rotateY(r.angle());
        g.computeVertexNormals();
        const tone = shade(base, r.float(-0.04, 0.04));
        const moss = mix(tone, '#6f9a4f', 0.6);
        const o = r.float(0, 10);
        addPainted(parts, g, tone, { at: [x, 0, z] }, (c, px, py, pz, nx, ny) => {
          if (ny > 0.55) c.offsetHSL(0, 0, 0.04 + 0.03 * noise3(px * 9 + o, pz * 9, 1));
          else {
            c.offsetHSL(0, 0, -0.03);
            if (mossy) c.lerp(C(moss), clamp(0.45 + noise3(px * 7 + o, py * 5, pz * 7) * 0.9, 0, 0.85) * smooth(topY - 0.01, topY - 0.12, py) * smooth(-0.45, -0.25, py));
            if (py < -0.25) c.lerp(C(shade(tone, -0.12, { hue: 0.02 })), smooth(-0.25, -0.4, py));
          }
        });
        tops.push([x, topY, z]);
      }
      const mid = tops[Math.floor((n - 1) / 2)];
      return finish(parts.build('steppingstones'), {
        footprint: { w: 0.8, d: L + 0.5 },
        spots: {
          start: spot(tops[0], 0, 'stand'),
          middle: spot(mid, 0, 'stand'),
          end: spot(tops[n - 1], 0, 'stand'),
        },
      });
    },
  },
  sailboat: {
    label: 'Sailboat',
    floats: true,
    about: 'A small sailboat with a striped cloth sail that sways in the breeze and a pennant at the masthead; it bobs gently on the water (the origin is the waterline; a hidden lid keeps the scene\u2019s water out of the hull). Sit at the tiller (the stern seat, the tiller ends behind you) or on the middle seat, both facing the bow.',
    params: {
      color: { default: 'white', type: 'color', about: 'hull paint' },
      sail: { default: 'cream', type: 'color', about: 'sail cloth' },
      stripe: { default: 'red', type: 'color', about: 'the stripe on the sail, the trim and the pennant' },
    },
    examples: [{}, { color: 'navy', sail: 'white', stripe: 'yellow' }, { color: 'red', stripe: 'blue' }, { color: 'mint', sail: 'lemon', stripe: 'coral' }],
    build(p, ctx) {
      const hullCol = colorOr(p.color, NAMED.white), sailCol = colorOr(p.sail, NAMED.cream), accent = colorOr(p.stripe, NAMED.red);
      const h = hullModel({ L: 2.35, B: 0.37, D: 0.13, sheer: 0.21, bowRise: 0.11, transom: 0.72, fullness: 0.8 });
      const boatG = new THREE.Group();
      const parts = new Parts();
      addHull(parts, h, { hull: hullCol, bottom: shade(accent, -0.12), stripe: accent, rail: PALETTE.woodLight, inside: PALETTE.woodLight, ribs: [0.36] });
      // seats: a stern seat at the tiller and a middle one
      const seatT = [[0.2, 0.1], [0.45, 0.1]];
      const tops = seatT.map(([t, y]) => {
        const z = h.zOf(t), hw = h.insideHalf(t, y) - 0.004;
        parts.add(bar(hw * 2, 0.034, 0.16, 0.013, 2), PALETTE.wood, { at: [0, y - 0.034, z] });
        parts.add(box(0.06, Math.max(0.02, y - 0.034 - h.keelY(t) - 0.03), 0.05), PALETTE.woodDark, { at: [0, h.keelY(t) + 0.03, z] });
        return [z, y];
      });
      // a foredeck from the mast forward
      const mastT = 0.7, mz = h.zOf(mastT);
      const deck = [];
      for (let i = 0; i <= 6; i++) {
        const t = mastT - 0.04 + ((0.995 - mastT + 0.04) * i) / 6;
        const hw = Math.max(0.002, h.half(t) - 0.004), y = h.topY(t) - 0.012;
        deck.push([[hw, y, h.zOf(t)], [0, y + 0.02, h.zOf(t)], [-hw, y, h.zOf(t)]]);
      }
      parts.add(loft(deck, { flip: true }), PALETTE.woodLight);
      // mast, rudder and tiller: the rudder head stands above the transom and the tiller reaches
      // forward over it, ending behind the helmsman's back
      const mastTop = 2.55;
      parts.add(roundCyl(0.036, mastTop - h.keelY(mastT), { top: 0.026, bevel: 0.012, segments: 10, steps: 1 }), PALETTE.woodLight, { at: [0, h.keelY(mastT) + 0.02, mz] });
      parts.add(sphere(0.04, 10, 6), accent, { at: [0, mastTop + 0.02, mz] });
      const sz = h.zOf(0) - 0.03;
      parts.add(roundBox(0.03, 0.56, 0.17, 0.012, 1), PALETTE.wood, { at: [0, -0.26, sz - 0.07] });
      const tillerEnd = tops[0][0] - 0.035 - 0.12 - 0.065;
      parts.add(stick([0, 0.3, sz - 0.04], [0, 0.272, tillerEnd], 0.017, { segments: 6 }), PALETTE.woodDark);
      parts.add(sphere(0.023, 8, 6), accent, { at: [0, 0.272, tillerEnd] });
      // the waterline lid (depth only) keeps the water plane out of the hull
      parts.add(h.lidGeo(LID_Y, 0, 0.9), WATERLINE);
      adopt(boatG, orderLid(parts.build('sailboat')));

      // the mainsail and boom swing gently round the mast
      const swing = new THREE.Group();
      swing.position.set(0, 0, mz);
      const sp = new Parts();
      const boomY = 0.98, boomL = 1.25;
      sp.add(roundCyl(0.03, boomL, { top: 0.026, bevel: 0.012, segments: 8, steps: 1 }), PALETTE.woodLight, { at: [0, boomY, 0], rot: [-Math.PI / 2, 0, 0] });
      const sail = (head, tack, clew, belly, bands) => {
        // rows from the foot up to the head; columns from the luff to the leech; rows land on band edges
        const vs = [...new Set([0, ...bands.flat(), 0.18, 0.36, 0.52, 0.66, 0.8, 0.9, 1].map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
        const cols = 6, rows = [];
        const H = new THREE.Vector3(...head), T = new THREE.Vector3(...tack), K = new THREE.Vector3(...clew);
        const n = new THREE.Vector3().subVectors(H, T).cross(new THREE.Vector3().subVectors(K, T)).normalize();
        for (const v of vs) {
          const a = T.clone().lerp(H, v), b = K.clone().lerp(H, v);
          const row = [];
          for (let j = 0; j <= cols; j++) {
            const u = j / cols;
            const pt = a.clone().lerp(b, u).addScaledVector(n, belly * Math.sin(Math.PI * u) * Math.pow(1 - v, 0.7));
            row.push(pt.toArray());
          }
          rows.push(row);
        }
        const g = loft(rows);
        const bandOf = (f) => {
          const i = Math.floor(Math.floor(f / 2) / cols);
          const vm = (vs[i] + vs[i + 1]) / 2;
          return bands.some(([lo, hi]) => vm > lo && vm < hi);
        };
        return { g, bandOf };
      };
      const main = sail([0, mastTop - 0.08, 0.03], [0, boomY + 0.04, -0.04], [0, boomY + 0.03, -boomL + 0.06], 0.12, [[0.18, 0.26], [0.3, 0.33]]);
      addPainted(sp, main.g, { slot: 'cloth', color: sailCol, double: true }, undefined, (c, x, y, z, nx, ny, nz, f) => { if (main.bandOf(f)) c.set(accent); }, true);
      adopt(swing, sp.build('mainsail'));
      swing.rotation.y = 0.32;
      boatG.add(swing);

      // the jib from the masthead to the bow
      const jibG = new THREE.Group();
      const jp = new Parts();
      const bowZ = h.zOf(1) - mz, bowY = h.topY(1);
      const jib = sail([0, mastTop - 0.4, 0.04], [0, bowY + 0.04, bowZ - 0.03], [0, boomY - 0.25, 0.32], 0.07, [[0.12, 0.2]]);
      addPainted(jp, jib.g, { slot: 'cloth', color: sailCol, double: true }, undefined, (c, x, y, z, nx, ny, nz, f) => { if (jib.bandOf(f)) c.set(accent); }, true);
      jp.add(tube([[0, mastTop - 0.05, 0.02], [0, bowY + 0.02, bowZ - 0.02]], 0.005, { segments: 2, radial: 4 }), '#d8d2c4');
      adopt(jibG, jp.build('jib'));
      jibG.position.set(0, 0, mz);
      jibG.rotation.y = 0.18;
      boatG.add(jibG);

      // a pennant at the masthead
      const flagG = new THREE.Group();
      const fp = new Parts();
      fp.add(extrude([[0, 0.035], [0, -0.035], [-0.26, -0.004], [-0.26, 0.004]], 0.004, { bevel: 0.002, bevelSegments: 1 }), { slot: 'cloth', color: accent });
      adopt(flagG, fp.build('pennant'));
      flagG.position.set(0, mastTop - 0.06, mz);
      flagG.rotation.y = Math.PI / 2;
      boatG.add(flagG);

      const group = new THREE.Group();
      group.add(boatG);
      const bob = bobber(boatG, phaseOf(ctx), { ...CREWED, speed: 0.9 });
      const ph = phaseOf(ctx, 'sail');
      return finish(group, {
        footprint: { w: 1.0, d: 2.5 },
        spots: {
          tiller: spot([0, tops[0][1], +(tops[0][0] - 0.035).toFixed(3)], 0, 'sit'),
          seat: spot([0, tops[1][1], +(tops[1][0] - 0.035).toFixed(3)], 0, 'sit'),
        },
        height: mastTop,
        tick(t) {
          bob(t);
          swing.rotation.y = 0.32 + 0.07 * Math.sin(t * 0.55 + ph) + 0.025 * Math.sin(t * 1.7 + ph * 2);
          swing.scale.x = 1 + 0.12 * Math.sin(t * 0.9 + ph);
          jibG.rotation.y = 0.18 + 0.05 * Math.sin(t * 0.6 + ph + 0.8);
          flagG.rotation.y = Math.PI / 2 + 0.35 * Math.sin(t * 3.1 + ph) + 0.15 * Math.sin(t * 7.3);
        },
      });
    },
  },

  buoy: {
    label: 'Buoy',
    floats: true,
    about: 'A floating buoy that bobs and nods on the water (origin at the waterline): a striped channel marker with a little lamp that glows at night, or a round mooring ball.',
    params: {
      style: { default: 'marker', options: ['marker', 'ball'], about: 'channel marker or mooring ball' },
      color: { default: 'red', type: 'color', about: 'main paint' },
      lamp: { default: true, about: 'the marker’s lamp lights up at night' },
    },
    examples: [{}, { color: 'green' }, { style: 'ball', color: 'orange' }, { style: 'ball', color: 'white' }, { color: 'yellow', lamp: false }],
    build(p, ctx) {
      const style = oneOf(p.style, ['marker', 'ball'], 'marker');
      const col = colorOr(p.color, NAMED.red);
      const white = '#f6f1e7';
      const g = new THREE.Group();
      const parts = new Parts();
      const lights = [];
      let height = 0.5;
      if (style === 'marker') {
        // a squat float painted in bands, with a little lattice tower on top
        const prof = [[0, -0.2], [0.16, -0.19], [0.24, -0.13], [0.27, -0.06], [0.27, 0.02], [0.27, 0.1], [0.26, 0.17], [0.22, 0.21], [0, 0.215]];
        addPainted(parts, lathe(prof, 20), col, undefined, (c, x, y) => {
          if (y > 0.015 && y < 0.105) c.set(white);
          if (y < -0.07) c.set(shade(col, -0.18));
        }, true);
        parts.add(ring(0.272, 0.018, { radial: 6, tubular: 28 }), white, { at: [0, 0.11, 0] });
        const legTop = 0.82;
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + 0.5;
          parts.add(stick([Math.cos(a) * 0.17, 0.2, Math.sin(a) * 0.17], [Math.cos(a) * 0.07, legTop, Math.sin(a) * 0.07], 0.018, { segments: 6 }), col);
        }
        parts.add(ring(0.12, 0.014, { radial: 5, tubular: 18 }), col, { at: [0, 0.5, 0] });
        parts.add(roundCyl(0.11, 0.04, { bevel: 0.015, segments: 14, steps: 1 }), col, { at: [0, legTop - 0.01, 0] });
        const lit = flag(p.lamp, true);
        const glowCol = mix(col, '#fff4d6', 0.45);
        parts.add(roundCyl(0.06, 0.1, { top: 0.055, bevel: 0.02, segments: 12, steps: 2 }), lit ? { slot: 'lamp', color: mix(col, '#fff4e0', 0.6), glow: glowCol } : { slot: 'glass', color: mix(col, '#e8eef0', 0.5), glowAmount: 0 }, { at: [0, legTop + 0.03, 0] });
        parts.add(cone(0.075, 0.08, 12), PALETTE.iron, { at: [0, legTop + 0.13, 0] });
        parts.add(sphere(0.022, 8, 6), PALETTE.iron, { at: [0, legTop + 0.22, 0] });
        if (lit) lights.push(light([0, legTop + 0.08, 0], { color: glowCol, intensity: 0.6, distance: 4 }));
        height = legTop + 0.24;
      } else {
        parts.add(sphere(0.22, 18, 12), col, { at: [0, 0.07, 0], scale: [1, 0.86, 1] });
        parts.add(roundCyl(0.224, 0.07, { bevel: 0.02, segments: 24, steps: 2 }), col === white || col === NAMED.white ? NAMED.blue : white, { at: [0, 0.035, 0] });
        parts.add(ring(0.03, 0.011, { radial: 5, tubular: 12 }), PALETTE.ironLight, { at: [0, 0.27, 0], rot: [0, 0, Math.PI / 2] });
        parts.add(roundCyl(0.035, 0.03, { bevel: 0.01, segments: 10, steps: 1 }), PALETTE.ironLight, { at: [0, 0.235, 0] });
        height = 0.32;
      }
      // a chain hanging down into the water
      parts.add(tube([[0, -0.15, 0], [0.02, -0.4, 0.01], [0, -0.7, 0]], 0.012, { segments: 6, radial: 4 }), PALETTE.ironLight);
      adopt(g, parts.build('buoy'));
      const group = new THREE.Group();
      group.add(g);
      const bob = bobber(g, phaseOf(ctx), { heave: 0.025, roll: 0.07, pitch: 0.06, speed: 1.1 });
      return finish(group, { footprint: { r: 0.32 }, spots: {}, lights, tick: bob, height });
    },
  },

  lilypads: {
    label: 'Lily pads',
    floats: true,
    about: 'A cluster of lily pads flat on the water with a water lily (origin at the waterline). Fresh green with a bud in spring, in flower in summer, yellowing in autumn and a few brown pads in winter. They turn slowly on the water.',
    params: {
      count: { default: 5, min: 1, max: 12, about: 'number of pads' },
      spread: { default: 0.6, min: 0.2, max: 1.6, about: 'radius of the cluster' },
      flower: { default: true, about: 'with water lilies (in season)' },
      color: { default: 'pink', type: 'color', about: 'flower color' },
    },
    examples: [{}, { count: 8, spread: 0.9, color: 'white' }, { count: 3, flower: false }, { color: 'yellow', count: 6 }],
    build(p, ctx) {
      const season = seasonOf(ctx);
      const count = int(p.count, 5, 1, 12), spread = size(p.spread, 0.6, 0.2, 1.6);
      const flowerCol = colorOr(p.color, NAMED.pink);
      const r = rand(ctx, 'pads');
      const tones = {
        spring: ['#8fd16a', '#a6dd7c', '#7cc35d'],
        summer: ['#5fb352', '#6fc25c', '#4f9f48'],
        autumn: ['#b9b44f', '#d1a548', '#9fa84a'],
        winter: ['#a08a5c', '#8f7e58', '#b09a6a'],
      }[season];
      const n = season === 'winter' ? Math.max(1, Math.ceil(count * 0.5)) : count;
      const g = new THREE.Group();
      const parts = new Parts();
      const placed = [];
      for (let i = 0; i < n; i++) {
        let x = 0, z = 0;
        const pr = r.float(0.17, 0.26) * (season === 'winter' ? 0.8 : 1);
        for (let k = 0; k < 14; k++) {
          const a = r.angle(), d = i === 0 ? r.float(0, 0.1) : Math.sqrt(r.next()) * spread;
          x = Math.cos(a) * d; z = Math.sin(a) * d;
          if (placed.every(([px, pz, prr]) => Math.hypot(px - x, pz - z) > (prr + pr) * 0.8)) break;
        }
        placed.push([x, z, pr]);
        const base = r.pick(tones);
        addPainted(parts, padGeo(pr, r.float(0.35, 0.6)), { slot: 'foliage', color: base, snow: false }, { at: [x, 0.004 * (i % 3), z], rot: [0, r.angle(), 0] }, (c, px, py, pz) => {
          const d = Math.hypot(px, pz) / pr;
          c.offsetHSL(0, 0.02, 0.06 * (1 - d) - (py > 0.012 ? 0 : 0.08));
          if (season === 'autumn' && d > 0.7) c.lerp(C('#c9773d'), 0.35);
        });
      }
      // the lilies: summer in bloom, a bud in spring
      if (flag(p.flower, true) && (season === 'summer' || season === 'spring')) {
        const blooms = season === 'summer' ? Math.min(2, Math.max(1, Math.round(n / 4))) : 1;
        for (let k = 0; k < blooms; k++) {
          const [x, z, pr] = placed[(k * 3) % placed.length];
          addLily(parts, [x + pr * 0.15, 0.014, z - pr * 0.1], flowerCol, { scale: k ? 0.85 : 1.1, bud: season === 'spring' });
        }
      }
      adopt(g, parts.build('lilypads'));
      const group = new THREE.Group();
      group.add(g);
      const ph = phaseOf(ctx);
      return finish(group, {
        footprint: { r: spread + 0.25 },
        spots: {},
        tick(t) {
          g.rotation.y = 0.06 * Math.sin(t * 0.21 + ph);
          g.position.y = 0.004 * Math.sin(t * 1.3 + ph);
        },
      });
    },
  },

  shells: {
    label: 'Seashells',
    about: 'Seashells and a starfish for beaches: a small cluster to scatter on the sand (under 400 triangles). Kneel in front to pick one up.',
    params: {
      variant: { default: 'mixed', options: ['mixed', 'scallop', 'whelk', 'starfish'], about: 'a little cluster, or one kind' },
      color: { default: 'auto', type: 'color', about: 'shell color (auto: natural tones)' },
    },
    examples: [{}, { variant: 'scallop' }, { variant: 'whelk' }, { variant: 'starfish' }, { variant: 'starfish', color: 'purple' }],
    build(p, ctx) {
      const variant = oneOf(p.variant, ['mixed', 'scallop', 'whelk', 'starfish'], 'mixed');
      const r = rand(ctx, 'shells');
      const tint = p.color === 'auto' ? null : colorOr(p.color, null);
      const parts = new Parts();
      const scallop = (at, rot, col) => addPainted(parts, scallopGeo(), tint ?? col, { at, rot: [0, rot, 0] }, (c, x, y, z) => {
        const th = Math.atan2(x, z + 0.054);
        const rib = Math.cos(((th + 1.15) / 2.3) * 7 * TAU) * 0.5 + 0.5;
        c.offsetHSL(0, 0, 0.07 * rib - 0.03 - 0.06 * clamp(1 - Math.hypot(x, z + 0.054) / 0.05, 0, 1));
      });
      const whelk = (at, rot, col) => addPainted(parts, whelkGeo(), tint ?? col, { at, rot: [0, rot, 0] }, (c, x, y, z) => {
        const u = (x + 0.08) / 0.19;
        if (Math.sin(u * 34) > 0.45 && u > 0.35) c.lerp(C('#c47f55'), 0.6);
        if (u < 0.36 && z > 0.02) c.lerp(C('#f4b3a6'), 0.7);
      });
      const star = (at, rot, col) => addPainted(parts, starGeo(), tint ?? col, { at, rot: [0, rot, 0] }, (c, x, y) => {
        c.offsetHSL(0, 0, (y - 0.018) * 2);
      });
      const pink = r.pick(['#f6c1b3', '#f4d2c0', '#f7b9c4']);
      const orange = r.pick(['#f08a5d', '#ec7a59', '#f29b5a']);
      if (variant === 'mixed') {
        scallop([0.1, 0, 0.08], r.float(-0.6, 0.6), pink);
        star([-0.12, 0, -0.03], r.angle(), orange);
        whelk([0.06, 0, -0.15], r.float(2.4, 3.6), '#f1e3c7');
      } else if (variant === 'scallop') {
        scallop([0.03, 0, 0.05], r.float(-0.4, 0.4), pink);
        scallop([-0.15, 0, -0.08], r.float(1.5, 2.5), '#f3e2cb');
      } else if (variant === 'whelk') {
        whelk([0, 0, 0], r.float(-0.5, 0.5), '#f1e3c7');
      } else {
        star([0, 0, 0], r.angle(), orange);
      }
      return finish(parts.build('shells'), { footprint: { r: 0.28 }, spots: { pick: spot([0, 0, 0.34], 180, 'kneel') } });
    },
  },

  driftwood: {
    label: 'Driftwood',
    about: 'A sea-bleached log or forked branch lying on the beach, worn smooth and pale, with knots and an old root flare. Two can sit on the log.',
    params: {
      variant: { default: 'log', options: ['log', 'branch'], about: 'a sitting log or a forked branch' },
      length: { default: 1.4, min: 0.5, max: 3, about: 'length along X' },
    },
    examples: [{}, { variant: 'branch' }, { length: 2.3 }, { variant: 'branch', length: 0.9 }],
    build(p, ctx) {
      const variant = oneOf(p.variant, ['log', 'branch'], 'log');
      const L = size(p.length, 1.4, 0.5, 3);
      const r = rand(ctx, 'drift');
      const base = '#dcd0b9', grain = '#b4a68c', pale = '#eee6d5', knot = '#9c8c72';
      const parts = new Parts();
      const o = r.float(0, 20);
      const painter = (end) => (c, x, y, z) => {
        const n = noise3(x * 2.5 + o, y * 26, z * 26) * 0.6 + noise3(x * 1.1, y * 8 + o, z * 8) * 0.4;
        c.lerp(C(grain), clamp(0.18 + n * 0.9, 0, 0.7));
        c.lerp(C(pale), clamp((y - 0.1) * 2.5, 0, 0.35));
        if (end && Math.abs(x) > end) {
          const d = Math.hypot(y - 0.12, z);
          c.copy(C(pale)).lerp(C(grain), Math.floor(d / 0.022) % 2 ? 0.35 : 0.05);
        }
      };
      const spots = {};
      if (variant === 'log') {
        const R = 0.11 + Math.min(0.03, L * 0.012);
        const flip = r.sign();
        const pts = [[-L / 2, R * 1.12, 0], [-L / 4, R * 1.04, r.float(-0.05, 0.05)], [0, R, r.float(-0.05, 0.05)], [L / 4, R * 0.98, r.float(-0.05, 0.05)], [L / 2, R * 0.92, 0]].map(([x, y, z]) => [x * flip, y, z]);
        const rad = (u, a) => R * (1 + 0.32 * Math.pow(smooth(0.18, 0, u), 1.4) * (0.75 + 0.25 * Math.cos(a * 3))) * (0.92 + 0.06 * Math.sin(u * 9 + o)) * (1 + 0.07 * noise3(u * 5 + o, Math.cos(a) * 1.3, Math.sin(a) * 1.3));
        addPainted(parts, taper(pts, rad, { segments: 20, radial: 12, capScale: 0.45 }), base, undefined, painter(L / 2 - 0.004));
        // knots and stubs of old branches
        for (const [u, side] of [[0.38, 1], [0.66, -1]]) {
          const x = lerp(-L / 2, L / 2, u) * flip, a = side > 0 ? 0.6 : -0.9;
          parts.add(sphere(0.034, 8, 6), knot, { at: [x, R + Math.sin(a) * R * 0.98, Math.cos(a) * R * 0.98 * side], scale: [1, 0.7, 1] });
        }
        parts.add(taper([[L * 0.12 * flip, R * 1.7, 0.04], [(L * 0.12 + 0.07) * flip, R * 2.5, 0.1]], [0.04, 0.026], { segments: 3, radial: 7, capScale: 0.5 }), base);
        parts.add(taper([[-L * 0.25 * flip, R * 0.9, -R * 0.8], [-L * 0.28 * flip, R * 0.7, -R * 2.0]], [0.036, 0.022], { segments: 3, radial: 7, capScale: 0.5 }), base);
        if (L >= 1.0) {
          spots.left = spot([L * 0.22, 2 * R - 0.01, 0.0], 0, 'sit');
          spots.right = spot([-L * 0.22, 2 * R - 0.01, 0.0], 0, 'sit');
        } else spots.seat = spot([0, 2 * R - 0.01, 0.0], 0, 'sit');
        spots.front = spot([0, 0, 0.6], 180, 'stand');
        return finish(parts.build('driftwood'), { footprint: { w: L + 0.1, d: R * 2 + 0.3 }, spots });
      }
      // a forked branch
      const R = 0.058;
      const main = [[-L / 2, R, 0], [-L / 6, R * 0.95, 0.06], [L / 6, R * 0.85, -0.04], [L / 2, R * 0.7, 0.03]];
      addPainted(parts, taper(main, (u, a) => R * (1 - 0.45 * u) * (1 + 0.06 * noise3(u * 6 + o, Math.cos(a), Math.sin(a))), { segments: 14, radial: 8, capScale: 0.5 }), base, undefined, painter(0));
      addPainted(parts, taper([[-L * 0.1, R * 0.9, 0.04], [L * 0.05, R * 0.8, 0.22], [L * 0.22, R * 0.72, 0.36]], (u) => R * (0.72 - 0.35 * u), { segments: 8, radial: 7, capScale: 0.5 }), base, undefined, painter(0));
      addPainted(parts, taper([[L * 0.2, R * 0.72, -0.02], [L * 0.3, R * 0.68, -0.19]], (u) => R * (0.58 - 0.25 * u), { segments: 5, radial: 6, capScale: 0.5 }), base, undefined, painter(0));
      spots.front = spot([0, 0, 0.6], 180, 'stand');
      return finish(parts.build('driftwood'), { footprint: { w: L + 0.1, d: 0.6 }, spots });
    },
  },

  beachchair: {
    label: 'Beach chair',
    about: 'A striped deck chair to sit back in, or a cushioned sun lounger to lie on (head toward -Z) or sit on.',
    params: {
      style: { default: 'deckchair', options: ['deckchair', 'lounger'], about: 'folding deck chair or flat sun lounger' },
      color: { default: 'blue', type: 'color', about: 'stripe color' },
      frame: { default: 'white', type: 'color', about: 'frame color (wood or painted)' },
    },
    examples: [{}, { style: 'lounger' }, { color: 'red', frame: 'brown' }, { style: 'lounger', color: 'yellow', frame: 'brown' }],
    build(p) {
      const style = oneOf(p.style, ['deckchair', 'lounger'], 'deckchair');
      const col = colorOr(p.color, NAMED.blue), frame = colorOr(p.frame, NAMED.white);
      const cream = '#f6f0e2';
      const parts = new Parts();
      if (style === 'deckchair') {
        const X = 0.29;
        const P0 = [-0.37, 0.78], P1 = [-0.1, -0.15], P2 = [0.31, 0.34];
        for (const s of [1, -1]) {
          const x = s * X;
          parts.add(stick([x, 0, 0.3], [x, 0.82, -0.4], 0.022, { segments: 8 }), frame);
          parts.add(stick([x + s * 0.045, 0, -0.3], [x + s * 0.045, 0.36, 0.33], 0.022, { segments: 8 }), frame);
          parts.add(sphere(0.022, 8, 6), PALETTE.ironLight, { at: [x + s * 0.025, 0.235, 0.1], scale: [1.2, 1, 1] });
        }
        parts.add(stick([-X, 0.78, -0.37], [X, 0.78, -0.37], 0.022, { segments: 8 }), frame);
        parts.add(stick([-X - 0.045, P2[1], P2[0]], [X + 0.045, P2[1], P2[0]], 0.022, { segments: 8 }), frame);
        // the striped sling, sagging between the top bar and the front bar
        const rows = [], N = 12, stripes = 8;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const z = (1 - t) * (1 - t) * P0[0] + 2 * t * (1 - t) * P1[0] + t * t * P2[0];
          const y = (1 - t) * (1 - t) * P0[1] + 2 * t * (1 - t) * P1[1] + t * t * P2[1];
          const row = [];
          for (let j = 0; j <= stripes; j++) {
            const x = -X + 0.025 + ((2 * X - 0.05) * j) / stripes;
            row.push([x, y + 0.025 - 0.012 * Math.cos((x / X) * Math.PI / 2), z]);
          }
          rows.push(row);
        }
        addPainted(parts, loft(rows), { slot: 'cloth', color: col, double: true }, undefined, (c, x, y, z, nx, ny, nz, f) => {
          if ((Math.floor(f / 2) % stripes) % 2) c.set(cream);
        }, true);
        return finish(parts.build('beachchair'), {
          footprint: { w: 0.7, d: 0.8 },
          spots: { seat: spot([0, 0.2, 0.06], 0, 'sit'), front: spot([0, 0, 0.75], 180, 'stand') },
        });
      }
      // lounger: a low frame with a quilted striped mattress
      const W = 0.6, Lz = 1.3, legH = 0.15;
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) parts.add(roundCyl(0.03, legH + 0.02, { top: 0.026, bevel: 0.01, segments: 8, steps: 1 }), frame, { at: [sx * (W / 2 - 0.06), 0, sz * (Lz / 2 - 0.08)] });
        parts.add(roundBox(0.05, 0.06, Lz, 0.02, 1), frame, { at: [sx * (W / 2 - 0.025), legH, 0] });
      }
      for (const sz of [1, -1]) parts.add(roundBox(W, 0.06, 0.05, 0.02, 1), frame, { at: [0, legH, sz * (Lz / 2 - 0.025)] });
      const n = 5, sw = (W - 0.04) / n;
      for (let i = 0; i < n; i++) {
        parts.add(roundBox(sw + 0.004, 0.07, Lz - 0.06, 0.03, 1), { slot: 'cloth', color: i % 2 ? cream : col }, { at: [-W / 2 + 0.02 + sw * (i + 0.5), legH + 0.05, 0] });
      }
      const top = legH + 0.12;
      return finish(parts.build('beachchair'), {
        footprint: { w: W + 0.1, d: Lz + 0.1 },
        spots: {
          lie: spot([0, top, 0.24], 0, 'lie'),
          sit: spot([W / 2 - 0.12, top, 0.1], 90, 'sit'),
        },
      });
    },
  },

  beachumbrella: {
    label: 'Beach umbrella',
    about: 'A big striped parasol stuck in the sand, leaning a little. Sit in its shade.',
    params: {
      color: { default: 'red', type: 'color', about: 'panel color' },
      color2: { default: 'white', type: 'color', about: 'the other panels' },
      lean: { default: 6, min: 0, max: 20, about: 'how far the pole leans (degrees)' },
    },
    examples: [{}, { color: 'blue' }, { color: 'yellow', color2: 'orange', lean: 12 }, { color: 'teal', color2: 'cream', lean: 2 }],
    build(p, ctx) {
      const col = colorOr(p.color, NAMED.red), col2 = colorOr(p.color2, NAMED.white);
      const lean = THREE.MathUtils.degToRad(num(p.lean, 6, 0, 20));
      const parts = new Parts();
      const H = 1.95, R = 1.0, dome = 0.3, panels = 8;
      // the pole, two-tone, and a little mound of sand where it goes in
      const pole = new Parts();
      pole.add(roundCyl(0.026, H + 0.12, { top: 0.022, bevel: 0.01, segments: 10, steps: 1 }), col2, { at: [0, -0.12, 0] });
      for (const y of [0.25, 0.45]) pole.add(roundCyl(0.03, 0.07, { bevel: 0.01, segments: 10, steps: 1 }), col, { at: [0, y, 0] });
      pole.add(roundCyl(0.045, 0.08, { bevel: 0.02, segments: 10, steps: 1 }), col2, { at: [0, H - dome - 0.45, 0] });
      // the canopy: eight panels sagging between ribs, with a scalloped valance
      const rows = [], cols = panels * 4;
      const NR = 6;
      for (let i = 0; i <= NR + 2; i++) {
        const row = [];
        for (let j = 0; j <= cols; j++) {
          const a = (j / cols) * TAU;
          const between = 1 - Math.abs(Math.cos((panels * a) / 2));
          let rr, y;
          if (i <= NR) {
            const f = Math.max(i / NR, 0.03);
            rr = R * Math.sin(f * Math.PI / 2) * (1 - 0.05 * between * f);
            y = H - dome * (1 - Math.cos(f * Math.PI / 2)) - 0.03 * between * f;
          } else {
            rr = R * (1 - 0.05 * between) + 0.004;
            y = H - dome - 0.03 * between - (i - NR) * 0.045 * (1 - 0.6 * Math.pow(Math.abs(Math.sin(panels * a)), 2));
          }
          row.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
        }
        rows.push(row);
      }
      addPainted(pole, loft(rows, { wrap: true }), { slot: 'cloth', color: col, double: true }, undefined, (c, x, y, z, nx, ny, nz, f) => {
        const j = Math.floor(f / 2) % cols;
        const ring = Math.floor(Math.floor(f / 2) / cols);
        if (Math.floor(j / 4) % 2) c.set(col2);
        if (ring >= NR) c.set(Math.floor(j / 4) % 2 ? col : col2);
      }, true);
      // finial, rib tips and the struts underneath
      pole.add(sphere(0.045, 10, 8), col2, { at: [0, H + 0.03, 0] });
      for (let k = 0; k < panels; k++) {
        const a = (k / panels) * TAU;
        pole.add(sphere(0.018, 6, 4), col2, { at: [Math.cos(a) * (R + 0.005), H - dome - 0.01, Math.sin(a) * (R + 0.005)] });
        pole.add(stick([0, H - dome - 0.42, 0], [Math.cos(a) * R * 0.55, H - dome * (1 - Math.cos(0.37 * Math.PI / 2)) - 0.03, Math.sin(a) * R * 0.55], 0.008, { segments: 5 }), '#c9c3b6');
      }
      const top = new THREE.Group();
      adopt(top, pole.build('umbrella'));
      top.rotation.x = lean;
      const g = new THREE.Group();
      g.add(top);
      parts.add(blob(0.16, { detail: 1, amp: 0.15, seed: 3, squash: [1, 0.28, 1], flatBottom: 0 }), PALETTE.sand, { at: [0, 0, 0] });
      adopt(g, parts.build('umbrella-base'));
      const ph = phaseOf(ctx);
      return finish(g, {
        footprint: { r: 0.3 },
        spots: {
          shade: spot([0.25, 0, 0.3], 0, 'floor'),
          under: spot([-0.35, 0, 0.25], 20, 'stand'),
        },
        height: H,
        tick(t) {
          top.rotation.x = lean + 0.006 * Math.sin(t * 1.3 + ph);
          top.rotation.z = 0.006 * Math.sin(t * 1.1 + ph * 2);
        },
      });
    },
  },

  towel: {
    label: 'Beach towel',
    about: 'A beach towel spread on the sand, with fringed ends. Lie on it (head toward -Z) or sit on it.',
    params: {
      color: { default: 'coral', type: 'color', about: 'main color' },
      color2: { default: 'cream', type: 'color', about: 'second color' },
      pattern: { default: 'stripes', options: ['stripes', 'plain', 'dots', 'border'], about: 'stripes, plain, polka dots, or a plain field with a border' },
    },
    examples: [{}, { pattern: 'plain', color: 'sky' }, { pattern: 'dots', color: 'yellow', color2: 'white' }, { pattern: 'border', color: 'teal', color2: 'lemon' }],
    build(p) {
      const col = colorOr(p.color, NAMED.coral), col2 = colorOr(p.color2, NAMED.cream);
      const pattern = oneOf(p.pattern, ['stripes', 'plain', 'dots', 'border'], 'stripes');
      const W = 0.72, L = 1.3, T = 0.016;
      const parts = new Parts();
      const cloth = (c) => ({ slot: 'cloth', color: c });
      if (pattern === 'stripes') {
        const bands = [col, col2, col, col2, col, col2, col];
        const widths = [0.34, 0.08, 0.12, 0.22, 0.12, 0.08, 0.34];
        let z = -L / 2;
        bands.forEach((c, i) => {
          const w = widths[i];
          parts.add(roundBox(W, T, w, i === 0 || i === bands.length - 1 ? 0.007 : 0.002, 1), cloth(c), { at: [0, 0, z + w / 2] });
          z += w;
        });
      } else if (pattern === 'border') {
        parts.add(roundBox(W, T, L, 0.007, 1), cloth(col2));
        parts.add(roundBox(W - 0.12, T + 0.003, L - 0.12, 0.004, 1), cloth(col));
      } else {
        parts.add(roundBox(W, T, L, 0.007, 1), cloth(col));
        if (pattern === 'dots') {
          for (let i = 0; i < 4; i++) for (let k = 0; k < 7; k++) {
            const x = -W / 2 + 0.11 + i * ((W - 0.22) / 3) + (k % 2 ? 0.08 : 0), z = -L / 2 + 0.14 + k * ((L - 0.28) / 6);
            if (Math.abs(x) > W / 2 - 0.06) continue;
            parts.add(cyl(0.035, T + 0.004, { segments: 8 }), cloth(col2), { at: [x, 0, z] });
          }
        }
      }
      // fringes on the short ends
      for (const sz of [1, -1]) {
        for (let i = 0; i < 9; i++) {
          const x = -W / 2 + 0.05 + (i * (W - 0.1)) / 8;
          parts.add(box(0.018, 0.006, 0.05), cloth(col2 === col ? shade(col, 0.1) : col2), { at: [x, 0.001, sz * (L / 2 + 0.02)] });
        }
      }
      return finish(parts.build('towel'), {
        footprint: { w: W + 0.05, d: L + 0.1 },
        spots: {
          lie: spot([0, T, 0.2], 0, 'lie'),
          sit: spot([0, T, 0.05], 0, 'floor'),
        },
      });
    },
  },

  fishrack: {
    label: 'Fish drying rack',
    about: 'A rustic drying rack of lashed poles with a fishing net draped over one end and a row of fish hanging to dry, and a basket underneath.',
    params: {
      fish: { default: 5, min: 0, max: 6, about: 'how many fish hang from the bar' },
      net: { default: true, about: 'a net draped over the bar' },
      color: { default: 'teal', type: 'color', about: 'net color' },
    },
    examples: [{}, { fish: 3, color: 'sky' }, { net: false, fish: 6 }],
    build(p, ctx) {
      const nFish = int(p.fish, 5, 0, 6), withNet = flag(p.net, true);
      const netCol = colorOr(p.color, NAMED.teal);
      const r = rand(ctx, 'rack');
      const parts = new Parts();
      const pole = PALETTE.wood, rope = '#e6d3a3';
      const X = 0.88, top = 1.18;
      // two lashed A-frames and the bar across them
      for (const sx of [1, -1]) {
        const x = sx * X;
        parts.add(stick([x, -0.05, 0.34], [x, top + 0.14, -0.08], 0.032, { segments: 7 }), pole);
        parts.add(stick([x, -0.05, -0.34], [x, top + 0.14, 0.08], 0.032, { segments: 7 }), pole);
        parts.add(ring(0.045, 0.014, { radial: 4, tubular: 10 }), rope, { at: [x, top - 0.02, 0], rot: [0, 0, Math.PI / 2] });
        parts.add(stick([x, 0.32, 0.25], [x, 0.32, -0.25], 0.018, { segments: 6 }), pole);
      }
      parts.add(taper([[-X - 0.16, top + 0.02, 0], [0, top + 0.035, 0.01], [X + 0.16, top + 0.02, 0]], [0.04, 0.036], { segments: 6, radial: 7 }), PALETTE.woodDark);
      // fish hanging by their tails
      const fishCols = ['#8fb0c6', '#9dbbcb', '#d19c86', '#a6bfae'];
      for (let i = 0; i < nFish; i++) {
        const x = withNet ? lerp(0.1, X - 0.12, nFish > 1 ? i / (nFish - 1) : 0.5) : lerp(-X + 0.15, X - 0.15, nFish > 1 ? i / (nFish - 1) : 0.5);
        const len = r.float(0.24, 0.3), y0 = top - 0.02;
        const col = r.pick(fishCols);
        const lean = r.float(-0.08, 0.08);
        parts.add(cyl(0.006, 0.06, { segments: 4 }), rope, { at: [x, y0 - 0.06, 0] });
        const cy = y0 - 0.1 - len / 2;
        addPainted(parts, sphere(1, 8, 5), col, { at: [x, cy, 0], scale: [0.06, len / 2, 0.032], rot: [0, 0, lean] }, (c, px, py) => {
          if (px > 0.15) c.lerp(C('#f1f2ee'), 0.7);
          else if (px < -0.45) c.offsetHSL(0, 0.04, -0.08);
          if (py < -0.75) c.offsetHSL(0, 0, -0.04);
        });
        // tail at the top, a fin on the back
        parts.add(extrude([[0, 0], [0.055, 0.06], [0.02, 0.05], [0, 0.04], [-0.02, 0.05], [-0.055, 0.06]], 0.008, { bevel: 0.005, bevelSegments: 1 }), shade(col, -0.06), { at: [x + Math.sin(-lean) * len * 0.45, cy + len / 2 - 0.022, 0], rot: [0, 0, lean] });
        parts.add(extrude([[0, 0], [-0.03, 0.02], [-0.036, 0.07], [0, 0.08]], 0.006, { bevel: 0.004, bevelSegments: 1 }), shade(col, -0.08), { at: [x - 0.05, cy - 0.04, 0], rot: [0, 0, lean] });
        for (const sz of [1, -1]) parts.add(sphere(0.011, 5, 3), '#2f3436', { at: [x - 0.012, cy - len / 2 + 0.05, sz * 0.027], scale: [1, 1, 0.5] });
      }
      // the net, draped over the bar: knotted cords over a sheer cloth, cork floats on the hem
      if (withNet) {
        const NX = 6, NZ = 10;
        const hangOf = (u) => 0.62 + 0.1 * Math.sin(u * 4.2) + 0.06 * Math.sin(u * 11 + 1);
        const at = (u, v) => {
          const x = lerp(-X + 0.08, -0.06, u), s = v * 2 - 1;
          const fold = 0.03 * Math.sin(u * 9 + v * 3) * Math.abs(s);
          const y = top + 0.06 - Math.pow(Math.abs(s), 1.25) * hangOf(u);
          const z = s * (0.06 + 0.22 * Math.pow(Math.abs(s), 1.5)) + fold;
          return [x, y, z];
        };
        const rows = [];
        for (let i = 0; i <= NX; i++) { const row = []; for (let j = 0; j <= NZ; j++) row.push(at(i / NX, j / NZ)); rows.push(row); }
        parts.add(loft(rows), { slot: 'cloth', color: mix(netCol, '#f4f1e8', 0.35), double: true, transparent: true, opacity: 0.4 });
        const cord = { slot: 'cloth', color: shade(netCol, -0.12) };
        for (let i = 0; i <= 5; i++) {
          const u = i / 5, pts = [];
          for (let j = 0; j <= 10; j++) pts.push(at(u, j / 10));
          parts.add(tube(pts, 0.007, { segments: 7, radial: 3 }), cord);
        }
        for (const v of [0.04, 0.24, 0.76, 0.96]) {
          const pts = [];
          for (let i = 0; i <= 6; i++) pts.push(at(i / 6, v));
          parts.add(tube(pts, 0.007, { segments: 7, radial: 3 }), cord);
        }
        for (let i = 0; i <= 4; i++) {
          const u = i / 4;
          const [x, y, z] = at(u, 1);
          parts.add(sphere(0.032, 6, 4), '#e9a54a', { at: [x, y - 0.01, z], scale: [1, 0.8, 0.8] });
        }
      }
      // a woven basket below
      addPainted(parts, lathe([[0, 0], [0.15, 0], [0.18, 0.04], [0.19, 0.13], [0.17, 0.14], [0.16, 0.03], [0, 0.03]], 14), PALETTE.thatch, { at: [0.45, 0, 0.12] }, (c, x, y) => {
        if (Math.floor(y / 0.025) % 2) c.offsetHSL(0, 0, -0.06);
      });
      parts.add(ring(0.185, 0.014, { radial: 4, tubular: 16 }), shade(PALETTE.thatch, -0.12), { at: [0.45, 0.135, 0.12] });
      return finish(parts.build('fishrack'), {
        footprint: { w: 2.1, d: 0.8 },
        spots: { front: spot([0.2, 0, 0.8], 180, 'stand') },
        height: top + 0.15,
      });
    },
  },

  /* ───────────── hand props (built in the hand frame, see holdTick) ───────────── */

  'held-lantern': {
    ...HELD,
    label: 'Lantern (held)',
    about: 'A little lantern carried by its bail. It hangs from the hand, swings as you walk, and glows at night, lighting up its surroundings.',
    params: {
      color: { default: 'black', type: 'color', about: 'frame color' },
      lit: { default: 'night', options: ['night', 'always', 'never'], about: 'when it glows' },
    },
    examples: [{}, { clip: 'Walk' }, { color: 'gold', lit: 'always' }, { color: 'red', clip: 'Carry' }, { color: 'teal', hand: 'leftHand', clip: 'Walk' }],
    build(p) {
      const frame = colorOr(p.color, NAMED.black);
      const lit = oneOf(p.lit, ['night', 'always', 'never'], 'night');
      const parts = new Parts();
      const capY = -0.058;
      const bail = [];
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; bail.push([0, capY + 0.058 * Math.sin(a), 0.058 * Math.cos(a)]); }
      parts.add(tube(bail, 0.0065, { segments: 16, radial: 5 }), frame);
      for (const sz of [1, -1]) parts.add(sphere(0.011, 6, 4), frame, { at: [0, capY, sz * 0.058] });
      parts.add(lathe([[0, 0], [0.062, 0], [0.058, 0.012], [0.032, 0.03], [0.012, 0.04], [0, 0.042]], 14), frame, { at: [0, capY - 0.004, 0] });
      parts.add(sphere(0.012, 8, 6), frame, { at: [0, capY + 0.043, 0] });
      const glass = lit === 'never' ? { slot: 'glass', color: '#dfe4dc', glowAmount: 0 } : lit === 'always' ? { slot: 'emit', color: '#ffe2a8', emit: 1.0 } : { slot: 'lamp', color: '#fff1cf' };
      parts.add(roundCyl(0.046, 0.082, { top: 0.05, bevel: 0.016, segments: 14, steps: 2 }), glass, { at: [0, capY - 0.086, 0] });
      if (lit !== 'never') parts.add(cone(0.012, 0.03, 8), { slot: 'emit', color: '#ffc45a', emit: 1.2 }, { at: [0, capY - 0.06, 0] });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        parts.add(roundBox(0.012, 0.09, 0.012, 0.005, 1), frame, { at: [Math.cos(a) * 0.05, capY - 0.088, Math.sin(a) * 0.05] });
      }
      parts.add(lathe([[0, 0], [0.056, 0], [0.062, 0.01], [0.054, 0.022], [0, 0.022]], 14), frame, { at: [0, capY - 0.108, 0] });
      const g = parts.build('held-lantern');
      // the light sits a little out from the body so the lantern's own legs aren't blown out
      const lights = lit === 'never' ? [] : [{ ...light([-0.07, capY - 0.03, 0.04], { intensity: 0.16, distance: 4, when: lit === 'always' ? 'always' : 'night' }), halo: 0.5 }];
      return finish(g, { footprint: { r: 0.1 }, spots: {}, lights, tick: holdTick(g, { hang: 0.1, lean: [0, 0, -0.1] }) });
    },
  },

  'held-umbrella': {
    ...HELD,
    label: 'Umbrella (held)',
    about: 'An open umbrella held up over the head (it stays upright while you walk), tipped a little to the side so it clears the hair. A plain canopy, stripes or polka dots.',
    params: {
      color: { default: 'red', type: 'color', about: 'canopy color' },
      pattern: { default: 'plain', options: ['plain', 'stripes', 'dots'], about: 'canopy pattern' },
    },
    examples: [{}, { color: 'yellow', pattern: 'stripes', clip: 'Walk' }, { color: 'sky', pattern: 'dots' }, { color: 'purple', clip: 'Walk' }, { color: 'green', pattern: 'stripes', hand: 'leftHand' }],
    build(p) {
      const col = colorOr(p.color, NAMED.red);
      const pattern = oneOf(p.pattern, ['plain', 'stripes', 'dots'], 'plain');
      const light2 = '#f6f1e7';
      const parts = new Parts();
      const sx = -0.034, H = 0.9, R = 0.56, dome = 0.17, panels = 8;
      // a hooked handle under the fist and the shaft up past the shoulder
      parts.add(taper([[sx, 0.05, 0], [sx, -0.045, 0], [sx + 0.012, -0.08, 0], [sx + 0.04, -0.093, 0], [sx + 0.066, -0.08, 0], [sx + 0.072, -0.058, 0]], [0.016, 0.014], { segments: 14, radial: 7 }), PALETTE.woodDark);
      parts.add(roundCyl(0.0095, H - dome + 0.02, { bevel: 0.004, segments: 7, steps: 1 }), '#c9c3b6', { at: [sx, 0.04, 0] });
      // the canopy: panels sagging between ribs, with a light trim round the rim
      const rows = [], cols = panels * 3;
      const fs = [0.04, 0.22, 0.42, 0.62, 0.8, 0.93, 1];
      for (const f of fs) {
        const row = [];
        for (let j = 0; j <= cols; j++) {
          const a = (j / cols) * TAU;
          const between = 1 - Math.abs(Math.cos((panels * a) / 2));
          const rr = R * Math.sin(f * Math.PI / 2) * (1 - 0.06 * between * f);
          const y = H - dome * (1 - Math.cos(f * Math.PI / 2)) - 0.035 * between * f * f;
          row.push([sx + Math.cos(a) * rr, y, Math.sin(a) * rr]);
        }
        rows.push(row);
      }
      const cloth = { slot: 'cloth', color: col, double: true };
      const trim = pattern === 'stripes' ? shade(col, -0.08) : light2;
      addPainted(parts, loft(rows, { wrap: true }), cloth, undefined, (c, x, y, z, nx, ny, nz, f) => {
        const j = Math.floor(f / 2) % cols, ringN = Math.floor(Math.floor(f / 2) / cols);
        if (pattern === 'stripes' && Math.floor(j / 3) % 2) c.set(light2);
        if (ringN === fs.length - 2) c.set(trim);
      }, true);
      if (pattern === 'dots') {
        for (let k = 0; k < panels; k++) {
          for (const [f, off] of [[0.45, 0.5], [0.85, 0]]) {
            const a = ((k + off) / panels) * TAU;
            const rr = R * Math.sin(f * Math.PI / 2) * 0.985, y = H - dome * (1 - Math.cos(f * Math.PI / 2)) - (off ? 0.02 : 0.012) * f;
            const n = new THREE.Vector3(Math.cos(a) * Math.sin(f * Math.PI / 2) * 0.55, 1, Math.sin(a) * Math.sin(f * Math.PI / 2) * 0.55).normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
            parts.add(cyl(0.045, 0.006, { segments: 10 }), { ...cloth, color: light2 }, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(sx + Math.cos(a) * rr, y + 0.004, Math.sin(a) * rr), q, new THREE.Vector3(1, 1, 1)) });
          }
        }
      }
      // tip, top knob and the rib ends
      parts.add(sphere(0.022, 8, 6), PALETTE.woodDark, { at: [sx, H + 0.02, 0] });
      for (let k = 0; k < panels; k++) {
        const a = (k / panels) * TAU;
        parts.add(sphere(0.011, 6, 4), '#c9c3b6', { at: [sx + Math.cos(a) * R, H - dome - 0.004, Math.sin(a) * R] });
        parts.add(stick([sx, H - dome - 0.2, 0], [sx + Math.cos(a) * R * 0.5, H - dome * (1 - Math.cos(0.5 * Math.PI / 2)) - 0.02, Math.sin(a) * R * 0.5], 0.0045, { segments: 4 }), '#c9c3b6');
      }
      parts.add(roundCyl(0.016, 0.03, { bevel: 0.006, segments: 8, steps: 1 }), '#c9c3b6', { at: [sx, H - dome - 0.215, 0] });
      const g = parts.build('held-umbrella');
      return finish(g, { footprint: { r: 0.1 }, spots: {}, tick: holdTick(g, { upright: 1, lean: [0, 0, 0.3] }) });
    },
  },

  'held-fishingrod': {
    ...HELD,
    label: 'Fishing rod (held)',
    about: 'A bamboo fishing rod with a reel, held out in front; the line hangs straight down to a red and white bobber (make the line longer to reach the water from a dock).',
    params: {
      color: { default: '#d8b56c', type: 'color', about: 'rod color (bamboo by default)' },
      line: { default: 0.55, min: 0.1, max: 3, about: 'how far the line hangs below the rod tip' },
    },
    examples: [{}, { clip: 'Walk' }, { color: 'red', line: 0.9 }, { clip: 'Sit', line: 1.0 }, { hand: 'leftHand', clip: 'Walk' }],
    build(p) {
      const rod = colorOr(p.color, '#d8b56c');
      const lineLen = size(p.line, 0.55, 0.1, 3);
      const parts = new Parts();
      const d = new THREE.Vector3(-0.22, 0.55, 0.8).normalize();
      const at = (k) => d.clone().multiplyScalar(k).toArray();
      const L = 1.15;
      parts.add(taper([at(-0.12), at(0.07)], [0.017, 0.015], { segments: 2, radial: 9 }), '#c99a66');
      parts.add(taper([at(0.07), at(L)], (u) => lerp(0.011, 0.0045, u), { segments: 6, radial: 7 }), rod);
      for (const k of [0.3, 0.55, 0.8, 1.0]) parts.add(stick(at(k - 0.006), at(k + 0.006), lerp(0.0125, 0.007, (k - 0.07) / L), { segments: 7 }), shade(rod, -0.12));
      // the reel hangs under the rod just ahead of the fist
      const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const below = new THREE.Vector3().crossVectors(side, d).normalize().multiplyScalar(-1);
      const reelC = d.clone().multiplyScalar(0.1).addScaledVector(below, 0.035);
      parts.add(stick(d.clone().multiplyScalar(0.1).toArray(), reelC.toArray(), 0.006, { segments: 5 }), PALETTE.ironLight);
      const reelQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), side);
      parts.add(roundCyl(0.03, 0.024, { bevel: 0.008, segments: 12, steps: 1 }), { slot: 'metal', color: '#9aa6b0' }, { matrix: new THREE.Matrix4().compose(reelC.clone().addScaledVector(side, -0.012), reelQ, new THREE.Vector3(1, 1, 1)) });
      parts.add(sphere(0.01, 6, 4), PALETTE.woodDark, { at: reelC.clone().addScaledVector(side, -0.022).addScaledVector(below, 0.02).toArray() });
      parts.add(sphere(0.008, 6, 4), shade(rod, -0.15), { at: at(L + 0.004) });
      const g = parts.build('held-fishingrod');
      // the line and bobber hang level from the tip
      const lineG = new THREE.Group();
      lineG.position.set(...at(L));
      const lp = new Parts();
      lp.add(cyl(0.0022, lineLen, { segments: 4 }), '#f4f1ea', { at: [0, -lineLen, 0] });
      lp.add(sphere(0.024, 10, 6, 0, TAU, 0, Math.PI / 2), '#e0574c', { at: [0, -lineLen, 0] });
      lp.add(new THREE.SphereGeometry(0.024, 10, 6, 0, TAU, Math.PI / 2, Math.PI / 2), '#f6f1e7', { at: [0, -lineLen, 0] });
      lp.add(cyl(0.004, 0.02, { segments: 5 }), '#e0574c', { at: [0, -lineLen + 0.02, 0] });
      adopt(lineG, lp.build('line'));
      g.add(lineG);
      return finish(g, { footprint: { r: 0.15 }, spots: {}, tick: holdTick(g, { upright: 0.75, level: [lineG] }) });
    },
  },

  'held-net': {
    ...HELD,
    label: 'Bug net (held)',
    about: 'A bug-catching net on a long wooden pole, held up and forward, its soft mesh bag drooping from the hoop.',
    params: {
      color: { default: 'white', type: 'color', about: 'mesh color' },
      hoop: { default: 'green', type: 'color', about: 'hoop and grip color' },
    },
    examples: [{}, { clip: 'Walk' }, { color: 'sky', hoop: 'orange' }, { color: 'lemon', hoop: 'red', clip: 'Run' }],
    build(p) {
      const mesh = colorOr(p.color, NAMED.white), hoopCol = colorOr(p.hoop, NAMED.green);
      const parts = new Parts();
      const d = new THREE.Vector3(-0.24, 0.84, 0.48).normalize();
      const at = (k) => d.clone().multiplyScalar(k);
      const L = 0.78, HR = 0.12;
      parts.add(taper([at(-0.11).toArray(), at(L).toArray()], [0.015, 0.013], { segments: 3, radial: 8 }), PALETTE.woodLight);
      parts.add(taper([at(-0.1).toArray(), at(0.05).toArray()], [0.019, 0.019], { segments: 2, radial: 8 }), hoopCol);
      // the hoop, in line with the pole like a racket, and the bag hanging from it
      const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const n = new THREE.Vector3().crossVectors(d, side).normalize();
      if (n.y > 0) n.negate();
      const hc = at(L + HR);
      const hoopQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      parts.add(ring(HR, 0.009, { radial: 6, tubular: 26 }), hoopCol, { matrix: new THREE.Matrix4().compose(hc, hoopQ, new THREE.Vector3(1, 1, 1)) });
      const bag = [];
      for (let i = 0; i <= 5; i++) {
        const u = i / 5;
        bag.push(hc.clone().addScaledVector(n, 0.04 + 0.2 * u).add(new THREE.Vector3(0, -0.12 * u * u, 0)).toArray());
      }
      addPainted(parts, taper(bag, (u) => HR * (1 - 0.82 * Math.pow(u, 1.6)), { segments: 8, radial: 12, caps: true }), { slot: 'cloth', color: mesh, double: true, transparent: true, opacity: 0.62 }, undefined, (c, x, y, z, nx, ny, nz, f) => {
        const q = Math.floor(f / 2);
        if ((q + Math.floor(q / 12)) % 2) c.offsetHSL(0, 0, -0.08);
      }, true);
      const g = parts.build('held-net');
      return finish(g, { footprint: { r: 0.15 }, spots: {}, tick: holdTick(g, { upright: 0.7 }) });
    },
  },

  'held-basket': {
    ...HELD,
    label: 'Basket (held)',
    about: 'A woven basket carried by its arched handle, swinging gently at your side. Filled with fruit, flowers, bread, eggs or a fish.',
    params: {
      contents: { default: 'fruit', options: ['fruit', 'flowers', 'bread', 'eggs', 'fish', 'empty'], about: 'what is in it' },
      color: { default: '#d8b26a', type: 'color', about: 'wicker color' },
    },
    examples: [{}, { contents: 'flowers', clip: 'Walk' }, { contents: 'bread', clip: 'Carry' }, { contents: 'eggs' }, { contents: 'fish' }],
    build(p, ctx) {
      const wick = colorOr(p.color, '#d8b26a');
      const contents = oneOf(p.contents, ['fruit', 'flowers', 'bread', 'eggs', 'fish', 'empty'], 'fruit');
      const r = rand(ctx, 'basket');
      const parts = new Parts();
      const rimY = -0.098, sx = 0.66;
      // handle arch
      const arch = [];
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; arch.push([0, rimY + 0.098 * Math.sin(a), 0.1 * Math.cos(a)]); }
      parts.add(tube(arch, 0.011, { segments: 16, radial: 6 }), shade(wick, -0.08));
      // body: a thin woven bowl, oval
      const body = lathe([[0, rimY - 0.105], [0.085, rimY - 0.105], [0.1, rimY - 0.095], [0.108, rimY - 0.06], [0.112, rimY], [0.1, rimY + 0.002], [0.098, rimY - 0.02], [0.094, rimY - 0.09], [0, rimY - 0.09]], 18);
      body.scale(sx, 1, 1);
      addPainted(parts, body, wick, undefined, (c, x, y) => { if (Math.floor((y - rimY) / -0.022) % 2) c.offsetHSL(0, 0, -0.045); });
      for (const y of [rimY + 0.003, rimY - 0.07]) {
        const rg = ring(y > rimY ? 0.108 : 0.106, 0.009, { radial: 5, tubular: 22 });
        rg.scale(sx, 1, 1);
        parts.add(rg, shade(wick, -0.12), { at: [0, y, 0] });
      }
      const inside = rimY - 0.03;
      if (contents === 'fruit') {
        const fruit = [['#e2483f', [0.02, 0, -0.04]], ['#f29a3a', [-0.015, 0.01, 0.03]], ['#9cc94a', [0.01, -0.004, 0.065]], ['#e2483f', [-0.02, -0.01, -0.075]]];
        for (const [c, [x, y, z]] of fruit) {
          parts.add(sphere(0.036, 10, 8), c, { at: [x, inside + 0.02 + y, z] });
          parts.add(cyl(0.004, 0.016, { segments: 4 }), PALETTE.woodDark, { at: [x, inside + 0.05 + y, z] });
        }
      } else if (contents === 'flowers') {
        const cols = [NAMED.pink, NAMED.yellow, NAMED.white, NAMED.lilac];
        for (let i = 0; i < 4; i++) {
          const z = -0.06 + i * 0.04, x = (i % 2 ? 1 : -1) * 0.015;
          parts.add(petalCup(0.04, 0.03, 5, { rows: 2, per: 3, phase: r.angle() }), { slot: 'solid', color: cols[i], double: true }, { at: [x, inside + 0.035 + (i % 2) * 0.012, z], rot: [r.float(-0.3, 0.3), 0, r.float(-0.3, 0.3)] });
          parts.add(sphere(0.012, 6, 4), '#f4c542', { at: [x, inside + 0.045 + (i % 2) * 0.012, z] });
        }
        for (const z of [-0.08, 0.075]) parts.add(sphere(0.04, 8, 6), { slot: 'foliage', color: '#6fae55' }, { at: [0, inside + 0.015, z], scale: [0.5, 0.45, 1] });
      } else if (contents === 'bread') {
        parts.add(taper([[0.01, inside + 0.0, -0.09], [0.0, inside + 0.07, 0.03], [-0.01, inside + 0.13, 0.11]], [0.026, 0.024], { segments: 6, radial: 8 }), '#d99a4e');
        parts.add(sphere(0.05, 10, 8), '#c9853f', { at: [0, inside + 0.015, -0.03], scale: [0.85, 0.65, 1] });
        parts.add(roundBox(0.1, 0.01, 0.13, 0.004, 1), { slot: 'cloth', color: '#f4efe6' }, { at: [0.0, inside + 0.0, 0.04], rot: [0.2, 0, 0.1] });
      } else if (contents === 'eggs') {
        parts.add(roundBox(0.11, 0.012, 0.18, 0.005, 1), { slot: 'cloth', color: '#e9d7b4' }, { at: [0, inside - 0.01, 0] });
        for (const [x, z, c] of [[0.015, -0.05, '#f7efe0'], [-0.015, 0.0, '#e9c9a0'], [0.012, 0.05, '#f7efe0']]) parts.add(sphere(0.03, 10, 8), c, { at: [x, inside + 0.022, z], scale: [0.85, 1.15, 0.85] });
      } else if (contents === 'fish') {
        addPainted(parts, sphere(1, 10, 8), '#8fb0c6', { at: [0, inside + 0.03, 0.0], scale: [0.04, 0.05, 0.12], rot: [0.5, 0, 0] }, (c, x, y) => { if (y < -0.2) c.lerp(C('#f1f2ee'), 0.7); });
        parts.add(extrude([[0, 0], [0.05, 0.05], [0.0, 0.035], [-0.05, 0.05]], 0.008, { bevel: 0.004, bevelSegments: 1 }), '#7f9fb5', { at: [0, inside + 0.07, -0.1], rot: [0.5, Math.PI / 2, 0] });
      } else {
        parts.add(roundBox(0.12, 0.012, 0.2, 0.005, 1), { slot: 'cloth', color: '#e0574c' }, { at: [0, rimY - 0.01, 0], rot: [0.06, 0, 0.12] });
        parts.add(roundBox(0.06, 0.013, 0.2, 0.004, 1), { slot: 'cloth', color: '#f6f1e7' }, { at: [0.0, rimY - 0.009, 0], rot: [0.06, 0, 0.12] });
      }
      const g = parts.build('held-basket');
      return finish(g, { footprint: { r: 0.12 }, spots: {}, tick: holdTick(g, { hang: 0.13, lean: [0, 0, -0.12] }) });
    },
  },

  'held-book': {
    ...HELD,
    label: 'Book (held)',
    about: 'A chunky hardback book carried at your side by its top edge (or in front while carrying). Cover color and a little title plate.',
    params: {
      color: { default: 'navy', type: 'color', about: 'cover color' },
    },
    examples: [{}, { color: 'red', clip: 'Walk' }, { color: 'green', clip: 'Carry' }, { color: 'purple' }],
    build(p) {
      const cover = colorOr(p.color, NAMED.navy);
      const parts = new Parts();
      const T = 0.045, Hh = 0.18, W = 0.14;
      const top = 0.02, cz = 0.025;
      parts.add(roundBox(T, Hh, W, 0.01, 1), cover, { at: [0, top - Hh, cz] });
      parts.add(roundBox(T - 0.012, Hh - 0.012, W - 0.008, 0.004, 1), '#f6efdf', { at: [0, top - Hh + 0.006, cz + 0.006] });
      parts.add(roundBox(T + 0.004, Hh + 0.002, 0.026, 0.01, 1), shade(cover, -0.08), { at: [0, top - Hh - 0.001, cz - W / 2 + 0.012] });
      for (const y of [top - 0.035, top - Hh + 0.035]) parts.add(roundBox(T + 0.008, 0.012, 0.028, 0.005, 1), PALETTE.gold, { at: [0, y, cz - W / 2 + 0.012] });
      for (const sx of [1, -1]) {
        parts.add(roundBox(0.004, 0.05, 0.075, 0.002, 1), '#f4e7cc', { at: [sx * (T / 2 + 0.001), top - Hh * 0.42, cz + 0.008] });
        parts.add(roundBox(0.005, 0.008, 0.05, 0.002, 1), shade(cover, -0.1), { at: [sx * (T / 2 + 0.002), top - Hh * 0.42 + 0.02, cz + 0.008] });
      }
      const g = parts.build('held-book');
      return finish(g, { footprint: { r: 0.1 }, spots: {}, tick: holdTick(g, { upright: 0.5, lean: [0.05, 0, 0] }) });
    },
  },

  'held-letter': {
    ...HELD,
    label: 'Letter (held)',
    about: 'An envelope held up by its corner, sealed with a little heart, with a stamp on the front.',
    params: {
      color: { default: 'cream', type: 'color', about: 'envelope color' },
      seal: { default: 'red', type: 'color', about: 'wax seal color' },
    },
    examples: [{}, { color: 'pink', seal: 'rose', clip: 'Walk' }, { color: 'sky', seal: 'gold', clip: 'Talk' }, { color: 'mint' }],
    build(p) {
      const paper = colorOr(p.color, NAMED.cream), sealCol = colorOr(p.seal, NAMED.red);
      const parts = new Parts();
      const env = new THREE.Group();
      const ep = new Parts();
      const W = 0.17, Hh = 0.115, T = 0.008;
      ep.add(roundBox(W, Hh, T, 0.0032, 1), paper);
      // the flap's V on the back and the address lines and stamp on the front
      const flap = extrude([[-W / 2 + 0.006, Hh - 0.006], [W / 2 - 0.006, Hh - 0.006], [0, Hh * 0.38]], 0.0025, { bevel: 0.0015, bevelSegments: 1, curveSegments: 1 });
      ep.add(flap, shade(paper, -0.05), { at: [0, 0, -T / 2 - 0.0015] });
      const heart = extrude([[0, -0.012], [0.012, 0.0], [0.012, 0.007], [0.006, 0.011], [0, 0.006], [-0.006, 0.011], [-0.012, 0.007], [-0.012, 0.0]], 0.004, { bevel: 0.0025, bevelSegments: 1, curveSegments: 2 });
      ep.add(heart, sealCol, { at: [0, Hh * 0.4, -T / 2 - 0.004], rot: [0, Math.PI, 0] });
      ep.add(roundBox(0.026, 0.03, 0.002, 0.001, 1), NAMED.sky, { at: [W / 2 - 0.022, Hh - 0.04, T / 2 + 0.0006] });
      ep.add(roundBox(0.02, 0.022, 0.0025, 0.001, 1), NAMED.coral, { at: [W / 2 - 0.022, Hh - 0.036, T / 2 + 0.001] });
      for (const [y, w] of [[0.034, 0.07], [0.022, 0.055]]) ep.add(roundBox(w, 0.004, 0.002, 0.001, 1), '#9b8f7c', { at: [-0.012, y, T / 2 + 0.0006] });
      adopt(env, ep.build('envelope'));
      env.position.set(-0.016, -0.018, 0.02);
      env.rotation.set(0, -0.55, 0.42);
      env.translateX(-W / 2 + 0.02);
      const g = new THREE.Group();
      g.add(env);
      return finish(g, { footprint: { r: 0.1 }, spots: {}, tick: holdTick(g, { upright: 0.5 }) });
    },
  },

  'held-cup': {
    ...HELD,
    label: 'Cup (held)',
    about: 'A chunky mug held by its handle, kept level so it never spills; hot drinks steam.',
    params: {
      drink: { default: 'coffee', options: ['coffee', 'tea', 'cocoa', 'milk', 'juice', 'empty'], about: 'what is in it (coffee, tea and cocoa steam)' },
      color: { default: 'white', type: 'color', about: 'mug color' },
    },
    examples: [{}, { drink: 'cocoa', color: 'red', clip: 'Carry' }, { drink: 'tea', color: 'mint', clip: 'Talk' }, { drink: 'juice', color: 'yellow', clip: 'Walk' }],
    build(p, ctx) {
      const mugCol = colorOr(p.color, NAMED.white);
      const drink = oneOf(p.drink, ['coffee', 'tea', 'cocoa', 'milk', 'juice', 'empty'], 'coffee');
      const parts = new Parts();
      const cz = 0.06, base = -0.05, Hm = 0.085, R = 0.043;
      parts.add(lathe([[0, 0], [R - 0.008, 0], [R, 0.008], [R + 0.002, Hm - 0.006], [R - 0.002, Hm], [R - 0.008, Hm - 0.002], [R - 0.009, 0.012], [0, 0.012]], 18), mugCol, { at: [0, base, cz] });
      parts.add(roundCyl(R + 0.004, 0.018, { bevel: 0.006, segments: 18, steps: 1 }), mugCol === NAMED.white ? NAMED.blue : '#f6f1e7', { at: [0, base + Hm * 0.55, cz] });
      parts.add(ring(0.025, 0.008, { radial: 6, tubular: 14, arc: Math.PI }), mugCol, { at: [0, base + Hm * 0.5, cz - R + 0.002], rot: [0, Math.PI / 2, Math.PI / 2] });
      const fill = { coffee: '#6b4329', tea: '#c98a3d', cocoa: '#8a5a3c', milk: '#f6f3ec', juice: '#f39a3a' }[drink];
      if (fill) parts.add(cyl(R - 0.008, 0.006, { segments: 16 }), { slot: 'solid', color: fill, rough: 0.3 }, { at: [0, base + Hm - 0.018, cz] });
      if (drink === 'cocoa') for (const [x, z] of [[0.01, 0.0], [-0.012, 0.01]]) parts.add(roundBox(0.016, 0.012, 0.016, 0.005, 1), '#fbf7ef', { at: [x, base + Hm - 0.015, cz + z], rot: [0, x * 40, 0] });
      const g = parts.build('held-cup');
      // steam puffs rising from hot drinks, drifting and fading away
      const puffs = [];
      if (drink === 'coffee' || drink === 'tea' || drink === 'cocoa') {
        const steamMat = material('solid', { transparent: true, opacity: 0.42, shadow: false, snow: false, wet: false, rough: 1 });
        const geo = new THREE.SphereGeometry(0.016, 8, 6);
        geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
        for (let k = 0; k < 4; k++) {
          const m = new THREE.Mesh(geo, steamMat);
          m.castShadow = false;
          m.renderOrder = 3;
          g.add(m);
          puffs.push(m);
        }
      }
      const ph = phaseOf(ctx);
      const steam = (t) => {
        puffs.forEach((m, k) => {
          const u = (t * 0.32 + k / puffs.length + ph) % 1;
          m.position.set(0.014 * Math.sin(u * 6 + k * 2.1) + 0.006 * (k - 1.5), base + Hm + 0.005 + u * 0.11, cz + 0.01 * Math.cos(u * 5 + k));
          m.scale.set(1, 1.25, 1).multiplyScalar(Math.sin(Math.PI * Math.pow(u, 0.7)) * (0.7 + 0.5 * u));
        });
      };
      steam(0);
      return finish(g, { footprint: { r: 0.1 }, spots: {}, tick: holdTick(g, { upright: 1, extra: steam }) });
    },
  },

  'held-bouquet': {
    ...HELD,
    label: 'Bouquet (held)',
    about: 'A bouquet of flowers wrapped in paper with a ribbon, held up with the blooms forward.',
    params: {
      color: { default: 'mixed', type: 'color', about: 'flower color (mixed for a bit of everything)' },
      wrap: { default: 'cream', type: 'color', about: 'paper wrap color' },
    },
    examples: [{}, { color: 'red', wrap: 'pink', clip: 'Walk' }, { color: 'yellow', wrap: 'sky' }, { color: 'white', wrap: 'lilac', clip: 'Carry' }],
    build(p, ctx) {
      const one = p.color === 'mixed' ? null : colorOr(p.color, null);
      const wrapCol = colorOr(p.wrap, NAMED.cream);
      const r = rand(ctx, 'bouquet');
      const parts = new Parts();
      const d = new THREE.Vector3(-0.16, 0.72, 0.68).normalize();
      const M = (() => {
        const y = d.clone(), t = new THREE.Vector3(0, 1, 0);
        const z = t.addScaledVector(y, -t.dot(y)).normalize();
        const x = new THREE.Vector3().crossVectors(y, z);
        return new THREE.Matrix4().makeBasis(x, y, z);
      })();
      const add = (geo, look, at = [0, 0, 0], rot = [0, 0, 0], scale = 1) => parts.add(geo, look, { matrix: M.clone().multiply(xform(at, rot, scale)) });
      // the paper cone and ribbon
      add(lathe([[0.016, -0.06], [0.024, 0.0], [0.05, 0.1], [0.078, 0.17], [0.083, 0.178], [0.07, 0.17], [0.042, 0.1]], 16), { slot: 'cloth', color: wrapCol, double: true });
      add(ring(0.027, 0.009, { radial: 5, tubular: 14 }), NAMED.red === one ? NAMED.white : NAMED.red, [0, 0.03, 0]);
      for (const s of [1, -1]) add(ring(0.022, 0.007, { radial: 5, tubular: 12 }), NAMED.red === one ? NAMED.white : NAMED.red, [s * 0.026, 0.03, 0.022], [Math.PI / 2, 0, s * 0.5], [1, 1, 0.7]);
      // blooms in a dome, with leaves round the edge
      const palette = [NAMED.pink, NAMED.yellow, NAMED.white, NAMED.coral, NAMED.lilac];
      const spotsB = [[0, 0.205, 0], [0.045, 0.19, 0.02], [-0.04, 0.19, 0.03], [0.02, 0.188, -0.045], [-0.03, 0.186, -0.038], [0.055, 0.178, -0.02], [-0.06, 0.176, -0.005]];
      spotsB.forEach(([x, y, z], i) => {
        const col = one ?? palette[i % palette.length];
        add(petalCup(0.034, 0.024, i % 2 ? 6 : 5, { rows: 2, per: 3, phase: r.angle(), open: 0.7 }), { slot: 'solid', color: col, double: true }, [x, y, z], [x * 5, 0, -z * 5]);
        add(sphere(0.011, 6, 4), i % 2 ? '#f4c542' : shade(col, -0.15), [x, y + 0.012, z]);
      });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        add(sphere(1, 6, 4), { slot: 'foliage', color: i % 2 ? '#5fae55' : '#79c062' }, [Math.cos(a) * 0.07, 0.175, Math.sin(a) * 0.07], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], [0.018, 0.045, 0.01]);
      }
      const g = parts.build('held-bouquet');
      return finish(g, { footprint: { r: 0.12 }, spots: {}, tick: holdTick(g, { upright: 0.7 }) });
    },
  },

  'held-torch': {
    ...HELD,
    label: 'Torch (held)',
    about: 'A wooden torch with a flickering flame that always burns and lights its surroundings, day or night.',
    params: {
      flame: { default: 'orange', options: ['orange', 'blue', 'green'], about: 'flame color' },
    },
    examples: [{}, { clip: 'Walk' }, { flame: 'blue' }, { flame: 'green', clip: 'Run' }],
    build(p, ctx) {
      const kind = oneOf(p.flame, ['orange', 'blue', 'green'], 'orange');
      const [outer, inner, glow] = { orange: ['#ff8a1f', '#ffcf4d', '#ffb04a'], blue: ['#3f86ff', '#c8eeff', '#8cc4ff'], green: ['#36c25a', '#e2ffa8', '#9ff0a0'] }[kind];
      const parts = new Parts();
      const d = new THREE.Vector3(-0.35, 0.7, 0.62).normalize();
      const at = (k) => d.clone().multiplyScalar(k).toArray();
      parts.add(taper([at(-0.08), at(0.3)], [0.017, 0.023], { segments: 3, radial: 8 }), PALETTE.wood);
      for (const k of [0.27, 0.31]) parts.add(stick(at(k - 0.018), at(k + 0.018), 0.031, { segments: 9 }), k > 0.3 ? '#5a3d2a' : '#7a5233');
      parts.add(stick(at(0.33), at(0.345), 0.027, { segments: 9 }), '#3f2c22');
      const g = parts.build('held-torch');
      // the flame stays upright and flickers: a teardrop glowing from gold at the base to red at the tip
      const flameG = new THREE.Group();
      flameG.position.set(...at(0.345));
      const fp = new Parts();
      const tear = (h, w) => lathe([[0, 0], [w * 0.6, h * 0.04], [w, h * 0.22], [w * 0.92, h * 0.42], [w * 0.62, h * 0.66], [w * 0.28, h * 0.86], [0, h]], 12);
      const fire = (c, x, y) => c.copy(C(inner)).lerp(C(outer), clamp(y / 0.09, 0, 1)).lerp(C(kind === 'orange' ? '#ee4f1a' : shade(outer, -0.08)), clamp((y - 0.09) / 0.09, 0, 1));
      const fl = { slot: 'emit', color: outer, emit: 0.85 };
      addPainted(fp, tear(0.19, 0.05), fl, { at: [0, -0.01, 0] }, fire);
      addPainted(fp, tear(0.1, 0.026), fl, { at: [0.04, 0.0, 0.012], rot: [0, 0, -0.4] }, fire);
      addPainted(fp, tear(0.085, 0.022), fl, { at: [-0.038, 0.0, -0.014], rot: [0, 0, 0.45] }, fire);
      adopt(flameG, fp.build('flame'));
      g.add(flameG);
      const ph = phaseOf(ctx);
      const flicker = (t) => {
        const a = t + ph;
        flameG.scale.set(1 + 0.05 * Math.sin(a * 13), 1 + 0.12 * Math.sin(a * 9 + 1) + 0.05 * Math.sin(a * 23), 1 + 0.05 * Math.cos(a * 11));
        flameG.children.forEach((m) => { m.rotation.y = a * 0.8; });
      };
      const tip = d.clone().multiplyScalar(0.345).add(new THREE.Vector3(-0.05, 0.1, 0.04));
      return finish(g, {
        footprint: { r: 0.1 }, spots: {},
        lights: [{ ...light(tip.toArray(), { color: glow, intensity: 0.28, distance: 4.5, when: 'always' }), halo: 0.6 }],
        tick: holdTick(g, { upright: 0.8, level: [flameG], extra: flicker }),
      });
    },
  },

  'held-shovel': {
    ...HELD,
    label: 'Shovel (held)',
    about: 'A garden shovel carried at your side on a slant: blade down in front, the T grip up behind the arm. A painted collar and grip.',
    params: {
      color: { default: 'red', type: 'color', about: 'collar and grip color' },
    },
    examples: [{}, { clip: 'Walk' }, { color: 'green' }, { color: 'blue', clip: 'Run' }],
    build(p) {
      const col = colorOr(p.color, NAMED.red);
      const parts = new Parts();
      const d = new THREE.Vector3(-0.07, -0.56, 0.83).normalize();
      const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(side, d).normalize();
      const at = (k) => d.clone().multiplyScalar(k).toArray();
      parts.add(taper([at(-0.25), at(0.27)], [0.016, 0.017], { segments: 3, radial: 8 }), PALETTE.woodLight);
      // T grip at the top end
      const gEnd = d.clone().multiplyScalar(-0.255);
      parts.add(stick(gEnd.clone().addScaledVector(side, -0.042).toArray(), gEnd.clone().addScaledVector(side, 0.042).toArray(), 0.017, { segments: 8 }), col);
      // collar and blade
      parts.add(stick(at(0.25), at(0.305), 0.022, { top: 0.026, segments: 10 }), col);
      const blade = extrude([[-0.05, 0], [0.05, 0], [0.056, 0.07], [0.042, 0.11], [0, 0.13], [-0.042, 0.11], [-0.056, 0.07]], 0.006, { bevel: 0.006, bevelSegments: 1, curveSegments: 4 });
      const basisM = new THREE.Matrix4().makeBasis(side, d, up.clone().negate()).setPosition(...at(0.3));
      addPainted(parts, blade, { slot: 'solid', color: '#c3ccd3' }, { matrix: basisM.clone().multiply(xform([0, 0, 0], [0.1, 0, 0])) }, (c, x, y) => { if (y > 0.095) c.set('#e6ebee'); });
      const g = parts.build('held-shovel');
      return finish(g, { footprint: { r: 0.12 }, spots: {}, tick: holdTick(g, { upright: 0.6 }) });
    },
  },

  'held-wateringcan': {
    ...HELD,
    label: 'Watering can (held)',
    about: 'A cute round watering can with a long spout and a brass rose, carried by its top handle; it swings as you walk.',
    params: {
      color: { default: 'green', type: 'color', about: 'can color' },
    },
    examples: [{}, { color: 'blue', clip: 'Walk' }, { color: 'pink' }, { color: 'yellow', clip: 'Carry' }],
    build(p) {
      const col = colorOr(p.color, NAMED.green);
      const parts = new Parts();
      const sx = 0.74, top = -0.075;
      const body = lathe([[0, top - 0.13], [0.07, top - 0.13], [0.086, top - 0.12], [0.092, top - 0.075], [0.086, top - 0.025], [0.06, top - 0.006], [0.03, top], [0, top]], 18);
      body.scale(sx, 1, 1);
      parts.add(body, col);
      const band = roundCyl(0.095, 0.022, { bevel: 0.008, segments: 18, steps: 1 });
      band.scale(sx, 1, 1);
      parts.add(band, shade(col, 0.12), { at: [0, top - 0.088, 0] });
      parts.add(roundCyl(0.026, 0.02, { bevel: 0.006, segments: 10, steps: 1 }), shade(col, -0.1), { at: [0, top - 0.004, -0.02] });
      // top handle
      const arch = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; arch.push([0, top - 0.004 + 0.075 * Math.sin(a), 0.055 * Math.cos(a) - 0.005]); }
      parts.add(tube(arch, 0.011, { segments: 14, radial: 6 }), shade(col, -0.1));
      // spout with a rose
      parts.add(taper([[0, top - 0.105, 0.05], [0, top - 0.06, 0.13], [0, top + 0.0, 0.2]], (u) => lerp(0.018, 0.011, u), { segments: 8, radial: 7, caps: false }), col);
      const roseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.75, 0.66).normalize());
      parts.add(roundCyl(0.03, 0.026, { top: 0.034, bevel: 0.008, segments: 12, steps: 1 }), { slot: 'metal', color: PALETTE.gold }, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, top - 0.004, 0.2), roseQ, new THREE.Vector3(1, 1, 1)) });
      const g = parts.build('held-wateringcan');
      return finish(g, { footprint: { r: 0.12 }, spots: {}, tick: holdTick(g, { hang: 0.12, lean: [0, 0, -0.13] }) });
    },
  },

  'held-axe': {
    ...HELD,
    label: 'Axe (held)',
    about: 'A chunky woodcutter’s axe held near the end of its handle, head forward and up, blade facing down.',
    params: {
      color: { default: 'red', type: 'color', about: 'painted band on the handle' },
    },
    examples: [{}, { clip: 'Walk' }, { color: 'blue' }, { color: 'green', clip: 'Run' }],
    build(p) {
      const col = colorOr(p.color, NAMED.red);
      const parts = new Parts();
      const d = new THREE.Vector3(-0.08, 0.45, 0.89).normalize();
      const v = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
      const b = v.clone().negate();
      const x = new THREE.Vector3().crossVectors(d, b);
      const at = (k) => d.clone().multiplyScalar(k).toArray();
      parts.add(taper([at(-0.07), at(0.15), at(0.43)], (u) => 0.0165 + 0.004 * Math.sin(u * Math.PI), { segments: 6, radial: 8 }), PALETTE.woodLight);
      parts.add(sphere(0.022, 8, 6), PALETTE.woodDark, { at: at(-0.075), scale: [1, 1, 1] });
      parts.add(stick(at(0.2), at(0.27), 0.02, { segments: 9 }), col);
      // the head: a rounded wedge, blade facing down
      const shape = new THREE.Shape();
      shape.moveTo(-0.028, -0.04); shape.lineTo(0.028, -0.04); shape.lineTo(0.03, 0.02);
      shape.quadraticCurveTo(0.05, 0.06, 0.066, 0.1); shape.quadraticCurveTo(0, 0.13, -0.066, 0.1);
      shape.quadraticCurveTo(-0.05, 0.06, -0.03, 0.02); shape.lineTo(-0.028, -0.04);
      const head = new THREE.ExtrudeGeometry(shape, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 6 }).translate(0, 0, -0.013);
      const M = new THREE.Matrix4().makeBasis(d, b, x).setPosition(...at(0.41));
      addPainted(parts, head, { slot: 'metal', color: '#bcc5cc' }, { matrix: M }, (c, px, py) => {
        if (py > 0.088 + 0.02 * Math.abs(px) / 0.066) c.set('#eef2f4');
        else if (py < 0.015) c.set(col);
      });
      const g = parts.build('held-axe');
      return finish(g, { footprint: { r: 0.12 }, spots: {}, tick: holdTick(g, { upright: 0.6 }) });
    },
  },

  'held-bag': {
    ...HELD,
    label: 'Bag (held)',
    about: 'A canvas tote bag carried by both handles at your side, with a colored pocket. Groceries, flowers or nothing peeking out of the top.',
    params: {
      contents: { default: 'groceries', options: ['groceries', 'flowers', 'empty'], about: 'what peeks out' },
      color: { default: 'teal', type: 'color', about: 'pocket and trim color' },
      canvas: { default: '#efe2c4', type: 'color', about: 'bag color' },
    },
    examples: [{}, { color: 'red', clip: 'Walk' }, { contents: 'flowers', color: 'pink', canvas: 'white' }, { contents: 'empty', color: 'navy', canvas: 'sky', clip: 'Carry' }],
    build(p, ctx) {
      const trim = colorOr(p.color, NAMED.teal), canvas = colorOr(p.canvas, '#efe2c4');
      const contents = oneOf(p.contents, ['groceries', 'flowers', 'empty'], 'groceries');
      const r = rand(ctx, 'bag');
      const parts = new Parts();
      const top = -0.085, Hb = 0.16, W = 0.17, T = 0.065;
      const cloth = (c) => ({ slot: 'cloth', color: c });
      parts.add(roundBox(T, Hb, W, 0.022, 2), cloth(canvas), { at: [0, top - Hb, 0] });
      parts.add(roundBox(T + 0.004, 0.026, W + 0.004, 0.01, 1), cloth(trim), { at: [0, top - 0.026, 0] });
      parts.add(roundBox(0.006, 0.065, 0.09, 0.006, 1), cloth(trim), { at: [-T / 2, top - Hb + 0.035, 0.015] });
      for (const sx of [1, -1]) {
        parts.add(tube([[sx * 0.02, top - 0.012, -0.045], [sx * 0.012, top + 0.045, -0.03], [sx * 0.004, 0.0, 0], [sx * 0.012, top + 0.045, 0.03], [sx * 0.02, top - 0.012, 0.045]], 0.008, { segments: 14, radial: 5 }), cloth(trim));
      }
      if (contents === 'groceries') {
        parts.add(taper([[0.008, top - 0.08, -0.05], [0.004, top + 0.02, -0.045], [-0.006, top + 0.1, -0.03]], [0.022, 0.02], { segments: 5, radial: 8 }), '#d99a4e');
        for (let i = 0; i < 3; i++) parts.add(sphere(0.03, 8, 6), { slot: 'foliage', color: i % 2 ? '#79c062' : '#5fae55' }, { at: [r.float(-0.01, 0.01), top + 0.005 + i * 0.012, 0.03 + i * 0.012], scale: [0.7, 1.3, 0.8] });
        parts.add(sphere(0.028, 8, 6), '#e2483f', { at: [0.0, top + 0.0, 0.0] });
      } else if (contents === 'flowers') {
        const cols = [NAMED.pink, NAMED.yellow, NAMED.white];
        for (let i = 0; i < 3; i++) {
          const z = -0.045 + i * 0.045;
          parts.add(stick([0, top - 0.04, z], [0, top + 0.05 + (i % 2) * 0.02, z + 0.01], 0.005, { segments: 4 }), '#5fae55');
          parts.add(petalCup(0.035, 0.025, 5, { rows: 2, per: 3, phase: r.angle() }), { slot: 'solid', color: cols[i], double: true }, { at: [0, top + 0.05 + (i % 2) * 0.02, z + 0.01] });
          parts.add(sphere(0.01, 6, 4), '#f4c542', { at: [0, top + 0.06 + (i % 2) * 0.02, z + 0.01] });
        }
      }
      const g = parts.build('held-bag');
      return finish(g, { footprint: { r: 0.12 }, spots: {}, tick: holdTick(g, { hang: 0.12, lean: [0, 0, -0.1] }) });
    },
  },
};
