import * as THREE from 'three';
import {
  Parts, finish, spot, light, roundBox, roundCyl, cyl, cone, sphere, lathe, blob, tube, extrude, ring, xform, material,
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
 * Add a piece and paint it: `painter(color, x, y, z, nx, ny, nz)` gets the look's color and a
 * point in the piece's own space (before `at/rot/scale`) and changes the color. With `perFace`
 * whole triangles take one color (crisp stripes and bands).
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
    painter(c, p.x, p.y, p.z, n.x, n.y, n.z);
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
function taper(points, radius, { segments = 16, radial = 10, caps = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(segments, false);
  const rows = [];
  const P = new THREE.Vector3();
  const rad = typeof radius === 'function' ? radius : (u) => lerp(radius[0], radius[1], u);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, P);
    const r = rad(u);
    const N = frames.normals[i], B = frames.binormals[i];
    const row = [];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      row.push([P.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), P.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), P.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z)]);
    }
    rows.push(row);
  }
  const g = loft(rows, { wrap: true, flip: true });
  if (!caps) return g;
  const geos = [g.toNonIndexed()];
  for (const end of [0, 1]) {
    const r = rad(end);
    curve.getPointAt(end, P);
    const T = curve.getTangentAt(end).multiplyScalar(end ? 1 : -1);
    const cap = new THREE.SphereGeometry(r, radial, 4, 0, TAU, 0, Math.PI / 2);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), T));
    cap.scale(1, 1, 1);
    cap.translate(P.x, P.y, P.z);
    geos.push(cap.toNonIndexed());
  }
  return mergeAll(geos);
}

/** Merge plain geometries (positions and normals only). */
function mergeAll(geos) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
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

/** Push every vertex out along its direction from `center` by `amount * noise` (lumpy stones, logs). */
function lumpy(g, { amp = 0.04, freq = 3, seed = 0, keep = null } = {}) {
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const o = (seed % 97) * 1.37;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (keep && keep(v)) continue;
    const n = noise3(v.x * freq + o, v.y * freq - o, v.z * freq + o * 0.5);
    const d = Math.hypot(v.x, v.z) || 1;
    pos.setXYZ(i, v.x + (v.x / d) * amp * n, v.y, v.z + (v.z / d) * amp * n);
  }
  g.computeVertexNormals();
  return g;
}

/* ───────────────────────── boats ───────────────────────── */

/**
 * A boat hull from stations along its length (t 0 = stern, 1 = bow). Returns the outer and inner
 * shells, the rim between them and helpers for fitting seats and rails.
 */
function hullModel({ L = 2, B = 0.42, D = 0.14, sheer = 0.24, bowRise = 0.09, sternRise = 0.03, transom = 0.62, th = 0.035, fullness = 0.72 } = {}) {
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
  const N = 22, M = 15;
  const outer = [], inner = [], rimL = [], rimR = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, z = zOf(t);
    const b = half(t), yk = keelY(t), yt = topY(t);
    const bi = Math.max(0.002, b - th), yki = Math.min(yk + th, yt - 0.01);
    const ro = [], ri = [];
    for (let j = 0; j < M; j++) {
      const s = -1 + (2 * j) / (M - 1);
      const [x, y] = section(b, yk, yt, s);
      const [xi, yi] = section(bi, yki, yt, s);
      ro.push([x, y, z]);
      ri.push([xi, yi, z]);
    }
    outer.push(ro); inner.push(ri);
    rimL.push([ro[0], ri[0]]);
    rimR.push([ro[M - 1], ri[M - 1]]);
  }
  const outerGeo = loft(outer);
  const innerGeo = loft(inner, { flip: true });
  const rimGeo = mergeAll([loft(rimL, { flip: true }), loft(rimR)]);
  /** Half-width of the inside at height y, station t. */
  const insideHalf = (t, y) => {
    const b = Math.max(0.002, half(t) - th), yk = Math.min(keelY(t) + th, topY(t) - 0.01), yt = topY(t);
    const f = clamp((y - yk) / Math.max(1e-3, yt - yk), 0, 1);
    const s = (2 / Math.PI) * Math.acos(1 - f);
    return b * Math.pow(Math.sin(s * (Math.PI / 2)), fullness);
  };
  const transomOutline = [];
  for (let j = 0; j < M; j++) {
    const s = -1 + (2 * j) / (M - 1);
    transomOutline.push(section(half(0), keelY(0), topY(0), s));
  }
  return { L, B, half, keelY, topY, zOf, insideHalf, outerGeo, innerGeo, rimGeo, transomOutline, th };
}

/** The hull pieces of a boat into `parts`: shell, rim, rails, stem, keel, transom. */
function addHull(parts, h, { hull, bottom, stripe, rail, inside, waterline = 0.0, weathered = false, r = null }) {
  const bandLo = waterline + 0.012, bandHi = waterline + 0.048;
  addPainted(parts, h.outerGeo, hull, undefined, (c, x, y) => {
    if (y < bandLo) c.set(bottom);
    else if (y < bandHi) c.set(stripe);
    if (weathered) {
      const n = noise3(x * 6, y * 9, 1.3) * 0.5 + noise3(x * 17, y * 23, 4.1) * 0.25;
      c.lerp(C('#8f8a80'), clamp(0.25 + n, 0, 0.6));
    }
  }, true);
  // the inside: planking bands
  addPainted(parts, h.innerGeo, inside, undefined, (c, x, y) => {
    const band = Math.floor((y + 0.3) / 0.055);
    c.offsetHSL(0, 0, band % 2 ? 0.025 : -0.02);
    if (weathered) c.lerp(C('#8a8478'), 0.35 + 0.2 * noise3(x * 9, y * 7, 2.2));
  }, true);
  parts.add(h.rimGeo, rail);
  // rub rails along the sheer, meeting at the bow
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push([side * (h.half(t) + 0.006), h.topY(t) - 0.012, h.zOf(t)]);
    }
    parts.add(taper(pts, [0.024, 0.02], { segments: 20, radial: 7 }), rail);
  }
  // stem: a rounded post up the bow
  const stem = [];
  for (let i = 0; i <= 6; i++) {
    const t = 0.72 + (0.28 * i) / 6;
    stem.push([0, h.keelY(t) - 0.005, h.zOf(t) + 0.004]);
  }
  stem.push([0, h.topY(1) + 0.02, h.zOf(1) + 0.01]);
  parts.add(taper(stem, [0.03, 0.034], { segments: 14, radial: 8 }), rail);
  // keel strip
  const keel = [];
  for (let i = 0; i <= 8; i++) {
    const t = 0.03 + (0.72 * i) / 8;
    keel.push([0, h.keelY(t) - 0.008, h.zOf(t)]);
  }
  parts.add(taper(keel, [0.022, 0.022], { segments: 12, radial: 6 }), bottom);
  // transom board
  const tg = extrude(h.transomOutline, 0.03, { bevel: 0.012, bevelSegments: 1, curveSegments: 4 });
  addPainted(parts, tg, hull, { at: [0, 0, h.zOf(0) + 0.006] }, (c, x, y) => {
    if (y < bandLo) c.set(bottom);
    else if (y < bandHi) c.set(stripe);
    if (weathered) c.lerp(C('#8f8a80'), 0.35);
  }, true);
  void r;
}

/** One oar: shaft along +X from the handle (origin) with the blade at the far end. */
function oarParts(len = 1.05, wood = PALETTE.woodLight, tip = '#f4efe6', broken = false) {
  const p = new Parts();
  const L = broken ? len * 0.55 : len;
  p.add(roundCyl(0.017, L, { bevel: 0.008, segments: 8, steps: 1 }), wood, { rot: [0, 0, -Math.PI / 2] });
  p.add(roundCyl(0.024, 0.12, { bevel: 0.01, segments: 8, steps: 1 }), shade(wood, -0.08), { rot: [0, 0, -Math.PI / 2] });
  if (!broken) {
    p.add(roundBox(0.26, 0.016, 0.085, 0.008, 1), wood, { at: [len - 0.13, -0.008, 0] });
    p.add(roundBox(0.1, 0.018, 0.088, 0.008, 1), tip, { at: [len - 0.05, -0.009, 0] });
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
      for (const child of level) {
        child.parent.updateWorldMatrix(true, false);
        child.parent.getWorldQuaternion(_qa);
        child.quaternion.copy(_qa).invert().multiply(_qf);
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
  painted: { deck: ['#f3eee4', '#ebe4d6', '#f7f3ea'], frame: '#4f86c6', post: '#3f6fae', cap: '#f6f1e7', trim: '#4f86c6' },
};

export const WATERSIDE = {
  dock: {
    label: 'Dock',
    about: 'A wooden pier. Its origin is the shore end, on the bank; the deck runs toward +Z over the water at about 0.08 and its posts go down into the water. Sit at the end with your legs over the edge, or along the side.',
    params: {
      length: { default: 4, min: 1.5, max: 12, about: 'how far the deck reaches out over the water' },
      width: { default: 1.4, min: 0.8, max: 3, about: 'deck width' },
      ladder: { default: true, about: 'a ladder down into the water near the end' },
      lamp: { default: false, about: 'a lantern post at the end that lights up at night' },
      style: { default: 'natural', options: ['natural', 'weathered', 'painted'], about: 'warm wood, sea-grey wood, or white planks with blue trim' },
    },
    examples: [{}, { style: 'weathered', length: 2.6, ladder: false }, { style: 'painted', length: 5, width: 1.8, lamp: true }],
    build(p, ctx) {
      const L = size(p.length, 4, 1.5, 12), W = size(p.width, 1.4, 0.8, 3);
      const style = oneOf(p.style, ['natural', 'weathered', 'painted'], 'natural');
      const pal = DOCK_WOODS[style];
      const r = rand(ctx, 'dock');
      const parts = new Parts();
      const top = 0.08, plankT = 0.05;
      // planks across the deck
      const pitch = 0.205, n = Math.max(3, Math.round((L + 0.15) / pitch));
      const step = (L + 0.15) / n;
      for (let i = 0; i < n; i++) {
        const z = -0.15 + (i + 0.5) * step;
        const w = W + r.float(-0.03, 0.03);
        const col = shade(r.pick(pal.deck), r.float(-0.025, 0.025));
        parts.add(roundBox(w, plankT, step - 0.024, 0.014, 1), col, { at: [r.float(-0.012, 0.012), top - plankT, z], rot: [0, r.float(-0.012, 0.012), 0] });
      }
      // stringers under the planks and a darker fascia board down each side
      for (const s of [1, -1]) {
        parts.add(roundBox(0.09, 0.11, L + 0.12, 0.02, 1), pal.frame, { at: [s * (W / 2 - 0.16), top - plankT - 0.11, L / 2 - 0.09] });
        parts.add(roundBox(0.04, 0.11, L + 0.17, 0.016, 1), pal.trim, { at: [s * (W / 2 + 0.012), top - plankT - 0.085, L / 2 - 0.075] });
      }
      // end board across the front
      parts.add(roundBox(W + 0.06, 0.11, 0.04, 0.016, 1), pal.trim, { at: [0, top - plankT - 0.085, L + 0.012] });
      // posts in pairs, sticking up as bollards with round caps
      const bays = Math.max(1, Math.round(L / 1.35));
      const postZ = [];
      for (let i = 0; i <= bays; i++) postZ.push(lerp(0.25, L - 0.12, i / bays));
      for (const z of postZ) {
        for (const s of [1, -1]) {
          const x = s * (W / 2 + 0.06);
          parts.add(roundCyl(0.072, 1.45, { top: 0.068, bevel: 0.03, segments: 12, steps: 2 }), pal.post, { at: [x, -1.25, z] });
          parts.add(roundCyl(0.078, 0.05, { bevel: 0.022, segments: 12, steps: 2 }), pal.cap, { at: [x, 0.19, z] });
        }
        // a cross beam under the deck between the pair
        parts.add(roundBox(W + 0.1, 0.07, 0.07, 0.02, 1), pal.frame, { at: [0, -0.16, z] });
      }
      // the shore end: a sturdy sill sunk into the bank and a step down
      parts.add(roundBox(W + 0.24, 0.16, 0.2, 0.03, 1), pal.post, { at: [0, top - plankT - 0.14, -0.06] });
      parts.add(roundBox(W * 0.62, 0.05, 0.22, 0.016, 1), pal.deck[1], { at: [0, -0.06, -0.34] });
      // a rope coiled on the deck near the end, and a cleat
      const ropeCol = '#e9d6a7';
      const coil = [];
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * TAU * 2.6, rr = 0.11 - (i / 40) * 0.05;
        coil.push([Math.cos(a) * rr, top + 0.018 + (i / 40) * 0.012, Math.sin(a) * rr]);
      }
      const coilX = -(W / 2 - 0.3), coilZ = L - 0.55;
      parts.add(tube(coil, 0.017, { segments: 60, radial: 6 }), { slot: 'cloth', color: ropeCol }, { at: [coilX, 0, coilZ] });
      parts.add(tube([[coilX + 0.1, top + 0.02, coilZ + 0.02], [coilX + 0.22, top + 0.03, coilZ + 0.18], [-(W / 2 + 0.06) + 0.02, 0.17, L - 0.12 + 0.02]], 0.016, { segments: 14, radial: 6 }), { slot: 'cloth', color: ropeCol });
      parts.add(roundBox(0.2, 0.035, 0.05, 0.015, 1), PALETTE.iron, { at: [W / 2 - 0.22, top, L - 0.35] });
      parts.add(roundBox(0.05, 0.04, 0.04, 0.012, 1), PALETTE.iron, { at: [W / 2 - 0.22, top - 0.005, L - 0.35] });
      const spots = {
        end: spot([0, top, L - 0.06], 0, 'sit'),
        endLeft: spot([0.32, top, L - 0.06], 0, 'sit'),
        endRight: spot([-0.32, top, L - 0.06], 0, 'sit'),
        side: spot([-(W / 2 - 0.06), top, L * 0.55], -90, 'sit'),
        along: spot([0, top, L * 0.5], 0, 'stand'),
        shore: spot([0, top, 0.25], 0, 'stand'),
      };
      if (flag(p.ladder, true)) {
        const lx = W / 2 + 0.03, lz = L - 0.62;
        const steel = '#c9d0d6';
        for (const dz of [-0.13, 0.13]) {
          parts.add(tube([[lx + 0.02, -0.75, lz + dz], [lx + 0.02, 0.05, lz + dz], [lx - 0.02, 0.27, lz + dz], [lx - 0.18, 0.3, lz + dz], [lx - 0.27, top + 0.01, lz + dz]], 0.018, { segments: 24, radial: 7 }), { slot: 'metal', color: steel });
        }
        for (let i = 0; i < 4; i++) {
          parts.add(roundBox(0.06, 0.025, 0.28, 0.01, 1), { slot: 'metal', color: steel }, { at: [lx + 0.03, -0.12 - i * 0.17, lz] });
        }
        spots.ladder = spot([lx - 0.35, top, lz], 90, 'stand');
      }
      const lights = [];
      if (flag(p.lamp, false)) {
        const x = W / 2 + 0.06, z = L - 0.12;
        parts.add(roundCyl(0.03, 0.95, { top: 0.026, bevel: 0.01, segments: 10, steps: 1 }), PALETTE.iron, { at: [x, 0.24, z] });
        parts.add(roundCyl(0.055, 0.03, { bevel: 0.01, segments: 12, steps: 1 }), PALETTE.iron, { at: [x, 1.17, z] });
        parts.add(roundCyl(0.075, 0.19, { top: 0.09, bevel: 0.02, segments: 14, steps: 2 }), { slot: 'lamp', color: '#fff0c8' }, { at: [x, 1.2, z] });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + Math.PI / 4;
          parts.add(roundBox(0.018, 0.21, 0.018, 0.006, 1), PALETTE.iron, { at: [x + Math.cos(a) * 0.09, 1.19, z + Math.sin(a) * 0.09] });
        }
        parts.add(lathe([[0, 0], [0.14, 0], [0.13, 0.02], [0.07, 0.08], [0.02, 0.11], [0, 0.11]], 14), PALETTE.iron, { at: [x, 1.39, z] });
        parts.add(sphere(0.025, 8, 6), PALETTE.gold, { at: [x, 1.51, z] });
        lights.push(light([x, 1.3, z], { intensity: 1.2, distance: 7 }));
      }
      return finish(parts.build('dock'), {
        footprint: { w: W + 0.4, d: Math.min(L, 3) * 2 },
        spots,
        lights,
        height: 0.3,
      });
    },
  },

  boat: {
    label: 'Rowboat',
    floats: true,
    about: 'A wooden rowboat. Afloat it bobs on the water with its oars out (the origin is the waterline); beached it rests tilted on the shore with the oars inside; a wreck is grey, half sunk and listing. Three seats.',
    params: {
      color: { default: 'blue', type: 'color', about: 'hull paint (a color name or #hex)' },
      state: { default: 'floating', options: ['floating', 'beached', 'wreck'], about: 'afloat, pulled up on the shore, or wrecked' },
      oars: { default: true, about: 'with a pair of oars' },
    },
    examples: [{}, { state: 'beached', color: 'red' }, { state: 'wreck' }, { color: 'yellow' }, { color: 'green', state: 'beached', oars: false }],
    build(p, ctx) {
      const state = oneOf(p.state, ['floating', 'beached', 'wreck'], 'floating');
      const wreck = state === 'wreck';
      const hullCol = wreck ? '#8d97a0' : colorOr(p.color, NAMED.blue);
      const h = hullModel({ L: 2.0, B: 0.43, D: 0.13, sheer: 0.24 });
      const outer = new THREE.Group();
      const boat = new Parts();
      const rail = wreck ? '#b9b1a2' : '#f4ead6';
      const inside = wreck ? '#a39a88' : PALETTE.woodLight;
      const seatCol = wreck ? '#978d7b' : PALETTE.wood;
      addHull(boat, h, {
        hull: hullCol,
        bottom: wreck ? '#6f6a63' : shade(hullCol, -0.2, { sat: -0.08 }),
        stripe: wreck ? '#c9c1b2' : '#f6f0e4',
        rail, inside, weathered: wreck,
      });
      // seats (thwarts) and their supports
      const seats = [[0.22, 0.1], [0.5, 0.11], [0.78, 0.13]];
      const seatTops = [];
      for (const [t, y] of seats) {
        const z = h.zOf(t), hw = h.insideHalf(t, y) - 0.004;
        boat.add(roundBox(hw * 2, 0.035, 0.17, 0.014, 1), seatCol, { at: [0, y - 0.035, z] });
        boat.add(roundBox(0.06, Math.max(0.02, y - 0.035 - h.keelY(t) - 0.03), 0.05, 0.015, 1), shade(seatCol, -0.08), { at: [0, h.keelY(t) + 0.03, z] });
        seatTops.push([z, y]);
      }
      // floor boards
      const fy = h.keelY(0.45) + h.th + 0.004;
      for (const dx of [-0.09, 0, 0.09]) boat.add(roundBox(0.08, 0.016, 0.7, 0.006, 1), shade(inside, -0.06), { at: [dx, fy, h.zOf(0.45)] });
      // oarlocks on the gunwale at the middle seat
      const zMid = h.zOf(0.5), yTop = h.topY(0.5);
      for (const s of [1, -1]) {
        boat.add(ring(0.03, 0.009, { radial: 5, tubular: 10, arc: Math.PI }), { slot: 'metal', color: '#9aa3ab' }, { at: [s * h.half(0.5), yTop + 0.012, zMid], rot: [Math.PI / 2, 0, 0] });
      }
      boat.build('boat').children.forEach((m) => outer.add(m));
      // oars
      const oars = flag(p.oars, true);
      if (oars) {
        const op = new Parts();
        const wood = wreck ? '#a59c8b' : PALETTE.woodLight, tip = wreck ? '#b9b1a2' : hullCol;
        if (state === 'floating') {
          for (const s of [1, -1]) {
            const o = oarParts(1.08, wood, tip);
            const piv = new THREE.Vector3(s * h.half(0.5), yTop + 0.03, zMid);
            const m = new THREE.Matrix4().compose(
              piv.clone().add(new THREE.Vector3(-s * 0.3 * Math.cos(0.3), 0.3 * Math.sin(0.3), 0.05)),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s > 0 ? 0.25 : Math.PI - 0.25, s > 0 ? -0.3 : 0.3, 'YXZ')),
              new THREE.Vector3(1, 1, 1));
            op.merge(o, m);
          }
        } else {
          const o1 = oarParts(1.08, wood, tip, wreck);
          op.merge(o1, xform([0.1, 0.16, h.zOf(0.18)], [0, -Math.PI / 2 + 0.06, 0]));
          if (!wreck) op.merge(oarParts(1.08, wood, tip), xform([-0.12, 0.165, h.zOf(0.16)], [0, -Math.PI / 2 - 0.05, 0]));
        }
        op.build('oars').children.forEach((m) => outer.add(m));
      }
      // wreck: broken planks and weed
      if (wreck) {
        const wp = new Parts();
        const r = rand(ctx, 'wreck');
        for (let i = 0; i < 3; i++) {
          wp.add(roundBox(0.05, 0.012, 0.22, 0.005, 1), '#8f877a', { at: [h.half(0.35) + 0.01, 0.06 - i * 0.05, h.zOf(0.32 + i * 0.03)], rot: [r.float(-0.5, 0.5), 0.2, 0.9] });
        }
        for (let i = 0; i < 4; i++) {
          const t = 0.2 + i * 0.18;
          wp.add(blob(0.05, { detail: 1, amp: 0.2, seed: i, squash: [0.6, 1.4, 0.6] }), { slot: 'foliage', color: '#5f8f4a', sway: 0.2 }, { at: [(i % 2 ? 1 : -1) * (h.half(t) + 0.01), 0.0, h.zOf(t)] });
        }
        wp.build('wreck').children.forEach((m) => outer.add(m));
      }
      const group = new THREE.Group();
      group.add(outer);
      let tick = null;
      if (state === 'floating') tick = bobber(outer, phaseOf(ctx));
      else if (state === 'beached') { outer.position.y = 0.11; outer.rotation.set(-0.04, 0, 0.13); }
      else { outer.position.y = -0.07; outer.rotation.set(0.1, 0.0, -0.36); }
      const lift = state === 'beached' ? 0.11 : wreck ? -0.07 : 0;
      const spots = wreck ? { look: spot([0, 0, h.L / 2 + 0.7], 180, 'stand') } : {
        seat: spot([0, seatTops[1][1] + lift, seatTops[1][0] - 0.02], 0, 'sit'),
        row: spot([0, seatTops[1][1] + lift, seatTops[1][0] + 0.02], 180, 'sit'),
        stern: spot([0, seatTops[0][1] + lift, seatTops[0][0] - 0.02], 0, 'sit'),
        bow: spot([0, seatTops[2][1] + lift, seatTops[2][0] + 0.02], 180, 'sit'),
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
        const rad = r.float(0.2, 0.26), topY = r.float(0.035, 0.06);
        const g = roundCyl(rad, 1.0, { top: rad * 0.92, bevel: 0.05, segments: 12, steps: 2 });
        g.translate(0, -1.0 + topY, 0);
        lumpy(g, { amp: rad * 0.16, freq: 4, seed: i * 7 + 3 });
        g.scale(1, 1, r.float(0.78, 0.95));
        g.rotateY(r.angle());
        g.computeVertexNormals();
        const tone = shade(base, r.float(-0.04, 0.04));
        const moss = mix(tone, '#6f9a4f', 0.55);
        addPainted(parts, g, tone, { at: [x, 0, z] }, (c, px, py, pz, nx, ny) => {
          if (ny > 0.6) c.offsetHSL(0, 0, 0.035);
          else if (mossy) c.lerp(C(moss), clamp(0.5 + noise3(px * 7, py * 5, pz * 7 + i) * 0.8, 0, 0.85) * smooth(topY - 0.02, topY - 0.25, py));
          if (py < topY - 0.3) c.offsetHSL(0, 0, -0.06);
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
};
