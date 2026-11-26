import * as THREE from 'three';
import { loadGLTF } from './loader.js';

// Hair styles built by tools/build_hair.py. Each mesh is in Head-bone space, so it is simply
// parented to the Head bone and follows every head movement. The meshes are sculpted in locks
// and carry flow UVs (u across the strands, v along them) and baked occlusion (COLOR_0).
export const HAIR_STYLES = [
  { id: 'spiky', label: 'Spiky' },
  { id: 'bob', label: 'Bob' },
  { id: 'swept', label: 'Side part' },
  { id: 'pigtails', label: 'Pigtails' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'bun', label: 'Top bun' },
  { id: 'long', label: 'Long' },
];

export const HAIR_COLORS = [
  { id: 'brown', label: 'Brown', value: '#4a2f22' },
  { id: 'black', label: 'Black', value: '#1f1b1a' },
  { id: 'chestnut', label: 'Chestnut', value: '#7a4a2c' },
  { id: 'blonde', label: 'Blonde', value: '#e0b45c' },
  { id: 'ginger', label: 'Ginger', value: '#d4692e' },
  { id: 'pink', label: 'Pink', value: '#f29ab2' },
  { id: 'blue', label: 'Blue', value: '#4d7cc9' },
  { id: 'gray', label: 'Gray', value: '#c8c3ba' },
  { id: 'white', label: 'White', value: '#ece7df' },
  { id: 'auburn', label: 'Auburn', value: '#8a3b22' },
  { id: 'green', label: 'Green', value: '#5aa56a' },
  { id: 'purple', label: 'Purple', value: '#8a5cc2' },
];

const cache = new Map();

export function loadHairGeometry(style) {
  if (!cache.has(style)) {
    const url = new URL(`../../assets/characters/canonical/hair/${style}.gltf`, import.meta.url).href;
    cache.set(style, loadGLTF(url).then((gltf) => {
      let geometry = null;
      gltf.scene.traverse((obj) => { if (obj.isMesh && !geometry) geometry = obj.geometry; });
      if (geometry && !geometry.getAttribute('color')) {   // no baked shading: plain, full strands
        const n = geometry.getAttribute('position').count;
        geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(n * 4).fill(255), 4, true));
      }
      return geometry;
    }));
  }
  return cache.get(style);
}

// ---------------------------------------------------------------------------------------------
// Strand textures: a tile of fine strands running along v, drawn once and shared by every
// character. One tile covers 0.24 x 0.48 world units of hair (TILE_U, TILE_V in build_hair.py).
// ---------------------------------------------------------------------------------------------
const SIZE = 512;
let strandTextures = null;

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a `cells` x `cells` lattice, sampled at (x, y) in [0, 1). */
function noiseField(cells, random) {
  const lattice = Float32Array.from({ length: cells * cells }, random);
  return (x, y) => {
    const fx = x * cells, fy = y * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % cells) + cells) % cells, x1 = (x0 + 1) % cells;
    const y0 = ((iy % cells) + cells) % cells, y1 = (y0 + 1) % cells;
    const a = lattice[y0 * cells + x0], b = lattice[y0 * cells + x1];
    const c = lattice[y1 * cells + x0], d = lattice[y1 * cells + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

/**
 * One layer of strands: `count` strands of uneven widths across x, gently wavy along y.
 * Returns fill(y, h, groove, shade), which writes one row: strand height, how deep in the
 * groove between strands, and the strand's own shade (-1..1).
 */
function strandLayer(count, random, wave) {
  const widths = Array.from({ length: count }, () => 0.5 + random());
  const total = widths.reduce((a, b) => a + b, 0);
  const edges = new Float64Array(count + 1);
  widths.forEach((w, i) => { edges[i + 1] = edges[i] + w / total; });
  const strands = widths.map(() => ({
    amp: 0.3 + 0.7 * random(), shade: random() * 2 - 1,
    k: 1 + Math.floor(random() * 3), phase: random() * Math.PI * 2,
  }));
  const ph = [random() * Math.PI * 2, random() * Math.PI * 2];
  const cosX = new Float64Array(SIZE), sinX = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) { const b = 6 * Math.PI * (i + 0.5) / SIZE; cosX[i] = Math.cos(b); sinX[i] = Math.sin(b); }
  const along = new Float64Array(count);
  return (y, h, groove, shade) => {
    const shift = wave * Math.sin(4 * Math.PI * y + ph[0]);
    const a = 10 * Math.PI * y + ph[1], sa = 0.6 * wave * Math.sin(a), ca = 0.6 * wave * Math.cos(a);
    // strands come and go along their length
    strands.forEach((s, k) => { along[k] = s.amp * (0.55 + 0.45 * Math.sin(2 * Math.PI * s.k * y + s.phase)); });
    for (let i = 0; i < SIZE; i++) {
      let p = (i + 0.5) / SIZE + shift + sa * cosX[i] + ca * sinX[i];   // shift + 0.6 wave sin(2pi(5y + 3x) + ph1)
      p -= Math.floor(p);
      let lo = 0, hi = count;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (edges[mid] <= p) lo = mid; else hi = mid; }
      const f = 2 * (p - edges[lo]) / (edges[lo + 1] - edges[lo]) - 1;
      const round = Math.sqrt(Math.max(0, 1 - f * f));
      h[i] = round * along[lo]; groove[i] = (1 - round) * along[lo]; shade[i] = strands[lo].shade;
    }
  };
}

function strandMaps() {
  if (strandTextures) return strandTextures;
  const random = rand(20240611);
  const layers = [strandLayer(10, random, 0.008), strandLayer(34, random, 0.005), strandLayer(90, random, 0.003)];
  const felt = noiseField(96, random), felt2 = noiseField(40, random), clump = noiseField(6, random);
  const row = () => [new Float64Array(SIZE), new Float64Array(SIZE), new Float64Array(SIZE)];
  const [A, B, C] = [row(), row(), row()];
  const height = new Float32Array(SIZE * SIZE);
  const shade = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j++) {
    const y = (j + 0.5) / SIZE;
    layers[0](y, ...A); layers[1](y, ...B); layers[2](y, ...C);
    for (let i = 0; i < SIZE; i++) {
      const x = (i + 0.5) / SIZE;
      const micro = felt(x, y) * 0.6 + felt2(x, y) * 0.4;      // a fine felted grain
      height[j * SIZE + i] = A[0][i] * 0.45 + B[0][i] * 0.4 + C[0][i] * 0.15 + micro * 0.12;
      shade[j * SIZE + i] = 0.975 - 0.11 * A[1][i] ** 2 - 0.18 * B[1][i] ** 2.5 - 0.08 * C[1][i] ** 3
        + 0.03 * B[2][i] + 0.05 * (clump(x, y) - 0.5) + 0.03 * (micro - 0.5);
    }
  }
  const canvas = (fill) => {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    const img = g.createImageData(SIZE, SIZE);
    fill(img.data);
    g.putImageData(img, 0, 0);
    return c;
  };
  const at = (i, j) => height[((j + SIZE) % SIZE) * SIZE + ((i + SIZE) % SIZE)];
  const strength = 2.0;
  const normal = canvas((px) => {
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
      // Canvas rows run down while v runs up (flipY), hence the sign on dy.
      const dx = (at(i + 1, j) - at(i - 1, j)) * 0.5 * strength;
      const dy = (at(i, j - 1) - at(i, j + 1)) * 0.5 * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (j * SIZE + i) * 4;
      px[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      px[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      px[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      px[o + 3] = 255;
    }
  });
  const albedo = canvas((px) => {
    for (let k = 0; k < SIZE * SIZE; k++) {
      const v = Math.round(Math.min(1, Math.max(0, shade[k])) * 255);
      px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = v;
      px[k * 4 + 3] = 255;
    }
  });
  const texture = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;   // plain numbers: a normal, and a multiplier on the color
    t.anisotropy = 8;                    // clamped to what the GPU supports
    return t;
  };
  strandTextures = { normal: texture(normal), albedo: texture(albedo) };
  return strandTextures;
}

/**
 * The hair material: matte and soft, like sculpted clay. Light rolls off gently and the sheen
 * is a faint, broad tint of the hair color. Fine strand grooves come from the shared strand
 * textures; the mesh's baked occlusion (COLOR_0 rgb) darkens creases, undersides and the
 * hairline, and COLOR_0 alpha fades the strands out where they converge.
 */
export function createHairMaterial() {
  const { normal, albedo } = strandMaps();
  const material = new THREE.MeshPhysicalMaterial({
    name: 'Hair', roughness: 0.78, metalness: 0, specularIntensity: 0.32,
    sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x000000),
    map: albedo, normalMap: normal, normalScale: new THREE.Vector2(0.85, 0.85),
  });
  material.onBeforeCompile = (shader) => {
    // Chunks are still #include lines here: expand the ones patched inside.
    const chunk = (name, from, to) => THREE.ShaderChunk[name].replace(from, to);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying vec4 vHair;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHair = color;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vHair;')
      // the strands fade out where they converge (crown, ties, tips)
      .replace('#include <map_fragment>', chunk('map_fragment', 'diffuseColor *= sampledDiffuseColor;',
        'diffuseColor.rgb *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb, vHair.a );'))
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vHair.rgb;')
      .replace('#include <normal_fragment_maps>', chunk('normal_fragment_maps', 'mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vHair.a;'))
      // the sheen follows the shading: none deep in a crease
      .replace('#include <lights_physical_fragment>', chunk('lights_physical_fragment', 'material.sheenColor = sheenColor;',
        'material.sheenColor = sheenColor * vHair.rgb;'));
  };
  material.customProgramCacheKey = () => 'hair-soft-1';
  return material;
}

const WHITE = new THREE.Color(1, 1, 1);
const COOL_WHITE = new THREE.Color(0.86, 0.93, 1.0);
const NEUTRAL = new THREE.Color();
const GRAY = new THREE.Color();

/** Set the hair color; the sheen is a soft, faint tint of it (never white). */
export function setHairColor(material, color) {
  const { lerp, smoothstep } = THREE.MathUtils;
  material.color.set(color);
  const c = material.color;
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;   // linear
  // Dark hair needs relatively more sheen to show its form; light hair needs little.
  const amount = lerp(0.27, 0.15, Math.min(1, Math.sqrt(lum / 0.6)));
  // The sheen is the hair's own hue at full brightness, a little paler. On very dark hair that
  // warm tint is many times the hair's own color and would turn black into espresso brown and
  // browns into copper, so the darker the hair, the closer its sheen gets to a neutral tone
  // (black fully, dark brown mostly, chestnut and auburn partly; colors from purple up keep
  // their own hue). Only black gets a faintly cool one: on brown it would read as lavender.
  const dark = 1 - smoothstep(lum, 0.015, 0.16);
  NEUTRAL.copy(COOL_WHITE).lerp(WHITE, smoothstep(lum, 0.015, 0.04));
  material.sheenColor.copy(c).multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-4))
    .lerp(WHITE, 0.2).lerp(NEUTRAL, 0.75 * dark).multiplyScalar(amount);
  // Under a warm key light the darkest browns drift toward copper: take a little of their
  // saturation out, at the same luminance. Chestnut and lighter colors are left as they are.
  c.lerp(GRAY.setScalar(lum), 0.25 * (1 - smoothstep(lum, 0.03, 0.08)));
}
