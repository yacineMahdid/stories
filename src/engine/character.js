import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BASE_URL, SOCKETS } from './rig.js';
import { buildClips } from './animations.js';
import { Face } from './face.js';
import { createBodyMaterial, applyOutfit } from './outfit.js';

// A character is the canonical base + a spec. Everything that makes characters differ
// lives in the spec; the mesh, skeleton and animations are shared.
export const DEFAULT_SPEC = {
  skin: '#f8d3b0',
  height: 1,          // overall scale (1 = base height)
  headScale: 1,
  outfit: null,       // see outfit.js
  face: {},           // see face.js DEFAULT_FACE
};

let base = null; // { scene, clips }

async function loadBase() {
  if (!base) {
    base = new GLTFLoader().loadAsync(BASE_URL).then((gltf) => ({ scene: gltf.scene, clips: buildClips(gltf.scene) }));
  }
  return base;
}

export async function createCharacter(spec = {}) {
  const { scene, clips } = await loadBase();
  return new Character(cloneSkinned(scene), clips, spec);
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

  /** Re-skin the character from a spec (colors, outfit, proportions, face). */
  apply(spec = {}) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    applyOutfit(this.bodyMesh.material, this.spec.skin, this.spec.outfit);
    this.root.scale.setScalar(this.spec.height);
    this.bones.Head.scale.setScalar(this.spec.headScale);
    this.face.setParams(this.spec.face);
  }

  get clipNames() { return this.clips.map((clip) => clip.name); }

  get stats() {
    const geo = this.bodyMesh.geometry;
    return { bones: this.skeleton.bones.length, triangles: geo.index.count / 3, clips: this.clips.length };
  }

  /** Cross-fade to a named animation. */
  play(name, fade = 0.3) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  setExpression(name) { this.face.setExpression(name); }
  set talking(on) { this.face.talking = on; }

  /** An attachment bone for hats, held props, ears or tails (see rig.js SOCKETS). */
  socket(name) { return this.bones[SOCKETS[name] ?? name]; }

  set showSkeleton(visible) { this.skeletonHelper.visible = visible; }
  set wireframe(on) { this.bodyMesh.material.wireframe = on; this.faceMesh.visible = !on; }

  update(dt) {
    this.mixer.update(dt);
    this.face.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.bodyMesh.material.dispose();
    this.faceMesh.material.dispose();
    this.face.dispose();
    this.skeletonHelper.dispose?.();
    this.root.removeFromParent();
  }
}
