import * as THREE from 'three';
import { furCoat } from './outfit.js';

// Ear styles. Human ears are part of the body mesh and ride on the LeftEar/RightEar bones, so
// they are resized by scaling those bones. Every other style (scale 0) hides them: the body
// swaps to an earless copy of its geometry, where each ear's vertices are laid out over a
// smooth patch of the head (earlessGeometry), so the side of the head is round from every
// angle. Animal and elf ears are sculpted shells parented to the Head bone (sculptEar), built
// in Head-bone space: +y up, +z toward the face, +x = the character's left.

export const EAR_STYLES = {
  human: { label: 'Human', scale: 1 },
  small: { label: 'Small', scale: 0.7 },
  big: { label: 'Big', scale: 1.45 },
  elf: { label: 'Elf', scale: 0 },
  cat: { label: 'Cat', scale: 0 },
  fox: { label: 'Fox', scale: 0 },
  bunny: { label: 'Bunny', scale: 0 },
  bear: { label: 'Bear', scale: 0 },
  mouse: { label: 'Mouse', scale: 0 },
  floppy: { label: 'Floppy', scale: 0 },
  cow: { label: 'Cow', scale: 0 },
  horse: { label: 'Horse', scale: 0 },
  monkey: { label: 'Monkey', scale: 0 },
  none: { label: 'None', scale: 0 },
};

// --- the earless head -----------------------------------------------------------------------

const EARLESS = new WeakMap(); // body geometry -> { geometry, head }
const EAR_BONES = ['LeftEar', 'RightEar'];

/** Least-squares sphere through points ([x, y, z] arrays): { center: Vector3, radius }. */
function fitSphere(points) {
  // |p|^2 = 2 p.c + (r^2 - |c|^2): linear in (cx, cy, cz, k); solve the 4x4 normal equations
  const A = Array.from({ length: 4 }, () => new Float64Array(5));
  for (const [x, y, z] of points) {
    const row = [2 * x, 2 * y, 2 * z, 1], rhs = x * x + y * y + z * z;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
      A[i][4] += row[i] * rhs;
    }
  }
  for (let i = 0; i < 4; i++) { // Gauss-Jordan with partial pivoting
    let p = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    for (let k = 0; k < 4; k++) {
      if (k === i) continue;
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 5; j++) A[k][j] -= f * A[i][j];
    }
  }
  const c = new THREE.Vector3(A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2]);
  return { center: c, radius: Math.sqrt(A[3][4] / A[3][3] + c.lengthSq()) };
}

/**
 * The body geometry without the human ears, shared by every character that hides them, plus
 * the head's vertices in Head-bone space (for placing ears on it). Each ear is a disk of the
 * mesh bounded by one loop of head vertices. The disk is laid out flat (a Tutte embedding into
 * a circle, which never folds), mapped into the loop, and lifted onto a sphere fitted to the
 * head around it (blending to the loop's exact heights), so the patch carries on the head's
 * curve with no dent, pinch or crease. Its new rest positions also repaint the fur there.
 */
export function earlessGeometry(geometry, skeleton) {
  let out = EARLESS.get(geometry);
  if (out) return out;
  const pos = geometry.attributes.position, si = geometry.attributes.skinIndex, sw = geometry.attributes.skinWeight;
  const count = pos.count;
  const bones = skeleton.bones.map((b) => b.name);
  const earJoint = new Set(EAR_BONES.map((n) => bones.indexOf(n)));
  const headJoint = bones.indexOf('Head');

  // weld the seams' duplicate vertices
  const ids = new Map(), weld = new Int32Array(count), X = [];
  for (let i = 0; i < count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    let w = ids.get(k);
    if (w === undefined) { w = ids.size; ids.set(k, w); X.push(new THREE.Vector3().fromBufferAttribute(pos, i)); }
    weld[i] = w;
  }
  const n = X.length, ear = new Uint8Array(n), onHead = new Uint8Array(n);
  for (let i = 0; i < count; i++) {
    let e = 0, h = 0;
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(i, k), wt = sw.getComponent(i, k);
      if (earJoint.has(j)) e += wt;
      if (j === headJoint) h += wt;
    }
    if (e > 0) ear[weld[i]] = 1;
    if (e + h > 0.999) onHead[weld[i]] = 1;
  }
  const idx = geometry.index.array, faces = [];
  for (let f = 0; f < idx.length; f += 3) faces.push([weld[idx[f]], weld[idx[f + 1]], weld[idx[f + 2]]]);

  const Y = X.map((v) => v.clone());
  const touched = new Set();
  for (const side of [1, -1]) {
    const inEar = (w) => ear[w] && Math.sign(X[w].x) === side;
    const patch = faces.filter((f) => f.some(inEar));
    if (!patch.length) continue;
    // the loop: edges used by one patch face, followed in the faces' winding
    const uses = new Map(), next = new Map();
    for (const [a, b, c] of patch) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    for (const [a, b, c] of patch) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (uses.get(p < q ? `${p},${q}` : `${q},${p}`) === 1) next.set(p, q);
    }
    const loop = [next.keys().next().value];
    while (loop.length <= next.size) {
      const v = next.get(loop[loop.length - 1]);
      if (v === loop[0] || v === undefined) break;
      loop.push(v);
    }
    const inner = [...new Set(patch.flat())].filter(inEar);
    const neighbors = new Map(inner.map((v) => [v, new Set()]));
    for (const f of patch) for (const v of f) if (neighbors.has(v)) for (const u of f) if (u !== v) neighbors.get(v).add(u);

    // the loop around a circle by length, the inside by repeated averaging (Tutte)
    const lengths = loop.map((v, k) => X[v].distanceTo(X[loop[(k + 1) % loop.length]]));
    const total = lengths.reduce((a, b) => a + b, 0);
    const angle = new Map(), U = new Map();
    let run = 0;
    loop.forEach((v, k) => { const a = (run / total) * Math.PI * 2; angle.set(v, a); U.set(v, [Math.cos(a), Math.sin(a)]); run += lengths[k]; });
    const center = loop.reduce((c, v) => c.add(X[v]), new THREE.Vector3()).divideScalar(loop.length);
    const fit = fitSphere(X.filter((p, w) => onHead[w] && !ear[w] && p.distanceTo(center) < 0.1 && p.x * side > 0.05).map((p) => [p.x, p.y, p.z]));
    const lift = new Map(loop.map((v) => [v, X[v].distanceTo(fit.center) - fit.radius]));
    // solve on flat arrays: slot k < inner.length is free, the rest are the loop's fixed values
    const slots = [...inner, ...loop], slot = new Map(slots.map((v, k) => [v, k]));
    const su = new Float64Array(slots.length), sw = new Float64Array(slots.length), sl = new Float64Array(slots.length);
    loop.forEach((v, k) => { const s = inner.length + k; [su[s], sw[s]] = U.get(v); sl[s] = lift.get(v); });
    const nb = inner.map((v) => Int32Array.from(neighbors.get(v), (q) => slot.get(q)));
    for (let it = 0; it < 500; it++) {
      for (let k = 0; k < inner.length; k++) {
        const ns = nb[k];
        let u = 0, w = 0, l = 0;
        for (let j = 0; j < ns.length; j++) { u += su[ns[j]]; w += sw[ns[j]]; l += sl[ns[j]]; }
        su[k] = u / ns.length; sw[k] = w / ns.length; sl[k] = l / ns.length;
      }
    }
    inner.forEach((v, k) => { U.set(v, [su[k], sw[k]]); lift.set(v, sl[k]); });
    // disk -> the loop's outline (radially from its center) -> the fitted sphere
    const edge = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const v of inner) {
      const [u, w] = U.get(v), rho = Math.min(1, Math.hypot(u, w));
      let a = Math.atan2(w, u);
      if (a < 0) a += Math.PI * 2;
      let k = loop.length - 1;
      for (let j = 0; j < loop.length; j++) if (angle.get(loop[j]) <= a) k = j;
      const a0 = angle.get(loop[k]), a1 = k + 1 < loop.length ? angle.get(loop[k + 1]) : Math.PI * 2;
      edge.lerpVectors(X[loop[k]], X[loop[(k + 1) % loop.length]], (a - a0) / Math.max(1e-9, a1 - a0));
      dir.lerpVectors(center, edge, rho).sub(fit.center).normalize();
      Y[v].copy(fit.center).addScaledVector(dir, fit.radius + lift.get(v));
      touched.add(v);
    }
    for (const v of loop) touched.add(v);
  }

  // smooth normals for the patch and its loop, from every face around them
  const normals = new Map([...touched].map((v) => [v, new THREE.Vector3()]));
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const [a, b, c] of faces) {
    if (!normals.has(a) && !normals.has(b) && !normals.has(c)) continue;
    e1.subVectors(Y[b], Y[a]); e2.subVectors(Y[c], Y[a]);
    const fn = e1.cross(e2); // area-weighted
    for (const v of [a, b, c]) normals.get(v)?.add(fn);
  }
  const position = pos.clone(), normal = geometry.attributes.normal.clone();
  for (let i = 0; i < count; i++) {
    const w = weld[i];
    if (!touched.has(w)) continue;
    position.setXYZ(i, Y[w].x, Y[w].y, Y[w].z);
    const nn = normals.get(w).normalize();
    normal.setXYZ(i, nn.x, nn.y, nn.z);
  }
  const earless = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) earless.setAttribute(name, attribute);
  earless.setAttribute('position', position);
  earless.setAttribute('normal', normal);
  earless.setIndex(geometry.index);
  earless.morphAttributes = geometry.morphAttributes;
  earless.morphTargetsRelative = geometry.morphTargetsRelative;
  for (const g of geometry.groups) earless.addGroup(g.start, g.count, g.materialIndex);
  earless.name = `${geometry.name || 'body'} (earless)`;

  // the head in Head-bone space (rest pose), where ears are placed
  const toHead = skeleton.boneInverses[headJoint];
  const head = Y.filter((p, w) => onHead[w]).map((p) => p.clone().applyMatrix4(toHead));
  out = { geometry: earless, head };
  EARLESS.set(geometry, out);
  return out;
}

/** The head's local sphere near `at` (Head space), from the head's vertices or a stand-in. */
function headSphere(head, at, reach = 0.085) {
  const near = head?.filter((p) => p.distanceTo(at) < reach).map((p) => [p.x, p.y, p.z]) ?? [];
  return near.length >= 12 ? fitSphere(near) : { center: new THREE.Vector3(0, 0.2, -0.02), radius: 0.215 };
}

// --- sculpted ears --------------------------------------------------------------------------

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** `count` points evenly spaced around a closed smooth curve through `pts` ([x, y]), anticlockwise. */
function outlinePoints(pts, count) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
  curve.arcLengthDivisions = 400;
  const out = curve.getSpacedPoints(count).slice(0, count).map((v) => [v.x, v.y]);
  let area = 0;
  for (let j = 0; j < count; j++) { const [x0, y0] = out[j], [x1, y1] = out[(j + 1) % count]; area += x0 * y1 - x1 * y0; }
  return area < 0 ? out.reverse() : out;
}

function distanceToOutline(O, x, y) {
  let best = Infinity;
  for (let j = 0; j < O.length; j++) {
    const [ax, ay] = O[j], [bx, by] = O[(j + 1) % O.length];
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

/**
 * One ear as a closed, smooth shell in Head space. Its outline (in the ear's own plane: x across,
 * y up the ear from where it meets the head, which is y = 0) is filled by rings around `center`.
 * The mid-surface is a bowl `cup` deep, so the front (+z) is a cupped hollow and the back
 * rounded; the shell is `thick` thick on each side of it in the middle and thins to a rim
 * rounded with radius `rim`. The ear can curl along its length (`bend`: radians at the tip, or
 * keyframes; + toward the hollow). Placed at `at` on the head's local curve (sunk `sink`), its y
 * along `up` and its hollow facing `face`; near the head it flares (thicker by `flare` [front,
 * back] where it meets the head, fading out `flareHeight` above it).
 * The uv carries the inner color's mask: x = distance from the rim across the hollow (negative
 * on the back), y = height above the head; the vertex color a little occlusion in the hollow.
 */
function sculptEar(o, head) {
  const {
    outline, center, cup = 0.02, flat = 0.4, thick = 0.007, thickFlat = 0.5, rim = 0.0035, bend = 0, bendPow = 1.6,
    at, sink = 0.012, up, face, flare = [0.004, 0.012], flareHeight = 0.035, ao = 0.1,
    cols = 48, frontRows = 14, capRows = 8, backRows = 8,
  } = o;
  const O = outlinePoints(outline, cols);
  const normal2 = O.map((p, j) => {
    const [ax, ay] = O[(j + cols - 1) % cols], [bx, by] = O[(j + 1) % cols], l = Math.hypot(bx - ax, by - ay);
    return [(by - ay) / l, -(bx - ax) / l]; // outward for an anticlockwise outline
  });
  const Q = O.map(([x, y], j) => [x - normal2[j][0] * rim, y - normal2[j][1] * rim]);
  const [cx, cy] = center;

  // rings, front pole to back pole: [s or cap angle, kind]; s = 0 at the center, 1 at the rim
  const rings = [];
  for (let i = 1; i <= frontRows; i++) rings.push(['front', i / frontRows]);
  for (let i = 1; i < capRows; i++) rings.push(['cap', (i / capRows) * Math.PI]);
  for (let i = backRows; i >= 1; i--) rings.push(['back', i / backRows]);

  const bowl = (s) => -cup * smooth((1 - s) / (1 - flat));
  const half = (s) => rim + (thick - rim) * smooth((1 - s) / (1 - thickFlat));
  const local = [], side = [], mask = [], radial = [];
  const push = (x, y, z, sd, m, s) => { local.push([x, y, z]); side.push(sd); mask.push(m); radial.push(s); };
  const pole = (sd) => push(cx, cy, bowl(0) + sd * half(0), sd, sd * distanceToOutline(O, cx, cy), 0);
  pole(1); pole(-1);
  for (const [kind, v] of rings) {
    for (let j = 0; j < cols; j++) {
      const [qx, qy] = Q[j], [nx, ny] = normal2[j];
      if (kind === 'cap') {
        const sn = Math.sin(v), cs = Math.cos(v);
        push(qx + nx * rim * sn, qy + ny * rim * sn, rim * cs, cs, rim * (1 - (2 * v) / Math.PI), 1);
      } else {
        const x = cx + (qx - cx) * v, y = cy + (qy - cy) * v, sd = kind === 'front' ? 1 : -1;
        push(x, y, bowl(v) + sd * half(v), sd, sd * distanceToOutline(O, x, y), v);
      }
    }
  }

  // curl along the length: the spine turns by bend * (y / top)^bendPow, or through keyframes
  // [[y / top, angle], ...] (the curve bends evenly between two)
  let top = 0;
  for (const [, y] of local) top = Math.max(top, y);
  const theta = (y) => {
    if (y <= 0) return 0;
    const u = Math.min(1, y / top);
    if (!Array.isArray(bend)) return bend * u ** bendPow;
    let k = 0;
    while (k < bend.length - 2 && bend[k + 1][0] < u) k++;
    const [u0, a0] = bend[k], [u1, a1] = bend[k + 1];
    return a0 + (a1 - a0) * Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
  };
  const STEPS = 96, spine = [];
  for (let i = 0, sy = 0, sz = 0; i <= STEPS; i++) {
    const y = (top * i) / STEPS;
    spine.push([sy, sz]);
    const t = theta(y + top / STEPS / 2);
    sy += Math.cos(t) * (top / STEPS); sz += Math.sin(t) * (top / STEPS);
  }
  const curl = (y) => {
    if (y <= 0) return [y, 0, 0];
    const f = Math.min(STEPS, (y / top) * STEPS), i = Math.min(STEPS - 1, Math.floor(f)), k = f - i;
    return [spine[i][0] + (spine[i + 1][0] - spine[i][0]) * k, spine[i][1] + (spine[i + 1][1] - spine[i][1]) * k, theta(y)];
  };

  // the ear's frame on the head
  const Yax = new THREE.Vector3(...up).normalize();
  const Zax = new THREE.Vector3(...face).projectOnPlane(Yax).normalize();
  const Xax = new THREE.Vector3().crossVectors(Yax, Zax);
  const sphere = headSphere(head, new THREE.Vector3(...at));
  const base = new THREE.Vector3(...at).sub(sphere.center).setLength(sphere.radius - sink).add(sphere.center);

  const positions = new Float32Array(local.length * 3), uvs = new Float32Array(local.length * 2), colors = new Float32Array(local.length * 3);
  const p = new THREE.Vector3();
  local.forEach(([x, y, z], i) => {
    const [sy, sz, t] = curl(y);
    const place = (zz) => p.copy(base).addScaledVector(Xax, x).addScaledVector(Yax, sy - zz * Math.sin(t)).addScaledVector(Zax, sz + zz * Math.cos(t));
    place(z);
    const height = p.distanceTo(sphere.center) - sphere.radius;
    // flare: thicker toward the head on both faces, most at and below the meeting line
    const w = 1 - smooth((height + 0.01) / (flareHeight + 0.01));
    const sd = side[i];
    const grow = sd >= 0 ? flare[0] * sd : flare[1] * sd;
    place(z + grow * w);
    positions.set([p.x, p.y, p.z], i * 3);
    uvs.set([mask[i], height], i * 2);
    // a little occlusion deep in the hollow
    const occ = 1 - ao * Math.max(0, sd) * smooth((1 - radial[i]) / (1 - flat));
    colors.set([occ, occ, occ], i * 3);
  });

  const index = [];
  const at2 = (r, j) => 2 + r * cols + ((j + cols) % cols);
  for (let j = 0; j < cols; j++) index.push(0, at2(0, j), at2(0, j + 1));
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < cols; j++) {
      const a = at2(r, j), b = at2(r, j + 1), c = at2(r + 1, j), d = at2(r + 1, j + 1);
      index.push(a, c, b, b, c, d);
    }
  }
  const last = rings.length - 1;
  for (let j = 0; j < cols; j++) index.push(at2(last, j), 1, at2(last, j + 1));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** The same ear on the other side: x mirrored, faces turned back out. */
function mirrored(geo) {
  const m = geo.clone();
  const pos = m.attributes.position, nrm = m.attributes.normal;
  for (let i = 0; i < pos.count; i++) { pos.setX(i, -pos.getX(i)); nrm.setX(i, -nrm.getX(i)); }
  const idx = m.index.array;
  for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return m;
}

/**
 * The body's matte velvet fur (outfit.js createBodyMaterial), with the inner color painted in
 * the hollow: a soft-edged band `band` in from the rim, fading out over `fade` [from, to] of
 * height above the head. One shader program for every ear.
 */
function earMaterial(fur, inner, { band = 0.012, soft = 0.005, fade = [0.004, 0.03] } = {}) {
  const uniforms = {
    uInner: { value: new THREE.Color(inner ?? fur) },
    uMask: { value: new THREE.Vector4(band, inner ? soft : 0, fade[0], fade[1]) },
  };
  const material = new THREE.MeshPhysicalMaterial({
    name: 'Ear', color: fur, vertexColors: true, roughness: 0.8, metalness: 0, specularIntensity: 0.25,
    sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff),
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEarMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEarMask = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEarMask;\nuniform vec3 uInner;\nuniform vec4 uMask;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', [
        'float earInner = smoothstep( uMask.x - uMask.y, uMask.x + uMask.y, vEarMask.x ) * smoothstep( uMask.z, uMask.w, vEarMask.y );',
        'vec4 diffuseColor = vec4( mix( diffuse, uInner, uMask.y > 0.0 ? earInner : 0.0 ), opacity );',
      ].join('\n'));
    furCoat(shader); // the body's coat: the sheen in the painted color's hue, and its faint grain
  };
  material.customProgramCacheKey = () => 'sculpted-ear-2';
  material.userData.ear = uniforms;
  return material;
}

const INNER_PINK = '#f3a8b6';

// Each style: the ear's shape (sculptEar) for the left ear, its inner color and mask.
// `at` is near the head's surface; the ear is snapped onto the head's local curve there.
const SHAPES = {
  cat: {
    outline: [[-0.095, -0.05], [-0.084, 0.03], [-0.055, 0.088], [-0.02, 0.126], [0, 0.133], [0.02, 0.126], [0.055, 0.088], [0.084, 0.03], [0.095, -0.05], [0, -0.075]],
    center: [0, 0.03], cup: 0.024, thick: 0.013, rim: 0.0065, bend: 0.12,
    at: [0.118, 0.378, -0.025], sink: 0.012, up: [0.45, 0.89, -0.06], face: [0.18, 0.08, 1],
    inner: INNER_PINK, band: 0.016,
  },
  fox: {
    outline: [[-0.078, -0.05], [-0.069, 0.05], [-0.042, 0.12], [-0.014, 0.168], [0, 0.176], [0.014, 0.168], [0.042, 0.12], [0.069, 0.05], [0.078, -0.05], [0, -0.07]],
    center: [0, 0.04], cup: 0.024, thick: 0.012, rim: 0.006, bend: 0.1,
    at: [0.112, 0.385, -0.03], sink: 0.012, up: [0.36, 0.93, -0.08], face: [0.15, 0.1, 1],
    inner: '#fff1dc', band: 0.015,
  },
  bunny: {
    outline: [[-0.032, -0.04], [-0.03, 0.03], [-0.042, 0.12], [-0.037, 0.21], [-0.019, 0.255], [0, 0.262], [0.019, 0.255], [0.037, 0.21], [0.042, 0.12], [0.03, 0.03], [0.032, -0.04], [0, -0.055]],
    center: [0, 0.11], cup: 0.017, flat: 0.5, thick: 0.011, rim: 0.0055, bend: -0.25,
    at: [0.07, 0.415, -0.04], sink: 0.012, up: [0.16, 0.98, -0.16], face: [0.1, 0.12, 1],
    inner: INNER_PINK, band: 0.013, frontRows: 16,
  },
  bear: {
    outline: [[-0.06, -0.035], [-0.066, 0.035], [-0.046, 0.083], [0, 0.101], [0.046, 0.083], [0.066, 0.035], [0.06, -0.035], [0, -0.055]],
    center: [0, 0.03], cup: 0.019, thick: 0.014, rim: 0.007,
    at: [0.148, 0.355, -0.035], sink: 0.012, up: [0.55, 0.83, -0.08], face: [0.2, 0.05, 1],
    inner: '#d9a77c', band: 0.016,
  },
  mouse: {
    outline: [[-0.075, -0.03], [-0.088, 0.04], [-0.065, 0.11], [0, 0.14], [0.065, 0.11], [0.088, 0.04], [0.075, -0.03], [0, -0.05]],
    center: [0, 0.045], cup: 0.022, thick: 0.01, rim: 0.005,
    at: [0.165, 0.335, -0.045], sink: 0.012, up: [0.72, 0.68, -0.1], face: [0.25, 0.0, 1],
    inner: INNER_PINK, band: 0.015,
  },
  floppy: { // lies over the top-side of the head, then folds softly down to hang, the hollow toward the cheek
    outline: [[-0.07, -0.03], [-0.068, 0.04], [-0.058, 0.11], [-0.056, 0.17], [-0.042, 0.228], [0, 0.255], [0.042, 0.228], [0.056, 0.17], [0.058, 0.11], [0.068, 0.04], [0.07, -0.03], [0, -0.045]],
    center: [0, 0.09], cup: 0.01, flat: 0.5, thick: 0.017, rim: 0.0085, bend: [[0, 0], [0.33, 0.39], [0.62, 0.92], [1, 0.95]],
    at: [0.12, 0.39, -0.01], sink: -0.004, up: [0.845, -0.534, 0], face: [-0.534, -0.845, -0.045], flare: [0.004, 0.006], flareHeight: 0.02,
    inner: 'shade', band: 0.014, frontRows: 16,
  },
  cow: {
    outline: [[-0.042, -0.03], [-0.052, 0.04], [-0.044, 0.1], [-0.021, 0.145], [0, 0.155], [0.021, 0.145], [0.044, 0.1], [0.052, 0.04], [0.042, -0.03], [0, -0.045]],
    center: [0, 0.055], cup: 0.022, flat: 0.45, thick: 0.011, rim: 0.0055, bend: 0.15,
    at: [0.185, 0.27, -0.03], sink: 0.012, up: [0.96, -0.2, -0.12], face: [0.1, 0.3, 1],
    inner: INNER_PINK, band: 0.014,
  },
  horse: {
    outline: [[-0.042, -0.045], [-0.044, 0.04], [-0.034, 0.1], [-0.013, 0.15], [0, 0.158], [0.013, 0.15], [0.034, 0.1], [0.044, 0.04], [0.042, -0.045], [0, -0.06]],
    center: [0, 0.05], cup: 0.024, flat: 0.5, thick: 0.011, rim: 0.0055, bend: 0.12,
    at: [0.1, 0.395, -0.045], sink: 0.012, up: [0.24, 0.96, -0.1], face: [0.4, 0.0, 1],
    inner: '#3a2a22', band: 0.013,
  },
  monkey: { // round and cupped, standing out from the side of the head where a human ear is, the face's color inside
    outline: [[-0.05, -0.03], [-0.06, 0.025], [-0.052, 0.068], [-0.022, 0.093], [0.012, 0.096], [0.046, 0.078], [0.06, 0.035], [0.052, -0.03], [0, -0.045]],
    center: [0, 0.035], cup: 0.024, flat: 0.35, thick: 0.012, rim: 0.0065, bend: -0.12,
    at: [0.196, 0.16, -0.035], sink: 0.012, up: [0.95, 0.22, -0.2], face: [0.35, 0.05, 1],
    inner: 'second', band: 0.015, fade: [0.0, 0.02],
  },
  elf: {
    outline: [[-0.03, -0.04], [-0.04, 0.02], [-0.03, 0.07], [-0.008, 0.12], [0, 0.13], [0.012, 0.115], [0.034, 0.06], [0.038, 0.0], [0.026, -0.045], [0, -0.055]],
    center: [0, 0.03], cup: 0.012, flat: 0.5, thick: 0.008, rim: 0.0045, bend: 0.25,
    at: [0.198, 0.13, -0.045], sink: 0.008, up: [0.62, 0.62, -0.48], face: [0.62, 0.0, 0.78],
    inner: 'skin', band: 0.011, fade: [-0.02, 0.0],
  },
};

/**
 * Build the ear meshes for a style. Returns [{ bone, object }] to attach (both sides);
 * `colors` = { fur, skin, second? } (second: the fur's second color, inside a monkey's ear); `head` = the head's vertices in Head space (see earlessGeometry), to
 * seat each ear on the head's curve.
 */
export function buildEars(style, colors, head = null) {
  const shape = SHAPES[style];
  if (!shape) return [];
  const fur = style === 'elf' ? colors.skin : colors.fur;
  let inner = shape.inner;
  if (inner === 'shade') inner = new THREE.Color(fur).multiplyScalar(0.82);
  else if (inner === 'skin') inner = new THREE.Color(colors.skin).multiply(new THREE.Color(0.93, 0.8, 0.8));
  else if (inner === 'second') inner = new THREE.Color(colors.second ?? new THREE.Color(fur).lerp(new THREE.Color(0xffffff), 0.45));
  const left = sculptEar(shape, head);
  const out = [];
  for (const geo of [left, mirrored(left)]) {
    const mesh = new THREE.Mesh(geo, earMaterial(fur, inner, shape));
    mesh.castShadow = true;
    out.push({ bone: 'Head', object: mesh });
  }
  return out;
}
