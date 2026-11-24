import * as THREE from 'three';

// The body is painted in its shader from each fragment's rest-pose position: first the skin or
// fur (with optional patterns), then clothes on top. Hems are clean lines at any height and
// every look is just a handful of numbers and colors.
//
// spec.outfit = {
//   top: '#e2483c', sleeves: 'none' | 'short' | 'elbow' | 'long', hem: 0.29,
//   bottom: '#2f3640', legs: 'shorts' | 'knee' | 'pants',
//   shoes: '#4766d6',
// }
// spec.fur = {                       // optional patterns over the skin color
//   second: '#f4e1c4',               // belly / chin / back patches
//   third: '#2b2b2b',                // spots / stripes
//   paws: '#4a3f3a',                 // hands and feet (hooves, dark paws)
//   belly: true, chin: true, back: false, spots: false, stripes: false,
// }

const SLEEVES = { none: -1, short: 0.055, elbow: 0.095, long: 0.17 }; // distance along the arm from the shoulder
const LEGS = { shorts: 0.165, knee: 0.12, pants: 0.05 };              // height where the bottom ends
const NECK = 0.53;
const SHOE_TOP = 0.05;

const GLSL = /* glsl */ `
varying vec3 vRest;
uniform vec3 uSkin, uFur2, uFur3, uPawColor, uTop, uBottom, uShoes;
uniform float uHasTop, uHasBottom, uHasShoes, uSleeve, uHem, uLegCut;
uniform float uBelly, uChin, uBack, uSpots, uStripes, uPaws;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

vec3 furColor(vec3 p, bool arm, float t) {
  vec3 c = uSkin;
  if (uBelly > 0.5 && !arm && p.y > 0.2 && p.y < 0.5 && p.z > 0.05) {
    vec2 e = vec2(p.x / 0.088, (p.y - 0.345) / 0.14);
    if (dot(e, e) < 1.0) c = uFur2;
  }
  if (uChin > 0.5 && p.y > 0.555 && p.z > 0.07) {
    vec2 e = vec2(p.x / 0.175, (p.y - 0.6) / 0.105);
    if (dot(e, e) < 1.0) c = uFur2;
  }
  if (uBack > 0.5 && !arm && p.y > 0.24 && p.y < 0.53 && p.z < 0.0) c = uFur2;
  if (uSpots > 0.5) {
    float n = noise3(p * 12.0 + 3.7) * 0.65 + noise3(p * 26.0 + 1.3) * 0.35;
    if (n > 0.6) c = uFur3;
  }
  if (uStripes > 0.5) {
    if (p.y > 0.56) { // head: clean bands over the crown and the back, wavering a little
      float s = sin(p.y * 95.0 + sin(p.x * 16.0) * 1.4);
      if (s > 0.45 && (p.z < 0.06 || p.y > 0.9)) c = uFur3;
    } else {
      float s = sin((p.y + 0.18 * noise3(p * 7.0)) * 72.0);
      if (s > 0.5 && (p.z < 0.03 || arm || p.y < 0.22)) c = uFur3;
    }
  }
  if (uPaws > 0.5 && ((arm && t > 0.158) || p.y < 0.045)) c = uPawColor;
  return c;
}

vec3 outfitColor(vec3 p) {
  float ax = abs(p.x);
  // Arm axis in the rest pose: shoulder (0.115, 0.48) -> wrist (0.262, 0.40).
  vec2 q = vec2(ax, p.y) - vec2(0.115, 0.48);
  vec2 d = normalize(vec2(0.147, -0.08));
  float t = dot(q, d);
  float perp = abs(q.x * d.y - q.y * d.x);
  bool arm = ax > 0.10 && p.y > 0.30 && p.y < 0.56 && t > -0.015 && perp < 0.075;
  vec3 skin = furColor(p, arm, t);
  if (arm) return (uHasTop > 0.5 && t < uSleeve) ? uTop : skin;
  if (uHasShoes > 0.5 && p.y < ${SHOE_TOP.toFixed(3)}) return uShoes;
  if (p.y >= ${NECK.toFixed(3)}) return skin;
  if (p.y >= uHem) return uHasTop > 0.5 ? uTop : skin;
  if (p.y >= uLegCut) return uHasBottom > 0.5 ? uBottom : skin;
  return skin;
}
`;

export function createBodyMaterial() {
  const color = () => ({ value: new THREE.Color() });
  const flag = () => ({ value: 0 });
  const uniforms = {
    uSkin: color(), uFur2: color(), uFur3: color(), uPawColor: color(),
    uTop: color(), uBottom: color(), uShoes: color(),
    uHasTop: flag(), uHasBottom: flag(), uHasShoes: flag(),
    uBelly: flag(), uChin: flag(), uBack: flag(), uSpots: flag(), uStripes: flag(), uPaws: flag(),
    uSleeve: { value: SLEEVES.short },
    uHem: { value: 0.29 },
    uLegCut: { value: LEGS.shorts },
  };
  // A soft velvet sheen gives skin, fur and fabric the gentle, toy-like falloff of the style.
  const material = new THREE.MeshPhysicalMaterial({
    name: 'Skin', roughness: 0.8, metalness: 0, specularIntensity: 0.25,
    sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff),
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( outfitColor(vRest), opacity );')
      // tint the sheen by the painted color so dark fur and saturated cloth keep their color
      .replace('material.sheenColor = sheenColor;', 'material.sheenColor = sheenColor * mix( vec3( 0.35 ), diffuseColor.rgb, 0.75 );');
  };
  material.customProgramCacheKey = () => 'canonical-outfit-5';
  material.userData.outfit = uniforms;
  return material;
}

export function applyOutfit(material, skin, outfit, fur) {
  const u = material.userData.outfit;
  u.uSkin.value.set(skin);
  const o = outfit || {};
  u.uHasTop.value = o.top ? 1 : 0;
  u.uHasBottom.value = o.bottom ? 1 : 0;
  u.uHasShoes.value = o.shoes ? 1 : 0;
  if (o.top) u.uTop.value.set(o.top);
  if (o.bottom) u.uBottom.value.set(o.bottom);
  if (o.shoes) u.uShoes.value.set(o.shoes);
  u.uSleeve.value = SLEEVES[o.sleeves ?? 'short'] ?? SLEEVES.short;
  u.uHem.value = o.hem ?? 0.29;
  u.uLegCut.value = LEGS[o.legs ?? 'shorts'] ?? LEGS.shorts;

  const f = fur || {};
  u.uFur2.value.set(f.second ?? skin);
  u.uFur3.value.set(f.third ?? skin);
  u.uPawColor.value.set(f.paws ?? skin);
  u.uBelly.value = f.belly ? 1 : 0;
  u.uChin.value = f.chin ? 1 : 0;
  u.uBack.value = f.back ? 1 : 0;
  u.uSpots.value = f.spots ? 1 : 0;
  u.uStripes.value = f.stripes ? 1 : 0;
  u.uPaws.value = f.paws ? 1 : 0;
}
