import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD_UNIFORMS } from './kit.js';
import { Sky, atmosphere } from './sky.js';
import { WeatherFX } from './weather.js';

/**
 * The outdoor stage: renderer, camera, sky, sun and moon light, fog, weather and the render
 * loop. Set the moment with `setMoment({ hour, weather, season, day, ambient })`; point the
 * shadows at the action with `focus(center, radius)`.
 */
export class WorldStage {
  constructor(container, { preserveDrawingBuffer = false } = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe3f0, 60, 260);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 2500);
    this.camera.position.set(0, 6, 16);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 140;

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.envScene = this.sky.makeEnvironmentScene();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = null;

    this.hemi = new THREE.HemisphereLight(0xdfe9f7, 0x7a6c58, 0.9);
    this.key = new THREE.DirectionalLight(0xfff4e6, 3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 4;
    this.key.shadow.blurSamples = 12;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.02;
    this.flashLight = new THREE.DirectionalLight(0xdfe8ff, 0);
    this.scene.add(this.hemi, this.key, this.key.target, this.flashLight, this.flashLight.target);

    this.weather = new WeatherFX();
    this.scene.add(this.weather.object);

    this.focusCenter = new THREE.Vector3();
    this.focusRadius = 20;
    this.updatables = new Set();
    this.paused = false;
    this.lastTime = null;
    this.moment = null;
    this.onFrame = null;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  add(thing) {
    const object = thing.root ?? thing.object ?? thing;
    if (object.isObject3D) this.scene.add(object);
    if (typeof thing.update === 'function') this.updatables.add(thing);
    return thing;
  }

  remove(thing) {
    (thing.root ?? thing.object ?? thing).removeFromParent();
    this.updatables.delete(thing);
  }

  /** Set the moment: hour (0-24), weather, season, day of month (moon phase), ambient particles. */
  setMoment({ hour = 12, weather = 'clear', season = 'summer', day = 15, ambient = null } = {}) {
    const a = atmosphere({ hour, weather, season, day });
    const prev = this.moment;
    this.moment = a;
    this.sky.set(a);

    this.key.color.copy(a.keyColor);
    this.key.intensity = a.keyIntensity;
    this.key.shadow.radius = 3 + a.shadowSoftness * 9;
    this.hemi.color.copy(a.hemiSky);
    this.hemi.groundColor.copy(a.hemiGround);
    this.hemi.intensity = a.hemiIntensity;
    this.scene.fog.color.copy(a.fogColor);
    this.scene.fog.near = a.fogNear;
    this.scene.fog.far = a.fogFar;
    this.renderer.toneMappingExposure = a.exposure;

    WORLD_UNIFORMS.uSnow.value = a.snow;
    WORLD_UNIFORMS.uWet.value = a.wet;
    WORLD_UNIFORMS.uGlow.value = a.glow;
    WORLD_UNIFORMS.uWind.value = a.wind;
    this.weather.set(a, ambient);
    this.placeLights();

    // Re-bake the sky into the environment light when the sky has changed enough to see.
    const changed = !prev || prev.weather !== a.weather || prev.season !== a.season || Math.abs(prev.hour - a.hour) > 0.2;
    if (changed) this.bakeEnvironment();
    return a;
  }

  bakeEnvironment() {
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.42;
    old?.dispose();
  }

  /** Aim the key light's shadows at an area (center Vector3, radius in units). */
  focus(center, radius = 20) {
    this.focusCenter.copy(center);
    this.focusRadius = radius;
    this.placeLights();
  }

  placeLights() {
    const a = this.moment;
    if (!a) return;
    const r = this.focusRadius;
    this.key.target.position.copy(this.focusCenter);
    this.key.position.copy(this.focusCenter).addScaledVector(a.keyDir, r * 3 + 20);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = r * 6 + 60;
    cam.updateProjectionMatrix();
    this.key.shadow.needsUpdate = true;
    this.flashLight.position.copy(this.focusCenter).add(new THREE.Vector3(-10, 30, 6));
    this.flashLight.target.position.copy(this.focusCenter);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Advance the world by dt seconds and draw one frame. */
  step(dt) {
    WORLD_UNIFORMS.uTime.value += dt;
    this.sky.uniforms.uTime.value = WORLD_UNIFORMS.uTime.value;
    for (const thing of this.updatables) thing.update(dt);
    this.sky.mesh.position.copy(this.camera.position);
    const flash = this.weather.update(dt, this.camera, this.focusCenter, this.renderer.domElement.height);
    this.sky.uniforms.uFlash.value = flash * 0.5;
    this.flashLight.intensity = flash * 2.5;
    this.onFrame?.(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  tick(time) {
    const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    if (this.paused) return;
    this.step(dt);
  }
}
