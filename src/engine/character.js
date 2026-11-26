import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BASE_URL, SOCKETS } from './rig.js';
import { buildClips } from './animations.js';
import { Face } from './face.js';
import { createBodyMaterial, applyOutfit } from './outfit.js';
import { createHairMaterial, hairTexture, loadHairGeometry, setHairColor, setHairTexture } from './hair.js';
import { loadGLTF } from './loader.js';
import { EMOTIONS } from './emotions.js';
import { Symbols } from './symbols.js';
import { applyBody } from './body.js';
import { EAR_STYLES, buildEars } from './ears.js';
import { buildParts, poseBrowRidge } from './parts.js';

// A character is the canonical base + a spec. Everything that makes characters differ
// lives in the spec; the mesh, skeleton and animations are shared.
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const CONTACT_BONES = ['Hips', 'Head', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand'];

let contactTexture = null;
function softShadowTexture() {
  if (!contactTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    grad.addColorStop(0.45, 'rgba(0, 0, 0, 0.3)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    contactTexture = new THREE.CanvasTexture(c);
  }
  return contactTexture;
}

export const DEFAULT_SPEC = {
  skin: '#f8d3b0',
  height: 1,          // overall scale (1 = base height)
  headScale: 1,
  body: 'standard',   // see body.js BODY_TYPES
  ears: 'human',      // see ears.js EAR_STYLES
  hair: null,         // { style: 'bob', color: '#4a2f22', texture?: 'wavy' }, see hair.js
  outfit: null,       // see outfit.js
  fur: null,          // fur patterns, see outfit.js
  parts: [],          // snouts, horns, tails..., see parts.js
  face: {},           // see face.js DEFAULT_FACE
};

let base = null; // { scene, clips }

async function loadBase() {
  if (!base) {
    base = loadGLTF(BASE_URL).then((gltf) => ({ scene: gltf.scene, clips: buildClips(gltf.scene) }));
  }
  return base;
}

export async function createCharacter(spec = {}) {
  const { scene, clips } = await loadBase();
  const character = new Character(cloneSkinned(scene), clips, spec);
  await character.ready;
  return character;
}

export class Character {
  constructor(model, clips, spec) {
    this.root = new THREE.Group();
    this.root.add(model);
    this.model = model;
    this.bones = {};

    model.traverse((obj) => {
      if (obj.isBone) this.bones[obj.name] = obj;
      if (!obj.isSkinnedMesh) return;
      obj.frustumCulled = false; // skinned bounds don't follow the animation
      if (obj.material.name === 'Face') this.faceMesh = obj;
      else this.bodyMesh = obj;
    });
    this.skeleton = this.bodyMesh.skeleton;

    this.bodyMesh.material = createBodyMaterial();
    this.bodyMesh.castShadow = true;
    this.faceMesh.material = new THREE.MeshStandardMaterial({
      name: 'Face', transparent: true, depthWrite: false, roughness: 0.9, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.face = new Face(this.faceMesh.material);
    this.hairMaterial = createHairMaterial();
    this.hairMesh = null;
    this.symbols = new Symbols(this.bones.Head);

    // A soft contact shadow on the floor that follows the body (stretches when lying down,
    // fades during jumps); the key light adds the longer cast shadow.
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: softShadowTexture(), color: 0x2a2320, transparent: true, depthWrite: false }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.renderOrder = -1;
    this.root.add(this.contact);
    this.motion = null;        // body motion layered on the animation by the current emotion
    this.nextMotion = null;
    this.motionWeight = 0;
    this.motionTime = 0;

    this.mixer = new THREE.AnimationMixer(model);
    this.clips = clips;
    this.actions = new Map(clips.map((clip) => [clip.name, this.mixer.clipAction(clip)]));
    this.current = null;

    this.skeletonHelper = new THREE.SkeletonHelper(model);
    this.skeletonHelper.material.depthTest = false;
    this.skeletonHelper.renderOrder = 999;
    this.skeletonHelper.visible = false;
    this.root.add(this.skeletonHelper);

    this.apply(spec);
  }

  /** Re-skin the character from a spec (colors, hair, outfit, proportions, face). */
  apply(spec = {}) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    applyOutfit(this.bodyMesh.material, this.spec.skin, this.spec.outfit, this.spec.fur);
    this.setParts(this.spec.parts);
    this.root.scale.setScalar(this.spec.height);
    this.bodyType = applyBody(this, this.spec.body);
    this.bones.Head.scale.setScalar(this.spec.headScale * (this.bodyType.head ?? 1));
    this.face.setParams(this.spec.face);
    this.ready = this.setHair(this.spec.hair);
    this.setEars(this.spec.ears);
    return this.ready;
  }

  /** Replace the extra parts (snouts, horns, manes, tails; see parts.js). */
  setParts(parts = []) {
    for (const { object } of this.partObjects ?? []) {
      object.removeFromParent();
      object.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); } });
    }
    this.partObjects = buildParts(parts).map((part) => { this.bones[part.bone].add(part.object); return part; });
    // A snout carries the mouth, so the face draws it there (see Face.setMuzzle); a brow ridge
    // takes the place of drawn brows and moves with the emotion.
    this.face.setMuzzle(this.partObjects.find((part) => part.muzzle)?.muzzle ?? null);
    this.face.setBrowRidge(this.partObjects.some((part) => part.ridge));
    this.poseParts();
  }

  /** Parts that follow the emotion: a brow ridge frowns, lifts and worries like drawn brows. */
  poseParts() {
    const brows = EMOTIONS[this.face.emotionId]?.brows ?? null;
    for (const part of this.partObjects ?? []) if (part.ridge) poseBrowRidge(part.ridge, brows);
  }

  /** Swap the ears (see ears.js). Animal ears take the hair color, or the fur color. */
  setEars(style = 'human') {
    this.spec.ears = style;
    for (const o of this.earObjects ?? []) {
      o.removeFromParent();
      o.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
    }
    const def = EAR_STYLES[style] ?? EAR_STYLES.human;
    const s = Math.max(def.scale, 0.001);
    this.bones.LeftEar.scale.setScalar(s);
    this.bones.RightEar.scale.setScalar(s);
    const furry = this.spec.fur || this.spec.parts?.length;
    const colors = { fur: furry ? this.spec.skin : this.spec.hair?.color ?? '#4a2f22', skin: this.spec.skin };
    this.earObjects = buildEars(style, colors).map(({ bone, object }) => { this.bones[bone].add(object); return object; });
  }

  /**
   * Swap the hair style, texture and/or color; `null` removes the hair. The skin color shows
   * through where the hair thins out (fades, partings), so a skin change re-tints it too. A style
   * this engine doesn't know leaves the character without hair; `ready` still resolves.
   */
  async setHair(hair) {
    this.spec.hair = hair;
    this.hairRequest = hair;
    if (!hair?.style) {
      this.removeHair();
      return;
    }
    const texture = hairTexture(hair.style, hair.texture);
    const geometry = await loadHairGeometry(hair.style, texture);
    if (this.hairRequest !== hair) return; // a newer request won
    if (!geometry) {
      this.removeHair();
    } else {
      if (!this.hairMesh) {
        this.hairMesh = new THREE.Mesh(geometry, this.hairMaterial);
        this.hairMesh.castShadow = true;
        this.bones.Head.add(this.hairMesh);
      } else {
        this.hairMesh.geometry = geometry;
      }
      setHairTexture(this.hairMaterial, texture);
      setHairColor(this.hairMaterial, hair.color ?? '#4a2f22', this.spec.skin);
    }
    if (this.spec.ears && EAR_STYLES[this.spec.ears]?.scale === 0) this.setEars(this.spec.ears); // fur follows the hair
  }

  removeHair() {
    this.hairMesh?.removeFromParent();
    this.hairMesh = null;
  }

  get clipNames() { return this.clips.map((clip) => clip.name); }

  get stats() {
    const geo = this.bodyMesh.geometry;
    return { bones: this.skeleton.bones.length, triangles: geo.index.count / 3, clips: this.clips.length };
  }

  /** Cross-fade to a named animation. One-shot moves (falls, throws...) play once and hold. */
  play(name, fade = 0.3) {
    const next = this.actions.get(name);
    if (!next) return;
    const once = next.getClip().userData?.once;
    if (next === this.current && !once) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = !!once;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current && this.current !== next) this.current.fadeOut(fade);
    this.current = next;
  }

  /** Show an emotion (see emotions.js): face, floating symbols and a small body motion. */
  setEmotion(id) {
    this.face.setEmotion(id);
    this.poseParts();
    const emotion = EMOTIONS[this.face.emotionId];
    this.symbols.set(emotion.symbols ?? []);
    this.nextMotion = emotion.motion ?? null;
  }

  setExpression(id) { this.setEmotion(id); }
  set talking(on) { this.face.talking = on; }

  /** An attachment bone for hats, held props, ears or tails (see rig.js SOCKETS). */
  socket(name) { return this.bones[SOCKETS[name] ?? name]; }

  set showSkeleton(visible) { this.skeletonHelper.visible = visible; }
  set wireframe(on) {
    this.bodyMesh.material.wireframe = on;
    this.hairMaterial.wireframe = on;
    this.faceMesh.visible = !on;
  }

  update(dt) {
    this.restoreMotion();
    this.mixer.update(dt);
    this.applyMotion(dt);
    this.face.update(dt);
    this.symbols.update(dt);
    this.updateContact();
    this.wagTime = (this.wagTime ?? 0) + dt;
    for (const { object, wag } of this.partObjects ?? []) {
      if (!wag) continue;
      object.rotation.y = wag[0] * Math.sin(this.wagTime * wag[1]);
      object.rotation.x = 0.06 * Math.sin(this.wagTime * wag[1] * 0.5);
    }
  }

  // The mixer only rewrites a bone when its animated value changes, so offsets added after it
  // would pile up frame after frame. Put back the mixer's own values before it runs again.
  restoreMotion() {
    for (const [target, value] of this.motionSaved ?? []) target.copy(value);
    this.motionSaved = [];
  }

  updateContact() {
    this.root.updateMatrixWorld(true);
    _inv.copy(this.root.matrixWorld).invert();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, low = Infinity;
    for (const name of CONTACT_BONES) {
      this.bones[name].getWorldPosition(_v).applyMatrix4(_inv);
      x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x);
      z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z);
      low = Math.min(low, _v.y);
    }
    this.contact.position.set((x0 + x1) / 2, 0.002, (z0 + z1) / 2);
    this.contact.scale.set(Math.max(0.34, x1 - x0 + 0.2), Math.max(0.3, z1 - z0 + 0.24), 1);
    this.contact.material.opacity = 0.9 * THREE.MathUtils.clamp(1 - low * 4, 0.2, 1);
  }

  /** Emotion motions are small rotations added on top of whatever the mixer just posed. */
  applyMotion(dt) {
    if (this.motion !== this.nextMotion) {
      this.motionWeight = Math.max(0, this.motionWeight - dt * 4);
      if (this.motionWeight === 0) { this.motion = this.nextMotion; this.motionTime = 0; }
    } else {
      this.motionWeight = Math.min(1, this.motionWeight + dt * 3);
    }
    if (!this.motion || !this.motionWeight) return;
    this.motionTime += dt;
    const t = this.motionTime, w = this.motionWeight, B = this.bones;
    const save = (target) => this.motionSaved.push([target, target.clone()]);
    const turn = (bone, x, y, z) => { save(bone.quaternion); bone.quaternion.multiply(_q.setFromEuler(_e.set(x * w, y * w, z * w))); };
    const noise = (x) => Math.sin(x) * 0.6 + Math.sin(x * 2.3 + 1.7) * 0.4;
    switch (this.motion) {
      case 'tremble': turn(B.Head, noise(t * 40) * 0.035, noise(t * 37 + 3) * 0.035, 0); turn(B.Spine1, noise(t * 33 + 5) * 0.02, 0, noise(t * 29) * 0.02); break;
      case 'bounce': save(B.Root.position); B.Root.position.y += 0.03 * Math.abs(Math.sin(t * 7)) * w; break;
      case 'sway': turn(B.Head, 0, 0, 0.14 * Math.sin(t * 2.6)); turn(B.Spine1, 0, 0, 0.05 * Math.sin(t * 2.6 - 0.8)); break;
      case 'slump': turn(B.Head, 0.28, 0, 0); turn(B.Neck, 0.08, 0, 0); turn(B.Spine1, 0.12, 0, 0); break;
      case 'chinup': turn(B.Head, -0.18, 0, 0); turn(B.Spine1, -0.05, 0, 0); break;
      case 'tilt': turn(B.Head, 0, 0, 0.2); break;
      case 'nodoff': turn(B.Head, 0.22 + 0.12 * Math.sin(t * 1.3), 0, 0.05); break;
      case 'sob': turn(B.Head, 0.12 + 0.04 * Math.sin(t * 16), 0, 0); turn(B.Spine1, 0.05 + 0.02 * Math.sin(t * 16), 0, 0); break;
      default: break;
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.bodyMesh.material.dispose();
    this.faceMesh.material.dispose();
    this.hairMaterial.dispose();
    this.contact.geometry.dispose();
    this.contact.material.dispose();
    this.setParts([]);
    this.symbols.dispose();
    this.face.dispose();
    this.skeletonHelper.dispose?.();
    this.root.removeFromParent();
  }
}
