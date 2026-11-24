import * as THREE from 'three';

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
  eyes: 'classic',       // classic | round | sparkle | dot
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
    g.strokeStyle = p.eyeLine;

    if (expr === 'happy') { // ^ ^
      g.lineWidth = 9;
      g.beginPath(); g.arc(x, y + 14 * k, 34 * k, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      return;
    }
    if (this.blink) { // closed: a soft downward curve
      g.lineWidth = 8;
      g.beginPath(); g.arc(x, y - 18 * k, 36 * k, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
      return;
    }

    const big = expr === 'surprised' ? 1.12 : 1;
    const rx = 44 * k * big, ry = 54 * k * big;
    g.save();
    if (expr === 'sleepy') { g.beginPath(); g.rect(x - 80, y - 8 * k, 160, 140); g.clip(); }

    if (p.eyes === 'dot') {
      g.fillStyle = p.eyeColor;
      g.beginPath(); g.ellipse(x, y, 16 * k * big, 20 * k * big, 0, 0, Math.PI * 2); g.fill();
    } else if (p.eyes === 'round') {
      g.fillStyle = p.eyeColor;
      g.beginPath(); g.ellipse(x, y, rx * 0.78, ry * 0.86, 0, 0, Math.PI * 2); g.fill();
      this.highlight(x + 10 * k, y - 18 * k, 11 * k);
    } else {
      // classic / sparkle: white with an outline and a big iris looking slightly inward
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.lineWidth = 5; g.stroke();
      const irisScale = expr === 'surprised' ? 0.62 : 0.8;
      const ix = x - side * 7 * k, iy = y + 5 * k;
      g.save();
      g.beginPath(); g.ellipse(x, y, rx - 2, ry - 2, 0, 0, Math.PI * 2); g.clip();
      g.fillStyle = p.eyeColor;
      g.beginPath(); g.ellipse(ix, iy, rx * irisScale, ry * irisScale, 0, 0, Math.PI * 2); g.fill();
      if (p.eyes === 'sparkle') {
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.beginPath(); g.ellipse(ix, iy + 4 * k, rx * 0.36, ry * 0.4, 0, 0, Math.PI * 2); g.fill();
      }
      g.restore();
      this.highlight(ix + side * -12 * k + 14 * k, iy - 20 * k, 9 * k);
      if (p.eyes === 'sparkle') {
        this.highlight(ix - 10 * k, iy + 18 * k, 5 * k);
        g.lineWidth = 6;
        g.beginPath(); // two lashes at the outer corner
        g.moveTo(x + side * rx * 0.75, y - ry * 0.62); g.lineTo(x + side * (rx + 12 * k), y - ry * 0.85);
        g.moveTo(x + side * rx * 0.95, y - ry * 0.25); g.lineTo(x + side * (rx + 16 * k), y - ry * 0.4);
        g.stroke();
      }
    }
    g.restore();
    if (expr === 'sleepy') {
      g.lineWidth = 8;
      g.beginPath(); g.moveTo(x - rx * 0.95, y - 6 * k); g.quadraticCurveTo(x, y - 14 * k, x + rx * 0.95, y - 6 * k); g.stroke();
    }
  }

  highlight(x, y, r) {
    const g = this.ctx;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
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
