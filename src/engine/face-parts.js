// Drawing for the emotion layer of the face canvas: special eye modes, brows, mouths, cheeks,
// tears and the dark manga shade over the eyes. Coordinates are canvas pixels (512 square);
// `side` is -1 for the eye on the canvas's left (the character's right) and +1 for the other.

const TAU = Math.PI * 2;
const MOUTH_DARK = '#7a2a2e';
const TONGUE = '#e8737a';
const WATER = 'rgba(120, 195, 255, 0.85)';

function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.35, y + s * 0.05, x - s * 0.95, y - s * 1.0, x, y - s * 0.38);
  g.bezierCurveTo(x + s * 0.95, y - s * 1.0, x + s * 1.35, y + s * 0.05, x, y + s * 0.9);
  g.closePath();
}

function starPath(g, x, y, r, inner = 0.46, points = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points, rr = i % 2 ? r * inner : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

export function dropPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s * 1.5);
  g.bezierCurveTo(x + s * 0.25, y - s * 0.8, x + s, y - s * 0.25, x + s, y + s * 0.25);
  g.arc(x, y + s * 0.25, s, 0, Math.PI);
  g.bezierCurveTo(x - s, y - s * 0.25, x - s * 0.25, y - s * 0.8, x, y - s * 1.5);
  g.closePath();
}

function drop(g, x, y, s) {
  dropPath(g, x, y, s);
  g.fillStyle = WATER; g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(40, 110, 190, 0.9)'; g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.9)';
  g.beginPath(); g.ellipse(x - s * 0.35, y + s * 0.05, s * 0.22, s * 0.3, -0.4, 0, TAU); g.fill();
}

// --- special eye modes -------------------------------------------------------------------------

export const EYE_MODES = {
  happy(g, x, y, side, k, p) {
    g.strokeStyle = p.eyeLine; g.lineWidth = 9;
    g.beginPath(); g.arc(x, y + 14 * k, 34 * k, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
  },
  closed(g, x, y, side, k, p) {
    g.strokeStyle = p.eyeLine; g.lineWidth = 8;
    g.beginPath(); g.arc(x, y - 18 * k, 36 * k, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
  },
  squeeze(g, x, y, side, k, p) { // > <  (both point at the nose)
    const d = -side;
    g.strokeStyle = p.eyeLine; g.lineWidth = 10;
    g.beginPath(); g.moveTo(x - d * 24 * k, y - 26 * k); g.lineTo(x + d * 22 * k, y); g.lineTo(x - d * 24 * k, y + 26 * k); g.stroke();
  },
  heart(g, x, y, side, k, p, t) {
    const s = 42 * k * (1 + 0.1 * Math.max(0, Math.sin(t * 9)));
    heartPath(g, x, y + 4 * k, s);
    g.fillStyle = '#e8384f'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#8c1d2c'; g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    g.beginPath(); g.ellipse(x - s * 0.42, y - s * 0.2, s * 0.18, s * 0.11, -0.7, 0, TAU); g.fill();
  },
  star(g, x, y, side, k, p, t) {
    const r = 46 * k * (1 + 0.07 * Math.sin(t * 10));
    starPath(g, x, y + 2 * k, r, 0.5, 5, -Math.PI / 2 + 0.1 * Math.sin(t * 3));
    g.fillStyle = '#ffd23f'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#c47f00'; g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + 7 * k, y - 8 * k, 6 * k, 0, TAU); g.fill();
  },
  spiral(g, x, y, side, k, p, t) {
    g.strokeStyle = p.eyeLine; g.lineWidth = 6;
    g.beginPath();
    for (let i = 0; i <= 140; i++) {
      const a = (i / 140) * 3 * TAU, r = (i / 140) * 42 * k, rot = t * 7 * side;
      const px = x + r * Math.cos(a + rot), py = y + r * Math.sin(a + rot) * 1.15;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.stroke();
  },
  x(g, x, y, side, k, p) {
    const s = 26 * k;
    g.strokeStyle = p.eyeLine; g.lineWidth = 11;
    g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y + s); g.moveTo(x + s, y - s); g.lineTo(x - s, y + s); g.stroke();
  },
  blank(g, x, y, side, k, p) { // shocked white eyes, no pupils
    g.beginPath(); g.ellipse(x, y, 48 * k, 60 * k, 0, 0, TAU);
    g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 6; g.strokeStyle = p.eyeLine; g.stroke();
  },
  tiny(g, x, y, side, k, p, t) { // fear: white eyes with trembling pinprick pupils
    g.beginPath(); g.ellipse(x, y, 44 * k, 56 * k, 0, 0, TAU);
    g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 5; g.strokeStyle = p.eyeLine; g.stroke();
    const jx = Math.sin(t * 47 + side) * 2.5, jy = Math.cos(t * 39) * 2;
    g.fillStyle = p.eyeColor; g.beginPath(); g.arc(x + jx, y + jy, 8 * k, 0, TAU); g.fill();
  },
  glow(g, x, y, side, k, p, t, emo) { // narrow glowing slits, inner corners low
    const d = -side, c = emo.glow || '#ffffff';
    g.save();
    g.shadowColor = c; g.shadowBlur = 26 + 8 * Math.sin(t * 6);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(x - d * 42 * k, y - 16 * k);
    g.quadraticCurveTo(x - d * 4 * k, y - 30 * k, x + d * 40 * k, y + 8 * k);
    g.quadraticCurveTo(x, y + 10 * k, x - d * 42 * k, y - 16 * k);
    g.closePath(); g.fill(); g.fill();
    g.restore();
  },
  hollow(g, x, y, side, k, p) { // dull, lifeless eyes with dark rings
    const rx = 42 * k, ry = 50 * k;
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU);
    g.fillStyle = '#dcd8d2'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#3a2a2a'; g.stroke();
    g.save(); g.clip();
    g.fillStyle = '#2b2829'; g.beginPath(); g.ellipse(x - side * 3 * k, y + 8 * k, rx * 0.58, ry * 0.58, 0, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(70, 35, 75, 0.55)'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(x, y + 10 * k, rx * 1.05, ry * 1.08, 0, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
  },
  money(g, x, y, side, k, p, t) {
    const s = 1 + 0.07 * Math.sin(t * 9);
    g.save();
    g.translate(x, y + 4 * k); g.scale(s * k, s * k);
    g.font = 'bold 104px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#7a5200'; g.fillStyle = '#ffcc33';
    g.strokeText('$', 0, 0); g.fillText('$', 0, 0);
    g.restore();
  },
  dots(g, x, y, side, k, p) {
    g.fillStyle = p.eyeColor; g.beginPath(); g.arc(x, y + 6 * k, 9 * k, 0, TAU); g.fill();
  },
  flat(g, x, y, side, k, p) {
    g.strokeStyle = p.eyeLine; g.lineWidth = 9;
    g.beginPath(); g.moveTo(x - 30 * k, y + 4 * k); g.lineTo(x + 30 * k, y + 4 * k); g.stroke();
  },
};

// Eye modes that animate on their own (the canvas is redrawn every frame while shown).
export const ANIMATED_EYES = new Set(['heart', 'star', 'spiral', 'tiny', 'glow', 'money']);

// --- brows ---------------------------------------------------------------------------------------

export const BROWS = {
  soft: { tilt: 0, lift: 0, width: 7, curve: 8 },
  raised: { tilt: 0, lift: -22, width: 8, curve: 14 },
  sad: { tilt: -0.38, lift: -4, width: 8, curve: 6 },
  worried: { tilt: -0.3, lift: -10, width: 8, curve: 10, wavy: true },
  angry: { tilt: 0.42, lift: 4, width: 9, curve: 4 },
  furious: { tilt: 0.62, lift: 10, width: 13, curve: 0 },
  determined: { tilt: 0.25, lift: 2, width: 13, curve: 0 },
  skeptical: { asym: true },
};

export function drawBrow(g, x, y, side, name, p) {
  let d = BROWS[name];
  if (!d) return;
  if (d.asym) d = side < 0 ? { tilt: -0.1, lift: -26, width: 9, curve: 16 } : { tilt: 0.22, lift: 4, width: 9, curve: 2 };
  g.save();
  g.translate(x, y + d.lift);
  g.rotate(-side * d.tilt);
  g.strokeStyle = p.browColor; g.lineWidth = d.width; g.lineCap = 'round';
  g.beginPath();
  if (d.wavy) { g.moveTo(-30, 4); g.bezierCurveTo(-16, -8, -4, 8, 10, -1); g.quadraticCurveTo(20, -8, 30, 2); }
  else { g.moveTo(-30, 4); g.quadraticCurveTo(0, 4 - d.curve * 1.6, 30, 4); }
  g.stroke();
  g.restore();
}

// --- mouths --------------------------------------------------------------------------------------

function openMouth(g, x, y, w, h, { teeth = false, tongue = true } = {}) {
  g.beginPath();
  g.moveTo(x - w, y - 4);
  g.quadraticCurveTo(x, y - 10, x + w, y - 4);
  g.quadraticCurveTo(x + w * 0.85, y + h, x, y + h);
  g.quadraticCurveTo(x - w * 0.85, y + h, x - w, y - 4);
  g.closePath();
  g.fillStyle = MOUTH_DARK; g.fill();
  g.save(); g.clip();
  if (teeth) { g.fillStyle = '#ffffff'; g.fillRect(x - w, y - 12, w * 2, 12 + h * 0.18); }
  if (tongue) { g.fillStyle = TONGUE; g.beginPath(); g.ellipse(x, y + h * 0.95, w * 0.62, h * 0.38, 0, 0, TAU); g.fill(); }
  g.restore();
}

export const MOUTHS = {
  smile(g, x, y, p) { g.strokeStyle = p.mouthColor; g.lineWidth = 7; g.beginPath(); g.arc(x, y - 22, 34, 0.22 * Math.PI, 0.78 * Math.PI); g.stroke(); },
  flat(g, x, y, p) { g.strokeStyle = p.mouthColor; g.lineWidth = 7; g.beginPath(); g.moveTo(x - 22, y + 2); g.lineTo(x + 22, y + 2); g.stroke(); },
  cat(g, x, y, p) {
    g.strokeStyle = p.mouthColor; g.lineWidth = 7;
    g.beginPath(); g.arc(x - 14, y - 2, 14, 0.1 * Math.PI, 0.9 * Math.PI); g.moveTo(x + 28, y - 2); g.arc(x + 14, y - 2, 14, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
  },
  frown(g, x, y, p) { g.strokeStyle = p.mouthColor; g.lineWidth = 7; g.beginPath(); g.arc(x, y + 34, 30, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke(); },
  small(g, x, y) { g.fillStyle = MOUTH_DARK; g.beginPath(); g.ellipse(x, y + 4, 9, 11, 0, 0, TAU); g.fill(); },
  grin(g, x, y) { openMouth(g, x, y, 34, 26); },
  teeth(g, x, y, p) {
    g.beginPath(); g.moveTo(x - 44, y - 8); g.quadraticCurveTo(x, y - 2, x + 44, y - 8); g.quadraticCurveTo(x, y + 40, x - 44, y - 8); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 6; g.strokeStyle = p.mouthColor; g.stroke();
    g.save(); g.clip(); g.lineWidth = 3;
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(x + i * 12, y - 10); g.lineTo(x + i * 12, y + 40); g.stroke(); }
    g.beginPath(); g.moveTo(x - 44, y + 8); g.quadraticCurveTo(x, y + 14, x + 44, y + 8); g.stroke();
    g.restore();
  },
  laugh(g, x, y, p, t) { openMouth(g, x, y, 46, 44 + 5 * Math.sin(t * 16), { teeth: true }); },
  shout(g, x, y, p, t) {
    const w = 52, h = 66 + 4 * Math.sin(t * 20);
    g.beginPath();
    g.moveTo(x - w, y - 14); g.quadraticCurveTo(x, y - 24, x + w, y - 14);
    g.quadraticCurveTo(x + w * 0.9, y + h, x, y + h); g.quadraticCurveTo(x - w * 0.9, y + h, x - w, y - 14);
    g.closePath();
    g.fillStyle = MOUTH_DARK; g.fill(); g.lineWidth = 5; g.strokeStyle = '#4a1418'; g.stroke();
    g.save(); g.clip();
    g.fillStyle = '#ffffff'; g.fillRect(x - w, y - 26, w * 2, 22);
    g.fillStyle = TONGUE; g.beginPath(); g.ellipse(x, y + h, w * 0.6, h * 0.35, 0, 0, TAU); g.fill();
    g.restore();
  },
  gasp(g, x, y, p) {
    g.fillStyle = MOUTH_DARK; g.beginPath(); g.ellipse(x, y + 8, 20, 26, 0, 0, TAU); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#4a1418'; g.stroke();
  },
  wail(g, x, y, p, t) {
    const w = 40, h = 40, wob = 3 * Math.sin(t * 18);
    g.beginPath();
    g.moveTo(x - w, y + 26 + wob); g.quadraticCurveTo(x - w * 0.6, y - 18, x, y - 16 - wob);
    g.quadraticCurveTo(x + w * 0.6, y - 18, x + w, y + 26 - wob); g.quadraticCurveTo(x, y + h, x - w, y + 26 + wob);
    g.closePath();
    g.fillStyle = MOUTH_DARK; g.fill();
    g.save(); g.clip(); g.fillStyle = TONGUE; g.beginPath(); g.ellipse(x, y + 32, 22, 12, 0, 0, TAU); g.fill(); g.restore();
  },
  wavy(g, x, y, p) {
    g.strokeStyle = p.mouthColor; g.lineWidth = 6; g.beginPath();
    for (let i = 0; i <= 40; i++) { const u = i / 40, px = x - 30 + 60 * u, py = y + 2 + 6 * Math.sin(u * TAU * 2); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.stroke();
  },
  sour(g, x, y, p) {
    g.strokeStyle = p.mouthColor; g.lineWidth = 6; g.beginPath();
    for (let i = 0; i <= 40; i++) { const u = i / 40, px = x - 30 + 60 * u, py = y + 10 - 12 * Math.sin(u * Math.PI) + 4 * Math.sin(u * TAU * 3); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.stroke();
  },
  gritted(g, x, y, p) {
    const w = 34, h = 15;
    g.beginPath(); g.roundRect(x - w, y - h, w * 2, h * 2, 9);
    g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 6; g.strokeStyle = p.mouthColor; g.stroke();
    g.save(); g.clip(); g.lineWidth = 3;
    g.beginPath(); g.moveTo(x - w, y); g.lineTo(x + w, y);
    for (let i = -2; i <= 2; i++) { g.moveTo(x + i * 13, y - h); g.lineTo(x + i * 13, y + h); }
    g.stroke(); g.restore();
  },
  shark(g, x, y, p) {
    const w = 50;
    g.beginPath(); g.moveTo(x - w, y - 12); g.quadraticCurveTo(x, y + 6, x + w, y - 12); g.quadraticCurveTo(x, y + 46, x - w, y - 12); g.closePath();
    g.fillStyle = MOUTH_DARK; g.fill();
    g.save(); g.clip(); g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i <= 8; i++) { const px = x - w + (2 * w * i) / 8; g.lineTo(px, y - 14 + (i % 2) * 0); g.lineTo(px + w / 8, y + 6); }
    g.lineTo(x + w, y - 14); g.closePath(); g.fill();
    g.beginPath();
    for (let i = 0; i <= 6; i++) { const px = x - w * 0.7 + (1.4 * w * i) / 6; g.lineTo(px, y + 44); g.lineTo(px + w * 0.7 / 6, y + 26); }
    g.lineTo(x + w, y + 46); g.lineTo(x - w, y + 46); g.closePath(); g.fill();
    g.restore();
    g.lineWidth = 5; g.strokeStyle = '#4a1418';
    g.beginPath(); g.moveTo(x - w, y - 12); g.quadraticCurveTo(x, y + 6, x + w, y - 12); g.quadraticCurveTo(x, y + 46, x - w, y - 12); g.stroke();
  },
  smirk(g, x, y, p) {
    g.strokeStyle = p.mouthColor; g.lineWidth = 7;
    g.beginPath(); g.moveTo(x - 24, y + 4); g.quadraticCurveTo(x + 8, y + 10, x + 28, y - 12); g.stroke();
  },
  pout(g, x, y, p) { // a puckered "3" turned sideways
    g.strokeStyle = p.mouthColor; g.lineWidth = 6;
    g.beginPath(); g.arc(x, y - 6, 9, -0.6 * Math.PI, 0.5 * Math.PI); g.arc(x, y + 12, 9, -0.5 * Math.PI, 0.6 * Math.PI); g.stroke();
  },
  tongue(g, x, y, p) {
    g.fillStyle = TONGUE;
    g.beginPath(); g.moveTo(x - 4, y + 4); g.lineTo(x + 22, y + 4); g.quadraticCurveTo(x + 24, y + 30, x + 9, y + 30); g.quadraticCurveTo(x - 6, y + 30, x - 4, y + 4); g.fill();
    g.strokeStyle = '#c4505a'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = p.mouthColor; g.lineWidth = 7;
    g.beginPath(); g.arc(x, y - 22, 32, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  },
  drool(g, x, y, p, t) {
    openMouth(g, x, y, 26, 22);
    const len = 22 + 14 * ((t * 0.8) % 1);
    g.fillStyle = WATER;
    g.beginPath(); g.moveTo(x + 18, y + 6); g.quadraticCurveTo(x + 26, y + 6 + len * 0.6, x + 22, y + 6 + len); g.quadraticCurveTo(x + 14, y + 6 + len * 0.6, x + 18, y + 6); g.fill();
    g.beginPath(); g.arc(x + 22, y + 10 + len, 6, 0, TAU); g.fill();
  },
};

export const ANIMATED_MOUTHS = new Set(['laugh', 'shout', 'wail', 'drool']);

// --- cheeks, tears, shade --------------------------------------------------------------------

export function blushAt(g, x, y, color, strength = 1) {
  const grad = g.createRadialGradient(x, y, 4, x, y, 42);
  grad.addColorStop(0, color + (strength >= 1 ? 'cc' : '88'));
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(x, y, 46, 30, 0, 0, TAU); g.fill();
}

export function drawCheeks(g, kind, L, p) {
  const sides = [[256 - L.blushDX, -1], [256 + L.blushDX, 1]];
  if (kind === 'blush' || kind === 'hatch' || kind === 'puff') {
    for (const [x] of sides) blushAt(g, x, L.blushY, p.blushColor, kind === 'puff' ? 1 : 0.9);
  }
  if (kind === 'hatch') {
    g.strokeStyle = '#d9474b'; g.lineWidth = 5;
    for (const [x] of sides) {
      g.beginPath();
      for (let i = -1; i <= 1; i++) { g.moveTo(x + i * 15 - 6, L.blushY + 12); g.lineTo(x + i * 15 + 8, L.blushY - 12); }
      g.stroke();
    }
  }
  if (kind === 'puff') {
    g.strokeStyle = 'rgba(180, 90, 80, 0.6)'; g.lineWidth = 5;
    for (const [x, side] of sides) {
      g.beginPath(); g.arc(x - side * 8, L.blushY + 4, 40, side > 0 ? -0.5 : Math.PI - 0.6, side > 0 ? 0.6 : Math.PI + 0.5); g.stroke();
    }
  }
  if (kind === 'pale') { // manga "blood draining": blue vertical lines over the upper face
    g.save();
    const grad = g.createLinearGradient(0, L.eyeY - 120, 0, L.eyeY + 40);
    grad.addColorStop(0, 'rgba(70, 80, 190, 0.55)');
    grad.addColorStop(1, 'rgba(70, 80, 190, 0)');
    g.strokeStyle = grad; g.lineWidth = 4;
    g.beginPath();
    for (let x = 70; x <= 442; x += 17) { g.moveTo(x, L.eyeY - 130); g.lineTo(x, L.eyeY + 10 + ((x * 7) % 23)); }
    g.stroke();
    g.restore();
  }
}

export const ANIMATED_TEARS = new Set(['streams', 'waterfall', 'corner']);

export function drawTears(g, kind, L, k, t) {
  const eyes = [[256 - L.eyeDX, -1], [256 + L.eyeDX, 1]];
  if (kind === 'corner') {
    for (const [x, side] of eyes) drop(g, x + side * 40 * k, L.eyeY + 46 * k + ((t * 18) % 26), 11);
  } else if (kind === 'laugh') {
    for (const [x, side] of eyes) drop(g, x + side * 44 * k, L.eyeY - 6 * k, 9);
  } else if (kind === 'streams' || kind === 'waterfall') {
    const w = kind === 'waterfall' ? 36 : 22;
    for (const [x, side] of eyes) {
      const cx = x + side * 6;
      g.fillStyle = 'rgba(120, 195, 255, 0.82)';
      g.beginPath();
      g.moveTo(cx - w / 2, L.eyeY + 30);
      for (let yy = L.eyeY + 30; yy <= 512; yy += 8) g.lineTo(cx - w / 2 + 3 * Math.sin(yy * 0.08 + t * 12), yy);
      for (let yy = 512; yy >= L.eyeY + 30; yy -= 8) g.lineTo(cx + w / 2 + 3 * Math.sin(yy * 0.08 + t * 12 + 1), yy);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const yy = L.eyeY + 40 + ((t * 160 + i * 45) % 180);
        g.moveTo(cx - w * 0.15, yy); g.lineTo(cx - w * 0.15, yy + 16);
      }
      g.stroke();
    }
  }
}

export function drawShade(g, amount, L) {
  const grad = g.createLinearGradient(0, 0, 0, L.eyeY + 64);
  grad.addColorStop(0, `rgba(24, 10, 34, ${amount})`);
  grad.addColorStop(0.72, `rgba(24, 10, 34, ${amount * 0.92})`);
  grad.addColorStop(1, 'rgba(24, 10, 34, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, L.eyeY + 64);
}
