import * as THREE from 'three';

/**
 * Sky, sun, moon and the time-of-day palette.
 *
 * `atmosphere({ hour, weather, season, day })` turns a moment into everything the stage needs:
 * sky colors, key light direction / color / intensity, ambient, fog, wetness, snow, glow.
 */

const HOURS = [
  // h: hour; zenith/horizon: sky; sun: key light color; light: key intensity;
  // sky/ground: hemisphere colors; ambient: hemisphere intensity; glow: windows and lamps (0 day, 1 night)
  { h: 0, zenith: '#0b1233', horizon: '#22305a', sun: '#a9bcff', light: 0.6, sky: '#5068a8', ground: '#222a3e', ambient: 0.95, glow: 1, exposure: 1.32 },
  { h: 4.7, zenith: '#111c45', horizon: '#2a3a66', sun: '#a9bcff', light: 0.55, sky: '#5068a8', ground: '#222a3e', ambient: 0.95, glow: 1, exposure: 1.32 },
  { h: 5.6, zenith: '#3d4f8c', horizon: '#f1a98d', sun: '#ffb27e', light: 0.8, sky: '#8f93bd', ground: '#4c4139', ambient: 0.7, glow: 0.7, exposure: 1.12 },
  { h: 6.6, zenith: '#6c97d8', horizon: '#ffd7ab', sun: '#ffd4a4', light: 1.9, sky: '#bccbe9', ground: '#6b5b49', ambient: 0.8, glow: 0.12, exposure: 1.02 },
  { h: 8.5, zenith: '#5b9de7', horizon: '#d3eaf7', sun: '#fff1db', light: 2.7, sky: '#d0e1f6', ground: '#7b6d59', ambient: 0.85, glow: 0, exposure: 1 },
  { h: 12, zenith: '#4b93eb', horizon: '#d8edf9', sun: '#fff8ee', light: 3.0, sky: '#d9e9f9', ground: '#807461', ambient: 0.9, glow: 0, exposure: 1 },
  { h: 15.5, zenith: '#5392e3', horizon: '#e4eee0', sun: '#fff0d6', light: 2.8, sky: '#d6e4f3', ground: '#7b6d59', ambient: 0.85, glow: 0, exposure: 1 },
  { h: 17.3, zenith: '#6b88cd', horizon: '#ffca96', sun: '#ffbe7a', light: 2.2, sky: '#d9c9c9', ground: '#6b5141', ambient: 0.78, glow: 0.1, exposure: 1.02 },
  { h: 18.4, zenith: '#4c5b9d', horizon: '#ff9667', sun: '#ff8f5a', light: 1.2, sky: '#b49bb1', ground: '#4b3b39', ambient: 0.7, glow: 0.55, exposure: 1.08 },
  { h: 19.3, zenith: '#263066', horizon: '#7e5b82', sun: '#a78dc2', light: 0.5, sky: '#6b6b9b', ground: '#2b2b39', ambient: 0.7, glow: 0.92, exposure: 1.18 },
  { h: 20.6, zenith: '#121b42', horizon: '#28355e', sun: '#a9bcff', light: 0.58, sky: '#5068a8', ground: '#222a3e', ambient: 0.95, glow: 1, exposure: 1.32 },
  { h: 24, zenith: '#0b1233', horizon: '#22305a', sun: '#a9bcff', light: 0.6, sky: '#5068a8', ground: '#222a3e', ambient: 0.95, glow: 1, exposure: 1.32 },
];

/** Weather presets. `grey` pulls the sky toward overcast grey, `dim` scales the key light. */
export const WEATHERS = {
  clear: { label: 'Clear', cloud: 0.22, dim: 1, grey: 0, fog: [60, 260] },
  cloudy: { label: 'Cloudy', cloud: 0.55, dim: 0.75, grey: 0.15, fog: [50, 220] },
  overcast: { label: 'Overcast', cloud: 0.9, dim: 0.32, grey: 0.6, fog: [36, 170] },
  rain: { label: 'Rain', cloud: 0.95, dim: 0.26, grey: 0.72, fog: [22, 120], wet: 1, rain: 1, wind: 0.55 },
  storm: { label: 'Storm', cloud: 1, dim: 0.16, grey: 0.86, fog: [16, 85], wet: 1, rain: 2, wind: 1, lightning: true, darken: 0.55 },
  snow: { label: 'Snowfall', cloud: 0.88, dim: 0.42, grey: 0.55, fog: [18, 95], snowfall: 1, snow: 0.85, wind: 0.25 },
  fog: { label: 'Fog', cloud: 0.6, dim: 0.45, grey: 0.62, fog: [2, 34], wind: 0.1 },
};

export const SEASON_OF_MONTH = (m) => (m == null ? null : ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][((m - 1) % 12 + 12) % 12]);

const C = (hex) => new THREE.Color(hex);
const lerpColor = (a, b, t) => C(a).lerp(C(b), t);

function samplePalette(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < HOURS.length - 2 && HOURS[i + 1].h <= h) i++;
  const a = HOURS[i], b = HOURS[i + 1];
  const t = THREE.MathUtils.smoothstep(h, a.h, b.h);
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 'h') continue;
    out[k] = typeof a[k] === 'string' ? lerpColor(a[k], b[k], t) : a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

const RISE = 6.0, SET = 18.7;

/** Sun direction (toward the sun): rises east (+X), noon to the south (+Z), sets west (-X). */
export function sunDirection(hour, season = 'summer') {
  const peak = { spring: 58, summer: 66, autumn: 50, winter: 36 }[season] ?? 58;
  const f = (hour - RISE) / (SET - RISE);
  const az = Math.PI * f;
  const el = Math.sin(Math.PI * THREE.MathUtils.clamp(f, 0, 1)) * THREE.MathUtils.degToRad(peak) - (f < 0 || f > 1 ? 0.2 : 0);
  return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.85 + 0.15).normalize();
}

/** Moon direction: crosses the sky through the night, a little to the south. */
export function moonDirection(hour) {
  const night = 24 - (SET - RISE);
  const f = (((hour - SET) % 24) + 24) % 24 / night;
  const az = Math.PI * f;
  const el = Math.sin(Math.PI * THREE.MathUtils.clamp(f, 0, 1)) * THREE.MathUtils.degToRad(48);
  return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.7 + 0.3).normalize();
}

/**
 * Everything the stage needs for a moment. `day` (1-30) sets the moon phase.
 * Returns plain values: colors are THREE.Color in linear space.
 */
export function atmosphere({ hour = 12, weather = 'clear', season = 'summer', day = 15 } = {}) {
  const w = WEATHERS[weather] ?? WEATHERS.clear;
  const p = samplePalette(hour);
  const sun = sunDirection(hour, season);
  const moon = moonDirection(hour);

  // The key light follows the sun by day and the moon by night, blending across dusk and dawn.
  const sunUp = THREE.MathUtils.smoothstep(sun.y, -0.04, 0.12);
  const keyDir = new THREE.Vector3().copy(moon).lerp(sun.clone().setY(Math.max(sun.y, 0.14)).normalize(), sunUp).normalize();
  if (keyDir.y < 0.16) keyDir.setY(0.16).normalize(); // never skim the ground: shadows stay readable

  const grey = w.grey ?? 0;
  const darken = w.darken ?? 0;
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const toGrey = (c, amount, tint = C('#b4bcc4')) => {
    const g = tint.clone().multiplyScalar(Math.max(lum(c) / lum(tint), 0.02) * 0.95);
    return c.clone().lerp(g, amount).multiplyScalar(1 - darken * 0.6);
  };
  const zenith = toGrey(p.zenith, grey * 0.9);
  const horizon = toGrey(p.horizon, grey);
  const fogColor = horizon.clone().lerp(zenith, 0.12);
  const glowOutside = THREE.MathUtils.clamp(p.glow + grey * 0.35 * (1 - p.glow), 0, 1);

  return {
    hour, weather, season, day,
    zenith, horizon, ground: p.ground.clone().multiplyScalar(0.8),
    sunDir: sun, moonDir: moon, keyDir,
    sunVisible: THREE.MathUtils.smoothstep(sun.y, -0.06, 0.05) * (1 - grey * 0.95),
    moonVisible: (1 - sunUp) * (1 - grey * 0.9) * THREE.MathUtils.smoothstep(moon.y, -0.05, 0.1),
    stars: THREE.MathUtils.clamp(p.glow * 1.1 - 0.1, 0, 1) * (1 - grey),
    moonPhase: ((day ?? 15) % 30) / 30,
    keyColor: toGrey(p.sun, grey * 0.6),
    keyIntensity: p.light * w.dim,
    shadowSoftness: grey,
    hemiSky: toGrey(p.sky, grey * 0.8),
    hemiGround: p.ground.clone(),
    hemiIntensity: p.ambient * (1 + grey * 0.25) * (1 - darken * 0.35),
    fogColor,
    fogNear: w.fog[0],
    fogFar: w.fog[1],
    cloud: w.cloud,
    cloudGrey: grey,
    exposure: p.exposure,
    glow: glowOutside,
    wet: w.wet ?? 0,
    snow: Math.max(season === 'winter' ? 1 : 0, w.snow ?? 0),
    wind: w.wind ?? 0.22,
    rain: w.rain ?? 0,
    snowfall: w.snowfall ?? 0,
    lightning: !!w.lightning,
    mist: weather === 'fog',
  };
}

/* ───────────────────────── sky dome ───────────────────────── */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uStars;
uniform float uCloud;
uniform float uCloudGrey;
uniform float uTime;
uniform float uFlash;
uniform float uMoonPhase;
uniform float uNight;
varying vec3 vDir;

float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise2(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uHorizon * 1.04, exp(-max(h, 0.0) * 14.0) * 0.4);
  col = mix(col, uGround, (1.0 - smoothstep(-0.18, 0.0, h)));

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uSunVis * (0.22 * pow(sd, 5.0) + 0.45 * pow(sd, 40.0));
  col = mix(col, uSunColor * 2.6 + vec3(0.5), uSunVis * smoothstep(0.99935, 0.9997, sd));

  if (uStars > 0.001 && h > 0.0) {
    vec3 p = d * 170.0;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float r = hash3(id);
    if (r > 0.972) {
      vec3 o = vec3(hash3(id + 3.1), hash3(id + 7.7), hash3(id + 1.3)) - 0.5;
      float tw = 0.55 + 0.45 * sin(uTime * (1.2 + r * 3.0) + r * 60.0);
      float s = (1.0 - smoothstep(0.0, 0.16, length(f - o * 0.5))) * tw * (r > 0.993 ? 1.6 : 0.8);
      col += vec3(0.88, 0.92, 1.0) * s * uStars * smoothstep(0.02, 0.3, h);
    }
  }

  if (uMoonVis > 0.001) {
    float md = dot(d, uMoonDir);
    col += vec3(0.6, 0.68, 0.95) * uMoonVis * (0.08 * pow(max(md, 0.0), 12.0) + 0.18 * pow(max(md, 0.0), 120.0));
    float R = 0.03;
    vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, uMoonDir);
    vec3 off = d - uMoonDir * md;
    vec2 q = vec2(dot(off, right), dot(off, up)) / R;
    float r2 = dot(q, q);
    if (md > 0.0 && r2 < 1.0) {
      float z = sqrt(1.0 - r2);
      float ph = uMoonPhase * 6.2831853;
      vec3 L = vec3(sin(ph), 0.0, -cos(ph));
      float lit = smoothstep(-0.05, 0.12, dot(vec3(q, z), L));
      float crater = 0.88 + 0.12 * noise2(q * 3.0 + 2.0);
      vec3 moonCol = mix(uZenith * 1.6 + vec3(0.03), vec3(0.98, 0.96, 0.88) * crater, max(lit, 0.06));
      col = mix(col, moonCol, uMoonVis * (1.0 - smoothstep(0.86, 1.0, r2)));
    }
  }

  if (uCloud > 0.001 && h > -0.02) {
    float hh = max(h, 0.0);
    vec2 uv = d.xz / (hh + 0.16) * 0.7 + vec2(uTime * 0.0045, uTime * 0.0018);
    float n = fbm(uv * 1.25);
    float th = mix(0.74, 0.3, uCloud);
    float dens = smoothstep(th, th + 0.07 + uCloudGrey * 0.3, n) * smoothstep(-0.02, 0.18, h);
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.08;
    float shadow = smoothstep(th - 0.02, th + 0.3, fbm(uv * 1.25 + toSun));
    float day = 1.0 - uNight;
    vec3 lit = mix(vec3(1.0), uSunColor, 0.3) * mix(0.25, 1.0, day) + uHorizon * 0.15;
    vec3 dark = mix(uZenith, uHorizon, 0.5) * mix(0.75, 0.9, uCloudGrey) + vec3(0.05) * day;
    vec3 cloudCol = mix(lit, dark, clamp(shadow * 0.75 + uCloudGrey * 0.55, 0.0, 1.0));
    cloudCol = mix(cloudCol, uHorizon, (1.0 - smoothstep(0.0, 0.25, h)) * 0.6);
    col = mix(col, cloudCol, dens * mix(0.92, 0.98, uCloudGrey));
  }

  col += vec3(0.75, 0.8, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunVis: { value: 1 },
      uMoonVis: { value: 0 },
      uStars: { value: 0 },
      uCloud: { value: 0.3 },
      uCloudGrey: { value: 0 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uMoonPhase: { value: 0.5 },
      uNight: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'sky', uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  set(a) {
    const u = this.uniforms;
    u.uZenith.value.copy(a.zenith);
    u.uHorizon.value.copy(a.horizon);
    u.uGround.value.copy(a.ground);
    u.uSunDir.value.copy(a.sunDir);
    u.uSunColor.value.copy(a.keyColor).lerp(new THREE.Color(1, 0.9, 0.75), 0.25);
    u.uMoonDir.value.copy(a.moonDir);
    u.uSunVis.value = a.sunVisible;
    u.uMoonVis.value = a.moonVisible;
    u.uStars.value = a.stars;
    u.uCloud.value = a.cloud;
    u.uCloudGrey.value = a.cloudGrey;
    u.uMoonPhase.value = a.moonPhase;
    u.uNight.value = a.glow;
  }

  /** A small copy of the dome for baking the environment light. */
  makeEnvironmentScene() {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.material);
    scene.add(mesh);
    return scene;
  }
}
