import { V, arm, arms, leg, legs, relaxed, keyed, bump, TAU, ARM_DOWN } from './pose-tools.js';

// The movement library: locomotion, sitting and lying, falls and getting hurt, gestures and
// actions. Each entry: { duration, pose(phase) } and `once: true` for moves that play a single
// time and hold their last pose (a fall stays on the ground until another move starts).

const stand = (extra = {}) => ({ rot: relaxed(extra), pos: {} });

/** A walk-cycle generator the locomotion variants are built from. */
function gait(ph, o = {}) {
  const p = ph * TAU, s = Math.sin(p), c = Math.cos(p);
  const stride = o.stride ?? 0.55, knee = o.knee ?? 0.9, base = o.kneeBase ?? 0.08;
  const lLeg = -stride * s, rLeg = stride * s;
  const lKnee = knee * Math.max(0, c) ** 1.5 + base, rKnee = knee * Math.max(0, -c) ** 1.5 + base;
  const crouch = o.crouch ?? 0;
  const down = o.armDown ?? ARM_DOWN, swing = o.armSwing ?? 0.5, bend = o.armBend ?? 0.25;
  return {
    rot: relaxed({
      Hips: [0.04 + (o.hipsLean ?? 0), (o.twist ?? 0.1) * s, (o.roll ?? 0.04) * s],
      Spine: [0.02 + (o.lean ?? 0), -0.05 * s, -(o.roll ?? 0.04) * 0.5 * s],
      Spine1: [0.02 + (o.chest ?? 0), -0.07 * s, 0],
      Head: [-0.03 * Math.cos(2 * p) - (o.lean ?? 0) * 0.6 + (o.headDown ?? 0), 0.04 * s, 0],
      LeftUpLeg: [lLeg - crouch, 0, 0], RightUpLeg: [rLeg - crouch, 0, 0],
      LeftLeg: [lKnee + crouch * 1.6, 0, 0], RightLeg: [rKnee + crouch * 1.6, 0, 0],
      LeftFoot: [-0.7 * (lLeg + lKnee) - crouch * 0.6 + (o.toes ?? 0), 0, 0],
      RightFoot: [-0.7 * (rLeg + rKnee) - crouch * 0.6 + (o.toes ?? 0), 0, 0],
      LeftArm: [swing * s, 0, -down], RightArm: [-swing * s, 0, down],
      LeftForeArm: [0, -bend, 0], RightForeArm: [0, bend, 0],
    }),
    pos: { Hips: [0, (o.bob ?? 0.012) * Math.cos(2 * p) - 0.004 - crouch * 0.09 + (o.lift ?? 0), 0] },
  };
}

// Shared poses -------------------------------------------------------------------------------

const LIE_BACK = { // flat on the back, arms out
  rot: relaxed({
    Hips: [-1.5, 0, 0], Neck: [0.12, 0, 0], Head: [0.42, 0, 0],
    ...legs(V(0, -0.95, -0.28), V(0, -0.97, -0.2), -0.9),
    ...arms(V(0.9, -0.2, -0.38), V(0.92, -0.05, -0.35)),
  }),
  pos: { Hips: [0, -0.09, 0] },
};
const LIE_FRONT = { // face down, arms out, feet kicked up
  rot: relaxed({
    Hips: [1.5, 0, 0], Neck: [-0.2, 0, 0], Head: [-0.45, 0, 0],
    ...legs(V(0, -0.9, 0.35), V(0, -0.35, -0.94), 1.2),
    ...arms(V(0.9, 0.3, 0.3), V(0.8, 0.55, 0.25)),
  }),
  pos: { Hips: [0, -0.1, 0] },
};
const SIT_FLOOR = {
  rot: relaxed({
    Spine: [-0.1, 0, 0], Spine1: [0.06, 0, 0], Head: [0.05, 0, 0],
    ...legs(V(0.12, -0.05, 1), V(0.1, -0.1, 1), -1.0),
    ...arms(V(0.35, -0.82, -0.45), V(0.3, -0.87, -0.4)),
  }),
  pos: { Hips: [0, -0.185, -0.02] },
};
const SQUAT = {
  rot: relaxed({
    Spine: [0.3, 0, 0], Spine1: [0.05, 0, 0], Head: [-0.25, 0, 0],
    ...legs(V(0.25, -0.4, 0.88), V(0.06, -0.94, -0.3)),
    ...arms(V(0.15, -0.55, 0.82), V(0.05, -0.75, 0.66)),
  }),
  pos: { Hips: [0, -0.085, -0.03] },
};
const HOLD_BELLY = arms(V(0.35, -0.6, 0.7), V(-0.82, -0.15, 0.55));
const CARRY = arms(V(0.45, -0.55, 0.72), V(-0.45, 0.05, 0.9));

export const MOVES = {
  // --- getting around -------------------------------------------------------------------------
  Sneak: {
    duration: 1.5,
    pose(ph) {
      const g = gait(ph, { stride: 0.45, knee: 0.8, kneeBase: 0.15, crouch: 0.35, lean: 0.28, bob: 0.008, twist: 0.04 });
      const s = Math.sin(ph * TAU);
      Object.assign(g.rot, arms(V(0.45, -0.3 + 0.05 * s, 0.84), V(0.2, 0.6, 0.78), V(-0.45, -0.3 - 0.05 * s, 0.84), V(-0.2, 0.6, 0.78)));
      return g;
    },
  },
  Tiptoe: {
    duration: 1.0,
    pose: (ph) => gait(ph, { stride: 0.28, knee: 0.5, kneeBase: 0.05, toes: 0.5, lift: 0.018, armDown: 0.35, armBend: 0.7, armSwing: 0.06, bob: 0.008 }),
  },
  Skip: {
    duration: 0.75,
    pose(ph) {
      const p = ph * TAU, s = Math.sin(p);
      const lUp = Math.max(0, s), rUp = Math.max(0, -s);
      return {
        rot: relaxed({
          Spine: [-0.05, 0.05 * s, 0], Head: [-0.08, 0, 0.05 * s],
          LeftUpLeg: [-1.1 * lUp + 0.25 * rUp, 0, 0], RightUpLeg: [-1.1 * rUp + 0.25 * lUp, 0, 0],
          LeftLeg: [1.4 * lUp + 0.05, 0, 0], RightLeg: [1.4 * rUp + 0.05, 0, 0],
          LeftFoot: [0.35 * lUp + 0.25 * rUp, 0, 0], RightFoot: [0.35 * rUp + 0.25 * lUp, 0, 0],
          LeftArm: [-0.9 * rUp + 0.6 * lUp, 0, -ARM_DOWN + 0.35], RightArm: [-0.9 * lUp + 0.6 * rUp, 0, ARM_DOWN - 0.35],
          LeftForeArm: [0, -0.5, 0], RightForeArm: [0, 0.5, 0],
        }),
        pos: { Root: [0, 0.06 * Math.abs(s), 0] },
      };
    },
  },
  March: {
    duration: 0.9,
    pose: (ph) => gait(ph, { stride: 0.7, knee: 1.3, armSwing: 0.95, armBend: 0.02, chest: -0.06, bob: 0.016, headDown: -0.05 }),
  },
  Jog: {
    duration: 0.62,
    pose: (ph) => gait(ph, { stride: 0.72, knee: 1.15, kneeBase: 0.15, armSwing: 0.6, armBend: 1.05, armDown: 0.75, bob: 0.02, lean: 0.06 }),
  },
  Sprint: {
    duration: 0.38,
    pose: (ph) => gait(ph, { stride: 1.1, knee: 1.8, kneeBase: 0.3, armSwing: 1.1, armBend: 1.35, armDown: 0.65, bob: 0.03, lean: 0.32, twist: 0.16 }),
  },
  Limp: {
    duration: 1.3,
    pose(ph) {
      const g = gait(ph, { stride: 0.38, knee: 0.7, roll: 0.1, headDown: 0.12, armSwing: 0.2 });
      const s = Math.sin(ph * TAU);
      g.rot.RightLeg = [0.06, 0, 0];                       // the hurt leg stays stiff
      g.pos.Hips[1] -= 0.02 * Math.max(0, -s);             // and the body dips onto it
      Object.assign(g.rot, arm('Right', V(-0.35, -0.75, 0.55), V(0.25, -0.85, 0.45))); // hand on the thigh
      return g;
    },
  },
  Waddle: {
    duration: 0.7,
    pose(ph) {
      const g = gait(ph, { stride: 0.25, knee: 0.18, kneeBase: 0, roll: 0.17, twist: 0.04, armDown: 0.4, armSwing: 0.04, armBend: 0.0, bob: 0.01 });
      g.rot.Spine[2] = -0.12 * Math.sin(ph * TAU);
      return g;
    },
  },
  Strut: {
    duration: 0.95,
    pose: (ph) => gait(ph, { stride: 0.5, knee: 0.8, armSwing: 0.75, twist: 0.22, roll: 0.08, chest: -0.08, headDown: -0.1 }),
  },
  Carry: {
    duration: 0.85,
    pose(ph) {
      const g = gait(ph, { stride: 0.45, knee: 0.75, chest: -0.05 });
      Object.assign(g.rot, CARRY);
      return g;
    },
  },

  // --- sitting and lying --------------------------------------------------------------------
  SitFloor: {
    duration: 3.2,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return { rot: { ...SIT_FLOOR.rot, Spine1: [0.06 + 0.015 * b, 0, 0], Head: [0.05 - 0.02 * b, 0.06 * Math.sin(ph * TAU + 1), 0] }, pos: SIT_FLOOR.pos };
    },
  },
  SitCrossed: {
    duration: 3.2,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return {
        rot: relaxed({
          Spine: [0.08, 0, 0], Spine1: [0.02 + 0.015 * b, 0, 0], Head: [0.02 - 0.02 * b, 0, 0.04 * Math.sin(ph * TAU + 2)],
          ...leg('Left', V(0.82, -0.22, 0.52), V(-0.6, -0.22, 0.77), -0.4),
          ...leg('Right', V(-0.82, -0.22, 0.52), V(0.6, -0.22, 0.77), -0.4),
          ...arms(V(0.35, -0.8, 0.45), V(0.25, -0.6, 0.76)),
        }),
        pos: { Hips: [0, -0.2, -0.02] },
      };
    },
  },
  Kneel: {
    duration: 3.0,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return {
        rot: relaxed({
          Spine: [0.05, 0, 0], Spine1: [0.015 * b, 0, 0], Head: [0.08 - 0.02 * b, 0, 0],
          ...legs(V(0, -1, 0.1), V(0, -0.12, -1), 2.9),
          ...arms(V(0.25, -0.85, 0.45), V(0.1, -0.55, 0.83)),
        }),
        pos: { Hips: [0, -0.115, -0.01] },
      };
    },
  },
  Squat: {
    duration: 3.0,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return { rot: { ...SQUAT.rot, Head: [-0.25 + 0.03 * b, 0.1 * Math.sin(ph * TAU + 1), 0] }, pos: SQUAT.pos };
    },
  },
  LieDown: {
    duration: 4.0,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return { rot: { ...LIE_BACK.rot, Spine1: [0.02 * b, 0, 0] }, pos: LIE_BACK.pos };
    },
  },
  Sleep: {
    duration: 4.0,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return {
        rot: {
          ...LIE_BACK.rot, Spine1: [0.025 * b, 0, 0], Head: [0.42, 0.35, 0],
          ...arms(V(0.45, -0.75, 0.45), V(-0.75, -0.25, 0.6)),
        },
        pos: LIE_BACK.pos,
      };
    },
  },

  // --- falls and getting hurt ---------------------------------------------------------------
  Trip: {
    duration: 1.2, once: true,
    pose: keyed([
      [0, stand()],
      [0.18, { rot: relaxed({ Spine: [0.35, 0, 0], Head: [-0.2, 0, 0], ...arms(V(0.6, 0.5, 0.5), V(0.4, 0.8, 0.4)), ...leg('Left', V(0, -0.85, -0.5)), ...leg('Right', V(0, -0.85, 0.45), V(0, -1, 0)) }), pos: { Hips: [0, -0.02, 0.02] } }],
      [0.45, { rot: relaxed({ Spine: [0.45, 0, 0.1], Head: [-0.3, 0, 0], ...arm('Left', V(0.3, 0.9, -0.3), V(0.1, 1, -0.2)), ...arm('Right', V(-0.5, -0.2, 0.85)), ...leg('Right', V(0, -0.65, 0.75), V(0, -1, 0.25)), ...leg('Left', V(0, -0.85, -0.5), V(0, -0.6, -0.8)) }), pos: { Hips: [0, -0.05, 0.05] } }],
      [0.75, { rot: relaxed({ Spine: [0.12, 0, 0], ...arms(V(0.92, 0.05, 0.3)), ...legs(V(0, -0.98, 0.18), V(0, -1, -0.1)) }), pos: { Hips: [0, -0.015, 0] } }],
      [1, stand()],
    ]),
  },
  FallBack: {
    duration: 1.4, once: true,
    pose: keyed([
      [0, stand()],
      [0.14, { rot: relaxed({ Spine: [-0.15, 0, 0], Head: [-0.2, 0, 0], ...arms(V(0.6, 0.7, 0.3), V(0.3, 0.9, 0.2)), ...legs(V(0, -0.9, 0.35), V(0, -0.95, -0.25)) }), pos: { Hips: [0, -0.03, 0] } }],
      [0.42, { rot: relaxed({ Hips: [-0.85, 0, 0], Spine: [-0.2, 0, 0], Head: [0.35, 0, 0], ...legs(V(0, -0.7, 0.6), V(0, -0.9, 0.3)), ...arms(V(0.5, 0.4, 0.75), V(0.4, 0.7, 0.6)) }), pos: { Hips: [0, -0.12, -0.05] } }],
      [0.64, { rot: { ...LIE_BACK.rot, ...legs(V(0, -0.6, -0.8), V(0, -0.7, -0.7), -0.6) }, pos: { Hips: [0, -0.07, 0] } }],
      [0.82, LIE_BACK],
      [1, LIE_BACK],
    ]),
  },
  Faceplant: {
    duration: 1.3, once: true,
    pose: keyed([
      [0, stand()],
      [0.2, { rot: relaxed({ Spine: [0.4, 0, 0], Head: [-0.25, 0, 0], ...arms(V(0.35, 0.1, 0.93), V(0.3, 0.3, 0.9)), ...leg('Left', V(0, -0.8, -0.6)), ...leg('Right', V(0, -0.85, 0.4)) }), pos: { Hips: [0, -0.03, 0.03] } }],
      [0.46, { rot: relaxed({ Hips: [0.9, 0, 0], Spine: [0.2, 0, 0], Head: [-0.35, 0, 0], ...arms(V(0.35, 0.3, 0.88), V(0.3, 0.5, 0.8)), ...legs(V(0, -0.95, -0.3)) }), pos: { Hips: [0, -0.1, 0.08] } }],
      [0.7, { rot: { ...LIE_FRONT.rot, ...legs(V(0, -0.8, 0.55), V(0, 0.2, -0.98), 1.3) }, pos: LIE_FRONT.pos }],
      [0.86, LIE_FRONT],
      [1, LIE_FRONT],
    ]),
  },
  Knockback: {
    duration: 1.3, once: true,
    pose: keyed([
      [0, stand()],
      [0.08, { rot: relaxed({ Head: [-0.45, 0, 0], Spine1: [-0.3, 0, 0], ...arms(V(0.4, 0.2, 0.9)) }), pos: {} }],
      [0.36, { rot: relaxed({ Hips: [-0.9, 0, 0], Head: [0.3, 0, 0], ...legs(V(0, -0.5, 0.85), V(0, -0.7, 0.7)), ...arms(V(0.45, 0.35, 0.82)) }), pos: { Root: [0, 0.14, -0.3], Hips: [0, -0.05, 0] } }],
      [0.62, { rot: LIE_BACK.rot, pos: { Root: [0, 0, -0.5], Hips: LIE_BACK.pos.Hips } }],
      [0.78, { rot: { ...LIE_BACK.rot, ...legs(V(0, -0.7, -0.7), V(0, -0.8, -0.6), -0.6) }, pos: { Root: [0, 0.02, -0.55], Hips: LIE_BACK.pos.Hips } }],
      [1, { rot: LIE_BACK.rot, pos: { Root: [0, 0, -0.56], Hips: LIE_BACK.pos.Hips } }],
    ]),
  },
  Hurt: {
    duration: 0.85, once: true,
    pose: keyed([
      [0, stand()],
      [0.13, { rot: relaxed({ Head: [-0.3, 0, 0.12], Spine1: [-0.25, 0, 0], ...arms(V(0.4, 0.3, 0.86), V(-0.3, 0.8, 0.5)) }), pos: {} }],
      [0.42, { rot: relaxed({ Spine: [0.35, 0, 0], Head: [0.2, 0, 0], ...HOLD_BELLY, ...legs(V(0, -0.95, 0.3), V(0, -0.95, -0.2)) }), pos: { Hips: [0, -0.025, 0] } }],
      [1, stand()],
    ]),
  },
  Pain: {
    duration: 1.6,
    pose(ph) {
      const p = ph * TAU, t = Math.sin(p * 6) * 0.015;
      return {
        rot: relaxed({
          Spine: [0.38 + t, 0, 0.03 * Math.sin(p)], Spine1: [0.12, 0, 0], Head: [0.15 + t, 0.05 * Math.sin(p), 0],
          ...HOLD_BELLY, ...legs(V(0, -0.95, 0.3), V(0, -0.95, -0.2)),
        }),
        pos: { Hips: [0, -0.03, 0] },
      };
    },
  },
  Faint: {
    duration: 1.9, once: true,
    pose: keyed([
      [0, stand()],
      [0.22, { rot: relaxed({ Head: [0.1, 0, 0.3], Spine: [0, 0, 0.1], Spine1: [0, 0, 0.08] }), pos: {} }],
      [0.45, { rot: relaxed({ Head: [0.25, 0, 0.2], Spine: [0.25, 0, 0.12], ...legs(V(0, -0.8, 0.6), V(0, -0.9, -0.4)) }), pos: { Hips: [0, -0.08, 0] } }],
      [0.78, { rot: relaxed({ Hips: [0.1, 0, 1.45], Head: [0.2, 0, -0.3], ...legs(V(0, -0.85, 0.5), V(0, -0.8, -0.55)), ...arms(V(0.3, -0.8, 0.5)) }), pos: { Hips: [-0.06, -0.13, 0] } }],
      [1, { rot: relaxed({ Hips: [0.1, 0, 1.5], Head: [0.2, 0, -0.35], ...legs(V(0, -0.8, 0.6), V(0, -0.75, -0.65)), ...arms(V(0.3, -0.8, 0.5)) }), pos: { Hips: [-0.06, -0.14, 0] } }],
    ]),
  },
  GetUp: {
    duration: 1.7, once: true,
    pose: keyed([
      [0, LIE_BACK],
      [0.3, SIT_FLOOR],
      [0.55, { rot: relaxed({ Spine: [0.35, 0, 0], ...leg('Left', V(0, -0.1, 1), V(0, -1, 0.05)), ...leg('Right', V(0, -1, 0.1), V(0, -0.12, -1), 2.9), ...arm('Left', V(0.3, -0.7, 0.65), V(0.2, -0.8, 0.55)) }), pos: { Hips: [0, -0.12, 0] } }],
      [0.8, { rot: relaxed({ Spine: [0.15, 0, 0], ...legs(V(0, -0.95, 0.25), V(0, -0.97, -0.15)) }), pos: { Hips: [0, -0.02, 0] } }],
      [1, stand()],
    ]),
  },
  Stagger: {
    duration: 1.5,
    pose(ph) {
      const p = ph * TAU, s = Math.sin(p), s2 = Math.sin(2 * p);
      return {
        rot: relaxed({
          Hips: [0.05, 0.1 * s, 0.12 * s], Spine: [0.08, 0, -0.1 * s], Head: [0.1, 0.15 * Math.sin(p + 1), 0.18 * Math.sin(p + 0.5)],
          ...leg('Left', V(0.15 - 0.25 * Math.max(0, s), -0.97, 0.2 * s2), V(0, -1, -0.05)),
          ...leg('Right', V(-0.15 + 0.25 * Math.max(0, -s), -0.97, -0.2 * s2), V(0, -1, -0.05)),
          ...arms(V(0.85, -0.1 + 0.25 * s, 0.35), V(0.8, 0.1 + 0.3 * s, 0.4), V(-0.85, -0.1 - 0.25 * s, 0.35), V(-0.8, 0.1 - 0.3 * s, 0.4)),
        }),
        pos: { Hips: [0.02 * s, -0.01, 0] },
      };
    },
  },

  // --- gestures -----------------------------------------------------------------------------
  Point: {
    duration: 2.0,
    pose(ph) {
      const b = Math.sin(ph * TAU);
      return { rot: relaxed({ Head: [-0.05, -0.12, 0], Spine1: [0, -0.1, 0], ...arm('Right', V(-0.1, 0.28 + 0.02 * b, 1), V(-0.05, 0.33 + 0.02 * b, 1)) }), pos: {} };
    },
  },
  Clap: {
    duration: 0.55,
    pose(ph) {
      const open = 0.5 + 0.5 * Math.cos(ph * TAU);
      return {
        rot: relaxed({ Head: [-0.04 * (1 - open), 0, 0], ...arms(V(0.55, -0.32, 0.78), V(-0.4 + 0.75 * open, 0.12, 0.9)) }),
        pos: {},
      };
    },
  },
  Bow: {
    duration: 2.4,
    pose(ph) {
      const b = bump(ph, 0.1, 0.9);
      return { rot: relaxed({ Hips: [0.15 * b, 0, 0], Spine: [0.45 * b, 0, 0], Spine1: [0.2 * b, 0, 0], Head: [0.2 * b, 0, 0], LeftArm: [-0.2 * b, 0, -ARM_DOWN - 0.1], RightArm: [-0.2 * b, 0, ARM_DOWN + 0.1] }), pos: {} };
    },
  },
  Shrug: {
    duration: 1.8,
    pose(ph) {
      const s = bump(ph, 0.12, 0.88);
      return {
        rot: relaxed({
          LeftShoulder: [0, 0, 0.35 * s], RightShoulder: [0, 0, -0.35 * s], Head: [0, 0, 0.16 * s],
          ...arms(V(0.55, -0.82, 0.18), V(0.85 * s + 0.25, 0.1 * s - 0.6 * (1 - s), 0.45)),
        }),
        pos: {},
      };
    },
  },
  Facepalm: {
    duration: 2.4,
    pose(ph) {
      const p = ph * TAU;
      return { rot: relaxed({ Spine1: [0.1, 0, 0], Head: [0.35, 0.1 * Math.sin(p), 0], ...arm('Right', V(-0.3, -0.25, 0.92), V(0.45, 0.76, 0.48)) }), pos: {} };
    },
  },
  Think: {
    duration: 3.0,
    pose(ph) {
      const p = ph * TAU;
      return {
        rot: relaxed({
          Head: [-0.12, 0.12, 0.12 + 0.03 * Math.sin(p)],
          ...arm('Right', V(-0.3, -0.55, 0.78), V(0.42, 0.74 + 0.04 * Math.sin(p * 2), 0.5)),
          ...arm('Left', V(0.25, -0.72, 0.65), V(-0.9, 0.0, 0.42)),
        }),
        pos: {},
      };
    },
  },
  ArmsCrossed: {
    duration: 3.0,
    pose(ph) {
      const s = Math.sin(ph * TAU);
      return {
        rot: relaxed({
          Hips: [0, 0, 0.03 * s], Spine1: [-0.04, 0, -0.02 * s], Head: [-0.05, 0.08 * Math.sin(ph * TAU + 1), 0.04],
          ...arm('Left', V(0.55, -0.55, 0.62), V(-0.9, 0.12, 0.42)), ...arm('Right', V(-0.55, -0.5, 0.66), V(0.9, 0.05, 0.42)),
        }),
        pos: {},
      };
    },
  },
  HandsOnHips: {
    duration: 3.0,
    pose(ph) {
      const s = Math.sin(ph * TAU);
      return { rot: relaxed({ Spine1: [-0.08, 0, 0], Head: [-0.1, 0.06 * s, 0], ...arms(V(0.8, -0.5, -0.3), V(-0.5, -0.55, 0.22)) }), pos: {} };
    },
  },
  Salute: {
    duration: 2.0,
    pose() {
      return { rot: relaxed({ Spine1: [-0.04, 0, 0], ...arm('Right', V(-0.9, 0.2, 0.38), V(0.6, 0.7, 0.36)), ...legs(V(0, -1, -0.08)) }), pos: {} };
    },
  },
  Beckon: {
    duration: 1.2,
    pose(ph) {
      const c = 0.5 + 0.5 * Math.sin(ph * TAU * 2);
      return { rot: relaxed({ Head: [0, 0, 0.08], ...arm('Right', V(-0.25, -0.35, 0.9), V(-0.05, 0.1 + 0.8 * c, 0.9 - 0.6 * c)) }), pos: {} };
    },
  },
  Cower: {
    duration: 1.0,
    pose(ph) {
      const t = Math.sin(ph * TAU * 8) * 0.02;
      return {
        rot: relaxed({
          Spine: [0.35 + t, 0, 0], Head: [0.3, 0, 0],
          ...legs(V(0, -0.85, 0.5), V(0, -0.9, -0.4)),
          ...arms(V(0.25, 0.72, 0.64), V(-0.6, 0.5, 0.45)),
        }),
        pos: { Hips: [0, -0.06, 0] },
      };
    },
  },
  CryHands: {
    duration: 1.2,
    pose(ph) {
      const p = ph * TAU;
      return { rot: relaxed({ Spine1: [0.08 + 0.04 * Math.sin(p * 3), 0, 0], Head: [0.2 + 0.04 * Math.sin(p * 3), 0, 0], ...arms(V(0.25, -0.05, 0.97), V(-0.25, 0.8, 0.55)) }), pos: {} };
    },
  },

  // --- actions ------------------------------------------------------------------------------
  Punch: {
    duration: 1.0,
    pose(ph) {
      const r = bump(ph, 0.05, 0.45), l = bump(ph, 0.55, 0.95);
      const guardL = [V(0.3, -0.35, 0.88), V(0.05, 0.7, 0.7)], guardR = [V(-0.3, -0.35, 0.88), V(-0.05, 0.7, 0.7)];
      const mixV = (a, b, t) => a.clone().lerp(b, t);
      const hit = V(0.03, 0.12, 1);
      return {
        rot: relaxed({
          Spine1: [0, 0.32 * (l - r), 0], Hips: [0, 0.12 * (l - r), 0], Head: [-0.05, -0.15 * (l - r), 0],
          ...arm('Left', mixV(guardL[0], hit, l), mixV(guardL[1], hit, l)),
          ...arm('Right', mixV(guardR[0], hit.clone().setX(-0.03), r), mixV(guardR[1], hit.clone().setX(-0.03), r)),
          ...leg('Left', V(0.08, -1, 0.25), V(0.05, -1, 0.05)), ...leg('Right', V(-0.08, -1, -0.28), V(-0.05, -1, -0.15)),
        }),
        pos: { Hips: [0, -0.012, 0] },
      };
    },
  },
  Kick: {
    duration: 1.2,
    pose(ph) {
      const k = bump(ph, 0.15, 0.75);
      return {
        rot: relaxed({
          Spine: [-0.22 * k, 0, 0], Head: [0.1 * k, 0, 0],
          ...leg('Right', V(0, -1 + 1.25 * k, 0.05 + 0.95 * k), V(0, -1 + 1.35 * k, 0.1 + 0.75 * k), 0.3 * k),
          ...leg('Left', V(0, -1, 0.1), V(0, -1, -0.1)),
          ...arms(V(0.85, -0.25 + 0.3 * k, 0.3), V(0.8, 0.0, 0.5)),
        }),
        pos: { Hips: [0, -0.01 * k, -0.02 * k] },
      };
    },
  },
  Throw: {
    duration: 1.3, once: true,
    pose: keyed([
      [0, stand()],
      [0.35, { rot: relaxed({ Spine1: [-0.1, 0.5, 0], Spine: [-0.1, 0.2, 0], ...arm('Right', V(-0.5, 0.6, -0.6), V(-0.2, 0.92, -0.3)), ...arm('Left', V(0.4, 0.1, 0.9)), ...leg('Right', V(0, -1, -0.3)), ...leg('Left', V(0, -0.95, 0.3), V(0, -1, 0)) }), pos: { Hips: [0, -0.01, -0.01] } }],
      [0.55, { rot: relaxed({ Spine1: [0.1, -0.45, 0], Spine: [0.2, -0.2, 0], ...arm('Right', V(-0.1, 0.3, 0.95)), ...arm('Left', V(0.6, -0.5, -0.5)), ...leg('Left', V(0, -0.95, 0.35), V(0, -1, -0.1)), ...leg('Right', V(0, -0.95, -0.35)) }), pos: { Hips: [0, -0.02, 0.02] } }],
      [0.78, { rot: relaxed({ Spine1: [0.15, -0.3, 0], Spine: [0.25, 0, 0], ...arm('Right', V(0.3, -0.6, 0.75)), ...legs(V(0, -0.98, 0.15)) }), pos: { Hips: [0, -0.015, 0.01] } }],
      [1, stand()],
    ]),
  },
  PickUp: {
    duration: 1.7, once: true,
    pose: keyed([
      [0, stand()],
      [0.35, { rot: { ...SQUAT.rot, ...arms(V(0.15, -0.85, 0.5), V(0.1, -0.9, 0.42)) }, pos: SQUAT.pos }],
      [0.55, { rot: { ...SQUAT.rot, ...arms(V(0.2, -0.8, 0.56), V(-0.3, -0.6, 0.74)) }, pos: SQUAT.pos }],
      [0.85, { rot: relaxed({ Spine1: [-0.05, 0, 0], ...CARRY }), pos: {} }],
      [1, { rot: relaxed({ Spine1: [-0.05, 0, 0], ...CARRY }), pos: {} }],
    ]),
  },
  Push: {
    duration: 1.2,
    pose(ph) {
      const s = Math.sin(ph * TAU);
      return {
        rot: relaxed({
          Spine: [0.38, 0, 0], Head: [-0.3, 0, 0],
          ...leg('Left', V(0, -0.85, 0.5), V(0, -0.95, -0.15)), ...leg('Right', V(0, -0.85, -0.55), V(0, -0.85, -0.5), 0.35),
          ...arms(V(0.22, 0.0 + 0.04 * s, 0.97), V(0.15, 0.15, 1)),
        }),
        pos: { Hips: [0, -0.04, 0.012 * s] },
      };
    },
  },
  Pull: {
    duration: 1.2,
    pose(ph) {
      const s = Math.sin(ph * TAU);
      return {
        rot: relaxed({
          Spine: [-0.28 - 0.05 * s, 0, 0], Head: [0.2, 0, 0],
          ...leg('Left', V(0, -0.85, 0.55), V(0, -1, 0.1), -0.3), ...leg('Right', V(0, -0.9, -0.4), V(0, -0.95, -0.25)),
          ...arms(V(0.15, -0.22, 0.96), V(0.05, -0.08 - 0.05 * s, 1)),
        }),
        pos: { Hips: [0, -0.035, -0.015 * s] },
      };
    },
  },
  Stretch: {
    duration: 3.2,
    pose(ph) {
      const s = bump(ph, 0.08, 0.92);
      const up = V(0.28, 0.96, -0.05);
      return {
        rot: {
          ...relaxed({ Spine: [-0.18 * s, 0, 0], Spine1: [-0.08 * s, 0, 0], Head: [-0.32 * s, 0, 0] }),
          ...arms(V(0.35, -0.94, 0).lerp(up, s), V(0.35, -0.94, 0).lerp(V(0.1, 1, 0), s)),
          ...legs(V(0, -1, -0.08), V(0, -1, -0.12), 0.35 * s),
        },
        pos: { Hips: [0, 0.012 * s, 0] },
      };
    },
  },
  Dance: {
    duration: 1.0,
    pose(ph) {
      const p = ph * TAU, s = Math.sin(p), up = Math.max(0, s), dn = Math.max(0, -s);
      return {
        rot: relaxed({
          Hips: [0, 0.1 * s, 0.12 * s], Spine: [0, -0.06 * s, -0.08 * s], Head: [0, 0.12 * s, 0.1 * s],
          ...arm('Right', V(-0.6, -0.4 + 1.2 * up, 0.35), V(-0.45, -0.2 + 1.2 * up, 0.4)),
          ...arm('Left', V(0.6, -0.4 + 1.2 * dn, 0.35), V(0.45, -0.2 + 1.2 * dn, 0.4)),
          ...leg('Left', V(0, -1, 0.05), V(0, -1, -0.05 - 0.5 * dn)), ...leg('Right', V(0, -1, 0.05), V(0, -1, -0.05 - 0.5 * up)),
        }),
        pos: { Root: [0.035 * s, 0, 0], Hips: [0, -0.015 * Math.abs(Math.cos(p)), 0] },
      };
    },
  },
  Celebrate: {
    duration: 0.8,
    pose(ph) {
      const u = bump(ph, 0.0, 0.5), hop = Math.max(0, Math.sin(ph * TAU));
      return {
        rot: relaxed({
          Head: [-0.15, 0, 0.05],
          ...arm('Right', V(-0.3, 0.1 + 0.8 * u, 0.6 - 0.4 * u), V(-0.12, 1, 0.2)),
          ...arm('Left', V(0.8, -0.5, -0.3), V(-0.5, -0.55, 0.22)),
        }),
        pos: { Root: [0, 0.035 * hop, 0] },
      };
    },
  },
};

// How the lab groups them.
export const MOVE_GROUPS = {
  Move: ['Sneak', 'Tiptoe', 'Skip', 'March', 'Jog', 'Sprint', 'Limp', 'Waddle', 'Strut', 'Carry'],
  Rest: ['SitFloor', 'SitCrossed', 'Kneel', 'Squat', 'LieDown', 'Sleep'],
  'Fall & hurt': ['Trip', 'FallBack', 'Faceplant', 'Knockback', 'Hurt', 'Pain', 'Faint', 'GetUp', 'Stagger'],
  Gesture: ['Point', 'Clap', 'Bow', 'Shrug', 'Facepalm', 'Think', 'ArmsCrossed', 'HandsOnHips', 'Salute', 'Beckon', 'Cower', 'CryHands'],
  Action: ['Punch', 'Kick', 'Throw', 'PickUp', 'Push', 'Pull', 'Stretch', 'Dance', 'Celebrate'],
};
