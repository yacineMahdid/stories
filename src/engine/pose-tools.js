import * as THREE from 'three';

// Helpers for writing poses on the canonical rig (see rig.js for its conventions).
// Arms and legs are aimed with direction vectors in the parent's space: +x = the character's
// left, +y up, +z forward. A pose is { rot: { Bone: [x, y, z] }, pos: { Root|Hips: [dx, dy, dz] } }.

export const TAU = Math.PI * 2;
export const ARM_DOWN = 0.85; // lowers the rest-pose arms (about 30° below horizontal) to a relaxed hang

export const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const flip = (v) => new THREE.Vector3(-v.x, v.y, v.z);

// Rest directions of each limb segment (from the joint positions in tools/build_base.py).
const REST = {
  LeftArm: V(0.878, -0.478, 0), RightArm: V(-0.878, -0.478, 0),
  LeftUpLeg: V(0, -0.996, -0.084), RightUpLeg: V(0, -0.996, -0.084),
  LeftLeg: V(0, -0.99, -0.14), RightLeg: V(0, -0.99, -0.14),
};

const _e = new THREE.Euler();
const toEuler = (q) => { _e.setFromQuaternion(q, 'XYZ'); return [_e.x, _e.y, _e.z]; };
const aimQ = (from, to) => new THREE.Quaternion().setFromUnitVectors(from, to.clone().normalize());

/** One arm: upper arm along `upper`, forearm along `lower`. */
export function arm(side, upper, lower = upper) {
  const qU = aimQ(REST[`${side}Arm`], upper);
  const qL = aimQ(REST[`${side}Arm`], lower);
  return { [`${side}Arm`]: toEuler(qU), [`${side}ForeArm`]: toEuler(qU.clone().invert().multiply(qL)) };
}

/** Both arms, the right one mirrored from the left unless given. */
export function arms(upperL, lowerL = upperL, upperR = flip(upperL), lowerR = flip(lowerL)) {
  return { ...arm('Left', upperL, lowerL), ...arm('Right', upperR, lowerR) };
}

/** One leg: thigh along `thigh`, shin along `shin`; the foot ends at world pitch `foot` (0 = flat). */
export function leg(side, thigh, shin = thigh, foot = 0) {
  const qT = aimQ(REST[`${side}UpLeg`], thigh);
  const qShinWorld = aimQ(REST[`${side}Leg`], shin);
  const qFoot = qShinWorld.clone().invert().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(foot, 0, 0)));
  return {
    [`${side}UpLeg`]: toEuler(qT),
    [`${side}Leg`]: toEuler(qT.clone().invert().multiply(qShinWorld)),
    [`${side}Foot`]: toEuler(qFoot),
  };
}

/** Both legs, mirrored. */
export function legs(thigh, shin = thigh, foot = 0) {
  return { ...leg('Left', thigh, shin, foot), ...leg('Right', flip(thigh), flip(shin), foot) };
}

export function relaxed(extra = {}) {
  return {
    LeftArm: [0, 0, -ARM_DOWN], RightArm: [0, 0, ARM_DOWN],
    LeftForeArm: [0, -0.15, 0], RightForeArm: [0, 0.15, 0],
    ...extra,
  };
}

export const bump = (x, a, b) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * A pose function that moves through key poses: keys = [[phase, pose], ...] with phases from 0
 * to 1. Rotations are slerped, positions lerped, both eased.
 */
export function keyed(keys) {
  const prepared = keys.map(([t, pose]) => ({
    t,
    rot: Object.fromEntries(Object.entries(pose.rot ?? {}).map(([b, e]) => [b, new THREE.Quaternion().setFromEuler(new THREE.Euler(...e))])),
    pos: pose.pos ?? {},
  }));
  const rotBones = [...new Set(prepared.flatMap((k) => Object.keys(k.rot)))];
  const posBones = [...new Set(prepared.flatMap((k) => Object.keys(k.pos)))];
  const id = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  return (ph) => {
    let i = 0;
    while (i < prepared.length - 2 && ph > prepared[i + 1].t) i++;
    const a = prepared[i], b = prepared[i + 1];
    const u = smoother(clamp01((ph - a.t) / Math.max(1e-6, b.t - a.t)));
    const rot = {}, pos = {};
    for (const bone of rotBones) rot[bone] = toEuler(q.slerpQuaternions(a.rot[bone] ?? id, b.rot[bone] ?? id, u));
    for (const bone of posBones) {
      const pa = a.pos[bone] ?? [0, 0, 0], pb = b.pos[bone] ?? [0, 0, 0];
      pos[bone] = pa.map((v, k) => v + (pb[k] - v) * u);
    }
    return { rot, pos };
  };
}
