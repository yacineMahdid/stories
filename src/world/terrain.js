import * as THREE from 'three';
import { WORLD_UNIFORMS, PALETTE, seasonal, noise3 } from './kit.js';

/**
 * The ground of a scene: a heightfield around the action with painted surfaces (grass, dirt
 * paths, paving, brick, sand, tilled soil), cliffs, water (rivers, ponds, lakes, the sea)
 * and a distant ring of hills. Built from terrain features in world coordinates:
 *
 *   { type: 'flat', at: [x, z], r, height?, blend? }         level ground (sites, buildings)
 *   { type: 'hill', at, r, height }                            a soft rise
 *   { type: 'plateau', at, r | points, height, edge? }        a raised terrace with cliffs
 *   { type: 'path', points: [[x, z]...], width?, surface? }   dirt | stone | brick | sand
 *   { type: 'plaza', at, r | size: [w, d], rotate?, surface? }
 *   { type: 'field', at, size, rotate? }                      tilled soil in rows
 *   { type: 'river', points, width?, depth? }
 *   { type: 'pond', at, r | points, depth? }                  (also 'lake')
 *   { type: 'sea', points (polygon of open water), beach? }
 *   { type: 'sand', at, r | points }                          a sandy patch
 */

export const WATER_LEVEL = -0.3;

/* ───────────── 2D geometry ───────────── */

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}

export function distToPolyline(px, pz, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  if (pts.length === 1) d = Math.hypot(px - pts[0][0], pz - pts[0][1]);
  return d;
}

function insidePolygon(px, pz, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance to a shape: negative inside. Shapes are circles ({at, r}) or polygons ({points}). */
function signedDistance(f, px, pz) {
  if (f.points && f.points.length >= 3) {
    let d = Infinity;
    const pts = f.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) d = Math.min(d, distToSegment(px, pz, pts[j][0], pts[j][1], pts[i][0], pts[i][1]));
    return insidePolygon(px, pz, pts) ? -d : d;
  }
  if (f.size) {
    const rot = THREE.MathUtils.degToRad(f.rotate ?? 0);
    const c = Math.cos(-rot), s = Math.sin(-rot);
    const lx = (px - f.at[0]) * c - (pz - f.at[1]) * s;
    const lz = (px - f.at[0]) * s + (pz - f.at[1]) * c;
    const qx = Math.abs(lx) - f.size[0] / 2, qz = Math.abs(lz) - f.size[1] / 2;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  }
  return Math.hypot(px - f.at[0], pz - f.at[1]) - (f.r ?? 5);
}

const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Smooth a polyline into a curve (Catmull-Rom), for rivers and paths. */
export function smoothLine(points, perSegment = 6) {
  if (points.length < 3) return points;
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return curve.getPoints((points.length - 1) * perSegment).map((v) => [v.x, v.z]);
}

/* ───────────── the terrain ───────────── */

const TERRAIN_FRAG_HEAD = /* glsl */ `
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform vec2 uOrigin;
uniform float uSize;
uniform vec3 uGrass;
uniform vec3 uGrass2;
uniform vec3 uDirt;
uniform vec3 uStone;
uniform vec3 uSand;
uniform vec3 uBrick;
uniform vec3 uSoil;
uniform vec3 uCliff;
uniform vec3 uUnder;
uniform float uSnow;
uniform float uWet;
uniform float uWaterLevel;
varying vec3 vTW;
varying vec3 vTN;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 tHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y);
}
// Cobblestones: Voronoi cells with mortar between them. Returns (edge, cell id).
vec2 tCells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = 0.5 + 0.38 * (tHash2(i + g) - 0.5) * 2.0;
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = tHash(i + g); } else if (d < d2) { d2 = d; }
  }
  return vec2(d2 - d1, id);
}
`;

const TERRAIN_FRAG_COLOR = /* glsl */ `
{
  vec2 uv = (vTW.xz - uOrigin) / uSize;
  vec3 mA = texture2D(uMaskA, uv).rgb;
  vec3 mB = texture2D(uMaskB, uv).rgb;
  float n1 = tNoise(vTW.xz * 1.3);
  float n2 = tNoise(vTW.xz * 5.7);
  float n3 = tNoise(vTW.xz * 0.21);
  float dirt = smoothstep(0.38, 0.62, mA.r + (n1 - 0.5) * 0.34 + (n2 - 0.5) * 0.14);
  float stone = smoothstep(0.44, 0.56, mA.g + (n2 - 0.5) * 0.06);
  float sand = smoothstep(0.3, 0.7, mA.b + (n1 - 0.5) * 0.26);
  float brick = smoothstep(0.44, 0.56, mB.r);
  float soil = smoothstep(0.44, 0.56, mB.g);

  // grass: two tones in broad patches, fine speckle, tiny darker clover dots
  vec3 g = mix(uGrass, uGrass2, smoothstep(0.32, 0.72, n3));
  g *= 0.95 + 0.08 * n2;
  float clover = smoothstep(0.9, 0.97, tNoise(vTW.xz * 9.0 + 7.0));
  g = mix(g, g * 0.86, clover * 0.6);
  vec3 col = g;

  vec3 sandC = uSand * (0.95 + 0.07 * n2) - 0.04 * smoothstep(0.85, 0.95, tNoise(vTW.xz * 14.0));
  col = mix(col, sandC, sand);
  vec3 dirtC = uDirt * (0.93 + 0.1 * n2) * (1.0 - 0.08 * smoothstep(0.8, 0.95, tNoise(vTW.xz * 11.0)));
  col = mix(col, dirtC, dirt);
  vec2 cell = tCells(vTW.xz * 2.4);
  vec3 stoneC = uStone * (0.88 + 0.2 * cell.y);
  stoneC = mix(stoneC * 0.72, stoneC, smoothstep(0.05, 0.13, cell.x));
  col = mix(col, stoneC, stone);
  {
    vec2 b = vTW.xz * vec2(2.2, 4.4);
    b.x += step(1.0, mod(floor(b.y), 2.0)) * 0.5;
    vec2 bf = fract(b);
    float mortar = smoothstep(0.0, 0.06, bf.x) * smoothstep(1.0, 0.94, bf.x) * smoothstep(0.0, 0.1, bf.y) * smoothstep(1.0, 0.9, bf.y);
    vec3 brickC = uBrick * (0.86 + 0.22 * tHash(floor(b)));
    col = mix(col, mix(uStone * 0.8, brickC, mortar), brick);
  }
  {
    float rows = sin(vTW.x * 6.0) * 0.5 + 0.5;
    vec3 soilC = mix(uSoil * 0.78, uSoil * 1.08, smoothstep(0.2, 0.8, rows));
    col = mix(col, soilC, soil);
  }

  // cliffs: steep slopes show earth and rock with strata
  float slope = 1.0 - clamp(normalize(vTN).y, 0.0, 1.0);
  float cliff = smoothstep(0.3, 0.5, slope + (n1 - 0.5) * 0.12);
  vec3 cliffC = uCliff * (0.9 + 0.16 * sin(vTW.y * 9.0 + n1 * 2.0)) * (0.92 + 0.1 * n2);
  col = mix(col, cliffC, cliff);

  // water's edge: wet darker band, then the riverbed tinted under the water
  float shore = smoothstep(uWaterLevel + 0.18, uWaterLevel + 0.02, vTW.y);
  col *= 1.0 - 0.18 * shore;
  float under = smoothstep(uWaterLevel, uWaterLevel - 0.35, vTW.y);
  col = mix(col, uUnder * (0.9 + 0.15 * n2), under * 0.75);

  // snow: everything but steep cliffs; trodden paths keep some color
  float snowN = tNoise(vTW.xz * 2.1) * 0.6 + n2 * 0.4;
  float trodden = max(dirt, max(stone, brick)) * (0.22 + 0.2 * smoothstep(0.35, 0.75, snowN));
  float snowAmt = uSnow * (1.0 - cliff * 0.75) * (1.0 - trodden) * (1.0 - under);
  snowAmt *= smoothstep(0.0, 0.25, uSnow + (snowN - 0.5) * 0.4);
  col = mix(col, vec3(0.9, 0.93, 0.98) * (0.96 + 0.06 * n2), clamp(snowAmt, 0.0, 1.0));
  tSnow = snowAmt;

  // rain: darker, with puddles on flat paved and dirt ground
  float puddle = smoothstep(0.62, 0.72, tNoise(vTW.xz * 0.9 + 3.0)) * max(dirt, max(stone, brick * 0.8)) * uWet * (1.0 - cliff);
  tPuddle = puddle;
  col *= 1.0 - uWet * 0.22 * (1.0 - snowAmt);
  col = mix(col, col * 0.55, puddle);
  diffuseColor.rgb = col;
}
`;

export class Terrain {
  /**
   * @param {object} o
   * @param {number[]} o.center  [x, z] of the middle of the area
   * @param {number} o.size      side of the square area (units)
   * @param {number} o.res       grid cells per side
   * @param {string} o.season
   * @param {object[]} o.features  terrain features (world coordinates)
   * @param {object} o.colors    optional color overrides { grass, grass2, dirt, stone, sand, brick, soil, cliff }
   * @param {number} o.seed
   */
  constructor({ center = [0, 0], size = 200, res = 300, season = 'summer', features = [], colors = {}, seed = 1, roll = 0.35 } = {}) {
    this.center = center;
    this.size = size;
    this.res = res;
    this.season = season;
    this.features = features.map((f) => (f.type === 'river' || f.type === 'path') && f.points ? { ...f, points: smoothLine(f.points, 6) } : f);
    this.seed = seed;
    this.roll = roll;
    this.origin = [center[0] - size / 2, center[1] - size / 2];
    this.object = new THREE.Group();
    this.object.name = 'terrain';

    this.computeHeights();
    this.paintMasks();
    this.buildMesh(colors);
    this.buildWater();
    this.buildBackdrop(colors);
  }

  /* heights */

  rawHeight(x, z) {
    const s = this.seed * 0.137;
    let h = this.roll * (noise3(x * 0.028 + s, 0.5, z * 0.028 - s) + 0.45 * noise3(x * 0.08 - s, 1.7, z * 0.08 + s));
    let flatW = 0, flatH = 0;
    const water = [];
    for (const f of this.features) {
      switch (f.type) {
        case 'hill': {
          const d = Math.hypot(x - f.at[0], z - f.at[1]);
          const r = f.r ?? 10;
          if (d < r) h += (f.height ?? 2) * 0.5 * (1 + Math.cos(Math.PI * d / r));
          break;
        }
        case 'plateau': {
          const d = signedDistance(f, x, z);
          const edge = f.edge ?? 0.9;
          h += (f.height ?? 1.5) * smooth(edge * 0.5, -edge * 0.5, d);
          break;
        }
        case 'flat': case 'plaza': case 'field': {
          if (f.type !== 'flat' && f.flatten === false) break;
          const d = signedDistance(f, x, z);
          const blend = f.blend ?? 4;
          const w = smooth(blend, 0, d);
          if (w > flatW) { flatW = w; flatH = f.height ?? 0; }
          break;
        }
        case 'path': {
          if (f.flatten !== true) break; // paths follow the ground unless asked to level it
          const d = distToPolyline(x, z, f.points) - (f.width ?? 1.6) / 2;
          const w = smooth(2.5, 0, d) * 0.85;
          if (w > flatW) { flatW = w; flatH = f.height ?? 0; }
          break;
        }
        case 'river': case 'pond': case 'lake': case 'sea':
          water.push(f);
          break;
        default: break;
      }
    }
    h = h * (1 - flatW) + flatH * flatW;
    // Water carves last: land near water levels out, then the bank drops to the bed.
    for (const f of water) {
      let d;
      if (f.type === 'river') d = distToPolyline(x, z, f.points) - (f.width ?? 4) / 2;
      else d = signedDistance(f, x, z);
      const depth = f.depth ?? (f.type === 'sea' ? 2.4 : f.type === 'river' ? 1.0 : 1.1);
      if (f.type === 'sea') {
        // The polygon edge is the waterline: a sandy beach rises behind it, the seabed falls away in front.
        const beach = f.beach ?? 7;
        const land = smooth(beach + 8, beach, d);
        h = h * (1 - land) + 0.08 * land;
        if (d < beach) h = d >= 0 ? WATER_LEVEL + 0.38 * smooth(0, beach, d) : WATER_LEVEL - depth * smooth(0, -14, d);
      } else {
        const bank = f.bank ?? 3;
        const land = smooth(bank + 2.5, bank * 0.3, d);
        h = h * (1 - land) + (f.banks ?? 0) * land;
        if (d < 0.45) {
          const t = smooth(0.45, -1.1, d);
          h = Math.min(h, -depth * t + (1 - t) * h);
        }
      }
    }
    return h;
  }

  computeHeights() {
    const n = this.res + 1;
    this.heights = new Float32Array(n * n);
    this.cell = this.size / this.res;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = this.origin[0] + i * this.cell, z = this.origin[1] + j * this.cell;
        this.heights[j * n + i] = this.rawHeight(x, z);
      }
    }
  }

  /** Ground height at a world position (bilinear on the grid). */
  heightAt(x, z) {
    const n = this.res + 1;
    const fx = (x - this.origin[0]) / this.cell, fz = (z - this.origin[1]) / this.cell;
    if (fx < 0 || fz < 0 || fx > this.res || fz > this.res) return this.rawHeight(x, z);
    const i = Math.min(Math.floor(fx), this.res - 1), j = Math.min(Math.floor(fz), this.res - 1);
    const tx = fx - i, tz = fz - j;
    const h00 = this.heights[j * n + i], h10 = this.heights[j * n + i + 1];
    const h01 = this.heights[(j + 1) * n + i], h11 = this.heights[(j + 1) * n + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  isWater(x, z, margin = 0.05) {
    return this.heightAt(x, z) < WATER_LEVEL - margin;
  }

  /** Steepness 0 (flat) … 1 (vertical). */
  slopeAt(x, z) {
    const e = this.cell;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const ny = 1 / Math.sqrt(1 + (dx / (2 * e)) ** 2 + (dz / (2 * e)) ** 2);
    return 1 - ny;
  }

  /* surfaces */

  paintMasks() {
    const R = 2048;
    this.maskRes = R;
    const k = R / this.size;
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = R; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, R, R); return [c, g]; };
    const [ca, ga] = mk();
    const [cb, gb] = mk();
    const toPx = ([x, z]) => [(x - this.origin[0]) * k, (z - this.origin[1]) * k];
    const shapePath = (g, f) => {
      g.beginPath();
      if (f.points && f.points.length >= 3) {
        f.points.forEach((p, i) => { const [px, pz] = toPx(p); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
        g.closePath();
      } else if (f.size) {
        const [cx, cz] = toPx(f.at);
        g.save();
        g.translate(cx, cz);
        g.rotate(THREE.MathUtils.degToRad(f.rotate ?? 0));
        g.roundRect(-f.size[0] * k / 2, -f.size[1] * k / 2, f.size[0] * k, f.size[1] * k, (f.round ?? 0.6) * k);
        g.restore();
      } else {
        const [cx, cz] = toPx(f.at);
        g.arc(cx, cz, (f.r ?? 5) * k, 0, Math.PI * 2);
      }
    };
    const CH = { dirt: [ga, 'rgb(255,0,0)'], stone: [ga, 'rgb(0,255,0)'], sand: [ga, 'rgb(0,0,255)'], brick: [gb, 'rgb(255,0,0)'], soil: [gb, 'rgb(0,255,0)'] };
    ga.globalCompositeOperation = gb.globalCompositeOperation = 'lighter';
    // Sand first (beaches), then plazas and fields, then paths on top.
    for (const f of this.features) {
      if (f.type === 'sea') {
        ga.save();
        ga.lineWidth = (f.beach ?? 7) * 2 * k;
        ga.strokeStyle = CH.sand[1];
        ga.lineJoin = 'round';
        shapePath(ga, f);
        ga.stroke();
        ga.fillStyle = CH.sand[1];
        ga.fill();
        ga.restore();
      }
      if (f.type === 'sand') { ga.fillStyle = CH.sand[1]; shapePath(ga, f); ga.fill(); }
    }
    const paint = (g, color, fn) => { g.save(); fn(g, color); g.restore(); };
    for (const f of this.features) {
      if (f.type === 'plaza') {
        const [g, color] = CH[f.surface ?? 'stone'] ?? CH.stone;
        paint(g, color, (gg) => { gg.fillStyle = color; shapePath(gg, f); gg.fill(); });
      }
      if (f.type === 'field') {
        paint(gb, CH.soil[1], (gg) => { gg.fillStyle = CH.soil[1]; shapePath(gg, f); gg.fill(); });
      }
    }
    for (const f of this.features) {
      if (f.type !== 'path') continue;
      const [g, color] = CH[f.surface ?? 'dirt'] ?? CH.dirt;
      paint(g, color, (gg) => {
        gg.strokeStyle = color;
        gg.lineWidth = (f.width ?? 1.6) * k;
        gg.lineCap = 'round';
        gg.lineJoin = 'round';
        gg.beginPath();
        f.points.forEach((p, i) => { const [px, pz] = toPx(p); if (i) gg.lineTo(px, pz); else gg.moveTo(px, pz); });
        gg.stroke();
      });
    }
    this.maskA = new THREE.CanvasTexture(ca);
    this.maskB = new THREE.CanvasTexture(cb);
    for (const t of [this.maskA, this.maskB]) {
      t.flipY = false; // canvas row 0 is the north edge (z = origin), like the shader's v = 0
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
    }
    this.maskDataA = ga.getImageData(0, 0, R, R).data;
    this.maskDataB = gb.getImageData(0, 0, R, R).data;
  }

  /** What the ground is at a point: { dirt, stone, sand, brick, soil } (0-1), water, slope. */
  surfaceAt(x, z) {
    const R = this.maskRes;
    const px = Math.floor(((x - this.origin[0]) / this.size) * R);
    const pz = Math.floor(((z - this.origin[1]) / this.size) * R);
    const inside = px >= 0 && pz >= 0 && px < R && pz < R;
    const i = (pz * R + px) * 4;
    const a = this.maskDataA, b = this.maskDataB;
    return {
      dirt: inside ? a[i] / 255 : 0,
      stone: inside ? a[i + 1] / 255 : 0,
      sand: inside ? a[i + 2] / 255 : 0,
      brick: inside ? b[i] / 255 : 0,
      soil: inside ? b[i + 1] / 255 : 0,
      water: this.isWater(x, z),
      slope: this.slopeAt(x, z),
    };
  }

  /** Bare grass with nothing painted on it (where grass tufts and wild flowers can grow). */
  isGrass(x, z) {
    const s = this.surfaceAt(x, z);
    return !s.water && s.dirt < 0.2 && s.stone < 0.2 && s.sand < 0.3 && s.brick < 0.2 && s.soil < 0.2 && s.slope < 0.25 && this.heightAt(x, z) > WATER_LEVEL + 0.12;
  }

  /* meshes */

  buildMesh(colors) {
    const n = this.res + 1;
    const g = new THREE.PlaneGeometry(this.size, this.size, this.res, this.res).rotateX(-Math.PI / 2);
    g.translate(this.center[0], 0, this.center[1]);
    const pos = g.attributes.position;
    // PlaneGeometry rows run from -z to +z after the rotation; match our [j * n + i] layout.
    for (let v = 0; v < pos.count; v++) {
      const i = Math.round((pos.getX(v) - this.origin[0]) / this.cell);
      const j = Math.round((pos.getZ(v) - this.origin[1]) / this.cell);
      pos.setY(v, this.heights[Math.min(j, this.res) * n + Math.min(i, this.res)]);
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();

    const season = this.season;
    const grass = colors.grass ?? seasonal(PALETTE.grass, season === 'winter' ? 'autumn' : season);
    const c = (v) => new THREE.Color(v);
    this.uniforms = {
      uMaskA: { value: this.maskA },
      uMaskB: { value: this.maskB },
      uOrigin: { value: new THREE.Vector2(this.origin[0], this.origin[1]) },
      uSize: { value: this.size },
      uGrass: { value: c(grass) },
      uGrass2: { value: c(colors.grass2 ?? new THREE.Color(grass).offsetHSL(0.015, 0.04, -0.06)) },
      uDirt: { value: c(colors.dirt ?? '#c49a69') },
      uStone: { value: c(colors.stone ?? '#c9c2b5') },
      uSand: { value: c(colors.sand ?? PALETTE.sand) },
      uBrick: { value: c(colors.brick ?? '#c46a4e') },
      uSoil: { value: c(colors.soil ?? '#8a6243') },
      uCliff: { value: c(colors.cliff ?? '#9a7a5a') },
      uUnder: { value: c(colors.under ?? '#6f8f7a') },
      uSnow: WORLD_UNIFORMS.uSnow,
      uWet: WORLD_UNIFORMS.uWet,
      uWaterLevel: { value: WATER_LEVEL },
    };
    const mat = new THREE.MeshStandardMaterial({ name: 'terrain', roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_HEAD}\nfloat tSnow = 0.0;\nfloat tPuddle = 0.0;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${TERRAIN_FRAG_COLOR}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, uWet * (1.0 - tSnow));\nroughnessFactor = mix(roughnessFactor, 0.08, tPuddle);');
    };
    mat.customProgramCacheKey = () => 'terrain-1';
    this.material = mat;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'ground';
    this.object.add(this.mesh);
  }

  hasWater() {
    return this.features.some((f) => ['river', 'pond', 'lake', 'sea'].includes(f.type));
  }

  buildWater() {
    if (!this.hasWater()) return;
    // Heights as a texture so the water knows its depth (shallows, foam at the shore). It is
    // sampled twice as finely as the ground mesh so the foam line follows smooth curves.
    const n = this.res * 2 + 1;
    const step = this.size / (n - 1);
    const data = new Uint16Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = this.origin[0] + i * step, z = this.origin[1] + j * step;
        const h = (i % 2 === 0 && j % 2 === 0) ? this.heights[(j / 2) * (this.res + 1) + i / 2] : this.rawHeight(x, z);
        data[j * n + i] = THREE.DataUtils.toHalfFloat(h);
      }
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.heightTexture = tex;

    const sea = this.features.some((f) => f.type === 'sea');
    const extent = sea ? 2400 : this.size;
    const g = new THREE.PlaneGeometry(extent, extent, 1, 1).rotateX(-Math.PI / 2);
    g.translate(this.center[0], WATER_LEVEL, this.center[1]);
    const u = {
      uHeights: { value: tex },
      uOrigin: { value: new THREE.Vector2(this.origin[0] - step * 0.5, this.origin[1] - step * 0.5) },
      uSize: { value: this.size + step },
      uTime: WORLD_UNIFORMS.uTime,
      uWet: WORLD_UNIFORMS.uWet,
      uSnow: WORLD_UNIFORMS.uSnow,
      uShallow: { value: new THREE.Color('#7fd6d8') },
      uDeep: { value: new THREE.Color(sea ? '#2f87b8' : '#3d93b3') },
      uLevel: { value: WATER_LEVEL },
    };
    const mat = new THREE.MeshStandardMaterial({ name: 'water', color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uHeights; uniform vec2 uOrigin; uniform float uSize; uniform float uTime; uniform float uWet; uniform float uSnow;
          uniform vec3 uShallow; uniform vec3 uDeep; uniform float uLevel;
          varying vec3 vWW;
          float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
          float wDepth = 1.0;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 uv = (vWW.xz - uOrigin) / uSize;
            float ground = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? -3.0 : texture2D(uHeights, uv).r;
            wDepth = uLevel - ground;
            float t = smoothstep(0.0, 1.1, wDepth);
            vec3 c = mix(uShallow, uDeep, t);
            float caustic = wNoise(vWW.xz * 2.2 + vec2(uTime * 0.25, uTime * 0.17)) * wNoise(vWW.xz * 3.1 - vec2(uTime * 0.2, -uTime * 0.11));
            c += vec3(0.08, 0.1, 0.09) * smoothstep(0.25, 0.6, caustic) * (1.0 - t);
            float wave = 0.5 + 0.5 * sin(uTime * 1.4 + wNoise(vWW.xz * 0.8) * 6.0);
            float foamLine = smoothstep(0.1 + 0.05 * wave, 0.02, wDepth);
            float foamSpeck = smoothstep(0.6, 0.8, wNoise(vWW.xz * 4.0 + uTime * 0.25)) * smoothstep(0.28, 0.08, wDepth) * 0.6;
            c = mix(c, vec3(0.95, 0.98, 1.0), clamp(foamLine * 0.85 + foamSpeck * 0.5, 0.0, 1.0));
            c = mix(c, vec3(0.86, 0.92, 0.96), uSnow * 0.25);
            diffuseColor.rgb = c;
            diffuseColor.a = mix(0.62, 0.94, smoothstep(0.0, 0.8, wDepth));
            diffuseColor.a = max(diffuseColor.a, foamLine);
            if (wDepth < -0.02) discard;
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 q = vWW.xz;
            float e = 0.15;
            float h0 = wNoise(q * 0.9 + uTime * 0.12) + 0.5 * wNoise(q * 2.3 - uTime * 0.21);
            float hx = wNoise((q + vec2(e, 0.0)) * 0.9 + uTime * 0.12) + 0.5 * wNoise((q + vec2(e, 0.0)) * 2.3 - uTime * 0.21);
            float hz = wNoise((q + vec2(0.0, e)) * 0.9 + uTime * 0.12) + 0.5 * wNoise((q + vec2(0.0, e)) * 2.3 - uTime * 0.21);
            vec3 bump = vec3(h0 - hx, 0.0, h0 - hz) * (0.9 + uWet * 1.2);
            normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);
          }`);
    };
    mat.customProgramCacheKey = () => 'water-1';
    this.water = new THREE.Mesh(g, mat);
    this.water.name = 'water';
    this.water.renderOrder = 2;
    this.water.receiveShadow = true;
    this.object.add(this.water);
  }

  /** A ring of soft distant hills beyond the edge, so the world never ends in a cliff. */
  buildBackdrop(colors) {
    const sea = this.features.find((f) => f.type === 'sea');
    const inner = this.size * 0.47, outer = this.size * 1.6;
    const seg = 160, rings = 10;
    const pos = [], col = [], idx = [];
    const base = new THREE.Color(colors.backdrop ?? seasonal({ spring: '#78ad67', summer: '#5f9a5a', autumn: '#a0935a', winter: '#d9e2ea' }, this.season));
    const far = new THREE.Color(colors.backdropFar ?? seasonal({ spring: '#8fb4a4', summer: '#7fa59a', autumn: '#a7a08a', winter: '#e3e9ef' }, this.season));
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = inner + (outer - inner) * Math.pow(t, 1.4);
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const x = this.center[0] + Math.cos(a) * rad, z = this.center[1] + Math.sin(a) * rad;
        let h = (0.5 + 0.5 * noise3(Math.cos(a) * 2.2 + this.seed, t * 1.5, Math.sin(a) * 2.2)) * (2 + 22 * Math.pow(t, 1.1));
        h += 4 * Math.pow(Math.max(0, noise3(Math.cos(a) * 5 - this.seed, 3, Math.sin(a) * 5)), 2) * t;
        let seaHere = false;
        if (sea) {
          const d = signedDistance(sea, x, z);
          const dirIn = signedDistance(sea, this.center[0] + Math.cos(a) * inner, this.center[1] + Math.sin(a) * inner);
          seaHere = d < 0 || dirIn < 8;
        }
        if (seaHere) h = WATER_LEVEL - 2;
        if (r === 0) h = Math.min(h, this.heightAt(Math.min(Math.max(x, this.origin[0]), this.origin[0] + this.size), Math.min(Math.max(z, this.origin[1]), this.origin[1] + this.size)) - 0.05);
        pos.push(x, h, z);
        const c = base.clone().lerp(far, Math.pow(t, 0.8)).multiplyScalar(0.92 + 0.12 * noise3(a * 3, t * 4, 0.5));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < seg; s++) {
        const a = r * (seg + 1) + s, b = a + seg + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, name: 'backdrop' }));
    mesh.name = 'backdrop';
    mesh.receiveShadow = false;
    this.backdrop = mesh;
    this.object.add(mesh);
  }

  dispose() {
    this.object.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.maskA?.dispose();
    this.maskB?.dispose();
    this.heightTexture?.dispose();
    this.object.removeFromParent();
  }
}
