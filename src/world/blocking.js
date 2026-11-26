import * as THREE from 'three';
import { SCALE } from './kit.js';

/**
 * Putting characters on props: a spot (`userData.spots`) gives a position, a facing and a
 * pose. Seats are measured at their surface, so sitters are lowered by the height the Sit
 * animation is posed for (feet dangle on tall seats, like in the games).
 */

export const POSE_CLIPS = { stand: 'Idle', sit: 'Sit', lie: 'LieDown', lean: 'ArmsCrossed', floor: 'SitFloor', kneel: 'Kneel' };
/**
 * The clips a character can play on a spot that sits, lies or kneels them: any other `do` (Idle,
 * Wave, Dance…) would stand them up through the seat, so the spot's own pose clip plays instead.
 * Standing and leaning spots take any clip.
 */
export const SPOT_CLIPS = { sit: ['Sit'], floor: ['SitFloor', 'SitCrossed'], lie: ['LieDown', 'Sleep'], kneel: ['Kneel', 'Squat'] };
/** Can `clip` be played on a spot with this pose? */
export const clipFits = (pose, clip) => !SPOT_CLIPS[pose] || SPOT_CLIPS[pose].includes(clip);

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Yaw (radians around +Y) of an object in world space. */
export function worldYaw(object) {
  object.updateMatrixWorld(true);
  object.matrixWorld.decompose(_p, _q, _s);
  return _e.setFromQuaternion(_q, 'YXZ').y;
}

/** A spot on a placed prop, in world space: { position, yaw, pose, name }. */
export function spotTransform(object, name) {
  const spots = object.userData.spots ?? {};
  const key = name && spots[name] ? name : Object.keys(spots)[0];
  const s = spots[key];
  if (!s) return null;
  object.updateMatrixWorld(true);
  const position = new THREE.Vector3(...s.at).applyMatrix4(object.matrixWorld);
  const yaw = worldYaw(object) + THREE.MathUtils.degToRad(s.facing ?? 0);
  return { position, yaw, pose: s.pose ?? 'stand', name: key };
}

/** Vertical offset that rests a pose on the surface it is placed on. */
export function poseLift(pose, height = 1) {
  if (pose === 'sit') return -SCALE.sitPose * height;
  if (pose === 'lie') return -0.056 * height;
  return 0;
}

/** Place a character at a world position / yaw in a pose, playing the pose's clip (or `clip`). */
export function placeCharacter(character, { position, yaw = 0, pose = 'stand' }, clip = null) {
  const h = character.spec?.height ?? 1;
  character.root.position.copy(position);
  character.root.position.y += poseLift(pose, h);
  character.root.rotation.set(0, yaw, 0);
  character.play(clip ?? POSE_CLIPS[pose] ?? 'Idle', 0);
}
