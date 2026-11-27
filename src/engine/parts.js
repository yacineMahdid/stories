import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BROWS } from './face-parts.js';
import { createHairMaterial, setHairColor, setHairTexture, UV_SCALE } from './hair.js';
import { createFurMaterial, furCoat } from './outfit.js';

// Extra 3D parts for animal characters: snouts, noses, horns, manes, brow ridges, eye domes and
// tails. Positions are in the space of the bone each part rides on: Head (y up from the neck,
// +z toward the face) or Tail (at the base of the spine, +z toward the front of the body).

// --- hair: manes, tails and tufts in the human hair's soft, matte material (hair.js) ------------

const TILE_U = 0.24, TILE_V = 0.48; // world size of one hair tile (hair.js)

function hairMaterial(color, texture = 'straight', blendColor) {
  const material = createHairMaterial();
  setHairTexture(material, texture);
  setHairColor(material, color, blendColor);
  return material;
}

/**
 * A lock of hair swept along a curve: an elliptical section `width(u)` across and `height(u)` out
 * from the curve (u = 0..1 along it), sunk by `sink` of its height into what it grows from. "Out"
 * points away from `center` (a mane on the head), or along the curve's normal (a tail). Flow UVs
 * run along the curve, and the underside is darkened like the hair's baked occlusion. `blend`
 * ({ color, amount(u) }) turns the lock into another color along its length (a dog's pale tail tip).
 * With `hug` (Head space only), the section is wrapped onto the head instead of lying in a plane:
 * across, it follows the skin's curve, and out is measured from the skin (the curve lifted `hug`
 * over it, a number or a function of u), so a wide, flat lock lies on the head with no edge
 * standing off it.
 */
function hairLock(points, { width, height, sink = 0.5, center = null, color, texture, around = 18, steps = 48, blend = null, hug = null }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = center ? null : curve.computeFrenetFrames(steps, false);
  const len = curve.getLength(), R = around + 1;
  let perim = 0;
  for (let i = 0; i <= steps; i++) perim = Math.max(perim, Math.PI * (width(i / steps) + height(i / steps)) / 2);
  const pos = [], uv = [], col = [], idx = [];
  const c0 = center && new THREE.Vector3(...center), out = new THREE.Vector3(), side = new THREE.Vector3();
  const ring = (i) => {
    const u = i / steps, c = curve.getPointAt(u), t = curve.getTangentAt(u), lift = typeof hug === 'function' ? hug(u) : hug;
    if (c0) out.copy(c).sub(c0).addScaledVector(t, -c.clone().sub(c0).dot(t)).normalize();
    else out.copy(frames.normals[i]);
    side.crossVectors(t, out).normalize();
    const w = width(u) / 2, h = height(u) / 2, mid = c.clone().addScaledVector(out, h * 2 * (0.5 - sink));
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2, sa = Math.sin(a);
      const p = hug === null ? mid.clone().addScaledVector(side, w * Math.cos(a)).addScaledVector(out, h * sa)
        : toSkin(c.clone().addScaledVector(side, w * Math.cos(a)), lift + h * 2 * (0.5 - sink) + h * sa);
      pos.push(p.x, p.y, p.z);
      uv.push((k / around) * perim / TILE_U / UV_SCALE, (u * len) / TILE_V / UV_SCALE);
      // occlusion: dark where it meets the head and on its underside, lighter toward the tips
      const occ = 0.5 + 0.5 * THREE.MathUtils.smoothstep(sa, -0.9, 0.7);
      col.push(Math.min(1, occ + 0.15 * u), blend ? blend.amount(u) : 0, 0, 1 - 0.5 * THREE.MathUtils.smoothstep(u, 0.85, 1));
    }
    return { c: hug === null ? c : toSkin(c.clone(), lift + h * (1.3 - 2 * sink)), t };
  };
  const ends = [];
  for (let i = 0; i <= steps; i++) {
    const r = ring(i);
    if (i === 0 || i === steps) ends.push(r);
    if (i < steps) for (let k = 0; k < around; k++) {
      const a = i * R + k, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // close both ends with a tip a little beyond the last ring
  ends.forEach(({ c, t }, e) => {
    const tip = pos.length / 3, base = e ? steps * R : 0;
    const p = c.clone().addScaledVector(t, (e ? 1 : -1) * Math.min(width(e), height(e)) * 0.4);
    pos.push(p.x, p.y, p.z);
    uv.push(0.5 * perim / TILE_U / UV_SCALE, (e * len) / TILE_V / UV_SCALE);
    col.push(0.8, blend ? blend.amount(e) : 0, 0, 0.4);
    for (let k = 0; k < around; k++) idx.push(...(e ? [tip, base + k + 1, base + k] : [tip, base + k, base + k + 1]));
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // the seam's two columns share one normal, so it doesn't show
  const n = geo.attributes.normal;
  for (let i = 0; i <= steps; i++) {
    const a = i * R, b = i * R + around;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  const m = new THREE.Mesh(geo, hairMaterial(color, texture, blend?.color));
  m.castShadow = true;
  return m;
}

/** Locks that bulge in a row (a mane's tufts): 1 at a lock's middle, `low` between two. */
const lobes = (count, low) => (u) => low + (1 - low) * Math.sqrt(Math.abs(Math.sin(Math.PI * count * u)));
const HEAD_CENTER = [0, 0.21, -0.01];

const group = (...children) => { const g = new THREE.Group(); g.add(...children); return g; };

// --- the head's skin, so parts can grow out of it ------------------------------------------------

// How far the base head's skin is from HEAD_C along each direction, in mm: sampled from the base
// mesh (the human ears left out) and lightly smoothed. Rows are elevations -60..90° and columns
// azimuths 0..180° from the face toward the side, both in 10° steps (the head is symmetric).
// Snouts, the brow ridge, horns and eye domes rise out of this surface in a soft fillet and sink
// just under it at their edges, so they read as part of the head rather than shapes stuck on.
const HEAD_C = [0, 0.19, -0.03];
const HEAD_R = [
  199, 199, 200, 199, 199, 198, 198, 198, 197, 196, 194, 193, 192, 190, 189, 187, 186, 185, 185,
  210, 210, 211, 211, 212, 211, 210, 209, 208, 206, 204, 203, 202, 200, 198, 196, 192, 191, 191,
  221, 220, 221, 221, 222, 219, 218, 216, 216, 214, 212, 210, 210, 210, 205, 203, 199, 197, 197,
  227, 226, 228, 227, 227, 222, 219, 216, 216, 216, 213, 212, 212, 214, 212, 208, 205, 202, 203,
  225, 224, 226, 225, 226, 219, 215, 211, 211, 211, 210, 210, 212, 215, 216, 212, 210, 206, 207,
  218, 216, 219, 218, 220, 215, 210, 207, 206, 207, 209, 208, 212, 217, 220, 216, 213, 210, 211,
  208, 207, 211, 211, 213, 209, 205, 202, 201, 204, 204, 205, 208, 214, 218, 216, 216, 212, 214,
  204, 203, 206, 207, 209, 207, 202, 199, 196, 198, 198, 203, 207, 213, 217, 217, 219, 216, 218,
  208, 207, 211, 212, 213, 210, 205, 202, 198, 199, 200, 204, 211, 216, 223, 223, 225, 222, 224,
  220, 219, 222, 221, 222, 216, 211, 207, 203, 204, 204, 208, 215, 219, 227, 227, 230, 229, 230,
  234, 233, 235, 233, 231, 223, 218, 212, 209, 209, 209, 213, 219, 223, 229, 231, 233, 233, 234,
  249, 248, 247, 244, 239, 232, 226, 220, 217, 217, 217, 219, 224, 227, 233, 235, 237, 238, 239,
  253, 251, 249, 246, 242, 237, 232, 228, 227, 226, 225, 227, 230, 232, 236, 238, 240, 242, 243,
  247, 245, 242, 240, 238, 235, 233, 232, 231, 230, 230, 230, 232, 233, 234, 236, 238, 240, 242,
  240, 239, 238, 237, 236, 235, 234, 234, 233, 233, 233, 233, 233, 234, 235, 236, 237, 238, 238,
  237, 237, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 237, 237
];
const R_COLS = 19, R_ROWS = 16, DEG = 180 / Math.PI;

/** Distance from HEAD_C to the skin along the direction (dx, dy, dz). */
function skinDistance(dx, dy, dz) {
  const fa = Math.min((Math.atan2(Math.abs(dx), dz) * DEG) / 10, R_COLS - 1.0001);
  const fe = THREE.MathUtils.clamp((Math.atan2(dy, Math.hypot(dx, dz)) * DEG + 60) / 10, 0, R_ROWS - 1.0001);
  const j = Math.floor(fa), i = Math.floor(fe), ta = fa - j, te = fe - i, r = (a, b) => HEAD_R[a * R_COLS + b];
  return ((r(i, j) * (1 - ta) + r(i, j + 1) * ta) * (1 - te) + (r(i + 1, j) * (1 - ta) + r(i + 1, j + 1) * ta) * te) / 1000;
}

/** How far a point is outside the skin, along the line from HEAD_C (negative inside). */
function aboveSkin(x, y, z) {
  const dx = x - HEAD_C[0], dy = y - HEAD_C[1], dz = z - HEAD_C[2];
  return Math.hypot(dx, dy, dz) - skinDistance(dx, dy, dz);
}

/** Move a point along the line from HEAD_C so it is `h` outside the skin. */
function toSkin(p, h) {
  const d = new THREE.Vector3(p.x - HEAD_C[0], p.y - HEAD_C[1], p.z - HEAD_C[2]);
  const r = skinDistance(d.x, d.y, d.z) + h;
  return p.set(HEAD_C[0], HEAD_C[1], HEAD_C[2]).addScaledVector(d.normalize(), r);
}

// The front of the head as a depth map z(x, y), on a 5 mm grid, made on first use.
const ZG = { x0: 0, y0: -0.03, step: 0.005, nx: 51, ny: 97, z: null };
function skinZ(x, y) {
  if (!ZG.z) {
    ZG.z = new Float32Array(ZG.nx * ZG.ny);
    for (let i = 0; i < ZG.ny; i++) {
      for (let j = 0; j < ZG.nx; j++) {
        let lo = HEAD_C[2], hi = 0.5;
        const x = j * ZG.step, y = ZG.y0 + i * ZG.step;
        for (let k = 0; k < 26; k++) { const m = (lo + hi) / 2; if (aboveSkin(x, y, m) > 0) hi = m; else lo = m; }
        ZG.z[i * ZG.nx + j] = aboveSkin(x, y, HEAD_C[2]) > 0 ? 0.6 : (lo + hi) / 2; // no head here: anything is under it
      }
    }
  }
  const fx = Math.min(Math.abs(x) / ZG.step, ZG.nx - 1.0001), fy = THREE.MathUtils.clamp((y - ZG.y0) / ZG.step, 0, ZG.ny - 1.0001);
  const j = Math.floor(fx), i = Math.floor(fy), tx = fx - j, ty = fy - i, z = (a, b) => ZG.z[a * ZG.nx + b];
  return (z(i, j) * (1 - tx) + z(i, j + 1) * tx) * (1 - ty) + (z(i + 1, j) * (1 - tx) + z(i + 1, j + 1) * tx) * ty;
}

/** The skin's outward normal on the front of the head at (x, y). */
function skinNormal(x, y, out = new THREE.Vector3()) {
  const e = 0.004;
  return out.set(-(skinZ(x + e, y) - skinZ(x - e, y)) / (2 * e), -(skinZ(x, y + e) - skinZ(x, y - e)) / (2 * e), 1).normalize();
}

// The base head's front is a little ridged down its middle (about 1.3 mm, over ±12 mm), which the
// skin above leaves out. Where a snout comes out of the skin it follows the ridge, so the line where
// it leaves the head stays round instead of dipping in a V at the middle.
const midRidge = (x, gap, sink) => 0.0013 * Math.max(0, 1 - Math.abs(x) / 0.012) ** 2 * smoothstep(gap, -sink, 0) * (1 - smoothstep(gap, 0.002, 0.012));

/** A smooth maximum: max(a, b) with the corner rounded over about k. */
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + (h * h * k) / 4; };
const smoothstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * A material that matches the furred body's (outfit.js): the same roughness, specular, velvet
 * sheen in the color's own hue and faint grain (furCoat), so a part in the skin color shades
 * exactly like the head it grows from. Vertex colors carry baked occlusion.
 */
function skinMat(color, { map = null, vertexColors = false } = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : new THREE.Color(color), map, vertexColors, roughness: 0.8, metalness: 0, specularIntensity: 0.25,
    sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff),
  });
  material.onBeforeCompile = furCoat;
  material.customProgramCacheKey = () => 'skin-part-1';
  return material;
}

// --- builders, each returning [{ bone, object, wag? }] -----------------------------------------

// --- snouts ---------------------------------------------------------------------------------------

/**
 * A rounded cap: its front, at z = `front` (receding by `tilt` per unit of |x| and of y), falls to
 * `back` at the edge of a superellipse footprint (`box` 2 is an ellipse, more is squarer). `round`
 * shapes the fall: 2 is a quarter ellipse, more is a flatter front with tighter rounded edges.
 */
function cap({ at: [x0, y0], size: [a, b], front, back = 0.06, tilt = [0, 0], box = 2, round = 2 }) {
  return (x, y) => {
    const q = (Math.abs((x - x0) / a) ** box + Math.abs((y - y0) / b) ** box) ** (1 / box);
    const f = front - tilt[0] * Math.abs(x - x0) - tilt[1] * (y - y0);
    return q < 1 ? back + (f - back) * (1 - q ** round) ** (1 / round) : back - (q - 1) * 1.5;
  };
}

/** A pair of soft dimples (nostrils) mirrored across the middle: `depth` at their centers. */
function dimples({ at: [x0, y0], size: [a, b], depth, angle = 0 }) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (x, y) => {
    const dx = Math.abs(x) - x0, dy = y - y0, u = (dx * c + dy * s) / a, v = (-dx * s + dy * c) / b, d = u * u + v * v;
    return d < 1 ? depth * (1 - d) ** 2 : 0;
  };
}

/**
 * Mesh a part that grows out of the head as a fan of profiles from its middle: `sample(t, s)` is
 * the surface point [x, y, z, gap] at angle t around the middle and s out from it, `gap` its height
 * over the skin. Each profile runs out to where the part has sunk under the skin, and the rings are
 * evenly spaced along the surface. Vertex colors bake occlusion into the fillet and the underside,
 * and near the edge the normals turn to the skin's (`skinNormalAt`), so the shading runs on into
 * the head. The uv is a front projection over the part's extent, `box` = [cx, cy, rx, ry]:
 * u = 0.5 + (x - cx) / 2rx, v = 0.5 + (y - cy) / 2ry. Also returns each vertex's height over the
 * skin (`gaps`) and the line where the part comes out of the skin, seen from the front (`rim`).
 */
function fanMesh(sample, gapAt, skinNormalAt, [cx, cy], { from = 0.004, step = 0.003, reach = 0.3, sink = 0.003, soft = 0.03, around = 72, rings = 34, crease = 0.28, S = 96 } = {}) {
  const sunk = (t, s) => sample(t, s)[3] < -0.7 * sink;
  const prof = [];
  for (let k = 0; k < around; k++) {
    const t = (k / around) * Math.PI * 2;
    let r = from;
    while (r < reach && !sunk(t, r)) r += step;
    let lo = r - step, hi = r;
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (sunk(t, m)) hi = m; else lo = m; }
    const pts = [], len = [0];
    for (let i = 0; i <= S; i++) {
      const [x, y, z] = sample(t, (i / S) * hi);
      if (i) { const p = pts[i - 1]; len.push(len[i - 1] + Math.hypot(x - p[0], y - p[1], z - p[2])); }
      pts.push([x, y, z]);
    }
    prof.push({ pts, len });
  }
  const pos = sample(0, 0).slice(0, 3);
  for (let j = 1; j <= rings; j++) {
    for (let k = 0; k < around; k++) {
      const { pts, len } = prof[k], L = (j / rings) * len[S];
      let i = 1;
      while (i < S && len[i] < L) i++;
      const t = THREE.MathUtils.clamp((L - len[i - 1]) / Math.max(len[i] - len[i - 1], 1e-9), 0, 1), a = pts[i - 1], b = pts[i];
      pos.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    }
  }
  const idx = [];
  for (let k = 0; k < around; k++) idx.push(0, 1 + k, 1 + ((k + 1) % around));
  for (let j = 1; j < rings; j++) {
    for (let k = 0; k < around; k++) {
      const a = 1 + (j - 1) * around + k, b = 1 + (j - 1) * around + ((k + 1) % around);
      idx.push(a, a + around, b, b, a + around, b + around);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const P = geo.attributes.position, N = geo.attributes.normal, sn = new THREE.Vector3(), n = new THREE.Vector3();
  let rx = 0, ry = 0;
  for (let i = 0; i < P.count; i++) { rx = Math.max(rx, Math.abs(P.getX(i) - cx)); ry = Math.max(ry, Math.abs(P.getY(i) - cy)); }
  const uv = [], col = [], gaps = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), gap = gaps[i] = gapAt(x, y, P.getZ(i));
    n.fromBufferAttribute(N, i).lerp(skinNormalAt(x, y, P.getZ(i), sn), 1 - smoothstep(gap, -sink, 0.008)).normalize();
    N.setXYZ(i, n.x, n.y, n.z);
    const occ = (1 - crease * smoothstep(gap, -sink, 0) * (1 - smoothstep(gap, 0, soft * 0.7))) * (1 - 0.14 * Math.max(0, -n.y) * smoothstep(gap, -sink, 0.004));
    col.push(occ, occ, occ);
    uv.push(0.5 + (x - cx) / (2 * rx), 0.5 + (y - cy) / (2 * ry));
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // where each profile comes out of the skin: the part's outline on the face, in (x, y)
  const rim = [];
  for (let k = 0; k < around; k++) {
    const v = (j) => (j ? 1 + (j - 1) * around + k : 0);
    let j = 1;
    while (j < rings && gaps[v(j)] >= 0) j++;
    const a = v(j - 1), b = v(j), t = gaps[b] < 0 ? gaps[a] / (gaps[a] - gaps[b]) : 1;
    rim.push([P.getX(a) + (P.getX(b) - P.getX(a)) * t, P.getY(a) + (P.getY(b) - P.getY(a)) * t]);
  }
  return { geometry: geo, box: [cx, cy, rx, ry], gaps, rim, grid: [around, rings] };
}

/**
 * A part that grows out of the front of the head, as a depth map: z = smax(shape(x, y), skin - sink)
 * rounded over `soft`, so it rises out of the face in a fillet and its edge sinks just under the
 * skin. Its profiles run straight out from `center` over the face (see fanMesh).
 */
function frontBulge(shape, [cx, cy], opts = {}) {
  const { soft = 0.03, sink = 0.003 } = opts;
  const surface = (x, y) => { const s = skinZ(x, y), z = smax(shape(x, y), s - sink, soft); return [z + midRidge(x, z - s, sink), s]; };
  const sample = (t, r) => {
    const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r, [z, s] = surface(x, y);
    return [x, y, z, z - s];
  };
  const mesh = fanMesh(sample, (x, y, z) => z - skinZ(x, y), (x, y, z, out) => skinNormal(x, y, out), [cx, cy], opts);
  return { ...mesh, depth: (x, y) => surface(x, y)[0] };
}

/** How far the skin is from `o` (inside the head) along the unit direction d. */
function skinReach(o, d) {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 15; i++) { const m = (lo + hi) / 2; if (aboveSkin(o[0] + d.x * m, o[1] + d.y * m, o[2] + d.z * m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/**
 * A (super)ellipsoid with half-axes `size` at `at`, `e` its squareness (2 round, more boxy), its
 * long (z) axis tipped down by `tilt`, as a ray function: how far its far side is from o along d.
 * Past its outline it carries on smoothly (falling away), so a smooth union with it stays smooth.
 */
function ball({ at: [cx, cy, cz], size: [a, b, c], e = 2, tilt = 0 }) {
  const ct = Math.cos(tilt), st = Math.sin(tilt), L = (a + b + c) / 3;
  const local = (x, y, z) => [x / a, (y * ct + z * st) / b, (z * ct - y * st) / c];
  return (o, d) => {
    const O = local(o[0] - cx, o[1] - cy, o[2] - cz), D = local(d.x, d.y, d.z);
    const q = (t) => (Math.abs(O[0] + D[0] * t) ** e + Math.abs(O[1] + D[1] * t) ** e + Math.abs(O[2] + D[2] * t) ** e) ** (1 / e);
    const tm = Math.max(0, -(O[0] * D[0] + O[1] * D[1] + O[2] * D[2]) / (D[0] ** 2 + D[1] ** 2 + D[2] ** 2)), qm = q(tm);
    if (qm >= 1) return tm - (qm - 1) * L;
    let lo = tm, hi = tm + 2.5 * Math.max(a, b, c);
    for (let i = 0; i < 15; i++) { const m = (lo + hi) / 2; if (q(m) < 1) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
}

/**
 * A snout measured along rays from a point inside the head and inside its main mass (`from`)
 * instead of along z, so it can be round all the way under, into a jaw: r = smax(its balls in one
 * smooth union, the skin - sink) rounded over `soft`, minus the nostrils. The fan of profiles
 * turns around `axis`, s being the angle away from it.
 */
function roundBulge(def, opts = {}) {
  const { soft = 0.03, sink = 0.003 } = opts, o = def.from;
  const A = new THREE.Vector3(...(def.axis ?? [0, 0, 1])).normalize();
  const U = new THREE.Vector3(1, 0, 0).addScaledVector(A, -A.x).normalize(), V = new THREE.Vector3().crossVectors(A, U);
  const balls = def.balls.map(ball), holes = def.nostrils ? dimples(def.nostrils) : () => 0, d = new THREE.Vector3();
  const surface = (dir) => { // [distance to the surface, to the skin] along dir
    let r = balls.reduce((r, f) => smax(r, f(o, dir), def.union), -1);
    r -= holes(o[0] + dir.x * r, o[1] + dir.y * r);
    const s = skinReach(o, dir);
    r = smax(r, s - sink, soft);
    return [r + midRidge(o[0] + dir.x * r, r - s, sink), s];
  };
  const sample = (t, s) => {
    d.copy(A).multiplyScalar(Math.cos(s)).addScaledVector(U, Math.cos(t) * Math.sin(s)).addScaledVector(V, Math.sin(t) * Math.sin(s));
    const [r, sk] = surface(d);
    return [o[0] + d.x * r, o[1] + d.y * r, o[2] + d.z * r, r - sk];
  };
  const along = (x, y, z) => { const l = d.set(x - o[0], y - o[1], z - o[2]).length(); d.divideScalar(l); return l; };
  const gapAt = (x, y, z) => { const l = along(x, y, z); return l - skinReach(o, d); };
  const inside = (x, y, z) => { const l = along(x, y, z); return l < surface(d)[0]; };
  const depth = (x, y) => { // the snout's front at (x, y)
    let lo = o[2], hi = 0.6;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (inside(x, y, m)) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const mesh = fanMesh(sample, gapAt, (x, y, z, out) => skinNormal3(out.set(x, y, z), out), def.center, { from: 0.01, step: 0.03, reach: 1.5, S: 64, ...opts });
  return { ...mesh, depth };
}

/** The front's normal of a depth map z(x, y). */
function depthNormal(depth, x, y, e = 0.003) {
  return new THREE.Vector3(-(depth(x + e, y) - depth(x - e, y)) / (2 * e), -(depth(x, y + e) - depth(x, y - e)) / (2 * e), 1).normalize();
}

// Each snout rises out of the lower face (Head space) with nostrils pressed into it. A wide, flat
// muzzle is a few caps in one smooth union over the face (a depth map, frontBulge); a long or round
// one is a few balls in one smooth union measured from a point inside it (roundBulge), so it is
// round underneath too. mouth: [height in Head space, size relative to a mouth on the face]; the
// mouth is drawn on the snout's own canvas there. nose: the dog's nose [height, width]. split:
// [x, y, rx, ry, blur], the muzzle's color inside this ellipse, the face's (`top`) above it. sheen
// and dim: the snout's own velvet sheen and a darkening, so a dark snout matches the face around it.
const SNOUTS = {
  dog: { // a puppy's round muzzle carried well forward below the eyes, soft puffs either side of the mouth, the nose on its tip
    from: [0, 0.1, 0.12], center: [0, 0.1], union: 0.025,
    balls: [
      { at: [0, 0.098, 0.19], size: [0.072, 0.06, 0.11], e: 2.2 },
      { at: [0.03, 0.073, 0.2], size: [0.04, 0.03, 0.082] },
      { at: [-0.03, 0.073, 0.2], size: [0.04, 0.03, 0.082] },
    ],
    split: [0, 0.035, 0.15, 0.118, 14], mouth: [0.072, 0.85], nose: [0.122, 0.07],
  },
  horse: { // a broad, round muzzle on the lower face, its top fillet in the face's color
    from: [0, 0.085, 0.12], center: [0, 0.085], union: 0.035,
    balls: [
      { at: [0, 0.078, 0.19], size: [0.1, 0.074, 0.11], e: 2.2 },
    ],
    split: [0, 0.07, 0.115, 0.08, 5],
    nostrils: { at: [0.046, 0.1], size: [0.012, 0.02], depth: 0.01, angle: 0.35 },
    mouth: [0.058, 1.1],
  },
  cow: { // a wide, flat muzzle with big nostrils
    center: [0, 0.083], union: 0.03,
    caps: [{ at: [0, 0.083], size: [0.128, 0.066], front: 0.27, tilt: [0.12, 0.12], box: 2.7, round: 3 }],
    nostrils: { at: [0.056, 0.1], size: [0.024, 0.016], depth: 0.009, angle: 0.3 },
    mouth: [0.056, 0.9],
  },
  baboon: { // a long, blunt muzzle: a straight top from the brow to an upright, rounded front, a full jaw under it
    from: [0, 0.1, 0.12], center: [0, 0.1], union: 0.02,
    balls: [
      { at: [0, 0.104, 0.18], size: [0.062, 0.056, 0.09], e: 3 },
      { at: [0, 0.062, 0.16], size: [0.056, 0.042, 0.085], e: 2.4 }, // the jaw
      { at: [0, 0.173, 0.187], size: [0.033, 0.03, 0.066], tilt: 0.866 }, // the bridge, from the brow
    ],
    nostrils: { at: [0.016, 0.13], size: [0.009, 0.007], depth: 0.006, angle: 0.3 },
    mouth: [0.09, 1.05], sheen: 0.05, dim: 0.85,
  },
  gorilla: { // a broad muzzle under a wide nose with flared nostrils
    center: [0, 0.08], union: 0.03,
    caps: [
      { at: [0, 0.075], size: [0.112, 0.06], front: 0.232, tilt: [0.15, 0.2], box: 2.5, round: 2.4 },
      { at: [0, 0.118], size: [0.06, 0.04], front: 0.245, back: 0.1, tilt: [0.2, 0.3], box: 2.4, round: 2 },
    ],
    nostrils: { at: [0.024, 0.11], size: [0.016, 0.012], depth: 0.009, angle: 0.5 },
    mouth: [0.058, 0.8],
  },
};

/** The snout's depth map: its caps in one smooth union, minus the nostrils. */
function snoutShape(def) {
  const caps = def.caps.map(cap), holes = def.nostrils ? dimples(def.nostrils) : () => 0;
  return (x, y) => caps.reduce((z, c) => smax(z, c(x, y), def.union), -1) - holes(x, y);
}

// A snout's mesh depends only on its shape: built once per page, each snout gets a copy.
const BULGES = new Map();
const SHADE_SIZE = 256; // the snout's shade canvas (see shadeLayer)

/**
 * Where the snout carries the emotion's shade itself rather than the face layer: white inside the
 * line where it comes out of the skin, feathered over a few mm (over its low fillet, where the face
 * layer and the snout's own layer both show and share the shade between them). A front projection
 * over the snout's extent, like its canvas.
 */
function shadeMask({ box: [cx, cy, rx, ry], rim }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SHADE_SIZE;
  const g = canvas.getContext('2d');
  g.filter = `blur(${(0.0015 * SHADE_SIZE) / (2 * Math.min(rx, ry))}px)`; // about 1.5 mm
  g.fillStyle = '#fff';
  g.beginPath();
  rim.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo']((0.5 + (x - cx) / (2 * rx)) * SHADE_SIZE, (0.5 - (y - cy) / (2 * ry)) * SHADE_SIZE));
  g.closePath();
  g.fill();
  return canvas;
}

/**
 * The snout's shade layer: a shell over its upper part in the face layer's own material, so the
 * emotion's shade on the snout is lit and blended exactly like the face's (painting it into the
 * snout's canvas would darken only its color, not its sheen). It lies 1.5 mm out where the snout
 * meets the skin, like the face layer, and closer over the rest; it is drawn only where the shade
 * can reach (Face.shadeMuzzle). It takes every other ring of the snout's fan: the shade is a soft
 * gradient, and the chords along the profiles stay well inside the gap over the snout.
 */
function shadeLayer({ geometry: src, gaps, grid: [around, rings] }) {
  const P = src.attributes.position, N = src.attributes.normal, pos = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const off = 0.0006 + 0.0009 * (1 - smoothstep(gaps[i], 0, 0.01));
    pos[i * 3] = P.getX(i) + N.getX(i) * off; pos[i * 3 + 1] = P.getY(i) + N.getY(i) * off; pos[i * 3 + 2] = P.getZ(i) + N.getZ(i) * off;
  }
  const v = (j, k) => (j ? 1 + (j - 1) * around + (k % around) : 0), keep = (i) => P.getY(i) > 0.1 && gaps[i] > -0.0015, idx = [];
  const tri = (a, b, c) => { if (keep(a) || keep(b) || keep(c)) idx.push(a, b, c); };
  for (let j = 0; j + 2 <= rings; j += 2) {
    for (let k = 0; k < around; k++) {
      if (j === 0) { tri(0, v(2, k), v(2, k + 1)); continue; }
      tri(v(j, k), v(j + 2, k), v(j, k + 1));
      tri(v(j, k + 1), v(j + 2, k), v(j + 2, k + 1));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', N.clone());
  geo.setAttribute('uv', src.attributes.uv.clone());
  geo.setIndex(idx);
  return geo;
}

/**
 * A snout that carries the mouth: the face draws its mouth (resting, emotion or talking) on this
 * canvas, over the snout's own paint (its color and nostrils, `base`); the canvas is projected
 * onto the snout from the front (see fanMesh), so the mouth reads like the face's own.
 */
function muzzle(def, color, nostrils, top) {
  const size = 512;
  let bulge = BULGES.get(def);
  if (!bulge) {
    BULGES.set(def, bulge = def.balls ? roundBulge(def) : frontBulge(snoutShape(def), def.center));
    bulge.mask = shadeMask(bulge);
    bulge.shell = shadeLayer(bulge);
  }
  const { box, depth } = bulge, geometry = bulge.geometry.clone();
  const [cx, cy, rx, ry] = box;
  const base = document.createElement('canvas');
  base.width = base.height = size;
  const g = base.getContext('2d');
  const X = (x) => (0.5 + (x - cx) / (2 * rx)) * size, Y = (y) => (0.5 - (y - cy) / (2 * ry)) * size;
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  if (def.split && top) { // the face's color above the muzzle's, so the muzzle's top fades softly into the coat
    const [ex, ey, ea, eb, blur = 1.5] = def.split;
    g.save();
    g.fillStyle = top;
    g.beginPath(); g.rect(0, 0, size, size);
    g.ellipse(X(ex), Y(ey), (ea / (2 * rx)) * size, (eb / (2 * ry)) * size, 0, 0, Math.PI * 2, true);
    g.filter = `blur(${blur}px)`;
    g.fill('evenodd');
    g.restore();
  }
  if (def.nostrils) { // soft dark openings in the dimples
    const { at: [x0, y0], size: [a, b], angle = 0 } = def.nostrils;
    const sx = size / (2 * rx), sy = size / (2 * ry);
    for (const s of [-1, 1]) {
      g.save();
      g.translate(X(s * x0), Y(y0));
      g.scale(sx, sy);
      g.rotate(-s * angle);
      g.scale(1, b / a);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, a * 0.8);
      grad.addColorStop(0, nostrils);
      grad.addColorStop(0.72, nostrils);
      grad.addColorStop(1, `${nostrils}00`);
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, a * 0.8, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.owned = true; // disposed with the part (hair tiles are shared and are not)
  const material = skinMat(color, { map: texture, vertexColors: true });
  if (def.sheen !== undefined) material.sheen = def.sheen;
  if (def.dim) material.color.setScalar(def.dim);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  // the shade layer, in the face layer's material, hidden until an emotion's shade reaches the snout
  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = shadeCanvas.height = SHADE_SIZE;
  const shadeMap = new THREE.CanvasTexture(shadeCanvas);
  shadeMap.colorSpace = THREE.SRGBColorSpace;
  shadeMap.userData.owned = true;
  const layer = new THREE.Mesh(bulge.shell.clone(), new THREE.MeshStandardMaterial({
    name: 'Face', map: shadeMap, transparent: true, depthWrite: false, roughness: 0.9, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, visible: false,
  }));
  mesh.add(layer);
  const shade = { ctx: shadeCanvas.getContext('2d'), texture: shadeMap, material: layer.material, mask: bulge.mask, size: SHADE_SIZE, key: '' };
  const [mouthAt, scale] = def.mouth;
  return { mesh, depth, muzzle: { ctx: canvas.getContext('2d'), texture, size, base, center: [cx, cy], radii: [rx, ry], color, mouthY: (mouthAt - cy) / ry, scale, shade } };
}

/**
 * The dog's nose: a soft, rounded inverted triangle puffed like a cushion, two nostrils pressed
 * into its lower front and a faint shine. Built facing +z, centered on its back plane.
 */
function dogNose(width, color) {
  const around = 56, R = 12, a = width / 2, b = width * 0.34, depth = width * 0.36;
  const outline = (t) => { // flat across the top with round corners, narrowing to a soft point
    const c = Math.cos(t), s = Math.sin(t), e = s > 0 ? 2.8 : 1.7;
    const y = (s > 0 ? b : b * 1.2) * Math.sign(s) * Math.abs(s) ** (2 / e);
    return [a * Math.sign(c) * Math.abs(c) ** (2 / e) * (y < 0 ? 1 + 0.42 * (y / (b * 1.2)) : 1), y];
  };
  const nostril = dimples({ at: [a * 0.4, -b * 0.18], size: [a * 0.24, b * 0.2], depth: depth * 0.3, angle: -0.45 });
  const pos = [], col = [];
  const ring = (s, z) => { for (let k = 0; k < around; k++) { const [x, y] = outline((k / around) * Math.PI * 2); pos.push(x * s, y * s, z(x * s, y * s, s)); } };
  const front = (x, y, s) => depth * (1 - s ** 2.4) ** (1 / 2.4) - (s < 1 ? nostril(x, y) : 0);
  const back = (x, y, s) => -depth * 0.45 * (1 - s * s) ** 0.5;
  pos.push(0, 0, depth);
  for (let j = 1; j <= R; j++) ring(Math.sin((j / R) * Math.PI / 2), front);
  for (let j = R - 1; j >= 1; j--) ring(Math.sin((j / R) * Math.PI / 2), back);
  pos.push(0, 0, -depth * 0.45);
  const rows = 2 * R - 1, last = 1 + rows * around, idx = [];
  for (let k = 0; k < around; k++) idx.push(0, 1 + k, 1 + ((k + 1) % around));
  for (let j = 0; j < rows - 1; j++) {
    for (let k = 0; k < around; k++) {
      const p = 1 + j * around + k, q = 1 + j * around + ((k + 1) % around);
      idx.push(p, p + around, q, q, p + around, q + around);
    }
  }
  for (let k = 0; k < around; k++) idx.push(last, 1 + (rows - 1) * around + ((k + 1) % around), 1 + (rows - 1) * around + k);
  for (let i = 0; i < pos.length; i += 3) { // the nostrils are dark inside
    const d = pos[i + 2] > 0 ? nostril(pos[i], pos[i + 1]) / (depth * 0.3) : 0, v = 1 - 0.75 * Math.min(1, d * 1.6);
    col.push(v, v, v);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.42, metalness: 0, specularIntensity: 0.6 }));
  m.castShadow = true;
  return { mesh: m, depth };
}

export const PART_BUILDERS = {
  snout({ shape = 'dog', color, skin, top = skin, nose = '#2a2224', nostrils = '#4a2c30' }) { // top: the face's color
    const def = SNOUTS[shape] ?? SNOUTS.dog;
    const { mesh, depth, muzzle: m } = muzzle(def, color, nostrils, top);
    const out = [{ bone: 'Head', object: mesh, muzzle: m }];
    if (def.nose) { // the dog's nose sits on the front of the muzzle, a third of it sunk in
      const [y, width] = def.nose, n = dogNose(width, nose), normal = depthNormal(depth, 0, y);
      n.mesh.position.set(0, y, depth(0, y)).addScaledVector(normal, -n.depth * 0.3);
      n.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      out.push({ bone: 'Head', object: n.mesh });
    }
    return out;
  },
  brow({ color }) { // one sculpted ridge that frowns, lifts and worries with the emotion's brows
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), skinMat(color, { vertexColors: true }));
    mesh.castShadow = true;
    const ridge = { mesh, color: new THREE.Color(color) };
    poseBrowRidge(ridge, null);
    return [{ bone: 'Head', object: mesh, ridge }];
  },
  horns({ color = '#efe6d2', skin, base = skin }) { // base: the fur they grow out of
    return [-1, 1].map((s) => ({ bone: 'Head', object: horn(s, color, base ?? color) }));
  },
  domes({ color, at = [0.112, 0.3], size = 0.072 }) { // eye domes (a frog's): the face draws the eyes on them
    return [-1, 1].map((s) => {
      const { mesh, layer } = dome(s * at[0], at[1], size, color);
      return { bone: 'Head', object: mesh, faceLayer: layer };
    });
  },
  mane({ color }) { // a crest of soft locks lying down the back of the head and over to one side, and a forelock over the brow
    const crest = [[0, 0.445, 0.04], [0, 0.432, -0.06], [0, 0.37, -0.17], [0, 0.27, -0.235], [0, 0.15, -0.25], [0, 0.05, -0.215]];
    const line = new THREE.CatmullRomCurve3(crest.map((p) => new THREE.Vector3(...p)));
    const lock = (pts, w, h, opts = {}) => ({ bone: 'Head', object: hairLock(pts, { center: HEAD_CENTER, color, sink: 0.42, hug: 0.002, steps: 36, around: 18, width: w, height: h, ...opts }) });
    // the crest itself, thinner toward the nape, that the locks grow from
    const out = [lock(crest, (u) => 0.012 + 0.04 * (1 - 0.5 * u) * Math.min(1, u / 0.05, (1 - u) / 0.1) ** 0.6, (u) => 0.01 + 0.026 * (1 - 0.5 * u) * Math.min(1, u / 0.05, (1 - u) / 0.1) ** 0.6, { steps: 40 })];
    const N = 8, SIDE = new THREE.Vector3(-1, 0, 0); // over to the character's right
    for (let i = 0; i < N; i++) {
      // long, flat locks lying down the back of the head, curving over to the side, each tip over the next one's root like shingles
      const t = 0.02 + (0.8 * i) / (N - 1), k = 1 - 0.35 * t, along = line.getTangentAt(t), L = 0.17 * k;
      const p = line.getPointAt(t).addScaledVector(SIDE, 0.006 * k), pts = [p.toArray()];
      for (let j = 0; j < 4; j++) {
        const th = 0.5 + 0.65 * ((j + 0.5) / 4); // along the crest at the root, more to the side toward the tip
        p.addScaledVector(along, (L / 4) * Math.cos(th)).addScaledVector(SIDE, (L / 4) * Math.sin(th));
        pts.push(p.toArray());
      }
      const end = (u) => Math.sqrt(Math.max(0, 1 - Math.max(0, (u - 0.72) / 0.29) ** 2)); // a round end, so the edge scallops softly
      out.push(lock(pts,
        (u) => 0.006 + 0.074 * k * (0.55 + 0.45 * smoothstep(u, 0, 0.35)) * end(u),
        (u) => 0.005 + 0.019 * k * (1 - 0.4 * u) * end(u) ** 0.5,
        { hug: (u) => 0.002 + 0.004 * u }));
    }
    // the forelock: from the crown, forward and over to the side, lying on the forehead
    out.push(lock([[0.006, 0.448, 0.02], [0.004, 0.44, 0.085], [-0.022, 0.405, 0.14], [-0.055, 0.345, 0.172], [-0.07, 0.3, 0.18]],
      (u) => 0.014 + 0.075 * (0.75 + 0.25 * smoothstep(u, 0, 0.3)) * (1 - u) ** 0.6,
      (u) => 0.008 + 0.05 * (1 - 0.5 * u) * (1 - u) ** 0.35, { steps: 32, around: 16 }));
    return out;
  },
  ruff({ color }) { // baboon cheek fur: one soft mass each side, lying back along the jaw, its back edge in rounded lobes
    const out = [];
    for (const s of [-1, 1]) {
      // three overlapping flat locks from under the eye, the middle one longest: their rounded ends scallop the edge
      for (const [pts, w, end] of [
        [[[0.162, 0.132, 0.1], [0.196, 0.118, 0.025], [0.206, 0.104, -0.035]], 0.06, 0.9],
        [[[0.158, 0.108, 0.105], [0.196, 0.088, 0.03], [0.206, 0.07, -0.06]], 0.066, 1],
        [[[0.152, 0.084, 0.105], [0.184, 0.06, 0.035], [0.188, 0.044, -0.03]], 0.058, 0.85],
      ]) {
        const round = (u) => Math.sqrt(Math.max(0, 1 - (smoothstep(u, 0.5, end) * 0.98) ** 2)); // a rounded end, not a point
        out.push({
          bone: 'Head',
          object: hairLock(pts.map(([x, y, z]) => [s * x, y, z]), {
            center: HEAD_CENTER, color, sink: 0.5, hug: 0.001, steps: 28, around: 16,
            width: (u) => 0.006 + w * (0.55 + 0.45 * smoothstep(u, 0, 0.35)) * round(u),
            height: (u) => 0.004 + 0.02 * smoothstep(u, 0, 0.3) * (0.4 + 0.6 * round(u)) ** 0.7, // full enough to read as a soft mass from the front
          }),
        });
      }
    }
    return out;
  },
  tail({ shape = 'dog', color, tip, stripes }) {
    const T = TAILS[shape] ?? TAILS.dog;
    return [{ bone: 'Tail', object: T.build(color, { tip, stripes }), wag: T.wag, lift: T.lift ?? 0 }];
  },
};

// --- tails ---------------------------------------------------------------------------------------
// In Tail space: y up, +z toward the front of the body. Every tail starts a little inside the body,
// so it grows out of it, and its markings follow its fur color (a recolored cat keeps its rings):
// stripes are the fur darkened like the body's stripes (see buildSpec), a pale tip the fur lightened.

const shade = (hex, amount) => `#${new THREE.Color(hex).lerp(new THREE.Color(amount > 0 ? 0xffffff : 0x000000), Math.abs(amount)).getHexString()}`;
const smooth = THREE.MathUtils.smoothstep;
const flare = (u, r) => r * 0.35 * (1 - smooth(u, 0, 0.1)); // the root widens a little into the body

const TAILS = {
  cat: { // long and plump, rising in a lazy S with the tip hooked over, ringed, with a dark tip
    wag: [0.25, 2.5],
    build: (color, { stripes }) => furTail(
      [[0, 0.005, 0.025], [0, -0.014, -0.035], [0.006, -0.018, -0.095], [0.015, 0.035, -0.16], [0.024, 0.135, -0.185], [0.03, 0.235, -0.16], [0.028, 0.3, -0.105]],
      (u) => 0.0275 - 0.0075 * u + flare(u, 0.0275),
      tailCanvas(color, { rings: stripes ?? shade(color, -0.35), tip: stripes ?? shade(color, -0.35) })),
  },
  dog: { // a short, fluffy plume carried up and back off the rump, its end swung over to one side, with a pale tip
    wag: [0.5, 9],
    build: (color, { tip }) => {
      const full = (u) => smooth(u, -0.05, 0.4) * (1 - u) ** 0.55;
      return hairLock([[0, -0.005, 0.03], [0, 0.012, -0.03], [0, 0.06, -0.078], [0.004, 0.118, -0.118], [0.022, 0.168, -0.135], [0.042, 0.205, -0.122]], {
        color, texture: 'wavy', sink: 0.5, center: [0, 0.08, 0.06], steps: 40, around: 20,
        width: (u) => 0.03 + 0.055 * full(u) * lobes(3, 0.82)(u),
        height: (u) => 0.03 + 0.055 * full(u),
        blend: { color: tip ?? shade(color, 0.6), amount: (u) => smooth(u, 0.66, 0.86) },
      });
    },
  },
  monkey: { // long and slender, swept up behind and rolled into a curl
    wag: [0.2, 2],
    build: (color) => furTail(
      [[0, 0, 0.02], [0, -0.022, -0.045], [0, -0.035, -0.115], [0, -0.012, -0.19], [0, 0.06, -0.245], [0, 0.155, -0.265], [0, 0.24, -0.245],
        [0, 0.29, -0.19], [0, 0.285, -0.13], [0, 0.25, -0.1], [0, 0.212, -0.118], [0, 0.205, -0.158], [0, 0.228, -0.178]],
      (u) => 0.0185 - 0.0095 * u + flare(u, 0.0185),
      tailCanvas(color, {}), { steps: 120, around: 16 }),
  },
  baboon: { // thick at the root, carried up in an arch and then hanging, darker toward the end
    wag: [0.15, 2], lift: 0.5,
    build: (color) => furTail(
      [[0, 0, 0.02], [0, 0.028, -0.04], [0, 0.07, -0.092], [0, 0.08, -0.135], [0, 0.045, -0.17], [0, -0.035, -0.188], [0, -0.13, -0.19]],
      (u) => 0.026 - 0.013 * u + flare(u, 0.026),
      tailCanvas(color, { tip: shade(color, -0.3), soft: true })),
  },
  cow: { // a thin rope hanging down, ending in a hair tuft it grows into
    wag: [0.2, 2], lift: 0.75,
    build: (color, { tip }) => {
      const g = group(furTail([[0, 0, 0.02], [0, -0.03, -0.035], [0, -0.085, -0.058], [0, -0.14, -0.064]], (u) => 0.0105 + flare(u, 0.016), tailCanvas(color, {}), { around: 14, steps: 40 }));
      const swell = (u) => Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.75;
      g.add(hairLock([[0, -0.112, -0.063], [0, -0.155, -0.066], [0, -0.21, -0.063]], {
        color: tip ?? '#3a2f2a', sink: 0.5, center: [0, -0.155, 0.05], steps: 24, around: 14,
        width: (u) => 0.022 + 0.04 * swell(u) * (1 - 0.35 * u), height: (u) => 0.022 + 0.034 * swell(u) * (1 - 0.35 * u),
      }));
      return g;
    },
  },
  horse: { // hair like the mane: three locks from one narrow dock, arching out and falling, the tips splayed and flicked back out
    wag: [0.18, 2], lift: 0.4,
    build: (color) => group(...[[0, 1, 0.15], [-1, 0.9, 0.13], [1, 0.84, 0.13]].map(([s, len, w]) => {
      const fall = (u) => smooth(u, 0.02, 0.4);
      const taper = (u) => (u < 0.6 ? 1 : ((1 - u) / 0.4) ** 0.7); // each lock ends in a soft point
      const x = (u) => s * (0.006 + 0.055 * u * u); // the side locks splay toward their tips
      const pts = [[0, 0.0, 0.03], [0, 0.022, -0.03], [x(0.3), 0.008, -0.088], [x(0.55), -0.058 * len, -0.116], [x(0.8), -0.122 * len, -0.118], [x(1), -0.17 * len, -0.148]];
      return hairLock(pts, {
        color, sink: 0.5, center: [0, -0.07, 0.1], around: 16, steps: 40,
        width: (u) => (0.02 + w * 0.3 * fall(u)) * taper(u), height: (u) => (0.022 + 0.04 * fall(u) * (1 - 0.3 * u)) * taper(u),
      });
    })),
  },
};

/**
 * A furred tail: a tube along a smooth curve with radius `radius(u)` (u = 0..1, root to tip), a fully
 * rounded tip, and the body's fur material. UVs run along it (v = 0 at the root, 1 at the very tip)
 * so a strip of canvas paints its rings, tip and gradients.
 */
function furTail(points, radius, map, { around = 22, steps = 72 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(steps, false);
  const len = curve.getLength(), rTip = radius(1), capRings = 6, total = len + rTip * Math.PI / 2;
  const pos = [], uv = [], idx = [], R = around + 1;
  const ring = (c, n, b, r, v) => {
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2;
      pos.push(c.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * r, c.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * r, c.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * r);
      uv.push(k / around, v);
    }
  };
  for (let i = 0; i <= steps; i++) ring(curve.getPointAt(i / steps), frames.normals[i], frames.binormals[i], radius(i / steps), (i / steps) * len / total);
  // the rounded tip: rings shrinking on a quarter circle past the end, then the very tip
  const end = curve.getPointAt(1), t = curve.getTangentAt(1), n = frames.normals[steps], b = frames.binormals[steps];
  for (let j = 1; j < capRings; j++) {
    const th = (j / capRings) * Math.PI / 2;
    ring(end.clone().addScaledVector(t, rTip * Math.sin(th)), n, b, rTip * Math.cos(th), (len + rTip * th) / total);
  }
  const rows = steps + capRings; // rings so far
  for (let i = 0; i < rows - 1; i++) {
    for (let k = 0; k < around; k++) { const a = i * R + k, c = a + R; idx.push(a, a + 1, c, a + 1, c + 1, c); } // outward-facing
  }
  const tipAt = end.clone().addScaledVector(t, rTip), tip = pos.length / 3;
  pos.push(tipAt.x, tipAt.y, tipAt.z); uv.push(0.5, 1);
  for (let k = 0; k < around; k++) idx.push((rows - 1) * R + k, (rows - 1) * R + k + 1, tip);
  // the root, inside the body, is closed too
  const root = pos.length / 3, c0 = curve.getPointAt(0);
  pos.push(c0.x, c0.y, c0.z); uv.push(0.5, 0);
  for (let k = 0; k < around; k++) idx.push(root, k + 1, k);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // the seam's two columns share one normal; the very tip points along the tail
  const nrm = geo.attributes.normal;
  for (let i = 0; i < rows; i++) {
    const a = i * R, z = a + around;
    const x = nrm.getX(a) + nrm.getX(z), y = nrm.getY(a) + nrm.getY(z), w = nrm.getZ(a) + nrm.getZ(z), l = Math.hypot(x, y, w) || 1;
    nrm.setXYZ(a, x / l, y / l, w / l); nrm.setXYZ(z, x / l, y / l, w / l);
  }
  nrm.setXYZ(tip, t.x, t.y, t.z);
  const mesh = new THREE.Mesh(geo, createFurMaterial(map));
  mesh.castShadow = true;
  return mesh;
}

/**
 * A strip of canvas painted along a tail (v = 0 at the root, at the bottom): the fur color, then
 * `rings` (a color: bands that go all the way round, each a little wavy, like a tabby's) and a
 * `tip` color over the last part, sharp-edged like the rings or, with `soft`, a gradual darkening.
 */
function tailCanvas(color, { rings = null, tip = null, soft = false }) {
  const W = 32, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  const base = new THREE.Color(color), ring = rings && new THREE.Color(rings), end = tip && new THREE.Color(tip);
  const out = new THREE.Color(), rgb = { r: 0, g: 0, b: 0 };
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, wave = Math.sin(2 * Math.PI * u + 1.3) * 0.006 + Math.sin(4 * Math.PI * u) * 0.004;
      out.copy(base);
      if (ring) {
        // five rings, closer and slimmer toward the tip, between the root and the dark tip
        for (let i = 0; i < 5; i++) {
          const mid = 0.2 + i * 0.13 - i * i * 0.004, half = 0.034 - i * 0.002;
          const cov = 1 - smooth(Math.abs(v + wave - mid), half - 0.003, half + 0.003);
          if (cov > 0) out.lerp(ring, cov);
        }
      }
      if (end) out.lerp(end, soft ? smooth(v, 0.6, 0.95) : smooth(v + wave, 0.845, 0.855));
      const k = (y * W + x) * 4;
      out.getRGB(rgb, THREE.SRGBColorSpace);
      img.data[k] = Math.round(rgb.r * 255); img.data[k + 1] = Math.round(rgb.g * 255); img.data[k + 2] = Math.round(rgb.b * 255); img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.owned = true; // disposed with the part
  return texture;
}

const BROW_Y = 0.226;

const SHADE = { r: 24 / 255, g: 10 / 255, b: 34 / 255 }; // the face's emotion shade (drawShade in face-parts.js)

/**
 * Pose a brow ridge like the face would draw the brows (see BROWS in face-parts.js): each side's
 * inner and outer ends rise and fall with the brow's tilt and lift. null rests it. `shade` is the
 * emotion's shade, which darkens the ridge as the face canvas darkens the brows around it.
 */
export function poseBrowRidge(ridge, name, shade = 0) {
  if (ridge.color && ridge.shade !== shade) { // most of drawShade's strength is over the brows: blend as the canvas does, in sRGB
    ridge.shade = shade;
    // toward a darker shade than the canvas's (the ridge catches the light the face below it doesn't),
    // and with its sheen (which takes the color's hue, not its darkness) dimmed with it
    const a = 0.88 * shade, c = ridge.color.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    ridge.mesh.material.color.setRGB(c.r + (SHADE.r * 0.45 - c.r) * a, c.g + (SHADE.g * 0.45 - c.g) * a, c.b + (SHADE.b * 0.45 - c.b) * a, THREE.SRGBColorSpace);
    ridge.mesh.material.sheen = 0.35 * (1 - 0.85 * a);
  }
  let left = BROWS[name] ?? BROWS.soft, right = left;
  if (left.asym) { left = { tilt: -0.1, lift: -26 }; right = { tilt: 0.22, lift: 4 }; }
  const px = (0.46 / 512) * 0.8; // a face-canvas pixel in Head units, a little softened
  const y = (d, outer) => BROW_Y - d.lift * px + (outer ? 1 : -1) * d.tilt * 0.04;
  const knots = [y(left, true), y(left, false), (y(left, false) + y(right, false)) / 2 - 0.003, y(right, false), y(right, true)];
  const key = knots.map((v) => v.toFixed(4)).join();
  if (ridge.key === key) return;
  ridge.key = key;
  ridge.mesh.geometry.dispose();
  ridge.mesh.geometry = browRidgeGeometry(knots);
}

/**
 * The ridge is a shelf of the forehead itself: a depth map over the skin along the brow line
 * (through `knots`, the heights at x = -0.13, -0.06, 0, 0.06, 0.13), sloping softly up into the
 * forehead, rounding over a steeper edge above the eyes, a little lower between the brows, and
 * fading into the temples at its ends. Its edges sink just under the skin.
 */
function browRidgeGeometry(knots) {
  const XS = [-0.13, -0.06, 0, 0.06, 0.13];
  const arch = (x) => 0.007 * Math.exp(-(((Math.abs(x) - 0.1) / 0.04) ** 2)); // over each eye
  const line = (x) => arch(x) + brow(x);
  const brow = (x) => { // Catmull-Rom through the knots, straight on past the ends
    if (x <= XS[0]) return knots[0] + (x - XS[0]) * (knots[1] - knots[0]) / (XS[1] - XS[0]) * 0.5;
    if (x >= XS[4]) return knots[4] + (x - XS[4]) * (knots[4] - knots[3]) / (XS[4] - XS[3]) * 0.5;
    let i = 0;
    while (x > XS[i + 1]) i++;
    const t = (x - XS[i]) / (XS[i + 1] - XS[i]), p = (k) => knots[THREE.MathUtils.clamp(k, 0, 4)];
    const m1 = (p(i + 1) - p(i - 1)) / 2, m2 = (p(i + 2) - p(i)) / 2;
    return (2 * t ** 3 - 3 * t * t + 1) * p(i) + (t ** 3 - 2 * t * t + t) * m1 + (-2 * t ** 3 + 3 * t * t) * p(i + 1) + (t ** 3 - t * t) * m2;
  };
  const UP = 0.034, DOWN = 0.024, LEN = 0.14, sink = 0.005, soft = 0.012;
  const rise = (x, v) => { // a rounded roll: a shelf over the eyes, a soft groove where it meets the forehead
    const ax = Math.abs(x), end = 1 - (ax / LEN) ** 3;
    if (end <= 0 || v < -1 || v > 1) return -0.1 * Math.max(v - 1, -1 - v, ax / LEN - 1, 0.01);
    const H = 0.031 * (0.7 + 0.3 * smoothstep(ax, 0.0, 0.07)) * end ** 0.6; // a little lower between the brows
    return H * (1 - Math.abs(v) ** (v > 0 ? 2 : 2.4)) ** (v > 0 ? 0.5 : 1 / 2.4) - 0.012 * (1 - end);
  };
  const NX = 56, NY = 26, pos = [], vs = [];
  for (let i = 0; i <= NY; i++) vs.push(-1.9 + (i / NY) * 3.6);
  for (let i = 0; i <= NY; i++) {
    for (let j = 0; j <= NX; j++) {
      const x = -0.15 + (j / NX) * 0.3, c = line(x), v = vs[i];
      let y = c + v * (v > 0 ? UP : DOWN);
      while (aboveSkin(x, y, HEAD_C[2]) > -0.03 && Math.abs(y - c) > 0.002) y += (c - y) * 0.25; // stay on the front of the head
      const vv = (y - c) / (y > c ? UP : DOWN);
      pos.push(x, y, skinZ(x, y) + smax(rise(x, vv), -sink, soft));
    }
  }
  // only the part that shows, and a thin margin of it under the skin
  const under = (i) => pos[i * 3 + 2] - skinZ(pos[i * 3], pos[i * 3 + 1]) < -0.6 * sink, idx = [];
  for (let i = 0; i < NY; i++) {
    for (let j = 0; j < NX; j++) {
      const a = i * (NX + 1) + j, b = a + 1, c = a + NX + 1, d = c + 1;
      if (!(under(a) && under(b) && under(d))) idx.push(a, b, d);
      if (!(under(a) && under(d) && under(c))) idx.push(a, d, c);
    }
  }
  return skinBlend(pos, idx, { sink, crease: 0.3, under: 0.4, reach: 0.009 });
}

/**
 * A geometry over the front of the head whose edges sink under the skin: normals turn to the
 * skin's toward the edges, and vertex colors darken where it meets the skin and underneath.
 */
function skinBlend(pos, idx, { sink, crease, under, reach = 0.012 }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const P = geo.attributes.position, N = geo.attributes.normal, n = new THREE.Vector3(), sn = new THREE.Vector3(), col = [];
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), gap = P.getZ(i) - skinZ(x, y);
    n.fromBufferAttribute(N, i).lerp(skinNormal(x, y, sn), 1 - smoothstep(gap, -sink, 0.006)).normalize();
    N.setXYZ(i, n.x, n.y, n.z);
    const occ = (1 - crease * smoothstep(gap, -sink, 0) * (1 - smoothstep(gap, 0, reach))) * (1 - under * Math.max(0, -n.y) * smoothstep(gap, 0, reach));
    col.push(occ, occ, occ);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/** The skin's outward normal anywhere on the head (the gradient of aboveSkin). */
function skinNormal3(p, out = new THREE.Vector3()) {
  const e = 0.003;
  return out.set(
    aboveSkin(p.x + e, p.y, p.z) - aboveSkin(p.x - e, p.y, p.z),
    aboveSkin(p.x, p.y + e, p.z) - aboveSkin(p.x, p.y - e, p.z),
    aboveSkin(p.x, p.y, p.z + e) - aboveSkin(p.x, p.y, p.z - e),
  ).normalize();
}

/**
 * Pull the part of a geometry that is near or under the skin onto it, along the lines from
 * HEAD_C: each vertex ends at smax(height, -sink) over the skin, so the part rises out of the head
 * in a fillet of about `soft` and the rest lies just under the skin. Returns each vertex's height
 * over the skin before the pull; normals turn to the skin's where the part meets it.
 */
function growFromSkin(geo, { soft = 0.02, sink = 0.003 } = {}) {
  const P = geo.attributes.position, p = new THREE.Vector3(), heights = [];
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i);
    const h = aboveSkin(p.x, p.y, p.z);
    heights.push(h);
    if (h < soft) { toSkin(p, smax(h, -sink, soft)); P.setXYZ(i, p.x, p.y, p.z); }
  }
  geo.computeVertexNormals();
  const N = geo.attributes.normal, n = new THREE.Vector3(), sn = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i);
    const w = smoothstep(aboveSkin(p.x, p.y, p.z), -sink, 0.006);
    if (w < 1) { n.fromBufferAttribute(N, i).lerp(skinNormal3(p, sn), 1 - w).normalize(); N.setXYZ(i, n.x, n.y, n.z); }
  }
  return heights;
}

/**
 * A cow's horn: a soft, round-tipped cone curving out and up from the top of the head. Its root
 * flares and grows out of the skin in a fillet, colored like the fur there (`base`) and turning to
 * the horn's color over its first few centimetres; the tip is a little darker.
 */
function horn(s, color, base) {
  const pts = [[0.1, 0.33, 0.0], [0.14, 0.378, 0.012], [0.183, 0.415, 0.028], [0.212, 0.458, 0.042], [0.218, 0.505, 0.052]];
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(s * x, y, z)));
  const steps = 44, around = 24, frames = curve.computeFrenetFrames(steps, false), pos = [], us = [];
  const radius = (u) => (0.0105 + 0.021 * (1 - u) ** 1.2 + 0.016 * (1 - smoothstep(u, 0.0, 0.3))) * Math.sqrt(1 - smoothstep(u, 0.86, 1) ** 2);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, c = curve.getPointAt(u), r = radius(u);
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a) * r).add(frames.binormals[i].clone().multiplyScalar(Math.sin(a) * r));
      pos.push(c.x + n.x, c.y + n.y, c.z + n.z);
      us.push(u);
    }
  }
  const idx = [];
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < around; k++) {
      const a = i * around + k, b = i * around + ((k + 1) % around);
      idx.push(a, b, a + around, b, b + around, a + around); // outward-facing
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const heights = growFromSkin(geo, { soft: 0.018 });
  const hc = new THREE.Color(color), bc = new THREE.Color(base), tc = hc.clone().multiplyScalar(0.78), c = new THREE.Color(), col = [];
  for (let i = 0; i < heights.length; i++) {
    c.copy(bc).lerp(hc, smoothstep(heights[i], 0.004, 0.032)).lerp(tc, smoothstep(us[i], 0.7, 1) * 0.8);
    const occ = 1 - 0.25 * (1 - smoothstep(heights[i], -0.003, 0.012));
    col.push(c.r * occ, c.g * occ, c.b * occ);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0, specularIntensity: 0.3,
    sheen: 0.35, sheenRoughness: 0.8, sheenColor: hc.clone().multiplyScalar(0.75).addScalar(0.0875),
  }));
  m.castShadow = true;
  return m;
}

/**
 * An eye dome: a ball half out of the head at (x, y) on its front, growing out of the skin in a
 * fillet. Its front carries a layer in the face's own material (`layer`, given the face canvas
 * by Face.setLayers), projected from the front exactly like the face, so the eyes the face draws
 * there (any style, blinking, every emotion's eyes) sit on the domes.
 */
function dome(x, y, r, color) {
  const c = new THREE.Vector3(x, y, skinZ(x, y) + r * 0.1); // its front faces the eye drawn at (x, y)
  const sphere = new THREE.SphereGeometry(r, 40, 30);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geo = mergeVertices(sphere); // one vertex along the seam and at each pole, so its normals (and the face layer) run on unbroken
  sphere.dispose();
  geo.rotateX(Math.PI / 2); // poles front and back
  geo.rotateZ(Math.PI / 2); // what is left of the seam runs under the dome, toward the head
  geo.translate(c.x, c.y, c.z);
  const heights = growFromSkin(geo, { soft: 0.022 });
  const col = heights.map((h) => 1 - 0.28 * (1 - smoothstep(h, -0.003, 0.014))).flatMap((v) => [v, v, v]);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, skinMat(color, { vertexColors: true }));
  mesh.castShadow = true;
  // the face layer: the dome's front, 1.2 mm out, with the face canvas's own front projection
  const P = geo.attributes.position, N = geo.attributes.normal, lp = [], luv = [];
  for (let i = 0; i < P.count; i++) {
    const px = P.getX(i) + N.getX(i) * 0.0012, py = P.getY(i) + N.getY(i) * 0.0012, pz = P.getZ(i) + N.getZ(i) * 0.0012;
    lp.push(px, py, pz);
    luv.push((px + 0.23) / 0.46, (0.45 - py) / 0.46);
  }
  const keep = (i) => N.getZ(i) > 0.05 && heights[i] > 0.006, src = geo.index.array, lidx = [];
  for (let t = 0; t < src.length; t += 3) if (keep(src[t]) && keep(src[t + 1]) && keep(src[t + 2])) lidx.push(src[t], src[t + 1], src[t + 2]);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lg.setAttribute('normal', N.clone());
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  lg.setIndex(lidx);
  const layer = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({
    name: 'Face', transparent: true, depthWrite: false, roughness: 0.9, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  mesh.add(layer);
  return { mesh, layer: layer.material };
}

/**
 * Build all parts of a spec: parts = [{ type: 'snout', shape: 'dog', color }, ...]. `skin` is the
 * character's skin or fur color, which parts that blend into the head take by default.
 */
export function buildParts(parts = [], skin) {
  return parts.flatMap(({ type, ...opts }) => PART_BUILDERS[type]?.({ skin, ...opts }) ?? []);
}
