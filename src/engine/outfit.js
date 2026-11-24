import * as THREE from 'three';

// Clothes are painted in the body shader from each fragment's rest-pose position, so hems are
// clean lines at any height and every outfit is just a handful of numbers and colors.
//
// spec.outfit = {
//   top: '#e2483c', sleeves: 'none' | 'short' | 'elbow' | 'long', hem: 0.29,
//   bottom: '#2f3640', legs: 'shorts' | 'knee' | 'pants',
//   shoes: '#4766d6',
// }

const SLEEVES = { none: -1, short: 0.055, elbow: 0.095, long: 0.17 }; // distance along the arm from the shoulder
const LEGS = { shorts: 0.165, knee: 0.12, pants: 0.05 };              // height where the bottom ends
const NECK = 0.53;
const SHOE_TOP = 0.05;

const GLSL = /* glsl */ `
varying vec3 vRest;
uniform vec3 uSkin, uTop, uBottom, uShoes;
uniform float uHasTop, uHasBottom, uHasShoes, uSleeve, uHem, uLegCut;

vec3 outfitColor(vec3 p) {
  float ax = abs(p.x);
  // Arm axis in the rest pose: shoulder (0.115, 0.48) -> wrist (0.262, 0.40).
  vec2 q = vec2(ax, p.y) - vec2(0.115, 0.48);
  vec2 d = normalize(vec2(0.147, -0.08));
  float t = dot(q, d);
  float perp = abs(q.x * d.y - q.y * d.x);
  bool arm = ax > 0.10 && p.y > 0.30 && p.y < 0.56 && t > -0.015 && perp < 0.075;
  if (arm) return (uHasTop > 0.5 && t < uSleeve) ? uTop : uSkin;
  if (uHasShoes > 0.5 && p.y < ${SHOE_TOP.toFixed(3)}) return uShoes;
  if (p.y >= ${NECK.toFixed(3)}) return uSkin;
  if (p.y >= uHem) return uHasTop > 0.5 ? uTop : uSkin;
  if (p.y >= uLegCut) return uHasBottom > 0.5 ? uBottom : uSkin;
  return uSkin;
}
`;

export function createBodyMaterial() {
  const uniforms = {
    uSkin: { value: new THREE.Color() },
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uShoes: { value: new THREE.Color() },
    uHasTop: { value: 0 },
    uHasBottom: { value: 0 },
    uHasShoes: { value: 0 },
    uSleeve: { value: SLEEVES.short },
    uHem: { value: 0.29 },
    uLegCut: { value: LEGS.shorts },
  };
  const material = new THREE.MeshStandardMaterial({ name: 'Skin', roughness: 0.85, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( outfitColor(vRest), opacity );');
  };
  material.customProgramCacheKey = () => 'canonical-outfit-1';
  material.userData.outfit = uniforms;
  return material;
}

export function applyOutfit(material, skin, outfit) {
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
}
