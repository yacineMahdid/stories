import * as THREE from 'three';
import { EYE_STYLES } from './eyes.js';

// The face is drawn on a 512px canvas that the base model maps onto the front of the head
// (planar UVs over x -0.23..0.23, y 0.56..1.02 in body units). The canvas is seen from the
// front: its left half is on the character's right side.

const SIZE = 512;
const toPx = (x) => ((x + 0.23) / 0.46) * SIZE;
const toPy = (y) => ((1.02 - y) / 0.46) * SIZE;

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
  nose: 'triangle',      // triangle | dot | none
  noseColor: '#ec7a3a',
  mouth: 'smile',        // smile | flat | cat | grin
  mouthColor: '#6b3a22',
  blush: false,
  blushColor: '#f28b82',
  brows: false,
  browColor: '#6b3a22',
};

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'angry', 'sleepy'];

export class Face {
  constructor(material, params = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.anisotropy = 4;
    material.map = this.texture;
    material.transparent = true;
    material.needsUpdate = true;

    this.params = { ...DEFAULT_FACE, ...params };
    this.expression = 'neutral';
    this.talking = false;
    this.blink = 0;           // 0 open, 1 closed
    this.mouthOpen = 0;       // 0..1 while talking
    this.blinkTimer = 1 + Math.random() * 2;
    this.talkTimer = 0;
    this.talkTarget = 0;
    this.lastKey = '';
    this.draw();
  }

  setParams(params) { this.params = { ...DEFAULT_FACE, ...params }; this.lastKey = ''; }
  setExpression(name) { this.expression = EXPRESSIONS.includes(name) ? name : 'neutral'; }

  update(dt) {
    // Blink every few seconds (not while the eyes are closed in a happy squint).
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 1;
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
    const key = `${this.expression}|${this.blink}|${Math.round(this.mouthOpen * 8)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.ctx, p = this.params;
    g.clearRect(0, 0, SIZE, SIZE);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const dx = EYE_DX * p.eyeSpacing;
    const sides = [[SIZE / 2 - dx, -1], [SIZE / 2 + dx, 1]]; // [x, side]: -1 = viewer's left

    if (p.blush || this.expression === 'happy') {
      for (const [, side] of sides) this.blushAt(SIZE / 2 + side * BLUSH_DX, BLUSH_Y);
    }
    for (const [x, side] of sides) this.eye(x, EYE_Y, side);
    if (p.brows || ['sad', 'angry', 'surprised'].includes(this.expression)) {
      for (const [x, side] of sides) this.brow(x, EYE_Y - 82 * p.eyeSize, side);
    }
    this.nose(SIZE / 2, NOSE_Y);
    this.mouth(SIZE / 2, MOUTH_Y);
    this.texture.needsUpdate = true;
  }

  blushAt(x, y) {
    const g = this.ctx;
    const grad = g.createRadialGradient(x, y, 4, x, y, 40);
    grad.addColorStop(0, this.params.blushColor + 'cc');
    grad.addColorStop(1, this.params.blushColor + '00');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(x, y, 44, 28, 0, 0, Math.PI * 2); g.fill();
  }

  eye(x, y, side) {
    const g = this.ctx, p = this.params, k = p.eyeSize;
    const expr = this.expression;
    const style = EYE_STYLES[p.eyes] ?? EYE_STYLES.classic;
    g.strokeStyle = p.eyeLine;
    g.lineCap = 'round';

    if (expr === 'happy' || style.closed) { // ^ ^
      g.lineWidth = 9;
      g.beginPath(); g.arc(x, y + 14 * k, 34 * k, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      return;
    }
    if (this.blink) { // closed: a soft downward curve
      g.lineWidth = 8;
      g.beginPath(); g.arc(x, y - 18 * k, 36 * k, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
      return;
    }

    const surprised = expr === 'surprised';
    const size = surprised ? k * 1.12 : k;
    g.save();
    if (expr === 'sleepy') { g.beginPath(); g.rect(x - 90 * k, y - 8 * k, 180 * k, 150 * k); g.clip(); }
    style.draw(g, x, y, side, size, p, { surprised });
    g.restore();
    if (expr === 'sleepy') {
      g.strokeStyle = p.eyeLine;
      g.lineWidth = 8;
      g.beginPath(); g.moveTo(x - 42 * size, y - 6 * k); g.quadraticCurveTo(x, y - 14 * k, x + 42 * size, y - 6 * k); g.stroke();
    }
  }

  brow(x, y, side) {
    const g = this.ctx;
    const tilt = { sad: -0.35, angry: 0.4, surprised: 0 }[this.expression] ?? 0;
    const lift = this.expression === 'surprised' ? -14 : 0;
    g.strokeStyle = this.params.browColor;
    g.lineWidth = 9;
    g.save();
    g.translate(x, y + lift);
    g.rotate(side * tilt * -1);
    g.beginPath(); g.moveTo(-30, 4); g.quadraticCurveTo(0, -8, 30, 4); g.stroke();
    g.restore();
  }

  nose(x, y) {
    const g = this.ctx, p = this.params;
    if (p.nose === 'none') return;
    g.fillStyle = p.noseColor;
    if (p.nose === 'dot') {
      g.beginPath(); g.ellipse(x, y, 13, 9, 0, 0, Math.PI * 2); g.fill();
      return;
    }
    g.beginPath(); g.moveTo(x - 18, y - 12); g.lineTo(x + 18, y - 12); g.lineTo(x, y + 14); g.closePath(); g.fill();
  }

  mouth(x, y) {
    const g = this.ctx, p = this.params, expr = this.expression;
    const open = this.mouthOpen;
    g.strokeStyle = p.mouthColor;
    g.lineWidth = 7;

    if (open > 0.08 || expr === 'surprised' || expr === 'happy') {
      const h = expr === 'surprised' && open < 0.08 ? 26 : 8 + 30 * Math.max(open, expr === 'happy' ? 0.55 : 0);
      const w = expr === 'surprised' && open < 0.08 ? 20 : 34;
      g.fillStyle = '#7a2a2e';
      g.beginPath();
      if (expr === 'surprised' && open < 0.08) g.ellipse(x, y + 6, w, h, 0, 0, Math.PI * 2);
      else { g.moveTo(x - w, y - 4); g.quadraticCurveTo(x, y - 10, x + w, y - 4); g.quadraticCurveTo(x + w * 0.8, y + h, x, y + h); g.quadraticCurveTo(x - w * 0.8, y + h, x - w, y - 4); }
      g.fill();
      g.fillStyle = '#e8737a';
      g.beginPath(); g.ellipse(x, y + h * 0.72, w * 0.5, h * 0.28, 0, 0, Math.PI * 2); g.fill();
      return;
    }

    const style = expr === 'sad' || expr === 'angry' ? (expr === 'sad' ? 'frown' : 'flat') : p.mouth;
    g.beginPath();
    if (style === 'flat') { g.moveTo(x - 22, y + 2); g.lineTo(x + 22, y + 2); }
    else if (style === 'frown') { g.arc(x, y + 34, 30, Math.PI * 1.2, Math.PI * 1.8); }
    else if (style === 'cat') { g.arc(x - 14, y - 2, 14, 0.1 * Math.PI, 0.9 * Math.PI); g.moveTo(x + 28, y - 2); g.arc(x + 14, y - 2, 14, 0.1 * Math.PI, 0.9 * Math.PI); }
    else if (style === 'grin') { g.arc(x, y - 22, 40, 0.18 * Math.PI, 0.82 * Math.PI); }
    else { g.arc(x, y - 22, 34, 0.22 * Math.PI, 0.78 * Math.PI); }
    g.stroke();
  }

  dispose() { this.texture.dispose(); }
}
