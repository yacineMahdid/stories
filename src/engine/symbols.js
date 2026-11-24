import * as THREE from 'three';
import { dropPath } from './face-parts.js';

// Manga symbols that float around a character's head: sweat drops, anger veins, steam, !, ?,
// Zzz, hearts, notes, sparkles, gloom lines, dizzy stars, light bulbs, "...", menacing ゴゴゴ,
// shock marks, a snot bubble, a rain cloud and comedic tear fountains. They are sprites
// parented to the Head bone (positions below are in Head-bone space: y up from the neck,
// +z toward the face, +x the character's left), so they follow the head and scale with it.

const TAU = Math.PI * 2;
const textures = new Map();

function icon(name, w = 128, h = 128) {
  if (!textures.has(name)) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    ICONS[name](g, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.set(name, tex);
  }
  return textures.get(name);
}

function outlinedText(g, text, x, y, size, fill, outline = '#ffffff', width = 12) {
  g.font = `900 ${size}px "Arial Black", Arial, Helvetica, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = width; g.strokeStyle = outline; g.strokeText(text, x, y);
  g.fillStyle = fill; g.fillText(text, x, y);
}

function heart(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.35, y + s * 0.05, x - s * 0.95, y - s, x, y - s * 0.38);
  g.bezierCurveTo(x + s * 0.95, y - s, x + s * 1.35, y + s * 0.05, x, y + s * 0.9);
  g.closePath();
}

function star(g, x, y, r, inner = 0.45) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * inner : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

const ICONS = {
  drop(g) {
    dropPath(g, 64, 74, 34);
    g.fillStyle = 'rgba(140, 205, 255, 0.95)'; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#2a6fb5'; g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(52, 78, 8, 12, -0.4, 0, TAU); g.fill();
  },
  vein(g) {
    g.strokeStyle = '#ffffff'; g.lineWidth = 22;
    const arcs = () => {
      for (let i = 0; i < 4; i++) {
        g.save(); g.translate(64, 64); g.rotate((i * Math.PI) / 2);
        g.beginPath(); g.moveTo(12, -44); g.quadraticCurveTo(12, -12, 44, -12); g.stroke();
        g.restore();
      }
    };
    arcs();
    g.strokeStyle = '#d7262b'; g.lineWidth = 12;
    arcs();
  },
  puff(g) {
    g.fillStyle = '#f5f5f5'; g.strokeStyle = '#9aa0a6'; g.lineWidth = 5;
    const blobs = [[44, 74, 26], [72, 60, 30], [92, 80, 22], [64, 86, 24]];
    for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
    for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r - 2, 0, TAU); g.fill(); }
  },
  exclaim(g) {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(44, 6, 40, 86, 18); g.fill(); g.beginPath(); g.arc(64, 110, 18, 0, TAU); g.fill();
    g.fillStyle = '#e0312f';
    g.beginPath(); g.roundRect(50, 12, 28, 74, 13); g.fill(); g.beginPath(); g.arc(64, 110, 12, 0, TAU); g.fill();
  },
  question(g) { outlinedText(g, '?', 64, 70, 118, '#2f6fd6'); },
  z(g) { outlinedText(g, 'Z', 64, 66, 112, '#4a5fc1'); },
  heart(g) {
    heart(g, 64, 64, 46);
    g.fillStyle = '#ef3e5c'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(44, 50, 10, 6, -0.7, 0, TAU); g.fill();
  },
  note(g) {
    const draw = (color, width) => {
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width;
      g.beginPath(); g.ellipse(46, 96, 20 + width / 3, 14 + width / 3, -0.4, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(64, 92); g.lineTo(64, 18); g.quadraticCurveTo(88, 34, 98, 54); g.stroke();
    };
    draw('#ffffff', 16); draw('#3b3b48', 8);
  },
  sparkle(g) {
    g.shadowColor = '#fff3a0'; g.shadowBlur = 18;
    g.fillStyle = '#fffbe0';
    g.beginPath();
    g.moveTo(64, 6); g.quadraticCurveTo(70, 58, 122, 64); g.quadraticCurveTo(70, 70, 64, 122);
    g.quadraticCurveTo(58, 70, 6, 64); g.quadraticCurveTo(58, 58, 64, 6); g.fill();
  },
  gloom(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(60, 45, 140, 0.95)');
    grad.addColorStop(1, 'rgba(60, 45, 140, 0)');
    g.strokeStyle = grad; g.lineWidth = 7;
    g.beginPath();
    for (let x = 14; x < w; x += 22) { g.moveTo(x, 0); g.lineTo(x, h * (0.55 + 0.45 * ((x * 13) % 7) / 7)); }
    g.stroke();
  },
  star(g) {
    star(g, 64, 66, 54, 0.48);
    g.fillStyle = '#ffd23f'; g.fill(); g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke();
    g.lineWidth = 3; g.strokeStyle = '#c47f00'; g.stroke();
  },
  bulb(g) {
    g.strokeStyle = '#ffd23f'; g.lineWidth = 7;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i * Math.PI) / 6;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 50, 56 + Math.sin(a) * 50); g.lineTo(64 + Math.cos(a) * 62, 56 + Math.sin(a) * 62); g.stroke();
    }
    g.fillStyle = '#fff6a8'; g.strokeStyle = '#c99a00'; g.lineWidth = 5;
    g.beginPath(); g.arc(64, 56, 34, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = '#9aa0a6'; g.fillRect(48, 88, 32, 22);
    g.strokeStyle = '#6b7178'; g.beginPath(); g.moveTo(48, 96); g.lineTo(80, 96); g.moveTo(48, 104); g.lineTo(80, 104); g.stroke();
  },
  dot(g) { g.fillStyle = '#2b2b33'; g.beginPath(); g.arc(64, 64, 40, 0, TAU); g.fill(); },
  go(g) { // ゴ drawn with strokes: コ plus the two dakuten ticks
    g.save(); g.translate(64, 64); g.transform(1, 0, -0.18, 1, 0, 0);
    const strokes = () => {
      g.beginPath(); g.moveTo(-40, -30); g.lineTo(26, -30); g.lineTo(26, 34); g.lineTo(-40, 34); g.stroke();
      g.beginPath(); g.moveTo(34, -52); g.lineTo(42, -36); g.moveTo(48, -56); g.lineTo(56, -40); g.stroke();
    };
    g.strokeStyle = '#1d0f24'; g.lineWidth = 26; strokes();
    g.strokeStyle = '#8b3fb5'; g.lineWidth = 14; strokes();
    g.restore();
  },
  shock(g) {
    g.strokeStyle = '#ffffff'; g.lineWidth = 16;
    const zig = () => { g.beginPath(); g.moveTo(20, 110); g.lineTo(58, 70); g.lineTo(44, 62); g.lineTo(96, 16); g.stroke(); };
    zig(); g.strokeStyle = '#2b2b33'; g.lineWidth = 8; zig();
  },
  bubble(g) {
    g.fillStyle = 'rgba(160, 215, 255, 0.45)'; g.strokeStyle = 'rgba(70, 140, 210, 0.9)'; g.lineWidth = 5;
    g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(46, 42, 14, 9, -0.6, 0, TAU); g.fill();
  },
  cloud(g, w, h) {
    g.strokeStyle = 'rgba(90, 110, 200, 0.85)'; g.lineWidth = 5;
    for (let x = 40; x < w - 30; x += 26) { g.beginPath(); g.moveTo(x, h * 0.62); g.lineTo(x - 8, h * 0.95); g.stroke(); }
    g.fillStyle = '#5d6170';
    for (const [x, y, r] of [[60, 50, 30], [100, 38, 36], [146, 46, 32], [180, 58, 24], [120, 62, 30]]) { g.beginPath(); g.arc(x * w / 240, y, r, 0, TAU); g.fill(); }
  },
  fountain(g, w, h) {
    g.strokeStyle = 'rgba(120, 195, 255, 0.95)'; g.lineWidth = 22;
    g.beginPath(); g.moveTo(10, h * 0.35); g.quadraticCurveTo(w * 0.55, -h * 0.25, w - 20, h * 0.85); g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(30, h * 0.28); g.quadraticCurveTo(w * 0.5, -h * 0.18, w * 0.8, h * 0.45); g.stroke();
    g.fillStyle = 'rgba(120, 195, 255, 0.95)';
    for (const [x, y, r] of [[w - 34, h * 0.96, 9], [w - 70, h * 0.9, 7], [w - 8, h * 0.7, 6]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  },
};

const ICON_SIZES = { gloom: [256, 128], cloud: [256, 128], fountain: [256, 128] };

function sprite(name, w, h = w) {
  const [cw, ch] = ICON_SIZES[name] ?? [128, 128];
  const material = new THREE.SpriteMaterial({ map: icon(name, cw, ch), transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const s = new THREE.Sprite(material);
  s.scale.set(w, h, 1);
  s.userData.base = [w, h];
  return s;
}

const cycle = (t, period, offset = 0) => (((t + offset) % period) + period) % period / period;
const fade = (u) => Math.min(1, u * 5, (1 - u) * 5);

// Each factory returns sprites plus an update(t) that animates them.
const SYMBOLS = {
  sweat() {
    const s = sprite('drop', 0.09, 0.11);
    return [s, (t) => { const u = cycle(t, 1.8); s.position.set(0.25, 0.34 - 0.04 * u, 0.1); s.material.opacity = fade(u); }];
  },
  sweats() {
    const parts = [[0.24, 0.4, 0.6], [-0.24, 0.38, -0.6], [0.16, 0.48, 0.3]].map(([x, y, dir]) => ({ s: sprite('drop', 0.05, 0.06), x, y, dir }));
    return [parts.map((p) => p.s), (t) => parts.forEach((p, i) => {
      const u = cycle(t, 0.9, i * 0.3);
      p.s.position.set(p.x + Math.sign(p.x) * 0.06 * u, p.y + 0.03 * Math.sin(u * Math.PI), 0.06);
      p.s.material.rotation = -p.dir;
      p.s.material.opacity = fade(u);
    })];
  },
  vein() {
    const s = sprite('vein', 0.1);
    return [s, (t) => { const k = 1 + 0.18 * Math.max(0, Math.sin(t * 11)); s.position.set(-0.15, 0.37, 0.24); s.scale.set(0.1 * k, 0.1 * k, 1); }];
  },
  steam() {
    const parts = [-1, 1].map((side) => ({ s: sprite('puff', 0.08), side }));
    return [parts.map((p) => p.s), (t) => parts.forEach((p, i) => {
      const u = cycle(t, 1.1, i * 0.55), k = 0.06 + 0.07 * u;
      p.s.position.set(p.side * (0.2 + 0.07 * u), 0.42 + 0.14 * u, 0.02);
      p.s.scale.set(k, k, 1); p.s.material.opacity = fade(u);
    })];
  },
  exclaim() {
    const s = sprite('exclaim', 0.11, 0.15);
    return [s, (t) => { s.position.set(0.21, 0.58 + 0.012 * Math.abs(Math.sin(t * 7)), 0.05); }];
  },
  question() {
    const s = sprite('question', 0.13, 0.15);
    return [s, (t) => { s.position.set(0.21, 0.58, 0.05); s.material.rotation = 0.22 * Math.sin(t * 3); }];
  },
  zzz() {
    const parts = [0, 1, 2].map(() => sprite('z', 0.06));
    return [parts, (t) => parts.forEach((s, i) => {
      const u = cycle(t, 2.4, i * 0.8), k = 0.04 + 0.07 * u;
      s.position.set(0.16 + 0.16 * u, 0.42 + 0.22 * u, 0.05);
      s.scale.set(k, k, 1); s.material.opacity = fade(u);
    })];
  },
  hearts() {
    const parts = [[-0.22, 0.0], [0.24, 0.7], [0.04, 1.4]].map(([x, o]) => ({ s: sprite('heart', 0.07), x, o }));
    return [parts.map((p) => p.s), (t) => parts.forEach((p) => {
      const u = cycle(t, 2.1, p.o);
      p.s.position.set(p.x + 0.03 * Math.sin(u * TAU * 1.5), 0.3 + 0.34 * u, 0.12);
      p.s.material.opacity = fade(u);
    })];
  },
  notes() {
    const parts = [[-0.27, 0], [0.27, 0.9]].map(([x, o]) => ({ s: sprite('note', 0.08), x, o }));
    return [parts.map((p) => p.s), (t) => parts.forEach((p) => {
      const u = cycle(t, 1.8, p.o);
      p.s.position.set(p.x + Math.sign(p.x) * 0.05 * u, 0.3 + 0.26 * u, 0.04);
      p.s.material.rotation = 0.3 * Math.sin(u * TAU * 2);
      p.s.material.opacity = fade(u);
    })];
  },
  sparkles() {
    const spots = [[-0.31, 0.36], [0.31, 0.4], [-0.22, 0.56], [0.2, 0.6], [0.02, 0.66]];
    const parts = spots.map(() => sprite('sparkle', 0.06));
    return [parts, (t) => parts.forEach((s, i) => {
      const k = 0.02 + 0.06 * Math.max(0, Math.sin(t * 5 + i * 1.7));
      s.position.set(spots[i][0], spots[i][1], 0.08); s.scale.set(k, k, 1);
    })];
  },
  gloom() {
    const s = sprite('gloom', 0.4, 0.2);
    return [s, (t) => { s.position.set(0, 0.36, 0.28); s.material.opacity = 0.8 + 0.2 * Math.sin(t * 2); }];
  },
  cloud() {
    const s = sprite('cloud', 0.34, 0.18);
    return [s, (t) => { s.position.set(0.02 * Math.sin(t * 0.8), 0.64, 0.02); }];
  },
  stars() {
    const parts = [0, 1, 2].map(() => sprite('star', 0.07));
    return [parts, (t) => parts.forEach((s, i) => {
      const a = t * 3.2 + (i * TAU) / 3;
      s.position.set(Math.cos(a) * 0.27, 0.46 + 0.02 * Math.sin(a * 2), -0.03 + Math.sin(a) * 0.27);
      s.material.rotation = t * 4;
    })];
  },
  bulb() {
    const s = sprite('bulb', 0.15, 0.15);
    return [s, (t) => { const k = 1 + 0.06 * Math.sin(t * 8); s.position.set(0, 0.62, 0.05); s.scale.set(0.15 * k, 0.15 * k, 1); }];
  },
  dots() {
    const parts = [0, 1, 2].map(() => sprite('dot', 0.028));
    return [parts, (t) => parts.forEach((s, i) => {
      s.position.set(0.15 + i * 0.05, 0.52, 0.06);
      s.visible = cycle(t, 2.4) * 4 > i + 1;
    })];
  },
  menace() {
    const spots = [[-0.4, 0.14, 0.1], [-0.36, 0.4, -0.12], [0.4, 0.2, -0.08], [0.37, 0.46, 0.14]];
    const parts = spots.map(() => sprite('go', 0.12));
    return [parts, (t) => parts.forEach((s, i) => {
      const [x, y, r] = spots[i];
      s.position.set(x + 0.004 * Math.sin(t * 43 + i), y + 0.004 * Math.cos(t * 37 + i * 2), -0.02);
      s.material.rotation = r;
    })];
  },
  shock() {
    const parts = [-1, 1].map((side) => ({ s: sprite('shock', 0.12), side }));
    return [parts.map((p) => p.s), (t) => parts.forEach((p) => {
      p.s.position.set(p.side * 0.31, 0.5, 0.06);
      p.s.scale.set(p.side * 0.12, 0.12, 1);
      p.s.material.opacity = Math.sin(t * 25) > -0.3 ? 1 : 0.25;
    })];
  },
  bubble() {
    const s = sprite('bubble', 0.05);
    return [s, (t) => { const k = 0.02 + 0.06 * (0.5 + 0.5 * Math.sin(t * 2.6)); s.position.set(0.035, 0.115, 0.25); s.scale.set(k, k, 1); }];
  },
  fountains() {
    const parts = [-1, 1].map((side) => ({ s: sprite('fountain', 0.26, 0.13), side }));
    return [parts.map((p) => p.s), (t) => parts.forEach((p) => {
      const wob = 1 + 0.06 * Math.sin(t * 20 + p.side);
      p.s.position.set(p.side * 0.25, 0.15, 0.2);
      p.s.scale.set(p.side * 0.26 * wob, 0.13 * wob, 1);
    })];
  },
};

export const SYMBOL_NAMES = Object.keys(SYMBOLS);

export class Symbols {
  constructor(head) {
    this.group = new THREE.Group();
    this.group.name = 'Symbols';
    head.add(this.group);
    this.active = [];
    this.time = 0;
  }

  set(names = []) {
    for (const s of this.group.children.slice()) { s.material.dispose(); this.group.remove(s); }
    this.active = [];
    for (const name of names) {
      if (!SYMBOLS[name]) continue;
      const [objs, update] = SYMBOLS[name]();
      for (const o of [].concat(objs)) this.group.add(o);
      this.active.push(update);
    }
    this.update(0);
  }

  update(dt) {
    this.time += dt;
    for (const update of this.active) update(this.time);
  }

  dispose() { this.set([]); this.group.removeFromParent(); }
}
