import * as THREE from 'three';
import { WORLD_UNIFORMS } from './kit.js';

/**
 * Falling things around the camera: rain, snow, and ambient particles (leaves, petals,
 * fireflies, dust motes). Everything moves in the vertex shader, so thousands cost nothing.
 */

const BOX = new THREE.Vector3(44, 22, 44);

function seeds(count, perVertex = 1) {
  const a = new Float32Array(count * perVertex * 4);
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random(), Math.random()];
    for (let v = 0; v < perVertex; v++) a.set(s, (i * perVertex + v) * 4);
  }
  return a;
}

const RAIN_VERT = /* glsl */ `
attribute vec4 seed;
attribute float tip;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uSpeed;
uniform float uWindX;
uniform float uLength;
varying float vFade;
void main() {
  vec3 p = (seed.xyz - 0.5) * uBox;
  float fall = uTime * uSpeed * (0.85 + seed.w * 0.3);
  p.y = mod(seed.y * uBox.y - fall, uBox.y) - uBox.y * 0.5;
  p.x += uWindX * (p.y / uBox.y) * 2.0;
  p += uCenter;
  p += vec3(uWindX * 0.06, 1.0, 0.0) * uLength * tip;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFade = smoothstep(1.0, 4.0, -mv.z) * (1.0 - smoothstep(16.0, 22.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
}
`;

const POINT_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uSpeed;
uniform float uSway;
uniform float uSize;
uniform float uWindX;
uniform float uWander;
uniform float uPixel;
varying float vFade;
varying float vSeed;
void main() {
  vec3 p = (seed.xyz - 0.5) * uBox;
  float t = uTime * (0.8 + seed.w * 0.4);
  p.y = mod(seed.y * uBox.y - t * uSpeed, uBox.y) - uBox.y * 0.5;
  p.x += sin(t * 0.9 + seed.w * 31.0) * uSway + uWindX * (p.y / uBox.y);
  p.z += cos(t * 0.7 + seed.x * 17.0) * uSway;
  p += vec3(sin(t * 0.37 + seed.z * 40.0), sin(t * 0.53 + seed.x * 20.0) * 0.5, cos(t * 0.41 + seed.y * 30.0)) * uWander;
  p += uCenter;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFade = smoothstep(0.5, 2.0, -mv.z) * (1.0 - smoothstep(18.0, 24.0, -mv.z));
  vSeed = seed.w;
  gl_PointSize = uSize * uPixel / max(-mv.z, 0.1) * (0.7 + seed.w * 0.6);
  gl_Position = projectionMatrix * mv;
}
`;
const POINT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uTime;
uniform float uBlink;
uniform float uShape;
varying float vFade;
varying float vSeed;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a;
  if (uShape > 0.5) {
    // a tumbling leaf or petal: a squashed ellipse that turns with time
    float ang = uTime * (1.0 + vSeed * 2.0) + vSeed * 30.0;
    vec2 r = vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y);
    r.y *= 1.0 + 1.2 * abs(sin(ang * 0.7));
    a = (1.0 - smoothstep(0.18, 0.25, length(r * vec2(1.0, 1.8))));
  } else {
    a = (1.0 - smoothstep(0.15, 0.5, length(q)));
  }
  float blink = mix(1.0, 0.5 + 0.5 * sin(uTime * (2.0 + vSeed * 3.0) + vSeed * 50.0), uBlink);
  vec3 c = mix(uColor, uColor2, step(0.5, fract(vSeed * 7.31)));
  gl_FragColor = vec4(c, a * uOpacity * vFade * blink);
  if (gl_FragColor.a < 0.01) discard;
}
`;

const AMBIENT = {
  leaves: { count: 160, color: '#e58a37', color2: '#d1552f', size: 0.22, speed: 0.55, sway: 0.9, shape: 1, opacity: 0.95, wander: 0.4 },
  petals: { count: 220, color: '#f8bfd0', color2: '#fde3ea', size: 0.13, speed: 0.4, sway: 0.8, shape: 1, opacity: 0.95, wander: 0.5 },
  fireflies: { count: 140, color: '#f6f28a', color2: '#c9f27a', size: 0.09, speed: 0.0, sway: 0.0, shape: 0, opacity: 1, wander: 1.4, blink: 1, additive: true, box: [30, 3.2, 30], lift: 1.3 },
  dust: { count: 180, color: '#fff3d6', color2: '#ffffff', size: 0.035, speed: 0.03, sway: 0.25, shape: 0, opacity: 0.45, wander: 0.5, additive: true },
};

export class WeatherFX {
  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'weather';
    this.center = new THREE.Vector3();
    this.layers = {};

    // Rain: short streaks.
    const rainCount = 5200;
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rainCount * 2 * 3), 3));
    rg.setAttribute('seed', new THREE.Float32BufferAttribute(seeds(rainCount, 2), 4));
    const tip = new Float32Array(rainCount * 2);
    for (let i = 0; i < rainCount; i++) tip[i * 2 + 1] = 1;
    rg.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
    this.rainUniforms = {
      uTime: WORLD_UNIFORMS.uTime, uCenter: { value: this.center }, uBox: { value: BOX.clone() },
      uSpeed: { value: 15 }, uWindX: { value: 1.5 }, uLength: { value: 0.55 },
      uColor: { value: new THREE.Color('#c4d3e0') }, uOpacity: { value: 0.32 },
    };
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.rainUniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, fog: false,
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.object.add(this.rain);

    // Snow and ambient particles share one point shader.
    this.snow = this.makePoints(4200, { color: '#ffffff', color2: '#eef4ff', size: 0.11, speed: 1.1, sway: 0.6, opacity: 0.95, wander: 0.2 });
    this.ambient = null;
    this.ambientKind = null;
    this.flash = 0;
    this.nextFlash = 3;
    this.lightning = false;
  }

  makePoints(count, o) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(seeds(count), 4));
    const box = o.box ? new THREE.Vector3(...o.box) : BOX.clone();
    const uniforms = {
      uTime: WORLD_UNIFORMS.uTime, uCenter: { value: o.lift ? new THREE.Vector3() : this.center }, uBox: { value: box },
      uSpeed: { value: o.speed }, uSway: { value: o.sway }, uSize: { value: o.size }, uWindX: { value: 0.6 },
      uWander: { value: o.wander ?? 0 }, uPixel: { value: 800 },
      uColor: { value: new THREE.Color(o.color) }, uColor2: { value: new THREE.Color(o.color2 ?? o.color) },
      uOpacity: { value: o.opacity ?? 1 }, uBlink: { value: o.blink ?? 0 }, uShape: { value: o.shape ?? 0 },
    };
    const points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false, fog: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    points.frustumCulled = false;
    points.visible = false;
    points.userData.lift = o.lift ?? 0;
    this.object.add(points);
    return points;
  }

  /** a: atmosphere(); ambient: 'leaves' | 'petals' | 'fireflies' | 'dust' | null */
  set(a, ambient = null) {
    this.rain.visible = a.rain > 0;
    this.rainUniforms.uSpeed.value = a.rain > 1 ? 19 : 14;
    this.rainUniforms.uWindX.value = a.rain > 1 ? 4 : 1.2;
    this.rainUniforms.uOpacity.value = a.rain > 1 ? 0.42 : 0.3;
    this.rainUniforms.uColor.value.copy(a.horizon).lerp(new THREE.Color('#dfe8f0'), 0.6);
    this.snow.visible = a.snowfall > 0;
    this.lightning = a.lightning;
    if (ambient !== this.ambientKind) {
      if (this.ambient) { this.ambient.removeFromParent(); this.ambient.geometry.dispose(); this.ambient.material.dispose(); }
      this.ambient = AMBIENT[ambient] ? this.makePoints(AMBIENT[ambient].count, AMBIENT[ambient]) : null;
      if (this.ambient) this.ambient.visible = true;
      this.ambientKind = ambient;
    }
  }

  update(dt, camera, focus, pixelHeight = 800) {
    // Rain and snow follow the camera; ambient particles stay around the action.
    camera.getWorldPosition(this.center);
    this.center.y += 2;
    for (const p of [this.snow, this.ambient]) {
      if (!p) continue;
      p.material.uniforms.uPixel.value = pixelHeight;
      if (p.userData.lift && focus) p.material.uniforms.uCenter.value.copy(focus).setY(focus.y + p.userData.lift);
    }
    // Lightning: a bright flicker every few seconds in a storm.
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (this.lightning) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 3 + Math.random() * 6; }
    }
    const f = this.flash;
    return f > 0 ? f * (0.6 + 0.4 * Math.sin(f * 40)) : 0;
  }
}
