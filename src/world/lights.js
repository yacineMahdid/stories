import * as THREE from 'three';
import { WORLD_UNIFORMS } from './kit.js';

/**
 * Real lights for props (lamps, windows, fires). Each prop lists `userData.lights`; the stage
 * turns the ones nearest the action into point lights, with a soft halo sprite on every one.
 * Night lights fade in with WORLD_UNIFORMS.uGlow; `when: 'always'` lights (fire) stay on.
 */

let haloTexture = null;
function halo() {
  if (!haloTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    haloTexture = new THREE.CanvasTexture(c);
    haloTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return haloTexture;
}

const CANDELA = 3.2; // kit intensity 1 ≈ a warm lamp lighting a few units around it

export class PropLights {
  constructor(scene, { max = 14 } = {}) {
    this.scene = scene;
    this.max = max;
    this.entries = []; // { position, color, intensity, distance, when, flicker }
    this.pool = [];
    this.halos = new THREE.Group();
    this.halos.name = 'light-halos';
    scene.add(this.halos);
  }

  clear() {
    this.entries = [];
    for (const s of this.halos.children.slice()) { s.material.dispose(); s.removeFromParent(); }
    for (const l of this.pool) l.intensity = 0;
  }

  /**
   * Collect the lights of a placed prop (its world matrix must be up to date). With `moving`,
   * the lights follow the prop every frame (a lantern in a hand).
   */
  addFrom(object, { moving = false } = {}) {
    object.updateMatrixWorld(true);
    for (const l of object.userData.lights ?? []) {
      const position = new THREE.Vector3(...l.at).applyMatrix4(object.matrixWorld);
      const scale = Math.min(object.matrixWorld.getMaxScaleOnAxis(), 4);
      const entry = { position, color: new THREE.Color(l.color), intensity: l.intensity, distance: l.distance * (moving ? 1 : scale), when: l.when ?? 'night', flicker: l.flicker ?? (l.when === 'always'), follow: moving ? { object, local: new THREE.Vector3(...l.at) } : null };
      this.entries.push(entry);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: halo(), color: entry.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
      }));
      sprite.position.copy(position);
      const size = (l.halo ?? 0.9) * scale;
      sprite.scale.set(size, size, 1);
      sprite.userData.entry = entry;
      sprite.renderOrder = 5;
      this.halos.add(sprite);
    }
  }

  /** Forget the lights of a prop (a hand prop put away). */
  removeFrom(object) {
    this.entries = this.entries.filter((e) => e.follow?.object !== object);
    for (const sprite of this.halos.children.slice()) {
      if (sprite.userData.entry.follow?.object === object) { sprite.material.dispose(); sprite.removeFromParent(); }
    }
  }

  /** Light the entries nearest `center` with real point lights. */
  update(center, t = WORLD_UNIFORMS.uTime.value) {
    for (const s of this.halos.children) {
      const e = s.userData.entry;
      if (!e.follow) continue;
      e.position.copy(e.follow.local).applyMatrix4(e.follow.object.matrixWorld);
      s.position.copy(e.position);
    }
    const glow = WORLD_UNIFORMS.uGlow.value;
    const level = (e) => (e.when === 'always' ? 1 : THREE.MathUtils.smoothstep(glow, 0.15, 0.7));
    const flick = (e, i) => (e.flicker ? 0.82 + 0.1 * Math.sin(t * 13 + i) + 0.08 * Math.sin(t * 29 + i * 3) : 1);
    const ranked = this.entries
      .map((e, i) => ({ e, i, d: e.position.distanceToSquared(center) }))
      .filter((r) => level(r.e) > 0.01)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.max);
    // The number of lights is part of every shader, so it moves in a few fixed steps
    // (0, 4, 8, max) instead of following the exact count, which would recompile all the time.
    const n = ranked.length;
    const bucket = n === 0 ? 0 : n <= 4 ? 4 : n <= 8 ? 8 : this.max;
    while (this.pool.length < bucket) {
      const pl = new THREE.PointLight(0xffffff, 0, 6, 2);
      pl.castShadow = false;
      this.scene.add(pl);
      this.pool.push(pl);
    }
    while (this.pool.length > bucket) this.pool.pop().removeFromParent();
    this.pool.forEach((pl, k) => {
      const r = ranked[k];
      if (!r) { pl.intensity = 0; return; }
      pl.position.copy(r.e.position);
      pl.color.copy(r.e.color);
      pl.distance = r.e.distance;
      pl.intensity = r.e.intensity * CANDELA * level(r.e) * flick(r.e, r.i);
    });
    for (const s of this.halos.children) {
      const e = s.userData.entry;
      s.material.opacity = 0.85 * level(e) * flick(e, 0);
      s.visible = s.material.opacity > 0.01;
    }
  }

  dispose() {
    this.clear();
    for (const l of this.pool) l.removeFromParent();
    this.pool = [];
    this.halos.removeFromParent();
  }
}
