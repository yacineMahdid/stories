import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * A stage owns the renderer, camera, lights and the render loop.
 * Anything added with `add()` that has an `update(dt)` method is ticked every frame.
 *
 * Lighting is a small photo studio: soft image-based fill from a room environment, a warm key
 * light with soft shadows, a cool rim light from behind to separate characters from the
 * background, and a faint fill from the other side.
 */
export class Stage {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0); // the page paints the backdrop
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.58;

    const hemi = new THREE.HemisphereLight(0xfdfbf7, 0x8b8478, 0.75);
    this.key = new THREE.DirectionalLight(0xfff1df, 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.radius = 7;
    this.key.shadow.blurSamples = 16;
    this.key.shadow.bias = -0.0004;
    this.rim = new THREE.DirectionalLight(0xd7e4ff, 1.7);
    this.fill = new THREE.DirectionalLight(0xe8eeff, 0.45);
    this.scene.add(hemi, this.key, this.key.target, this.rim, this.fill);

    // Invisible floor that only shows shadows, so the CSS backdrop stays visible.
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.16 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.updatables = new Set();
    this.lastTime = null;
    this.framing = null;

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

  /**
   * Point the camera, lights and floor at an object so it fills the frame. With
   * `keepView`, the current viewing direction is kept (used when the subject changes size).
   */
  frame(object, keepView = false) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const h = Math.max(size.y, 0.5);

    const target = new THREE.Vector3(center.x, box.min.y + size.y * 0.47, center.z);
    if (!keepView) this.camera.position.copy(target).addScaledVector(new THREE.Vector3(0.36, 0.14, 1).normalize(), h * 3);
    this.framing = { h, target };
    this.camera.near = h * 0.01;
    this.camera.far = h * 100;
    this.controls.minDistance = h * 0.45;
    this.controls.maxDistance = h * 8;
    this.fit();

    this.ground.position.set(center.x, box.min.y, center.z);
    this.ground.scale.setScalar(h * 2);
    this.key.position.copy(center).add(new THREE.Vector3(1.3, 3.4, 2.3).multiplyScalar(h));
    this.key.target.position.copy(center);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -h * 1.2;
    cam.right = cam.top = h * 1.2;
    cam.near = h * 0.5;
    cam.far = h * 12;
    cam.updateProjectionMatrix();
    this.rim.position.copy(center).add(new THREE.Vector3(-1.6, 2.4, -3.2).multiplyScalar(h));
    this.fill.position.copy(center).add(new THREE.Vector3(-3, 1.0, 2.2).multiplyScalar(h));
  }

  /** Move the camera along its current direction so the framed subject fits the viewport. */
  fit() {
    if (!this.framing) return;
    const { h, target } = this.framing;
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const dist = Math.max((h * 0.64) / Math.tan(vHalf), (h * 0.5) / Math.tan(hHalf));
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(0.36, 0.14, 1);
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir.normalize(), dist);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  tick(time) {
    const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    for (const thing of this.updatables) thing.update(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
