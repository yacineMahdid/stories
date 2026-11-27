import * as THREE from 'three';
import { EYE_STYLES } from './eyes.js';
import { EMOTIONS } from './emotions.js';
import {
  EYE_MODES, ANIMATED_EYES, drawBrow, MOUTHS, ANIMATED_MOUTHS, NOSES,
  drawCheeks, drawTears, ANIMATED_TEARS, drawShade, blushAt,
} from './face-parts.js';

// The face is drawn on a 512px canvas that the base model maps onto the front of the head
// (planar UVs over x -0.23..0.23, y 0.56..1.02 in body units). The canvas is seen from the
// front: its left half is on the character's right side.

const SIZE = 512;
const TAU = Math.PI * 2;
const toPx = (x) => ((x + 0.23) / 0.46) * SIZE;
const toPy = (y) => ((1.02 - y) / 0.46) * SIZE;
const HEAD_TOP = 0.45; // the canvas's top row in Head-bone space (the Head bone is at y 0.57)

// Where the face layer mesh lies on the canvas, its edges faded in: white well inside the mesh,
// half from 20 px inside its edges (sides, jaw and crown), clear at them. Built once per geometry.
const FOOTPRINTS = new WeakMap();
const FOOTPRINT_EDGE = 40, FOOTPRINT_BLUR = 8; // the band taken off along the edges (half of it inside), the fade

function footprint(geometry) {
  let mask = FOOTPRINTS.get(geometry);
  if (mask) return mask;
  const uv = geometry.attributes.uv, index = geometry.index, at = (i) => [uv.getX(i) * SIZE, uv.getY(i) * SIZE]; // flipY off: v runs down the canvas
  const vertex = (t) => (index ? index.getX(t) : t);
  const shape = document.createElement('canvas');
  shape.width = shape.height = SIZE;
  const g = shape.getContext('2d');
  const tri = [], edges = new Map();
  for (let t = 0; t < (index ?? uv).count; t += 3) {
    const v = [vertex(t), vertex(t + 1), vertex(t + 2)];
    tri.push(v);
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  g.fillStyle = '#fff';
  g.beginPath(); // one path, so shared edges leave no seams
  for (const v of tri) { const [a, b, c] = v.map(at); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c); g.closePath(); }
  g.fill();
  g.globalCompositeOperation = 'destination-out'; // take a band off along the mesh's open edges
  g.lineWidth = FOOTPRINT_EDGE; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  for (const [key, n] of edges) {
    if (n !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    g.moveTo(...at(a)); g.lineTo(...at(b));
  }
  g.stroke();
  mask = document.createElement('canvas');
  mask.width = mask.height = SIZE;
  const m = mask.getContext('2d');
  m.filter = `blur(${FOOTPRINT_BLUR}px)`;
  m.drawImage(shape, 0, 0);
  FOOTPRINTS.set(geometry, mask);
  return mask;
}

// Feature anchors (body units -> canvas pixels).
const EYE_Y = toPy(0.745);
const EYE_DX = toPx(0.105) - SIZE / 2;
const NOSE_Y = toPy(0.69);
const MOUTH_Y = toPy(0.655);
const BLUSH_Y = toPy(0.68);
const BLUSH_DX = toPx(0.165) - SIZE / 2;

export const DEFAULT_FACE = {
  eyes: 'classic',       // any key of EYE_STYLES in eyes.js
  eyeColor: '#2c2a2b',   // iris / pupil
  eyeLine: '#6b3a22',    // outline, lashes, closed-eye strokes
  eyeSize: 1,
  eyeSpacing: 1,
  nose: 'triangle',      // any key of NOSES in face-parts.js
  noseColor: '#ec7a3a',
  mouth: 'smile',        // resting mouth: any key of MOUTHS in face-parts.js
  mouthColor: '#6b3a22',
  lipColor: '#d9566b',
  blush: false,
  blushColor: '#f28b82',
  brows: false,
  browColor: '#6b3a22',
  eyeY: 0, noseY: 0, mouthY: 0,   // feature offsets in canvas pixels (for snouts and wide heads)
  mask: null,                     // { color, shape: 'heart' | 'oval' | 'muzzle' } painted under the features
  whiskers: null,                 // color of whiskers, or null
};

// Eye modes drawn with the character's own eye style (and so able to blink).
const STYLE_MODES = new Set(['style', 'wide', 'half', 'teary', 'determined', 'wink']);

export const EXPRESSIONS = Object.keys(EMOTIONS);

export class Face {
  constructor(material, params = {}) {
    // Drawn at 2x (1024px) for crisp features up close; all drawing uses 512-px coordinates.
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE * 2;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(2, 0, 0, 2, 0, 0);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.anisotropy = 8;
    material.map = this.texture;
    material.transparent = true;
    material.needsUpdate = true;

    this.params = { ...DEFAULT_FACE, ...params };
    this.emotionId = 'neutral';
    this.emotion = EMOTIONS.neutral;
    this.time = 0;
    this.talking = false;
    this.blink = 0;           // 0 open, 1 closed
    this.mouthOpen = 0;       // 0..1 while talking
    this.blinkTimer = 1 + Math.random() * 2;
    this.talkTimer = 0;
    this.talkTarget = 0;
    this.lastKey = '';
    this.muzzle = null;
    this.browRidge = false;
    this.draw();
  }

  /** A snout that carries the mouth (see muzzle() in parts.js), or null to draw it on the face. */
  setMuzzle(muzzle) { this.muzzle = muzzle; this.lastKey = ''; }

  /** Extra layers in the face's material that show this canvas too (eye domes, see parts.js):
   *  the eyes sit on them, so the brows are drawn lower, on the domes' upper fronts. */
  setLayers(materials) {
    for (const m of materials) { m.map = this.texture; m.needsUpdate = true; }
    this.domed = materials.length > 0;
    this.lastKey = '';
  }

  /** A furred face has no hair to hide the canvas's edges, so the emotion's shade fades out before them. */
  setFurry(on) { this.furry = on; this.lastKey = ''; }

  /** The face layer mesh this canvas is drawn on: a furred face's shade fades out before its edges. */
  setFootprint(geometry) { this.footprintGeometry = geometry; this.lastKey = ''; }

  /** A 3D brow ridge (see parts.js) shows the brows, so none are drawn under it. */
  setBrowRidge(on) { this.browRidge = on; this.lastKey = ''; }

  setParams(params) { this.params = { ...DEFAULT_FACE, ...params }; this.lastKey = ''; }

  setEmotion(id) {
    this.emotionId = EMOTIONS[id] ? id : 'neutral';
    this.emotion = EMOTIONS[this.emotionId];
    this.lastKey = '';
  }

  setExpression(id) { this.setEmotion(id); }

  get eyeMode() { return this.emotion.eyes ?? 'style'; }

  get animated() {
    const e = this.emotion;
    return ANIMATED_EYES.has(e.eyes) || ANIMATED_MOUTHS.has(e.mouth) || ANIMATED_TEARS.has(e.tears);
  }

  update(dt) {
    this.time += dt;
    // Blink every few seconds, only when the eyes are open in the character's own style.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = STYLE_MODES.has(this.eyeMode) ? 1 : 0;
      if (this.blinkTimer <= -0.13) { this.blink = 0; this.blinkTimer = 2 + Math.random() * 3.5; }
    }
    // Mouth flaps while talking.
    if (this.talking) {
      this.talkTimer -= dt;
      if (this.talkTimer <= 0) { this.talkTarget = Math.random() < 0.2 ? 0.1 : 0.35 + Math.random() * 0.65; this.talkTimer = 0.07 + Math.random() * 0.08; }
    } else {
      this.talkTarget = 0;
    }
    this.mouthOpen += (this.talkTarget - this.mouthOpen) * Math.min(1, dt * 25);
    this.draw();
  }

  draw() {
    const tick = this.animated ? Math.floor(this.time * 30) : 0;
    const key = `${this.emotionId}|${this.blink}|${Math.round(this.mouthOpen * 8)}|${tick}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.ctx, p = this.params, e = this.emotion, k = p.eyeSize, t = this.time;
    const dx = EYE_DX * p.eyeSpacing;
    const eyeY = EYE_Y + p.eyeY, noseY = NOSE_Y + p.noseY, mouthY = MOUTH_Y + p.mouthY;
    const layout = { eyeY, eyeDX: dx, blushY: BLUSH_Y + p.eyeY * 0.5, blushDX: BLUSH_DX };
    const eyes = [[SIZE / 2 - dx, -1], [SIZE / 2 + dx, 1]]; // [x, side]: -1 = viewer's left
    g.clearRect(0, 0, SIZE, SIZE);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (p.mask) this.mask(p.mask, eyes, eyeY, mouthY);

    if (e.cheeks) drawCheeks(g, e.cheeks, layout, p);
    else if (p.blush) for (const [, side] of eyes) blushAt(g, SIZE / 2 + side * BLUSH_DX, BLUSH_Y, p.blushColor);

    const glow = this.eyeMode === 'glow';
    if (!glow) for (const [x, side] of eyes) this.eye(x, eyeY, side);
    const brows = e.brows ?? (p.brows ? 'soft' : null);
    if (brows && !this.browRidge) for (const [x, side] of eyes) drawBrow(g, x, eyeY - (this.domed ? 49 : 82) * k, side, brows, p);
    if (e.shade) {
      if (this.furry || this.muzzle) this.softShade(e.shade, layout, eyeY);
      else drawShade(g, e.shade, layout);
    } else if (this.muzzle?.shade) {
      this.muzzle.shade.material.visible = false;
    }
    if (glow) for (const [x, side] of eyes) EYE_MODES.glow(g, x, eyeY, side, k, p, t, e);
    if (e.tears) drawTears(g, e.tears, layout, k, t);

    if (p.whiskers) this.whiskers(p.whiskers, noseY);
    this.nose(SIZE / 2, noseY);
    if (this.muzzle) this.drawMuzzle(p, e, t);
    else this.mouth(g, SIZE / 2, mouthY, p, e, t);
    this.texture.needsUpdate = true;
  }

  mouth(g, x, y, p, e, t) {
    if (this.talking && this.mouthOpen > 0.08) this.talkMouth(g, x, y);
    else (MOUTHS[e.mouth ?? p.mouth] ?? MOUTHS.smile)(g, x, y, p, t);
  }

  /** The mouth on the snout: the canvas is projected onto it from the front, so one face pixel
   *  there is as wide as on the face (times the snout's mouth scale). */
  drawMuzzle(p, e, t) {
    const m = this.muzzle, g = m.ctx, W = m.size, perUnit = SIZE / 0.46;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (m.base) g.drawImage(m.base, 0, 0); // the snout's own paint: its color, nostrils
    else { g.fillStyle = m.color; g.fillRect(0, 0, W, W); }
    g.setTransform(m.scale * W / (2 * perUnit * m.radii[0]), 0, 0, m.scale * W / (2 * perUnit * m.radii[1]), W / 2, (0.5 - m.mouthY / 2) * W);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    this.mouth(g, 0, 0, p, e, t);
    m.texture.needsUpdate = true;
  }

  /** The emotion's shade in an oval around the eyes, fading out before the canvas's sides and top
   *  and before the face layer's edges (the head goes on past them, unshaded). */
  softShade(amount, layout, eyeY) {
    if (!this.shadeCanvas) {
      this.shadeCanvas = document.createElement('canvas');
      this.shadeCanvas.width = this.shadeCanvas.height = SIZE * 2;
    }
    const g = this.shadeCanvas.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, SIZE, SIZE);
    drawShade(g, amount, layout);
    g.globalCompositeOperation = 'destination-in';
    const ry = Math.max(eyeY, 120) + 20;
    g.translate(SIZE / 2, eyeY);
    g.scale(1, ry / 236);
    const oval = g.createRadialGradient(0, 0, 0, 0, 0, 236);
    oval.addColorStop(0, '#000');
    oval.addColorStop(0.55, '#000');
    oval.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = oval;
    g.fillRect(-SIZE, -SIZE * 2, SIZE * 2, SIZE * 4);
    if (this.footprintGeometry) { g.setTransform(2, 0, 0, 2, 0, 0); g.drawImage(footprint(this.footprintGeometry), 0, 0); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    if (this.muzzle?.shade) this.shadeMuzzle(this.muzzle, `${amount}|${eyeY}`);
    this.ctx.drawImage(this.shadeCanvas, 0, 0, SIZE, SIZE);
  }

  /**
   * Where a snout rises into the shade, its own shade layer (in the face layer's material, see
   * shadeLayer in parts.js) carries it, and the face's shade is taken off the snout: the face layer
   * also lies over the snout's low fillet, so shading both would darken a rim there. Over the
   * fillet the two fade into each other (the snout's shade mask), and add up to the one shade.
   * Both canvases are front projections, so a face pixel maps to the snout's canvas through Head space.
   */
  shadeMuzzle(m, key) {
    const s = m.shade, W = s.size, [cx, cy] = m.center, [rx, ry] = m.radii, k = 0.46 / SIZE;
    const ax = (W * k) / (2 * rx), bx = W * (0.5 - (0.23 + cx) / (2 * rx)), ay = (W * k) / (2 * ry), by = W * (0.5 - (HEAD_TOP - cy) / (2 * ry));
    if (s.key !== key) { // the snout's part of the shade (the mask's inside)
      s.key = key;
      const g = s.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, W);
      g.setTransform(ax, 0, 0, ay, bx, by);
      g.drawImage(this.shadeCanvas, 0, 0, SIZE, SIZE);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(s.mask, 0, 0, W, W);
      g.globalCompositeOperation = 'source-over';
      s.texture.needsUpdate = true;
    }
    s.material.visible = true;
    const f = this.shadeCanvas.getContext('2d'); // and the face's part (the mask's outside)
    f.setTransform(2 / ax, 0, 0, 2 / ay, (-2 * bx) / ax, (-2 * by) / ay);
    f.globalCompositeOperation = 'destination-out';
    f.drawImage(s.mask, 0, 0, W, W);
    f.globalCompositeOperation = 'source-over';
    f.setTransform(1, 0, 0, 1, 0, 0);
  }

  mask({ color, shape = 'heart' }, eyes, eyeY, mouthY) {
    const g = this.ctx;
    g.save();
    if (this.browRidge) { // the ridge's shelf starts at the tops of the eyes: no mask above, where it would show through
      const top = eyeY - 40 * this.params.eyeSize;
      g.beginPath(); g.moveTo(0, SIZE);
      for (let x = 0; x <= SIZE; x += 16) g.lineTo(x, top + 0.012 * Math.max(0, Math.abs(x - SIZE / 2) - 110) ** 2); // rounding down past the ridge's ends
      g.lineTo(SIZE, SIZE); g.closePath(); g.clip();
    }
    g.fillStyle = color;
    g.beginPath();
    if (shape === 'heart' && this.browRidge) { // one soft shape tucked under the ridge: round the eyes, in at the cheeks, round the mouth
      const top = eyeY - 40 * this.params.eyeSize, cx = SIZE / 2, ox = cx - eyes[0][0] + 60, my = mouthY - 12;
      g.moveTo(cx - ox, top + 18);
      g.bezierCurveTo(cx - ox * 0.5, top + 2, cx + ox * 0.5, top + 2, cx + ox, top + 18);
      // each side from the top corner down round the eye, in at the cheek and round the mouth to the chin
      const side = (s) => [
        [cx + s * (ox + 22), eyeY - 5, cx + s * (ox + 12), eyeY + 55, cx + s * (ox - 30), eyeY + 85],
        [cx + s * (ox - 55), eyeY + 100, cx + s * 95, my - 20, cx + s * 92, my + 10],
        [cx + s * 88, my + 48, cx + s * 42, my + 72, cx, my + 72],
      ];
      for (const c of side(1)) g.bezierCurveTo(...c);
      const left = side(-1), starts = [[cx - ox, top + 18], ...left.map((c) => c.slice(4))];
      for (let i = left.length - 1; i >= 0; i--) g.bezierCurveTo(...left[i].slice(2, 4), ...left[i].slice(0, 2), ...starts[i]); // back up the other side
    } else if (shape === 'heart') { // around both eyes and down over the mouth (monkeys)
      for (const [x] of eyes) g.ellipse(x + (SIZE / 2 - x) * 0.12, eyeY + 6, 74, 80, 0, 0, TAU);
      g.ellipse(SIZE / 2, mouthY - 12, 92, 74, 0, 0, TAU);
    } else if (shape === 'muzzle') {
      g.ellipse(SIZE / 2, mouthY - 22, 96, 70, 0, 0, TAU);
    } else {
      g.ellipse(SIZE / 2, (eyeY + mouthY) / 2, 170, 150, 0, 0, TAU);
    }
    g.fill();
    g.restore();
  }

  whiskers(color, noseY) {
    const g = this.ctx;
    g.strokeStyle = color; g.lineWidth = 4; g.globalAlpha = 0.85;
    g.beginPath();
    for (const side of [-1, 1]) {
      for (const [dy, tilt] of [[-6, -14], [6, 0], [18, 14]]) {
        g.moveTo(SIZE / 2 + side * 62, noseY + dy);
        g.lineTo(SIZE / 2 + side * 136, noseY + dy + tilt);
      }
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  eye(x, y, side) {
    const g = this.ctx, p = this.params, k = p.eyeSize, e = this.emotion, mode = this.eyeMode;
    if (EYE_MODES[mode]) { EYE_MODES[mode](g, x, y, side, k, p, this.time, e); return; }

    const style = EYE_STYLES[p.eyes] ?? EYE_STYLES.classic;
    if ((mode === 'wink' && side > 0) || style.closed) { EYE_MODES.happy(g, x, y, side, k, p); return; }
    if (this.blink) { EYE_MODES.closed(g, x, y, side, k, p); return; }

    const size = mode === 'wide' ? k * 1.14 : k;
    g.save();
    if (mode === 'half') { g.beginPath(); g.rect(x - 90 * k, y - 8 * k, 180 * k, 150 * k); g.clip(); }
    if (mode === 'determined') { // lids slanting down toward the nose
      g.beginPath(); g.moveTo(x + side * 70 * k, y - 34 * k); g.lineTo(x - side * 70 * k, y - 10 * k); g.lineTo(x - side * 70 * k, y + 90 * k); g.lineTo(x + side * 70 * k, y + 90 * k); g.closePath(); g.clip();
    }
    style.draw(g, x, y, side, size, p, { gaze: e.gaze, surprised: mode === 'wide' });
    g.restore();

    g.strokeStyle = p.eyeLine;
    if (mode === 'half') {
      g.lineWidth = 8;
      g.beginPath(); g.moveTo(x - 44 * k, y - 6 * k); g.quadraticCurveTo(x, y - 14 * k, x + 44 * k, y - 6 * k); g.stroke();
    }
    if (mode === 'determined') {
      g.lineWidth = 9;
      g.beginPath(); g.moveTo(x + side * 50 * k, y - 32 * k); g.lineTo(x - side * 46 * k, y - 12 * k); g.stroke();
    }
    if (mode === 'teary') { // water pooling in the eyes, extra shine
      g.save();
      g.beginPath(); g.ellipse(x, y, 44 * k, 54 * k, 0, 0, TAU); g.clip();
      g.fillStyle = 'rgba(150, 210, 255, 0.55)';
      g.fillRect(x - 50 * k, y + 20 * k, 100 * k, 40 * k);
      g.restore();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(x + 8 * k, y + 24 * k, 14 * k, 5 * k, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(x - 14 * k, y - 4 * k, 6 * k, 0, TAU); g.fill();
    }
  }

  nose(x, y) {
    (NOSES[this.params.nose] ?? NOSES.triangle)(this.ctx, x, y, this.params);
  }

  talkMouth(g, x, y) {
    const h = 8 + 30 * this.mouthOpen, w = 34;
    g.fillStyle = '#7a2a2e';
    g.beginPath();
    g.moveTo(x - w, y - 4); g.quadraticCurveTo(x, y - 10, x + w, y - 4);
    g.quadraticCurveTo(x + w * 0.8, y + h, x, y + h); g.quadraticCurveTo(x - w * 0.8, y + h, x - w, y - 4);
    g.fill();
    g.fillStyle = '#e8737a';
    g.beginPath(); g.ellipse(x, y + h * 0.72, w * 0.5, h * 0.28, 0, 0, TAU); g.fill();
  }

  dispose() { this.texture.dispose(); }
}
