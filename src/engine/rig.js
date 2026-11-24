// The canonical rig every character shares. Built by tools/build_base.py.
//
// Conventions
//   - 1 unit = the base character's height; feet on y = 0; the character faces +Z.
//   - "Left" is the character's own left (+X).
//   - Every bone's rest rotation is identity, so a pose is just Euler angles per bone
//     (order XYZ: the Z turn is applied first, then Y, then X).
//       legs:  x < 0 swings forward, x > 0 bends the knee / swings back
//       arms:  z lowers/raises (left arm: z < 0 lowers, right arm: z > 0 lowers),
//              then x swings forward (x < 0) or back (x > 0)
//       forearms: y bends the elbow forward (left: y < 0, right: y > 0)
//       head/spine: x nods forward, y turns, z tilts

export const BASE_URL = new URL('../../assets/characters/canonical/base.gltf', import.meta.url).href;

export const BONES = [
  'Root', 'Hips', 'Spine', 'Spine1', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

// Attachment points with no skin weight: hats, ears, held props, tails.
export const SOCKETS = {
  headTop: 'HeadTop_End',
  leftEar: 'LeftEar',
  rightEar: 'RightEar',
  leftHand: 'LeftHand_End',
  rightHand: 'RightHand_End',
  tail: 'Tail',
};

// Body regions baked into the mesh (vertex attribute `_region`), used to paint outfits.
export const REGIONS = ['head', 'neck', 'chest', 'pelvis', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'foot'];
