import * as THREE from 'three';
import { BROWS } from './face-parts.js';
import { createHairMaterial, setHairColor, setHairTexture, UV_SCALE } from './hair.js';
import { createFurMaterial } from './outfit.js';

// Extra 3D parts for animal characters: snouts, noses, horns, manes, brow ridges, eye domes and
// tails. Positions are in the space of the bone each part rides on: Head (y up from the neck,
// +z toward the face) or Tail (at the base of the spine, +z toward the front of the body).

const mat = (color, roughness = 0.75) => new THREE.MeshPhysicalMaterial({
  color, roughness, metalness: 0, specularIntensity: 0.3, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3),
});

function ellipsoid(radii, color, { segments = 28, roughness } = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.round(segments * 0.7)), mat(color, roughness));
  m.scale.set(...radii);
  m.castShadow = true;
  return m;
}

/** A tube along a smooth curve whose radius follows `radius(u)` (u = 0..1 along the curve). */
function taperedTube(points, radius, color, opts = {}) {
  const m = new THREE.Mesh(taperedTubeGeometry(points, radius, opts), mat(color, opts.roughness));
  m.castShadow = true;
  return m;
}

function taperedTubeGeometry(points, radius, { around = 16, steps = 40, ridges = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(steps, false);
  const pos = [], idx = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, c = curve.getPointAt(u), r = radius(u);
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2, rr = r * (1 + ridges * Math.cos(a * 5));
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a) * rr).add(frames.binormals[i].clone().multiplyScalar(Math.sin(a) * rr));
      pos.push(c.x + n.x, c.y + n.y, c.z + n.z);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < around; k++) {
      const a = i * around + k, b = i * around + ((k + 1) % around);
      idx.push(a, b, a + around, b, b + around, a + around); // outward-facing
    }
  }
  const tipCenter = curve.getPointAt(1);
  const tip = pos.length / 3;
  pos.push(tipCenter.x, tipCenter.y, tipCenter.z);
  for (let k = 0; k < around; k++) idx.push(steps * around + k, steps * around + ((k + 1) % around), tip);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

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
 */
function hairLock(points, { width, height, sink = 0.5, center = null, color, texture, around = 18, steps = 48, blend = null }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = center ? null : curve.computeFrenetFrames(steps, false);
  const len = curve.getLength(), R = around + 1;
  let perim = 0;
  for (let i = 0; i <= steps; i++) perim = Math.max(perim, Math.PI * (width(i / steps) + height(i / steps)) / 2);
  const pos = [], uv = [], col = [], idx = [];
  const c0 = center && new THREE.Vector3(...center), out = new THREE.Vector3(), side = new THREE.Vector3();
  const ring = (i) => {
    const u = i / steps, c = curve.getPointAt(u), t = curve.getTangentAt(u);
    if (c0) out.copy(c).sub(c0).addScaledVector(t, -c.clone().sub(c0).dot(t)).normalize();
    else out.copy(frames.normals[i]);
    side.crossVectors(t, out).normalize();
    const w = width(u) / 2, h = height(u) / 2, mid = c.clone().addScaledVector(out, h * 2 * (0.5 - sink));
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2, sa = Math.sin(a);
      const p = mid.clone().addScaledVector(side, w * Math.cos(a)).addScaledVector(out, h * sa);
      pos.push(p.x, p.y, p.z);
      uv.push((k / around) * perim / TILE_U / UV_SCALE, (u * len) / TILE_V / UV_SCALE);
      // occlusion: dark where it meets the head and on its underside, lighter toward the tips
      const occ = 0.5 + 0.5 * THREE.MathUtils.smoothstep(sa, -0.9, 0.7);
      col.push(Math.min(1, occ + 0.15 * u), blend ? blend.amount(u) : 0, 0, 1 - 0.5 * THREE.MathUtils.smoothstep(u, 0.85, 1));
    }
    return { c, t };
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
const at = (obj, x, y, z, rx = 0, ry = 0, rz = 0) => { obj.position.set(x, y, z); obj.rotation.set(rx, ry, rz); return obj; };

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

/** A smooth maximum: max(a, b) with the corner rounded over about k. */
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + (h * h * k) / 4; };
const smoothstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * A material that matches the body's (outfit.js): the same roughness, specular and velvet sheen
 * tinted by the color, so a part in the skin color shades exactly like the head it grows from.
 * Vertex colors carry baked occlusion (and, for horns, the color itself).
 */
function skinMat(color, { map = null, vertexColors = false } = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : c, map, vertexColors, roughness: 0.8, metalness: 0, specularIntensity: 0.25,
    sheen: 0.35, sheenRoughness: 0.8, sheenColor: c.clone().multiplyScalar(0.75).addScalar(0.0875),
  });
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
 * A part that grows out of the front of the head, as a depth map: z = smax(shape(x, y), skin - sink)
 * rounded over `soft`, so it rises out of the face in a fillet and its edge sinks just under the
 * skin. It is meshed as rings around `center`, evenly spaced along the surface out to that edge.
 * Vertex colors bake occlusion into the fillet and the underside, and near the edge the normals
 * turn to the skin's, so the shading runs on into the head. The uv is a front projection over the
 * part's extent, `box` = [cx, cy, rx, ry]: u = 0.5 + (x - cx) / 2rx, v = 0.5 + (y - cy) / 2ry.
 */
function frontBulge(shape, [cx, cy], { soft = 0.03, sink = 0.003, around = 72, rings = 34, crease = 0.28 } = {}) {
  const surface = (x, y) => { const s = skinZ(x, y); return [smax(shape(x, y), s - sink, soft), s]; };
  const sunk = (x, y) => { const [z, s] = surface(x, y); return z - s < -0.7 * sink; };
  const S = 96, prof = [];
  for (let k = 0; k < around; k++) {
    const t = (k / around) * Math.PI * 2, dx = Math.cos(t), dy = Math.sin(t);
    let r = 0.004;
    while (r < 0.3 && !sunk(cx + dx * r, cy + dy * r)) r += 0.003;
    let lo = r - 0.003, hi = r;
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (sunk(cx + dx * m, cy + dy * m)) hi = m; else lo = m; }
    const pts = [], len = [0];
    for (let i = 0; i <= S; i++) {
      const rr = (i / S) * hi, x = cx + dx * rr, y = cy + dy * rr, z = surface(x, y)[0];
      if (i) { const p = pts[i - 1]; len.push(len[i - 1] + Math.hypot(x - p[0], y - p[1], z - p[2])); }
      pts.push([x, y, z]);
    }
    prof.push({ pts, len });
  }
  const pos = [cx, cy, surface(cx, cy)[0]];
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
  const uv = [], col = [];
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), gap = P.getZ(i) - skinZ(x, y);
    n.fromBufferAttribute(N, i).lerp(skinNormal(x, y, sn), 1 - smoothstep(gap, -sink, 0.008)).normalize();
    N.setXYZ(i, n.x, n.y, n.z);
    const occ = (1 - crease * smoothstep(gap, -sink, 0) * (1 - smoothstep(gap, 0, soft * 0.7))) * (1 - 0.14 * Math.max(0, -n.y) * smoothstep(gap, -sink, 0.004));
    col.push(occ, occ, occ);
    uv.push(0.5 + (x - cx) / (2 * rx), 0.5 + (y - cy) / (2 * ry));
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { geometry: geo, box: [cx, cy, rx, ry], depth: (x, y) => surface(x, y)[0] };
}

/** The front's normal of a depth map z(x, y). */
function depthNormal(depth, x, y, e = 0.003) {
  return new THREE.Vector3(-(depth(x + e, y) - depth(x - e, y)) / (2 * e), -(depth(x, y + e) - depth(x, y - e)) / (2 * e), 1).normalize();
}

// Each snout is a few caps in one smooth union, rising out of the lower face (Head space), with
// nostrils pressed into it. mouth: [height in Head space, size relative to a mouth on the face];
// the mouth is drawn on the snout's own canvas there. nose: the dog's nose [height, width].
const SNOUTS = {
  dog: { // a soft muzzle: a rounded top running up into the brow, puffed cheeks either side of the mouth
    center: [0, 0.095], union: 0.03,
    caps: [
      { at: [0, 0.096], size: [0.07, 0.062], front: 0.258, tilt: [0.35, 0.25], box: 2.3, round: 2.3 },
      { at: [0, 0.15], size: [0.048, 0.065], front: 0.212, back: 0.1, tilt: [0.4, 0.5], round: 1.7 },
      { at: [0.033, 0.072], size: [0.044, 0.034], front: 0.262, back: 0.12, round: 2 },
      { at: [-0.033, 0.072], size: [0.044, 0.034], front: 0.262, back: 0.12, round: 2 },
    ],
    split: [0, 0.03, 0.175, 0.105], // the muzzle's color inside this ellipse (the chin fur's), `top` above
    mouth: [0.072, 0.8], nose: [0.128, 0.056],
  },
  horse: { // a long soft nose: a straight bridge from the brow down to a broad, rounded end
    center: [0, 0.095], union: 0.04,
    caps: [
      { at: [0, 0.082], size: [0.086, 0.064], front: 0.33, tilt: [0.3, 0.15], box: 2.4, round: 2.3 },
      { at: [0, 0.155], size: [0.046, 0.075], front: 0.258, back: 0.08, tilt: [0.35, 1.0], box: 2.2, round: 2 },
    ],
    nostrils: { at: [0.044, 0.102], size: [0.01, 0.022], depth: 0.011, angle: 0.4 },
    mouth: [0.062, 0.85],
  },
  cow: { // a wide, flat muzzle with big nostrils
    center: [0, 0.083], union: 0.03,
    caps: [{ at: [0, 0.083], size: [0.128, 0.066], front: 0.27, tilt: [0.12, 0.12], box: 2.7, round: 3 }],
    nostrils: { at: [0.056, 0.1], size: [0.024, 0.016], depth: 0.009, angle: 0.3 },
    mouth: [0.056, 0.9],
  },
  baboon: { // a long, deep muzzle with a blunt end, under a ridge that runs up between the eyes
    center: [0, 0.095], union: 0.04,
    caps: [
      { at: [0, 0.09], size: [0.06, 0.066], front: 0.31, tilt: [0.4, 0.3], box: 2.2, round: 2.6 },
      { at: [0, 0.155], size: [0.05, 0.07], front: 0.262, back: 0.08, tilt: [0.5, 1.1], round: 2 },
    ],
    nostrils: { at: [0.017, 0.118], size: [0.01, 0.008], depth: 0.006, angle: 0.3 },
    mouth: [0.066, 0.7],
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

/**
 * A snout that carries the mouth: the face draws its mouth (resting, emotion or talking) on this
 * canvas, over the snout's own paint (its color and nostrils, `base`); the canvas is projected
 * onto the snout from the front (see frontBulge), so the mouth reads like the face's own.
 */
function muzzle(def, color, nostrils, top) {
  const size = 512;
  const { geometry, box, depth } = frontBulge(snoutShape(def), def.center);
  const [cx, cy, rx, ry] = box;
  const base = document.createElement('canvas');
  base.width = base.height = size;
  const g = base.getContext('2d');
  const X = (x) => (0.5 + (x - cx) / (2 * rx)) * size, Y = (y) => (0.5 - (y - cy) / (2 * ry)) * size;
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  if (def.split && top) { // the face's color above the muzzle's, so the bridge runs on into the forehead
    const [ex, ey, ea, eb] = def.split;
    g.save();
    g.fillStyle = top;
    g.beginPath(); g.rect(0, 0, size, size);
    g.ellipse(X(ex), Y(ey), (ea / (2 * rx)) * size, (eb / (2 * ry)) * size, 0, 0, Math.PI * 2, true);
    g.filter = 'blur(1.5px)';
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
  const mesh = new THREE.Mesh(geometry, skinMat(color, { map: texture, vertexColors: true }));
  mesh.castShadow = true;
  const [mouthAt, scale] = def.mouth;
  return { mesh, depth, muzzle: { ctx: canvas.getContext('2d'), texture, size, base, radii: [rx, ry], color, mouthY: (mouthAt - cy) / ry, scale } };
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
    const ridge = { mesh };
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
  mane({ color }) { // a crest of soft locks from the forelock over the top and down the neck
    const pts = [[0, 0.3, 0.175], [0, 0.4, 0.125], [0, 0.447, 0.03], [0, 0.425, -0.1], [0, 0.31, -0.205], [0, 0.15, -0.24], [0, 0.0, -0.2]];
    const ends = (u) => Math.min(1, u / 0.08, (1 - u) / 0.12) ** 0.7;
    const tufts = lobes(8, 0.55);
    return [{
      bone: 'Head',
      object: hairLock(pts, {
        center: HEAD_CENTER, color, sink: 0.42,
        width: (u) => 0.012 + 0.05 * ends(u),
        height: (u) => 0.012 + (0.105 - 0.035 * u) * ends(u) * tufts(u),
      }),
    }];
  },
  ruff({ color }) { // baboon cheek fur: soft, flat tufts lying back along the sides of the head
    const out = [];
    for (const s of [-1, 1]) {
      for (const [y, len, w, fan] of [[0.15, 0.85, 0.085, 0.02], [0.095, 1.15, 0.095, 0], [0.045, 0.8, 0.08, -0.025]]) {
        const pts = [[s * 0.17, y, 0.065], [s * 0.207, y - 0.012 * len + fan * 0.4, 0.005], [s * 0.22, y - 0.03 * len + fan, -0.065 * len]];
        const shape = (u) => Math.min(1, u / 0.2) ** 0.5 * (1 - u) ** 0.75; // full at the root, a soft point at the tip
        out.push({
          bone: 'Head',
          object: hairLock(pts, { center: HEAD_CENTER, color, sink: 0.5, width: (u) => 0.01 + w * shape(u), height: (u) => 0.008 + 0.034 * shape(u), steps: 24, around: 14 }),
        });
      }
    }
    return out;
  },
  tail({ shape = 'dog', color, tip, stripes }) {
    const T = TAILS[shape] ?? TAILS.dog;
    return [{ bone: 'Tail', object: T.build(color, { tip, stripes }), wag: T.wag }];
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
  dog: { // a short, fluffy plume carried up, with a pale tip
    wag: [0.5, 9],
    build: (color, { tip }) => {
      const full = (u) => smooth(u, -0.05, 0.4) * (1 - u) ** 0.55;
      return hairLock([[0, -0.005, 0.03], [0, 0.03, -0.04], [0, 0.1, -0.08], [0, 0.17, -0.072], [0, 0.205, -0.03]], {
        color, texture: 'wavy', sink: 0.5, center: [0, 0.08, 0.06], steps: 40, around: 20,
        width: (u) => 0.03 + 0.085 * full(u) * lobes(3, 0.82)(u),
        height: (u) => 0.03 + 0.06 * full(u),
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
    wag: [0.15, 2],
    build: (color) => furTail(
      [[0, 0, 0.02], [0, 0.028, -0.04], [0, 0.07, -0.092], [0, 0.08, -0.135], [0, 0.045, -0.17], [0, -0.035, -0.188], [0, -0.13, -0.19]],
      (u) => 0.026 - 0.013 * u + flare(u, 0.026),
      tailCanvas(color, { tip: shade(color, -0.3), soft: true })),
  },
  cow: { // a thin rope hanging down, ending in a hair tuft it grows into
    wag: [0.2, 2],
    build: (color, { tip }) => {
      const g = group(furTail([[0, 0, 0.02], [0, -0.03, -0.035], [0, -0.1, -0.06], [0, -0.185, -0.066]], (u) => 0.0105 + flare(u, 0.016), tailCanvas(color, {}), { around: 14, steps: 40 }));
      const swell = (u) => Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.75;
      g.add(hairLock([[0, -0.155, -0.064], [0, -0.2, -0.067], [0, -0.262, -0.064]], {
        color: tip ?? '#3a2f2a', sink: 0.5, center: [0, -0.2, 0.05], steps: 24, around: 14,
        width: (u) => 0.022 + 0.04 * swell(u) * (1 - 0.35 * u), height: (u) => 0.022 + 0.034 * swell(u) * (1 - 0.35 * u),
      }));
      return g;
    },
  },
  horse: { // hair like the mane: three locks from one narrow dock, arching out and falling full
    wag: [0.18, 2],
    build: (color) => group(...[[0, 1, 0.28], [-1, 0.93, 0.24], [1, 0.9, 0.24]].map(([s, len, w]) => {
      const fall = (u) => smooth(u, 0.05, 0.45) * (1 - 0.45 * smooth(u, 0.72, 1));
      const x = (u) => s * (0.008 + 0.036 * u * u); // the side locks part a little toward the end
      const pts = [[0, 0.0, 0.03], [0, 0.02, -0.03], [x(0.3), 0.004, -0.086], [x(0.55), -0.07 * len, -0.122], [x(0.8), -0.165 * len, -0.134], [x(1), -0.262 * len, -0.126]];
      return hairLock(pts, {
        color, sink: 0.5, center: [0, -0.07, 0.1], around: 16, steps: 40,
        width: (u) => 0.028 + w * 0.3 * fall(u), height: (u) => 0.028 + 0.052 * fall(u) * (1 - 0.4 * u),
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

/**
 * Pose a brow ridge like the face would draw the brows (see BROWS in face-parts.js): each side's
 * inner and outer ends rise and fall with the brow's tilt and lift. null rests it.
 */
export function poseBrowRidge(ridge, name) {
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
  const geo = new THREE.SphereGeometry(r, 40, 30);
  geo.deleteAttribute('uv');
  geo.rotateX(Math.PI / 2); // poles front and back
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
