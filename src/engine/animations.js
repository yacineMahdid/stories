import * as THREE from 'three';
import { MOVES, MOVE_GROUPS } from './moves.js';

// Procedural animation library for the canonical rig (see rig.js for the axis conventions).
// Each entry is a pose function of the cycle phase (0..1); clips are baked from it at 30 fps.

const FPS = 30;
const TAU = Math.PI * 2;
const ARM_DOWN = 0.85; // lowers the rest-pose arms (about 30° below horizontal) to a relaxed hang

// Every clip writes all of these, so cross-fades never leave a bone stuck in an old pose.
const ROT_BONES = [
  'Hips', 'Spine', 'Spine1', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
const POS_BONES = ['Root', 'Hips'];

const bump = (x, a, b) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));

function relaxed(extra = {}) {
  return {
    LeftArm: [0, 0, -ARM_DOWN], RightArm: [0, 0, ARM_DOWN],
    LeftForeArm: [0, -0.15, 0], RightForeArm: [0, 0.15, 0],
    ...extra,
  };
}

export const LIBRARY = {
  Idle: {
    duration: 3.2,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      const sway = Math.sin(ph * TAU + 1.3);
      return {
        rot: relaxed({
          Spine1: [0.015 * b, 0, 0.01 * sway],
          Head: [-0.02 * b, 0.05 * sway, 0.025 * sway],
          LeftArm: [0.03 * b, 0, -ARM_DOWN - 0.02 * b],
          RightArm: [0.03 * b, 0, ARM_DOWN + 0.02 * b],
        }),
        pos: { Hips: [0, 0.002 * b, 0] },
      };
    },
  },

  Walk: {
    duration: 0.8,
    pose(ph) {
      const p = ph * TAU, s = Math.sin(p), c = Math.cos(p);
      const lLeg = -0.55 * s, rLeg = 0.55 * s;
      const lKnee = 0.9 * Math.max(0, c) ** 1.5 + 0.08;
      const rKnee = 0.9 * Math.max(0, -c) ** 1.5 + 0.08;
      return {
        rot: relaxed({
          Hips: [0.04, 0.1 * s, 0.04 * s],
          Spine: [0.02, -0.05 * s, -0.02 * s],
          Spine1: [0.02, -0.07 * s, -0.02 * s],
          Head: [-0.03 * Math.cos(2 * p), 0.04 * s, 0],
          LeftUpLeg: [lLeg, 0, 0], RightUpLeg: [rLeg, 0, 0],
          LeftLeg: [lKnee, 0, 0], RightLeg: [rKnee, 0, 0],
          LeftFoot: [-0.7 * (lLeg + lKnee), 0, 0], RightFoot: [-0.7 * (rLeg + rKnee), 0, 0],
          LeftArm: [0.5 * s, 0, -ARM_DOWN], RightArm: [-0.5 * s, 0, ARM_DOWN],
          LeftForeArm: [0, -0.25, 0], RightForeArm: [0, 0.25, 0],
        }),
        pos: { Hips: [0, 0.012 * Math.cos(2 * p) - 0.004, 0] },
      };
    },
  },

  Run: {
    duration: 0.5,
    pose(ph) {
      const p = ph * TAU, s = Math.sin(p), c = Math.cos(p);
      const lLeg = -0.95 * s, rLeg = 0.95 * s;
      const lKnee = 1.5 * Math.max(0, c) ** 1.2 + 0.25;
      const rKnee = 1.5 * Math.max(0, -c) ** 1.2 + 0.25;
      return {
        rot: relaxed({
          Hips: [0.12, 0.14 * s, 0],
          Spine: [0.1, -0.08 * s, 0],
          Spine1: [0.08, -0.1 * s, 0],
          Head: [-0.12, 0.05 * s, 0],
          LeftUpLeg: [lLeg, 0, 0], RightUpLeg: [rLeg, 0, 0],
          LeftLeg: [lKnee, 0, 0], RightLeg: [rKnee, 0, 0],
          LeftFoot: [-0.6 * (lLeg + lKnee) + 0.3, 0, 0], RightFoot: [-0.6 * (rLeg + rKnee) + 0.3, 0, 0],
          LeftArm: [0.9 * s, 0, -ARM_DOWN * 0.85], RightArm: [-0.9 * s, 0, ARM_DOWN * 0.85],
          LeftForeArm: [0, -1.2, 0], RightForeArm: [0, 1.2, 0],
        }),
        pos: { Hips: [0, 0.025 * Math.cos(2 * p) - 0.02, 0] },
      };
    },
  },

  Wave: {
    duration: 1.2,
    pose(ph) {
      const p = ph * TAU;
      return {
        rot: relaxed({
          Spine1: [0, 0.05, -0.04],
          Head: [0, -0.08, 0.06],
          RightShoulder: [0, 0, -0.1],
          RightArm: [-0.15, 0, -0.6],
          RightForeArm: [0, 0.15, -0.95 + 0.38 * Math.sin(2 * p)],
        }),
        pos: {},
      };
    },
  },

  Nod: {
    duration: 1.2,
    pose(ph) {
      const n = Math.sin(ph * TAU) ** 2;
      return { rot: relaxed({ Neck: [0.06 * n, 0, 0], Head: [0.22 * n, 0, 0] }), pos: {} };
    },
  },

  Shake: {
    duration: 1.2,
    pose(ph) {
      const t = Math.sin(2 * ph * TAU) * Math.sin(ph * Math.PI);
      return { rot: relaxed({ Neck: [0, 0.08 * t, 0], Head: [0.03, 0.32 * t, 0] }), pos: {} };
    },
  },

  Talk: {
    duration: 2.4,
    pose(ph) {
      const p = ph * TAU;
      return {
        rot: relaxed({
          Spine1: [0.01 * Math.sin(2 * p), 0.04 * Math.sin(p), 0],
          Head: [0.04 * Math.sin(6 * p) + 0.02 * Math.sin(10 * p), 0.06 * Math.sin(p), 0.04 * Math.sin(2 * p)],
          RightArm: [-0.25 - 0.15 * Math.sin(2 * p), 0, ARM_DOWN - 0.15],
          RightForeArm: [0, 0.55 + 0.25 * Math.sin(4 * p), 0],
        }),
        pos: {},
      };
    },
  },

  Jump: {
    duration: 1.0,
    pose(ph) {
      const crouch = bump(ph, 0.0, 0.32) * 0.8 + bump(ph, 0.72, 1.0) * 0.65;
      const air = bump(ph, 0.3, 0.76);
      return {
        rot: relaxed({
          Spine: [0.18 * crouch, 0, 0],
          Head: [-0.1 * air, 0, 0],
          LeftUpLeg: [-0.6 * crouch - 0.3 * air, 0, 0], RightUpLeg: [-0.6 * crouch - 0.3 * air, 0, 0],
          LeftLeg: [1.1 * crouch + 0.5 * air, 0, 0], RightLeg: [1.1 * crouch + 0.5 * air, 0, 0],
          LeftFoot: [-0.5 * crouch + 0.3 * air, 0, 0], RightFoot: [-0.5 * crouch + 0.3 * air, 0, 0],
          LeftArm: [0.3 * crouch, 0, -ARM_DOWN + 1.7 * air], RightArm: [0.3 * crouch, 0, ARM_DOWN - 1.7 * air],
        }),
        pos: { Hips: [0, -0.055 * crouch, 0.01 * crouch], Root: [0, 0.16 * air, 0] },
      };
    },
  },

  Sit: {
    duration: 3.0,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return {
        rot: relaxed({
          Spine1: [0.02 * b, 0, 0],
          Head: [-0.02 * b, 0, 0],
          LeftUpLeg: [-1.5, 0, 0], RightUpLeg: [-1.5, 0, 0],
          LeftLeg: [1.5, 0, 0], RightLeg: [1.5, 0, 0],
          LeftArm: [-0.55, 0, -ARM_DOWN - 0.1], RightArm: [-0.55, 0, ARM_DOWN + 0.1],
          LeftForeArm: [0, -0.7, 0], RightForeArm: [0, 0.7, 0],
        }),
        pos: { Hips: [0, -0.095 + 0.002 * b, -0.01] },
      };
    },
  },

  Cheer: {
    duration: 0.9,
    pose(ph) {
      const p = ph * TAU;
      const hop = Math.max(0, Math.sin(p));
      return {
        rot: relaxed({
          Spine: [-0.05, 0, 0],
          Head: [-0.12, 0, 0.06 * Math.sin(p)],
          LeftArm: [-0.2, 0, 1.25 + 0.2 * Math.sin(2 * p)], RightArm: [-0.2, 0, -1.25 - 0.2 * Math.sin(2 * p)],
          LeftForeArm: [0, -0.2, 0.3], RightForeArm: [0, 0.2, -0.3],
          LeftUpLeg: [-0.15 * (1 - hop), 0, 0], RightUpLeg: [-0.15 * (1 - hop), 0, 0],
          LeftLeg: [0.3 * (1 - hop), 0, 0], RightLeg: [0.3 * (1 - hop), 0, 0],
        }),
        pos: { Root: [0, 0.05 * hop, 0], Hips: [0, -0.012 * (1 - hop), 0] },
      };
    },
  },
};

Object.assign(LIBRARY, MOVES);

/** Animation names grouped for pickers. */
export const ANIMATION_GROUPS = {
  Basics: ['Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Nod', 'Shake', 'Talk', 'Sit', 'Cheer'],
  ...MOVE_GROUPS,
};

/** Bake every pose function in the library into AnimationClips for a skeleton at rest. */
export function buildClips(restRoot) {
  const rest = {};
  for (const name of POS_BONES) {
    const bone = restRoot.getObjectByName(name);
    rest[name] = bone ? bone.position.clone() : new THREE.Vector3();
  }
  return Object.entries(LIBRARY).map(([name, def]) => {
    const clip = bake(name, def, rest);
    clip.userData = { once: !!def.once };
    return clip;
  });
}

function bake(name, { duration, pose }, rest) {
  const frames = Math.max(2, Math.round(duration * FPS));
  const times = new Float32Array(frames + 1);
  const rot = Object.fromEntries(ROT_BONES.map((b) => [b, new Float32Array((frames + 1) * 4)]));
  const pos = Object.fromEntries(POS_BONES.map((b) => [b, new Float32Array((frames + 1) * 3)]));
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();

  for (let i = 0; i <= frames; i++) {
    const ph = i / frames;
    times[i] = ph * duration;
    const out = pose(ph);
    for (const b of ROT_BONES) {
      const r = out.rot[b] || [0, 0, 0];
      quat.setFromEuler(euler.set(r[0], r[1], r[2]));
      rot[b].set([quat.x, quat.y, quat.z, quat.w], i * 4);
    }
    for (const b of POS_BONES) {
      const o = out.pos[b] || [0, 0, 0];
      pos[b].set([rest[b].x + o[0], rest[b].y + o[1], rest[b].z + o[2]], i * 3);
    }
  }

  const tracks = [
    ...ROT_BONES.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, rot[b])),
    ...POS_BONES.map((b) => new THREE.VectorKeyframeTrack(`${b}.position`, times, pos[b])),
  ];
  return new THREE.AnimationClip(name, duration, tracks);
}
