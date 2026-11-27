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
//   second: '#f4e1c4',               // belly, chin, muzzle and back patches
//   third: '#2b2b2b',                // spots and stripes
//   paws: '#4a3f3a',                 // hands and feet (hooves, dark paws)
//   belly: true,                     // a pale oval on the belly
//   chin: true | 'muzzle',           // a pale chin and throat; 'muzzle' adds pale whisker pads
//   back: true,                      // a soft pale saddle on the back (a silverback)
//   spots: true | 'patches',         // round spots on the back and the top of the head, or big patches
//   stripes: true,                   // tabby: forehead lines, bands that wrap the head and the body
// }
//
// Any fur also makes the body read as plush rather than smooth skin: a velvet sheen in the fur's
// own hue and a faint grain, both off for skin (no fur), which renders exactly as it always has.

const SLEEVES = { none: -1, short: 0.055, elbow: 0.095, long: 0.17 }; // distance along the arm from the shoulder
const LEGS = { shorts: 0.165, knee: 0.12, pants: 0.05 };              // height where the bottom ends
const NECK = 0.53;
const SHOE_TOP = 0.05;

// Spots and patches, placed by design on the base mesh's rest pose: [x, y, z, radius]. Each
// patch's outline wobbles a little (a toy's patches are cut by hand), and it never reaches the face.
const MAX_MARKS = 16;
const MARKS = {
  // round spots on the back of the head, the crown, the back, the outer thighs and the arms
  round: {
    wobble: 0.12,
    marks: [
      [0.053, 0.828, -0.207, 0.05], [-0.076, 0.743, -0.204, 0.036], [0.108, 0.699, -0.178, 0.028],
      [-0.076, 0.971, -0.07, 0.034], [0.108, 0.926, -0.123, 0.03], [0.193, 0.785, -0.065, 0.034],
      [-0.185, 0.835, -0.055, 0.042], [-0.035, 0.456, -0.026, 0.034], [0.042, 0.372, -0.036, 0.04],
      [-0.025, 0.296, -0.035, 0.028], [0.106, 0.324, 0.053, 0.024], [-0.089, 0.413, 0.018, 0.026],
      [0.075, 0.173, 0.01, 0.026], [-0.073, 0.124, 0.002, 0.022], [0.193, 0.445, 0.022, 0.022],
      [-0.247, 0.407, 0.025, 0.02],
    ],
  },
  // big patches: one over an ear and the side of the head, the back of the head, the back and
  // the rump, a flank, one from the chest round the side to the other flank, a thigh, a shin and an arm each
  patches: {
    wobble: 0.55,
    marks: [
      [0.168, 0.849, -0.1, 0.085], [0.14, 0.92, -0.06, 0.05], [-0.12, 0.735, -0.175, 0.058],
      [-0.068, 0.983, 0.029, 0.04], [0.038, 0.429, -0.029, 0.066], [0.075, 0.37, -0.01, 0.04],
      [-0.105, 0.314, 0.053, 0.055], [0.07, 0.448, 0.118, 0.04], [0.1, 0.405, 0.095, 0.042], [0.108, 0.352, 0.052, 0.038],
      [-0.05, 0.274, -0.026, 0.045],
      [0.08, 0.161, 0.021, 0.042], [-0.073, 0.074, 0.03, 0.034], [0.206, 0.441, 0.022, 0.038],
      [-0.276, 0.389, 0.022, 0.028],
    ],
  },
};

// Shared by the body and by furred parts (tails): value noise, and the look of fur: a plush pile.
// A faint, fine grain fades out before it is finer than a pixel, and the sheen takes the fur's own
// hue, a little paler and a little tighter than skin's, so the rim glows like velvet, not dust.
const FUR_GLSL = /* glsl */ `
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
// q: position scaled so that one unit is about one tuft of the pile.
float furGrain(vec3 q) {
  float fade = 1.0 - smoothstep(0.25, 0.6, length(fwidth(q)));
  return (noise3(q) * 0.6 + noise3(q * 2.3 + 7.1) * 0.4 - 0.5) * 0.06 * fade;
}
vec3 furSheen(vec3 c) {
  vec3 hue = c / max(max(c.r, c.g), max(c.b, 1e-4));
  return mix(hue, vec3(1.0), 0.3) * 0.45;
}
const float FUR_SHEEN_ROUGHNESS = 0.6;
`;

const GLSL = /* glsl */ `
varying vec3 vRest;
uniform vec3 uSkin, uFur2, uFur3, uPawColor, uTop, uBottom, uShoes;
uniform float uHasTop, uHasBottom, uHasShoes, uSleeve, uHem, uLegCut;
uniform float uBelly, uChin, uBack, uSpots, uStripes, uPaws, uFurry;
uniform vec4 uMarks[${MAX_MARKS}];
uniform float uMarkCount, uMarkWobble;
float furMask = 0.0;   // 1 where the fur shows (not clothes), for the sheen
vec3 cloth(vec3 c) { furMask = 0.0; return c; }
${FUR_GLSL}
// Coverage of a shape from its signed distance d (negative inside): an edge 'soft' wide, in body
// units, plus about a pixel (w) of anti-aliasing. Clean seams have soft = 0.
float cover(float d, float soft, float w) { return 1.0 - smoothstep(-soft - w, soft + w, d); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// Rest-pose landmarks: the head is close to a ball, the torso to an upright cylinder.
const vec3 HEAD_C = vec3(0.0, 0.775, -0.005);
const float TORSO_Z = 0.053;

// Tabby stripes. Every stripe is a band around a centerline with a half-width that tapers to a
// point at its ends, so none stops in a hard line; thinner than a pixel, it fades out.
float band(float dist, float halfWidth, float w) {
  return (1.0 - smoothstep(halfWidth - w, halfWidth + w, dist)) * clamp(halfWidth / w, 0.0, 1.0);
}

float tabbyHead(vec3 p) {
  vec3 q = p - HEAD_C;
  float r = length(q), el = q.y / r;
  float a = abs(atan(q.x, -q.z)) / 3.14159;   // 0 at the back of the head, 1 at the face
  // Bands wrap the back and sides of the head, dip toward the jaw as they come round, and taper
  // away before they reach the face (each ending in its own place) and before the crown.
  // (they curve down toward the nape in the middle of the back, unevenly spaced)
  float s = q.y + 0.03 * a * a + 0.045 * smoothstep(0.3, 0.8, a) * (1.0 - 0.6 * el) + 0.012 * (noise3(p * 9.0) - 0.5)
          + 0.028 * exp(-(q.x * q.x) / 0.007) * (1.0 - smoothstep(0.0, 0.35, a));
  s += 0.011 * sin(s * 41.0 + 1.3);
  float period = 0.088, v = s / period + 0.3, k = floor(v + 0.5);
  float d = abs(v - k) * period;
  float end = 0.6 + 0.07 * sin(k * 2.7);
  float taper = (1.0 - smoothstep(end - 0.22, end, a)) * (1.0 - smoothstep(0.5, 0.78, el)) * smoothstep(-0.8, -0.55, el);
  float w = fwidth(s) * 0.75 + 1e-5;
  float c = band(d, (0.018 + 0.007 * sin(k * 2.3 + 0.5)) * taper, w);
  // Lines from the forehead back over the crown: a long one in the middle and one each side that
  // flares out toward the brows, all pointed at both ends.
  float th = atan(q.z, q.y);                  // 0 on top, +1.57 at the face, -1.57 at the back
  float wx = fwidth(q.x) * 0.75 + 1e-5;
  for (int i = -1; i <= 1; i++) {
    float side = float(i), outer = abs(side);
    float x0 = side * (0.034 + 0.026 * smoothstep(0.35, 1.05, th));
    float front = 1.16 - 0.12 * outer, back = -0.75 + 0.25 * outer;
    float t = clamp((th - back) / (front - back), 0.0, 1.0);
    float hw = (0.016 - 0.003 * outer) * sqrt(sin(3.14159 * pow(t, 1.6))) * step(back, th) * step(th, front);
    c = max(c, band(abs(q.x - x0), hw, wx));
  }
  return c;
}

float tabbyBody(vec3 p, bool arm, float t, float perp) {
  // Torso: bands that start at the spine and sweep down around the sides, each tapering to a
  // point (in its own place) before the belly.
  float phi = atan(p.x, -(p.z - TORSO_Z)), a = abs(phi) / 3.14159;
  float s = p.y + 0.06 * a + 0.01 * (noise3(p * 11.0) - 0.5);
  float period = 0.07, v = s / period, k = floor(v + 0.5);
  float d = abs(v - k) * period;
  float end = 0.53 + 0.05 * sin(k * 3.1);
  // (they thin out before the neck and the hips, where the head's and the legs' own take over)
  float taper = (1.0 - smoothstep(end - 0.22, end, a)) * (1.0 - smoothstep(0.49, 0.545, p.y)) * smoothstep(0.215, 0.25, p.y);
  float w = fwidth(s) * 0.75 + 1e-5;
  float torso = band(d, (0.016 + 0.003 * sin(k * 2.3)) * taper, w);
  // Arms: bars across the outer (upper) side, fading round to the inside and before the paws.
  float va = t / 0.042 + 0.2, ka = floor(va + 0.5), da = abs(va - ka) * 0.042;
  float armTaper = (1.0 - smoothstep(-0.005, 0.03, perp)) * smoothstep(0.01, 0.03, t) * (1.0 - smoothstep(0.13, 0.15, t));
  float armC = band(da, 0.011 * armTaper, fwidth(t) * 0.75 + 1e-5);
  // Legs: bars on the back and the outer side of each leg.
  float pl = atan(abs(p.x) - 0.05, -(p.z - 0.025));      // 0 behind the leg, + outside, - inside
  float vl = p.y / 0.05 + 0.4, kl = floor(vl + 0.5), dl = abs(vl - kl) * 0.05;
  float legTaper = smoothstep(-1.4, -0.6, pl) * (1.0 - smoothstep(1.9, 2.5, pl)) * smoothstep(0.035, 0.06, p.y) * (1.0 - smoothstep(0.185, 0.215, p.y));
  float legC = band(dl, 0.012 * legTaper, fwidth(p.y) * 0.75 + 1e-5);
  if (arm) return armC;
  if (p.y < 0.215) return legC;
  return torso;
}

vec3 furColor(vec3 p, bool arm, float t, float perp) {
  vec3 c = uSkin;
  if (uBelly > 0.5) {
    vec2 e = vec2(p.x / 0.088, (p.y - 0.345) / 0.14);
    float d = max((length(e) - 1.0) * 0.1, 0.06 - p.z);
    float w = fwidth(d) * 0.75 + 1e-5;
    if (!arm) c = mix(c, uFur2, cover(d, 0.004, w));
  }
  if (uChin > 0.5) {
    // A pale chin and throat that runs down into the chest (and the belly, if pale). 'muzzle'
    // has a smaller chin and two whisker pads under the nose, the fur's color down the bridge
    // between them. All are rounded shapes on the front, so no edge runs straight down the side.
    bool muzzle = uChin > 1.5;
    vec3 r = muzzle ? vec3(0.1, 0.07, 0.1) : vec3(0.155, 0.09, 0.13);
    float d = (length((p - vec3(0.0, muzzle ? 0.615 : 0.605, 0.165)) / r) - 1.0) * 0.08;
    vec3 ta = p - vec3(0.0, 0.6, 0.115), tb = vec3(0.0, -0.16, 0.015);
    d = smin(d, length(ta - tb * clamp(dot(ta, tb) / dot(tb, tb), 0.0, 1.0)) - 0.05, 0.03);
    if (muzzle) {
      float pads = (length((vec3(abs(p.x), p.y, p.z) - vec3(0.042, 0.664, 0.2)) / vec3(0.068, 0.047, 0.06)) - 1.0) * 0.05;
      d = smin(d, pads, 0.015);
    }
    d += 0.003 * (noise3(p * vec3(70.0, 28.0, 70.0)) - 0.5);
    float w = fwidth(d) * 0.75 + 1e-5;
    if (!arm) c = mix(c, uFur2, cover(d, 0.005, w));
  }
  if (uBack > 0.5) {
    // A silver saddle over the lower back: a rounded shield, broader at its top, with a soft, clean
    // edge (about 1.5 cm) and a slightly lighter middle.
    float phi = atan(p.x, -(p.z - TORSO_Z));     // 0 at the spine
    vec2 e = vec2(phi / (0.78 + 0.22 * smoothstep(0.27, 0.44, p.y)), (p.y - 0.352) / 0.112);
    float d = (pow(pow(abs(e.x), 2.6) + pow(abs(e.y), 2.6), 1.0 / 2.6) - 1.0) * 0.095;
    float w = fwidth(d) * 0.75 + 1e-5;
    if (!arm) c = mix(c, uFur2, cover(d, 0.0075, w) * (0.84 + 0.16 * cover(d + 0.03, 0.025, w)));
  }
  if (uSpots > 0.5) {
    float wob = noise3(p * 11.0) - 0.5 + 0.6 * (noise3(p * 26.0 + 4.1) - 0.5), d = 1.0;
    for (int i = 0; i < ${MAX_MARKS}; i++) {
      if (float(i) >= uMarkCount) break;
      vec4 m = uMarks[i];
      d = min(d, length(p - m.xyz) - m.w * (1.0 + uMarkWobble * wob));
    }
    float w = fwidth(d) * 0.75 + 1e-5;
    c = mix(c, uFur3, cover(d, 0.0005, w));
  }
  if (uStripes > 0.5) {
    float head = tabbyHead(p), body = tabbyBody(p, arm, t, perp);
    c = mix(c, uFur3, p.y > 0.56 && !arm ? head : body);
  }
  if (uPaws > 0.5 && ((arm && t > 0.158) || p.y < 0.045)) c = uPawColor;
  if (uFurry > 0.5) c *= 1.0 + furGrain(p * 260.0);
  return c;
}

vec3 outfitColor(vec3 p) {
  float ax = abs(p.x);
  // Arm axis in the rest pose: shoulder (0.115, 0.48) -> wrist (0.262, 0.40).
  vec2 q = vec2(ax, p.y) - vec2(0.115, 0.48);
  vec2 d = normalize(vec2(0.147, -0.08));
  float t = dot(q, d);
  float side = q.x * d.y - q.y * d.x;   // + below the arm's axis, - above
  float perp = abs(side);
  bool arm = ax > 0.10 && p.y > 0.30 && p.y < 0.56 && t > -0.015 && perp < 0.075;
  vec3 skin = furColor(p, arm, t, side);
  furMask = 1.0;
  if (arm) return (uHasTop > 0.5 && t < uSleeve) ? cloth(uTop) : skin;
  if (uHasShoes > 0.5 && p.y < ${SHOE_TOP.toFixed(3)}) return cloth(uShoes);
  if (p.y >= ${NECK.toFixed(3)}) return skin;
  if (p.y >= uHem) return uHasTop > 0.5 ? cloth(uTop) : skin;
  if (p.y >= uLegCut) return uHasBottom > 0.5 ? cloth(uBottom) : skin;
  return skin;
}
`;

// The body's (and furred parts') response: matte, with a soft velvet sheen.
const LOOK = { roughness: 0.8, metalness: 0, specularIntensity: 0.25, sheen: 0.35, sheenRoughness: 0.8 };

// The sheen is set in an #include, so the chunk is expanded here to reach it. Skin and clothes keep
// the plain white sheen; fur takes the fur's own hue (where \`amount\` is 1).
const sheenChunk = (furry, amount) => THREE.ShaderChunk.lights_physical_fragment
  .replace('material.sheenColor = sheenColor;',
    `material.sheenColor = sheenColor;\nif ( ${furry} ) material.sheenColor = mix( sheenColor, furSheen( diffuseColor.rgb ), ${amount} );`)
  .replace('material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );',
    `material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );\nif ( ${furry} ) material.sheenRoughness = mix( material.sheenRoughness, FUR_SHEEN_ROUGHNESS, ${amount} );`);

export function createBodyMaterial() {
  const color = () => ({ value: new THREE.Color() });
  const flag = () => ({ value: 0 });
  const uniforms = {
    uSkin: color(), uFur2: color(), uFur3: color(), uPawColor: color(),
    uTop: color(), uBottom: color(), uShoes: color(),
    uHasTop: flag(), uHasBottom: flag(), uHasShoes: flag(),
    uBelly: flag(), uChin: flag(), uBack: flag(), uSpots: flag(), uStripes: flag(), uPaws: flag(), uFurry: flag(),
    uMarks: { value: Array.from({ length: MAX_MARKS }, () => new THREE.Vector4()) },
    uMarkCount: flag(), uMarkWobble: flag(),
    uSleeve: { value: SLEEVES.short },
    uHem: { value: 0.29 },
    uLegCut: { value: LEGS.shorts },
  };
  // A soft velvet sheen gives skin, fur and fabric the gentle, toy-like falloff of the style.
  const material = new THREE.MeshPhysicalMaterial({ name: 'Skin', ...LOOK, sheenColor: new THREE.Color(0xffffff) });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( outfitColor(vRest), opacity );')
      .replace('#include <lights_physical_fragment>', sheenChunk('uFurry > 0.5', 'furMask'));
  };
  material.customProgramCacheKey = () => 'canonical-outfit-8';
  material.userData.outfit = uniforms;
  return material;
}

/**
 * Give a part's physical material the furred body's coat, from its onBeforeCompile: the sheen in
 * the fur's own hue and the faint grain, over the part's own positions (Head or Tail space, the
 * body's scale). Furred tails, ears and the parts that grow out of the head (snouts, the brow
 * ridge, eye domes) use it, so they shade like the coat they grow from.
 */
export function furCoat(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFur;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFur = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vFur;\n${FUR_GLSL}`)
    .replace('#include <lights_physical_fragment>', `diffuseColor.rgb *= 1.0 + furGrain(vFur * 260.0);\n${sheenChunk('true', '1.0')}`);
}

/**
 * A material for furred parts (tails) that matches a furred body: the same response, sheen and
 * grain. `map` carries the colors and markings; one shader program for every such part.
 */
export function createFurMaterial(map) {
  const material = new THREE.MeshPhysicalMaterial({ name: 'Fur', ...LOOK, map, sheenColor: new THREE.Color(0xffffff) });
  material.onBeforeCompile = furCoat;
  material.customProgramCacheKey = () => 'fur-part-2';
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
  u.uChin.value = f.chin === 'muzzle' ? 2 : f.chin ? 1 : 0;
  u.uBack.value = f.back ? 1 : 0;
  u.uSpots.value = f.spots ? 1 : 0;
  u.uStripes.value = f.stripes ? 1 : 0;
  u.uPaws.value = f.paws ? 1 : 0;
  u.uFurry.value = fur ? 1 : 0;
  const set = MARKS[f.spots] ?? MARKS.round;
  set.marks.forEach((m, i) => u.uMarks.value[i].set(...m));
  u.uMarkCount.value = set.marks.length;
  u.uMarkWobble.value = set.wobble;
}
