import * as THREE from 'three';
import { loadGLTF } from './loader.js';

// Hair styles built by tools/build_hair.py, one quantized .glb per shape. Each mesh is in Head-bone
// space, so it is simply parented to the Head bone and follows every head movement. The meshes are
// sculpted in locks and carry flow UVs (u across the strands, v along them, stored as uv / UV_SCALE)
// and COLOR_0 = (baked occlusion, skin mix, unused, strand strength).
//
// A look is a style plus a texture. Each style lists the textures it can be drawn with, natural
// first, and offers one only where it changes the look: every texture but the natural one has a
// mesh of its own (`files`, e.g. the curly bob; curly and coily share one where only the tile
// differs). Straight and wavy are drawn with the strand tile, curly and coily with curls and coils
// (see setHairTexture).
export const HAIR_TEXTURES = [
  { id: 'straight', label: 'Straight' },
  { id: 'wavy', label: 'Wavy' },
  { id: 'curly', label: 'Curly' },
  { id: 'coily', label: 'Coily' },
];

// UI order. Spiky stays first: it is the lab's default.
export const HAIR_STYLES = [
  { id: 'spiky', label: 'Spiky', textures: ['straight'] },
  { id: 'swept', label: 'Side part', textures: ['straight'] },
  { id: 'buzz', label: 'Buzz cut', textures: ['straight'] },
  { id: 'fade', label: 'Fade', textures: ['coily', 'straight'], files: { straight: 'fade-straight' } },
  { id: 'quiff', label: 'Quiff', textures: ['straight'] },
  { id: 'curls', label: 'Short curls', textures: ['curly', 'coily'], files: { coily: 'curls-coily' } },
  { id: 'shaggy', label: 'Shaggy', textures: ['straight'] },
  { id: 'balding', label: 'Balding', textures: ['straight'] },
  { id: 'bob', label: 'Bob', textures: ['straight', 'wavy', 'curly'], files: { wavy: 'bob-wavy', curly: 'bob-curly' } },
  { id: 'afro', label: 'Afro', textures: ['coily', 'curly'], files: { curly: 'afro-curly' } },
  { id: 'long', label: 'Long', textures: ['straight', 'wavy', 'curly'], files: { wavy: 'long-wavy', curly: 'long-curly' } },
  { id: 'parted', label: 'Center part', textures: ['straight'] },
  { id: 'ponytail', label: 'Ponytail', textures: ['straight'] },
  { id: 'pigtails', label: 'Pigtails', textures: ['straight'] },
  { id: 'braids', label: 'Braids', textures: ['straight', 'curly', 'coily'], files: { curly: 'braids-coily', coily: 'braids-coily' } },
  { id: 'cornrows', label: 'Cornrows', textures: ['coily'] },
  { id: 'locs', label: 'Locs', textures: ['coily'] },
  { id: 'bun', label: 'Top bun', textures: ['straight', 'curly', 'coily'], files: { curly: 'bun-puff', coily: 'bun-puff' } },
  { id: 'buns', label: 'Two buns', textures: ['straight', 'curly', 'coily'], files: { curly: 'buns-puff', coily: 'buns-puff' } },
  { id: 'updo', label: 'Updo', textures: ['coily', 'straight'], files: { straight: 'updo-straight' } },
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

const STYLE_BY_ID = new Map(HAIR_STYLES.map((style) => [style.id, style]));

/** The texture a style is actually drawn with: the one asked for if the style offers it, else its natural one. */
export function hairTexture(style, texture) {
  const textures = STYLE_BY_ID.get(style)?.textures ?? ['straight'];
  return textures.includes(texture) ? texture : textures[0];
}

const geometries = new Map();   // file name -> Promise<BufferGeometry | null>
const warned = new Set();

function warnOnce(id, message) {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(message);
}

/**
 * The geometry of a style in a texture, shared by every character that wears it. Resolves null
 * (and warns once) for a style this engine doesn't know, say from a newer staging.json, or a file
 * that fails to load: the character then simply has no hair.
 */
export function loadHairGeometry(style, texture) {
  const entry = STYLE_BY_ID.get(style);
  if (!entry) {
    warnOnce(style, `Unknown hair style "${style}": drawing no hair.`);
    return Promise.resolve(null);
  }
  const file = entry.files?.[hairTexture(style, texture)] ?? style;
  if (!geometries.has(file)) {
    const url = new URL(`../../assets/characters/canonical/hair/${file}.glb`, import.meta.url).href;
    geometries.set(file, loadGLTF(url).then(hairGeometry).catch((err) => {
      warnOnce(file, `Couldn't load hair "${file}" (${err.message}): drawing no hair.`);
      geometries.delete(file);   // a later look tries again (a network hiccup isn't for good)
      return null;
    }));
  }
  return geometries.get(file);
}

function hairGeometry(gltf) {
  // Positions are int16 in Head-bone metres and the node has no transform, so the geometry is used
  // as it is (three draws the quantized attributes directly).
  let geometry = null;
  gltf.scene.traverse((obj) => { if (obj.isMesh && !geometry) geometry = obj.geometry; });
  if (!geometry) throw new Error('no mesh');
  if (!geometry.getAttribute('color')) {   // no baked shading: no occlusion, no skin, full strands
    const n = geometry.getAttribute('position').count;
    const color = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { color[i * 4] = 255; color[i * 4 + 3] = 255; }
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 4, true));
  }
  return geometry;
}

// ---------------------------------------------------------------------------------------------
// Tile textures, drawn once per page on first use and shared by every character. One tile covers
// TILE_U x TILE_V world units of hair (build_hair.py), so a tile pixel is twice as tall as it is
// wide on the hair. The meshes store uv / UV_SCALE, so the tiles repeat UV_SCALE times.
// ---------------------------------------------------------------------------------------------
export const UV_SCALE = 16;
const TILE_U = 0.24, TILE_V = 0.48;
const SIZE = 512;
const TAU = 2 * Math.PI;

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tileable value noise on a `cells` x `rows` lattice, sampled at the center of tile pixel (i, j).
 * The lattice cells and smoothstep weights of every column and row are worked out once.
 */
function noiseField(cells, random, rows = cells) {
  const lattice = Float32Array.from({ length: cells * rows }, random);
  const axis = (n) => {
    const i0 = new Int32Array(SIZE), i1 = new Int32Array(SIZE), t = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
      const f = ((i + 0.5) / SIZE) * n, fi = Math.floor(f);
      let s = f - fi;
      s = s * s * (3 - 2 * s);
      i0[i] = ((fi % n) + n) % n; i1[i] = (i0[i] + 1) % n; t[i] = s;
    }
    return { i0, i1, t };
  };
  const X = axis(cells), Y = axis(rows);
  return (i, j) => {
    const r0 = Y.i0[j] * cells, r1 = Y.i1[j] * cells, x0 = X.i0[i], x1 = X.i1[i], tx = X.t[i], ty = Y.t[j];
    const a = lattice[r0 + x0], b = lattice[r0 + x1];
    const c = lattice[r1 + x0], d = lattice[r1 + x1];
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

/** Straight and wavy hair: fine strands running along v. */
function drawStrands() {
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
      const micro = felt(i, j) * 0.6 + felt2(i, j) * 0.4;      // a fine felted grain
      height[j * SIZE + i] = A[0][i] * 0.45 + B[0][i] * 0.4 + C[0][i] * 0.15 + micro * 0.12;
      shade[j * SIZE + i] = 0.975 - 0.11 * A[1][i] ** 2 - 0.18 * B[1][i] ** 2.5 - 0.08 * C[1][i] ** 3
        + 0.03 * B[2][i] + 0.05 * (clump(i, j) - 0.5) + 0.03 * (micro - 0.5);
    }
  }
  return { height, shade, strength: 2.0 };
}

// Curly and coily hair: round fibres with no direction, packed so densely that they tangle. Curls
// are arcs 1-2 cm across, coils small rings 4-8 mm across in a felted, spongy mass. Radii and
// widths are in tile pixels across u (1 px = 0.47 mm on the hair).
const CURLS = {
  seed: 7, count: 3400, radius: [11, 22], span: [2.0, 4.6], width: 3.8, felt: 0.12, feltCells: 64,
  shade: 0.99, cavity: 0.14, strength: 1.6,
};
const COILS = {
  seed: 11, count: 7500, radius: [4.5, 8], span: [TAU, TAU], width: 2.6, felt: 0.3, feltCells: 96,
  shade: 0.99, cavity: 0.2, strength: 2.0,
};

/**
 * Round fibres: `count` arcs (or whole rings) scattered over the tile, each a rounded ridge with
 * rounded ends, combined by their maximum and filled with felt noise. Everything is drawn twice as
 * wide as tall, so the fibres land round on the 0.24 x 0.48 tile, and wraps around both edges, so
 * the tile is seamless.
 */
function drawCurls(p) {
  const random = rand(p.seed);
  const aspect = TILE_V / TILE_U;
  const height = new Float32Array(SIZE * SIZE);
  const tone = new Float32Array(SIZE * SIZE);
  const wrap = (i) => ((i % SIZE) + SIZE) % SIZE;
  for (let k = 0; k < p.count; k++) {
    const cx = random() * SIZE, cy = random() * SIZE;
    const r = p.radius[0] + (p.radius[1] - p.radius[0]) * random();
    const span = p.span[0] + (p.span[1] - p.span[0]) * random();
    const mid = random() * TAU;                    // the arc runs span / 2 either side of this direction
    const amp = 0.55 + 0.45 * random();
    const shade = random() * 2 - 1;
    const w = p.width * (0.8 + 0.4 * random());
    const ring = span >= TAU;
    const mx = Math.cos(mid), my = Math.sin(mid), edge = Math.cos(span / 2);
    const outer = (r + w) * (r + w);
    const ry = Math.ceil((r + w) / aspect);
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    for (let dy = -ry; dy <= ry; dy++) {
      const Y = (y0 + dy + 0.5 - cy) * aspect;
      if (Y * Y >= outer) continue;
      const row = wrap(y0 + dy) * SIZE;
      const rx = Math.ceil(Math.sqrt(outer - Y * Y));
      for (let dx = -rx; dx <= rx; dx++) {
        const X = x0 + dx + 0.5 - cx;
        const d = Math.sqrt(X * X + Y * Y);
        const t = (d - r) / w;
        if (t <= -1 || t >= 1) continue;
        let taper = 1;
        if (!ring) {
          // how far along the arc from its middle, by the cosine of the angle: rounded ends
          const c = (X * mx + Y * my) / (d || 1);
          if (c <= edge) continue;
          taper = Math.sqrt((c - edge) / (1 - edge));
        }
        const h = amp * taper * (1 - t * t);
        const i = row + wrap(x0 + dx);
        if (h > height[i]) { height[i] = h; tone[i] = shade; }
      }
    }
  }
  const felt = noiseField(p.feltCells * 2, random, p.feltCells), felt2 = noiseField(p.feltCells, random, p.feltCells / 2);
  const clump = noiseField(6, random);
  const shade = new Float32Array(SIZE * SIZE);
  for (let j = 0, k = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++, k++) {
      const micro = felt(i, j) * 0.6 + felt2(i, j) * 0.4;
      const h = height[k] * (1 - p.felt) + micro * p.felt;
      height[k] = h;
      shade[k] = p.shade - p.cavity * (1 - h) ** 2 + 0.03 * tone[k] + 0.05 * (clump(i, j) - 0.5);
    }
  }
  return { height, shade, strength: p.strength };
}

/** A height field and a shade field as a tangent-space normal map and a gray albedo multiplier. */
function tileTextures({ height, shade, strength }) {
  const canvas = (fill) => {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    const img = g.createImageData(SIZE, SIZE);
    fill(img.data);
    g.putImageData(img, 0, 0);
    return c;
  };
  const normal = canvas((px) => {
    for (let j = 0; j < SIZE; j++) {
      const row = j * SIZE, up = ((j + SIZE - 1) % SIZE) * SIZE, down = ((j + 1) % SIZE) * SIZE;
      for (let i = 0; i < SIZE; i++) {
        const left = (i + SIZE - 1) % SIZE, right = (i + 1) % SIZE;
        // Canvas rows run down while v runs up (flipY), hence the sign on dy.
        const dx = (height[row + right] - height[row + left]) * 0.5 * strength;
        const dy = (height[up + i] - height[down + i]) * 0.5 * strength;
        const len = Math.sqrt(dx * dx + dy * dy + 1);
        const o = (row + i) * 4;
        px[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
        px[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
        px[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
        px[o + 3] = 255;
      }
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
    t.repeat.set(UV_SCALE, UV_SCALE);
    t.colorSpace = THREE.NoColorSpace;   // plain numbers: a normal, and a multiplier on the color
    t.anisotropy = 8;                    // clamped to what the GPU supports
    return t;
  };
  return { normal: texture(normal), albedo: texture(albedo) };
}

// Straight and wavy hair share the strand tile; curly and coily hair are more matte, with a
// fainter sheen. The two puff meshes and the tile options all go through these three families.
// Near-black hair shows its relief only through the sheen: there long strand grooves turn into
// thin bright lines, so the strand tile is softened, while round curls and coils would vanish,
// so they get more relief and more of the sheen (dark*, reached at black).
const FAMILY_OF = { straight: 'strands', wavy: 'strands', curly: 'curls', coily: 'coils' };
const FAMILIES = {
  strands: { draw: drawStrands, roughness: 0.78, normalScale: 0.85, darkNormals: 0.55, sheen: 1, darkSheen: 1 },
  curls: { draw: () => drawCurls(CURLS), roughness: 0.82, normalScale: 0.7, darkNormals: 1.4, sheen: 0.8, darkSheen: 1 },
  coils: { draw: () => drawCurls(COILS), roughness: 0.88, normalScale: 0.6, darkNormals: 1.6, sheen: 0.5, darkSheen: 0.8 },
};
const tiles = new Map();

function tileMaps(family) {
  if (!tiles.has(family)) tiles.set(family, tileTextures(FAMILIES[family].draw()));
  return tiles.get(family);
}

// The body's skin response, which the hair takes on where the skin shows through: what the body
// actually draws (createBodyMaterial in outfit.js), a plain white sheen of 0.35. Its line that
// tints the sheen by the painted color patches text inside an #include, so it never reaches the
// shader; a tinted sheen here made faded sides and partings darker and more orange than the skin
// next to them (on #6e4a33 a forced full-skin shell drew 91,51,16 where the head drew 111,78,56).
const SKIN_ROUGHNESS = 0.8;
const SKIN_SHEEN = 0.35;
const SKIN_SHEEN_ROUGHNESS = 0.8;
const SKIN_SPECULAR = 0.25;
const DEFAULT_SKIN = '#f8d3b0';

/**
 * The hair material: matte and soft, like sculpted clay. Light rolls off gently and the sheen
 * is a faint, broad tint of the hair color. Fine detail comes from the shared tile textures
 * (see setHairTexture); the mesh's baked occlusion (COLOR_0 r) darkens creases, undersides and
 * the hairline, COLOR_0 alpha fades the tile out where the strands converge, and COLOR_0 g lets
 * the skin show through (fades, partings, the scalp of a buzz cut), with the body's own sheen.
 * The shader is the same for every texture and color, so all hair shares one program.
 */
export function createHairMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    name: 'Hair', roughness: 0.78, metalness: 0, specularIntensity: 0.32,
    sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x000000),
    normalScale: new THREE.Vector2(0.85, 0.85),
  });
  const uniforms = {
    hairSkin: { value: new THREE.Color(DEFAULT_SKIN) },
    hairLight: { value: 0 },
  };
  Object.assign(material.userData, { uniforms, sheen: 1, normalScale: 0.85, skin: DEFAULT_SKIN });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Chunks are still #include lines here: expand the ones patched inside.
    const chunk = (name, ...pairs) => pairs.reduce((text, [from, to]) => text.replace(from, to), THREE.ShaderChunk[name]);
    const f2 = (x) => x.toFixed(2);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying vec4 vHair;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHair = color;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vHair;
uniform vec3 hairSkin;
uniform float hairLight;
// Light hair bounces light into its own creases, so they are shallower and keep the hair's hue
// instead of going gray (the multi-bounce occlusion fit of Jimenez et al. 2016).
vec3 hairBounce( float v, vec3 albedo ) {
	vec3 a = 2.0404 * albedo - 0.3324;
	vec3 b = - 4.7951 * albedo + 0.6417;
	vec3 c = 2.7552 * albedo + 0.6903;
	return max( vec3( v ), ( ( v * a + b ) * v + c ) * v );
}`)
      // the skin shows through where the hair thins out
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( mix( diffuse, hairSkin, vHair.g ), opacity );')
      // the strands fade out where they converge (crown, ties, tips)
      .replace('#include <map_fragment>', chunk('map_fragment', ['diffuseColor *= sampledDiffuseColor;',
        'diffuseColor.rgb *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb, vHair.a );']))
      .replace('#include <color_fragment>', `float hairSoft = 1.0 - ( 1.0 - vHair.r ) * ( 1.0 - 0.3 * hairLight );
vec3 hairOcc = mix( vec3( vHair.r ), hairBounce( hairSoft, diffuseColor.rgb ), hairLight );
diffuseColor.rgb *= hairOcc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, ${f2(SKIN_ROUGHNESS)}, vHair.g );`)
      .replace('#include <normal_fragment_maps>', chunk('normal_fragment_maps', ['mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vHair.a;']))
      // the sheen follows the shading: none deep in a crease; on the skin, sheen and specular are the body's
      .replace('#include <lights_physical_fragment>', chunk('lights_physical_fragment',
        ['material.sheenColor = sheenColor;', `material.sheenColor = mix( sheenColor, vec3( ${f2(SKIN_SHEEN)} ), vHair.g ) * hairOcc;`],
        ['clamp( sheenRoughness, 0.0001, 1.0 )', `clamp( mix( sheenRoughness, ${f2(SKIN_SHEEN_ROUGHNESS)}, vHair.g ), 0.0001, 1.0 )`],
        ['float specularIntensityFactor = specularIntensity;', `float specularIntensityFactor = mix( specularIntensity, ${f2(SKIN_SPECULAR)}, vHair.g );`]));
  };
  material.customProgramCacheKey = () => 'hair-soft-2';
  return material;
}

/**
 * Draw the hair with a texture's tile: straight and wavy with strands, curly with curls, coily
 * with coils (each tile drawn once per page, on first use). Also sets the family's roughness,
 * normal strength and sheen. Only textures change, so the shader is not recompiled.
 */
export function setHairTexture(material, texture) {
  const family = FAMILY_OF[texture] ?? 'strands';
  const look = FAMILIES[family];
  const { albedo, normal } = tileMaps(family);
  if (!material.map || !material.normalMap) material.needsUpdate = true;   // the first tile shapes the program
  material.map = albedo;
  material.normalMap = normal;
  material.roughness = look.roughness;
  const { sheen, darkSheen, normalScale, darkNormals } = look;
  Object.assign(material.userData, { sheen, darkSheen, normalScale, darkNormals });
  updateLook(material);
}

/** Set the hair color, and the skin color that shows through where the hair thins out. */
export function setHairColor(material, color, skin) {
  material.userData.color = color;
  if (skin) material.userData.skin = skin;
  updateLook(material);
}

const WHITE = new THREE.Color(1, 1, 1);
const GRAY = new THREE.Color();

/** Everything that follows from the color, the skin and the tile family. */
function updateLook(material) {
  const { color = '#4a2f22', skin = DEFAULT_SKIN, uniforms } = material.userData;
  const { sheen = 1, darkSheen = sheen, normalScale = 0.85, darkNormals = 1 } = material.userData;
  const { lerp, smoothstep } = THREE.MathUtils;
  material.color.set(color);
  const c = material.color;
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;   // linear
  const black = 1 - smoothstep(lum, 0.012, 0.03);           // black only; dark brown is 0.036
  // The sheen is a soft, faint tint of the hair color (never white). Dark hair needs relatively
  // more sheen to show its form; light hair needs little.
  const amount = lerp(0.27, 0.15, Math.min(1, Math.sqrt(lum / 0.6))) * lerp(sheen, darkSheen, black);
  // The sheen is the hair's own hue at full brightness, a little paler. On very dark hair that
  // warm tint is many times the hair's own color and would turn black into espresso brown and
  // browns into copper, so the darker the hair, the closer its sheen gets to neutral (black
  // fully, dark brown mostly, chestnut and auburn partly; colors from purple up keep their own
  // hue). Neutral, not cool: under the cool rim light a cool sheen made black read navy.
  const dark = 1 - smoothstep(lum, 0.015, 0.16);
  material.sheenColor.copy(c).multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-4))
    .lerp(WHITE, 0.2).lerp(WHITE, 0.75 * dark).multiplyScalar(amount);
  // Under a warm key light the darkest browns drift toward copper: take a little of their
  // saturation out, at the same luminance. Chestnut and lighter colors are left as they are.
  c.lerp(GRAY.setScalar(lum), 0.25 * (1 - smoothstep(lum, 0.03, 0.08)));
  material.normalScale.setScalar(normalScale * lerp(1, darkNormals, black));
  if (!uniforms) return;
  // Light hair (pink, blonde, gray, white): softer, hue-keeping occlusion (see the shader).
  uniforms.hairLight.value = smoothstep(lum, 0.3, 0.45);
  // Where the skin shows through (COLOR_0 g) the hair is the skin, with the body's response.
  uniforms.hairSkin.value.set(skin);
}
