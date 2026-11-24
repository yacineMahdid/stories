import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * A stage owns the renderer, camera, lights and the render loop.
 * Anything added with `add()` that has an `update(dt)` method is ticked every frame.
 */
export class Stage {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0); // the page paints the backdrop
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.58;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x7d8579, 1.3);
    this.key = new THREE.DirectionalLight(0xfff4e6, 2.0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.normalBias = 0.02;
    this.rim = new THREE.DirectionalLight(0xdce6ff, 1.1);
    this.scene.add(hemi, this.key, this.key.target, this.rim);

    // Invisible floor that only shows shadows, so the CSS backdrop stays visible.
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.updatables = new Set();
    this.lastTime = null;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop((time) => this.tick(time));
  }

  add(thing) {
    this.scene.add(thing.root ?? thing);
    if (typeof thing.update === 'function') this.updatables.add(thing);
    return thing;
  }

  remove(thing) {
    (thing.root ?? thing).removeFromParent();
    this.updatables.delete(thing);
  }

  /** Point the camera, lights and floor at an object so it fills the frame. */
  frame(object) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const h = Math.max(size.y, size.x, size.z);

    const target = new THREE.Vector3(center.x, box.min.y + size.y * 0.44, center.z);
    const dir = new THREE.Vector3(0.38, 0.16, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, h * 2.4);
    this.camera.near = h * 0.01;
    this.camera.far = h * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.minDistance = h * 0.5;
    this.controls.maxDistance = h * 8;
    this.controls.update();

    this.ground.position.set(center.x, box.min.y, center.z);
    this.ground.scale.setScalar(h * 1.4);

    this.key.position.copy(center).add(new THREE.Vector3(2.5, 4, 3).multiplyScalar(h));
    this.key.target.position.copy(center);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -h * 1.5;
    cam.right = cam.top = h * 1.5;
    cam.near = h * 0.1;
    cam.far = h * 20;
    cam.updateProjectionMatrix();
    this.rim.position.copy(center).add(new THREE.Vector3(-3, 2.5, -3).multiplyScalar(h));
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick(time) {
    const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    for (const thing of this.updatables) thing.update(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
