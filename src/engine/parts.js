import * as THREE from 'three';

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
function taperedTube(points, radius, color, { around = 16, steps = 40, ridges = 0, roughness } = {}) {
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
  const m = new THREE.Mesh(geo, mat(color, roughness));
  m.castShadow = true;
  return m;
}

const group = (...children) => { const g = new THREE.Group(); g.add(...children); return g; };
const at = (obj, x, y, z, rx = 0, ry = 0, rz = 0) => { obj.position.set(x, y, z); obj.rotation.set(rx, ry, rz); return obj; };

// --- builders, each returning [{ bone, object, wag? }] -----------------------------------------

const SNOUTS = {
  // [center, radii] in Head space
  dog: [[0, 0.105, 0.2], [0.085, 0.062, 0.078]],
  horse: [[0, 0.085, 0.215], [0.096, 0.076, 0.12]],
  cow: [[0, 0.078, 0.2], [0.13, 0.075, 0.08]],
  baboon: [[0, 0.1, 0.225], [0.072, 0.066, 0.135]],
  gorilla: [[0, 0.075, 0.175], [0.12, 0.066, 0.06]],
};

export const PART_BUILDERS = {
  snout({ shape = 'dog', color, nose = '#2a2224', nostrils = '#4a2c30' }) {
    const [c, r] = SNOUTS[shape];
    const out = [{ bone: 'Head', object: at(ellipsoid(r, color), ...c) }];
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
  brow({ color }) {
    return [{ bone: 'Head', object: at(ellipsoid([0.13, 0.034, 0.03], color), 0, 0.226, 0.152) }];
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
  mane({ color }) { // horse: tufts from the forehead over the top and down the back of the neck
    const path = new THREE.CatmullRomCurve3([[0, 0.34, 0.15], [0, 0.44, 0.04], [0, 0.42, -0.1], [0, 0.28, -0.22], [0, 0.1, -0.24], [0, -0.04, -0.18]].map((p) => new THREE.Vector3(...p)));
    const g = new THREE.Group();
    for (let i = 0; i < 18; i++) { // dense, overlapping tufts read as one crest
      const u = i / 17, p = path.getPointAt(u), t = path.getTangentAt(u);
      const tuft = ellipsoid([0.026, 0.062 - 0.015 * u, 0.042], color);
      tuft.position.copy(p);
      tuft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      tuft.rotateX(-0.6);
      g.add(tuft);
    }
    return [{ bone: 'Head', object: g }];
  },
  ruff({ color }) { // baboon cheek fur
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      g.add(at(ellipsoid([0.045, 0.06, 0.05], color), s * 0.2, 0.11, 0.04, 0, 0, s * 0.35));
      g.add(at(ellipsoid([0.042, 0.052, 0.046], color), s * 0.185, 0.04, 0.01, 0, 0, s * 0.55));
    }
    return [{ bone: 'Head', object: g }];
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
    const g = group(taperedTube(T.pts, T.r, color, { ridges: T.ridges ?? 0 }));
    if (shape === 'cow') g.add(at(ellipsoid([0.026, 0.04, 0.026], tip ?? '#3a2f2a'), 0, -0.17, -0.065));
    return [{ bone: 'Tail', object: g, wag: T.wag }];
  },
};

/** Build all parts of a spec: parts = [{ type: 'snout', shape: 'dog', color }, ...]. */
export function buildParts(parts = []) {
  return parts.flatMap(({ type, ...opts }) => PART_BUILDERS[type]?.(opts) ?? []);
}
