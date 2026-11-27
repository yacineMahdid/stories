import * as THREE from 'three';
import { BROWS } from './face-parts.js';
import { createHairMaterial, setHairColor, setHairTexture, UV_SCALE } from './hair.js';

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

function hairMaterial(color, texture = 'straight') {
  const material = createHairMaterial();
  setHairTexture(material, texture);
  setHairColor(material, color);
  return material;
}

/**
 * A lock of hair swept along a curve: an elliptical section `width(u)` across and `height(u)` out
 * from the curve (u = 0..1 along it), sunk by `sink` of its height into what it grows from. "Out"
 * points away from `center` (a mane on the head), or along the curve's normal (a tail). Flow UVs
 * run along the curve, and the underside is darkened like the hair's baked occlusion.
 */
function hairLock(points, { width, height, sink = 0.5, center = null, color, texture, around = 18, steps = 48 }) {
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
      col.push(Math.min(1, occ + 0.15 * u), 0, 0, 1 - 0.5 * THREE.MathUtils.smoothstep(u, 0.85, 1));
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
    col.push(0.8, 0, 0, 0.4);
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
  const m = new THREE.Mesh(geo, hairMaterial(color, texture));
  m.castShadow = true;
  return m;
}

/** Locks that bulge in a row (a mane's tufts): 1 at a lock's middle, `low` between two. */
const lobes = (count, low) => (u) => low + (1 - low) * Math.sqrt(Math.abs(Math.sin(Math.PI * count * u)));
const HEAD_CENTER = [0, 0.21, -0.01];

const group = (...children) => { const g = new THREE.Group(); g.add(...children); return g; };
const at = (obj, x, y, z, rx = 0, ry = 0, rz = 0) => { obj.position.set(x, y, z); obj.rotation.set(rx, ry, rz); return obj; };

// --- builders, each returning [{ bone, object, wag? }] -----------------------------------------

const SNOUTS = {
  // [center, radii, mouth] in Head space. The mouth is drawn on the snout, under the nose:
  // [height on the snout's front (1 top, -1 bottom), size relative to a mouth on the face].
  dog: [[0, 0.105, 0.2], [0.085, 0.062, 0.078], [-0.15, 0.8]],
  horse: [[0, 0.085, 0.215], [0.096, 0.076, 0.12], [-0.25, 0.9]],
  cow: [[0, 0.078, 0.2], [0.13, 0.075, 0.08], [-0.25, 0.9]],
  baboon: [[0, 0.1, 0.225], [0.072, 0.066, 0.135], [-0.25, 0.75]],
  gorilla: [[0, 0.075, 0.175], [0.12, 0.066, 0.06], [-0.05, 0.8]],
};

/**
 * A snout that carries the mouth: the face draws its mouth (resting, emotion or talking) on this
 * canvas, which is projected onto the snout from the front, so it reads like the face's own mouth.
 */
function muzzle(r, color, [mouthY, scale]) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.owned = true; // disposed with the part (hair tiles are shared and are not)
  const mesh = ellipsoid(r, color);
  const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / 2, 0.5 + pos.getY(i) / 2);
  mesh.material.color.set(0xffffff); // the canvas carries the snout's color
  mesh.material.map = texture;
  return { mesh, muzzle: { ctx: canvas.getContext('2d'), texture, size, radii: r, color, mouthY, scale } };
}

export const PART_BUILDERS = {
  snout({ shape = 'dog', color, nose = '#2a2224', nostrils = '#4a2c30' }) {
    const [c, r, mouth] = SNOUTS[shape];
    const { mesh, muzzle: m } = muzzle(r, color, mouth);
    const out = [{ bone: 'Head', object: at(mesh, ...c), muzzle: m }];
    const front = c[2] + r[2];
    if (shape === 'dog') {
      out.push({ bone: 'Head', object: at(ellipsoid([0.032, 0.024, 0.026], nose, { roughness: 0.35 }), 0, c[1] + r[1] * 0.45, front - 0.008) });
    } else {
      const spread = shape === 'cow' ? 0.045 : shape === 'gorilla' ? 0.03 : shape === 'baboon' ? 0.022 : 0.036;
      const y = c[1] + r[1] * (shape === 'gorilla' ? 0.55 : 0.2);
      const z = shape === 'gorilla' ? c[2] + r[2] * 0.75 : front - 0.012;
      for (const s of [-1, 1]) out.push({ bone: 'Head', object: at(ellipsoid([0.016, 0.012, 0.01], nostrils, { segments: 14 }), s * spread, y, z) });
    }
    return out;
  },
  brow({ color }) { // one ridge that frowns, lifts and worries with the emotion's brows
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat(color));
    mesh.castShadow = true;
    const ridge = { mesh };
    poseBrowRidge(ridge, null);
    return [{ bone: 'Head', object: mesh, ridge }];
  },
  horns({ color = '#efe6d2' }) {
    return [-1, 1].map((s) => ({
      bone: 'Head',
      object: taperedTube([[s * 0.13, 0.35, -0.01], [s * 0.19, 0.39, 0.0], [s * 0.23, 0.45, 0.02], [s * 0.22, 0.5, 0.03]], (u) => 0.026 * (1 - u * 0.75), color, { roughness: 0.45 }),
    }));
  },
  domes({ color }) { // frog eye bumps
    return [-1, 1].map((s) => ({ bone: 'Head', object: at(ellipsoid([0.085, 0.07, 0.075], color), s * 0.105, 0.33, 0.06) }));
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
  tail({ shape = 'dog', color, tip }) {
    const T = {
      dog: { pts: [[0, 0, 0], [0, 0.04, -0.06], [0, 0.1, -0.085], [0, 0.14, -0.055]], r: (u) => 0.03 - 0.016 * u, wag: [0.5, 9] },
      cat: { pts: [[0, 0, 0], [0, -0.03, -0.08], [0, 0.05, -0.15], [0, 0.17, -0.16], [0, 0.23, -0.11]], r: (u) => 0.022 - 0.006 * u, wag: [0.25, 2.5] },
      cow: { pts: [[0, 0, 0], [0, -0.05, -0.05], [0, -0.15, -0.065]], r: () => 0.011, wag: [0.2, 2] },
      horse: { pts: [[0, 0, 0], [0, -0.02, -0.07], [0, -0.12, -0.1], [0, -0.21, -0.09]], r: (u) => 0.035 + 0.02 * Math.sin(u * Math.PI) - 0.02 * u, wag: [0.18, 2], ridges: 0.12 },
      monkey: { pts: [[0, 0, 0], [0, -0.04, -0.1], [0, 0.03, -0.2], [0, 0.15, -0.21], [0, 0.2, -0.15], [0, 0.16, -0.1]], r: () => 0.015, wag: [0.2, 2] },
      baboon: { pts: [[0, 0, 0], [0, 0.03, -0.06], [0, 0.0, -0.11], [0, -0.08, -0.125]], r: (u) => 0.02 - 0.006 * u, wag: [0.15, 2] },
    }[shape];
    // a horse's tail is hair, like its mane; the others are furred like the body
    const g = group(shape === 'horse'
      ? hairLock(T.pts, { color, sink: 0.5, width: (u) => 2 * T.r(u) * 1.15, height: (u) => 2 * T.r(u), around: 20 })
      : taperedTube(T.pts, T.r, color, { ridges: T.ridges ?? 0 }));
    if (shape === 'cow') { // the tuft at the tip
      g.add(hairLock([[0, -0.135, -0.065], [0, -0.17, -0.068], [0, -0.215, -0.066]], {
        color: tip ?? '#3a2f2a', sink: 0.5, width: (u) => 0.01 + 0.05 * Math.sin(Math.PI * Math.min(1, u * 1.25)) ** 0.7, height: (u) => 0.01 + 0.045 * Math.sin(Math.PI * Math.min(1, u * 1.25)) ** 0.7, steps: 20, around: 14,
      }));
    }
    return [{ bone: 'Tail', object: g, wag: T.wag }];
  },
};

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
  const pts = [
    [-0.13, y(left, true), 0.128], [-0.06, y(left, false), 0.158], [0, (y(left, false) + y(right, false)) / 2 - 0.003, 0.166],
    [0.06, y(right, false), 0.158], [0.13, y(right, true), 0.128],
  ];
  const key = JSON.stringify(pts);
  if (ridge.key === key) return;
  ridge.key = key;
  ridge.mesh.geometry.dispose();
  ridge.mesh.geometry = taperedTubeGeometry(pts, (u) => 0.033 - 0.013 * (2 * u - 1) ** 2, { around: 20, steps: 36 });
}

/** Build all parts of a spec: parts = [{ type: 'snout', shape: 'dog', color }, ...]. */
export function buildParts(parts = []) {
  return parts.flatMap(({ type, ...opts }) => PART_BUILDERS[type]?.(opts) ?? []);
}
