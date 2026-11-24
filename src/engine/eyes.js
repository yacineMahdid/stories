// Eye styles for the face canvas. Each style draws one open eye centered at (x, y), in canvas
// pixels. `side` is -1 for the eye on the canvas's left (the character's right eye) and +1 for
// the other, so "inner" (toward the nose) is -side and "outer" is +side. `k` scales the eye.
// Blinking, the happy squint and the sleepy lid are handled by face.js for every style.

const TAU = Math.PI * 2;

export const EYE_COLORS = [
  { label: 'Dark', value: '#2c2a2b' },
  { label: 'Brown', value: '#5a3825' },
  { label: 'Hazel', value: '#8a6a3a' },
  { label: 'Green', value: '#3f8a5a' },
  { label: 'Blue', value: '#3a6fb0' },
  { label: 'Violet', value: '#6b5aa8' },
  { label: 'Gray', value: '#7d838c' },
  { label: 'Red', value: '#b0413e' },
];

// --- drawing helpers ---------------------------------------------------------------------

function mix(hex, toward, amount) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(toward.slice(1), 16);
  const ch = (v, s) => (v >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * amount);
  return `rgb(${m(16)}, ${m(8)}, ${m(0)})`;
}

const ellipse = (g, x, y, rx, ry) => () => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); };

/** Almond shape; tilt > 0 lifts the outer corner, tilt < 0 drops it. */
const almond = (g, x, y, rx, ry, side, tilt) => () => {
  const ix = x - side * rx, ox = x + side * rx;
  const iy = y + tilt * ry * 0.3, oy = y - tilt * ry * 0.55;
  g.beginPath();
  g.moveTo(ix, iy);
  g.bezierCurveTo(ix + side * rx * 0.3, y - ry * 1.2, ox - side * rx * 0.35, y - ry * 1.15 - tilt * ry * 0.3, ox, oy);
  g.bezierCurveTo(ox - side * rx * 0.25, y + ry * 1.1 - tilt * ry * 0.2, ix + side * rx * 0.3, y + ry * 1.15, ix, iy);
  g.closePath();
};

function sclera(g, path, p, line = 5) {
  path();
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = line;
  g.strokeStyle = p.eyeLine;
  g.stroke();
}

function inside(g, path, draw) {
  g.save();
  path();
  g.clip();
  draw();
  g.restore();
}

function iris(g, x, y, rx, ry, color, pupil = 0) {
  g.fillStyle = color;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
  if (pupil) {
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g.beginPath(); g.ellipse(x, y + ry * 0.06, rx * pupil, ry * pupil, 0, 0, TAU); g.fill();
  }
}

function shine(g, x, y, r) {
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

function starShine(g, x, y, r) {
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

/** A thick line over the top of an elliptical eye (eyeliner / upper lid). */
function upperLid(g, x, y, rx, ry, p, width = 10, from = 1.08, to = 1.92) {
  g.strokeStyle = p.eyeLine; g.lineWidth = width;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, Math.PI * from, Math.PI * to); g.stroke();
}

/** Lashes flicking out from the outer top of an elliptical eye. */
function lashes(g, x, y, rx, ry, side, p, count = 3, length = 16, lower = false) {
  g.strokeStyle = p.eyeLine; g.lineWidth = 6;
  g.beginPath();
  for (let i = 0; i < count; i++) {
    const a = lower ? 0.15 + i * 0.22 : -0.15 - i * 0.28; // angle from the outer horizontal, + is down
    const px = x + side * Math.cos(a) * rx, py = y + Math.sin(a) * ry;
    const dx = side * Math.cos(a), dy = Math.sin(a);
    g.moveTo(px, py);
    g.lineTo(px + dx * length + side * 4, py + dy * length - (lower ? -2 : 6));
  }
  g.stroke();
}

/** The common white eye with an iris looking slightly inward. */
function classicEye(g, x, y, side, k, p, o, { iris: size = 0.8, pupil = 0, line = 5, rx = 44, ry = 54, look = 7, star = false } = {}) {
  const ex = rx * k, ey = ry * k, path = ellipse(g, x, y, ex, ey);
  sclera(g, path, p, line);
  const s = o.surprised ? size * 0.75 : size;
  const [gx, gy] = o.gaze || [0, 0];
  const ix = x - side * look * k + gx, iy = y + 5 * k + gy;
  inside(g, path, () => iris(g, ix, iy, ex * s, ey * s, p.eyeColor, pupil));
  if (star) starShine(g, ix + 11 * k, iy - 17 * k, 14 * k);
  else shine(g, ix + 12 * k, iy - 20 * k, 9 * k);
  return { ex, ey, ix, iy };
}

// --- the styles ------------------------------------------------------------------------------

export const EYE_STYLES = {
  classic: {
    label: 'Classic',
    draw: (g, x, y, side, k, p, o) => { classicEye(g, x, y, side, k, p, o); },
  },
  round: {
    label: 'Round',
    draw(g, x, y, side, k, p, o) {
      x += (o.gaze?.[0] ?? 0) * 0.5; y += (o.gaze?.[1] ?? 0) * 0.5;
      g.fillStyle = p.eyeColor;
      g.beginPath(); g.ellipse(x, y, 34 * k, 46 * k, 0, 0, TAU); g.fill();
      shine(g, x + 10 * k, y - 18 * k, 11 * k);
    },
  },
  dot: {
    label: 'Dot',
    draw(g, x, y, side, k, p, o) {
      x += (o.gaze?.[0] ?? 0) * 0.5; y += (o.gaze?.[1] ?? 0) * 0.5;
      g.fillStyle = p.eyeColor;
      g.beginPath(); g.ellipse(x, y + 4 * k, 15 * k, 19 * k, 0, 0, TAU); g.fill();
    },
  },
  sparkle: {
    label: 'Sparkle',
    draw(g, x, y, side, k, p, o) {
      const { ex, ey, ix, iy } = classicEye(g, x, y, side, k, p, o, { pupil: 0.45 });
      shine(g, ix - 10 * k, iy + 18 * k, 5 * k);
      lashes(g, x, y, ex, ey, side, p, 2, 14);
    },
  },
  lashes: {
    label: 'Lashes',
    draw(g, x, y, side, k, p, o) {
      const { ex, ey } = classicEye(g, x, y, side, k, p, o);
      upperLid(g, x, y, ex, ey, p, 10);
      lashes(g, x, y, ex, ey, side, p, 3, 16);
    },
  },
  sleepy: {
    label: 'Sleepy',
    draw(g, x, y, side, k, p, o) {
      const lid = y - 8 * k;
      g.save(); g.beginPath(); g.rect(x - 90 * k, lid, 180 * k, 140 * k); g.clip();
      classicEye(g, x, y, side, k, p, o, { look: 4 });
      g.restore();
      g.strokeStyle = p.eyeLine; g.lineWidth = 9;
      g.beginPath(); g.moveTo(x - side * 46 * k, lid + 2 * k); g.quadraticCurveTo(x, lid - 10 * k, x + side * 46 * k, lid + 6 * k); g.stroke();
    },
  },
  droopy: {
    label: 'Droopy',
    draw(g, x, y, side, k, p, o) {
      const path = almond(g, x, y, 46 * k, 46 * k, side, -0.55);
      sclera(g, path, p, 5);
      const s = o.surprised ? 0.6 : 0.82, ix = x - side * 3 * k + (o.gaze?.[0] ?? 0), iy = y + 6 * k + (o.gaze?.[1] ?? 0);
      inside(g, path, () => iris(g, ix, iy, 40 * s * k, 48 * s * k, p.eyeColor));
      shine(g, ix + 12 * k, iy - 18 * k, 9 * k);
    },
  },
  sharp: {
    label: 'Sharp',
    draw(g, x, y, side, k, p, o) {
      const path = almond(g, x, y, 48 * k, 38 * k, side, 0.7);
      sclera(g, path, p, 5);
      const s = o.surprised ? 0.5 : 0.62, ix = x - side * 6 * k + (o.gaze?.[0] ?? 0), iy = y + 2 * k + (o.gaze?.[1] ?? 0);
      inside(g, path, () => iris(g, ix, iy, 40 * s * k, 46 * s * k, p.eyeColor));
      shine(g, ix + 8 * k, iy - 12 * k, 7 * k);
      g.save(); g.lineWidth = 10; g.strokeStyle = p.eyeLine; path(); g.clip(); path(); g.stroke(); g.restore();
      g.strokeStyle = p.eyeLine; g.lineWidth = 8;
      g.beginPath(); g.moveTo(x + side * 46 * k, y - 0.7 * 38 * k * 0.55); g.lineTo(x + side * 60 * k, y - 34 * k); g.stroke();
    },
  },
  wide: {
    label: 'Wide',
    draw(g, x, y, side, k, p, o) {
      const path = ellipse(g, x, y, 48 * k, 60 * k);
      sclera(g, path, p, 5);
      const ix = x - side * 4 * k + (o.gaze?.[0] ?? 0), iy = y + 2 * k + (o.gaze?.[1] ?? 0);
      iris(g, ix, iy, 13 * k, 15 * k, p.eyeColor);
      shine(g, ix + 5 * k, iy - 6 * k, 4 * k);
    },
  },
  glossy: {
    label: 'Glossy',
    draw(g, x, y, side, k, p, o) {
      const ex = 44 * k, ey = 56 * k, path = ellipse(g, x, y, ex, ey);
      sclera(g, path, p, 6);
      const s = o.surprised ? 0.7 : 0.92, ix = x - side * 3 * k + (o.gaze?.[0] ?? 0), iy = y + 4 * k + (o.gaze?.[1] ?? 0);
      inside(g, path, () => {
        const grad = g.createLinearGradient(ix, iy - ey * s, ix, iy + ey * s);
        grad.addColorStop(0, mix(p.eyeColor, '#000000', 0.55));
        grad.addColorStop(0.55, p.eyeColor);
        grad.addColorStop(1, mix(p.eyeColor, '#ffffff', 0.45));
        g.fillStyle = grad;
        g.beginPath(); g.ellipse(ix, iy, ex * s, ey * s, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(0, 0, 0, 0.6)';
        g.beginPath(); g.ellipse(ix, iy - 4 * k, ex * s * 0.42, ey * s * 0.42, 0, 0, TAU); g.fill();
      });
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(ix + 10 * k, iy - 22 * k, 15 * k, 10 * k, -0.4, 0, TAU); g.fill();
      shine(g, ix - 12 * k, iy + 22 * k, 6 * k);
      upperLid(g, x, y, ex, ey, p, 9, 1.12, 1.88);
    },
  },
  button: {
    label: 'Button',
    draw(g, x, y, side, k, p, o) {
      x += (o.gaze?.[0] ?? 0) * 0.5; y += (o.gaze?.[1] ?? 0) * 0.5;
      g.fillStyle = p.eyeColor;
      g.beginPath(); g.arc(x, y + 2 * k, 34 * k, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = 4 * k;
      g.beginPath(); g.arc(x, y + 2 * k, 25 * k, 0, TAU); g.stroke();
      shine(g, x + 10 * k, y - 10 * k, 7 * k);
    },
  },
  smiley: {
    label: 'Smiley',
    closed: true, // always drawn as happy arcs
    draw() {},
  },
  sly: {
    label: 'Sly',
    draw(g, x, y, side, k, p, o) {
      const rx = 46 * k, top = y - 10 * k;
      const path = () => {
        g.beginPath();
        g.moveTo(x - side * rx, top + 4 * k);
        g.quadraticCurveTo(x, top - 6 * k, x + side * rx, top - 2 * k);
        g.ellipse(x, top, rx, 50 * k, 0, side > 0 ? 0 : Math.PI, side > 0 ? Math.PI : 0, side < 0);
        g.closePath();
      };
      sclera(g, path, p, 5);
      const s = o.surprised ? 0.55 : 0.7, ix = x + side * 4 * k + (o.gaze?.[0] ?? 0), iy = y + 8 * k + (o.gaze?.[1] ?? 0);
      inside(g, path, () => iris(g, ix, iy, 40 * s * k, 48 * s * k, p.eyeColor));
      shine(g, ix + 9 * k, iy - 12 * k, 7 * k);
      g.strokeStyle = p.eyeLine; g.lineWidth = 10;
      g.beginPath(); g.moveTo(x - side * rx, top + 4 * k); g.quadraticCurveTo(x, top - 6 * k, x + side * (rx + 6 * k), top - 4 * k); g.stroke();
    },
  },
  starry: {
    label: 'Starry',
    draw(g, x, y, side, k, p, o) {
      const { ix, iy } = classicEye(g, x, y, side, k, p, o, { pupil: 0.35, star: true });
      shine(g, ix - 12 * k, iy + 16 * k, 4 * k);
    },
  },
  doll: {
    label: 'Doll',
    draw(g, x, y, side, k, p, o) {
      const { ex, ey } = classicEye(g, x, y, side, k, p, o, { rx: 46, ry: 50, iris: 0.86, pupil: 0.4, look: 3 });
      upperLid(g, x, y, ex, ey, p, 11);
      lashes(g, x, y, ex, ey, side, p, 3, 18);
      lashes(g, x, y, ex, ey, side, p, 2, 10, true);
    },
  },
  beady: {
    label: 'Beady',
    draw(g, x, y, side, k, p, o) {
      const path = ellipse(g, x, y, 38 * k, 50 * k);
      sclera(g, path, p, 9);
      iris(g, x - side * 6 * k + (o.gaze?.[0] ?? 0), y + 6 * k + (o.gaze?.[1] ?? 0), 10 * k, 11 * k, p.eyeColor);
    },
  },
  tired: {
    label: 'Tired',
    draw(g, x, y, side, k, p, o) {
      const { ex, ey } = classicEye(g, x, y, side, k, p, o, { look: 3 });
      g.strokeStyle = p.eyeLine; g.globalAlpha = 0.55; g.lineWidth = 4;
      g.beginPath(); g.ellipse(x, y + 6 * k, ex * 0.85, ey * 1.05, 0, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
      g.beginPath(); g.ellipse(x, y + 12 * k, ex * 0.7, ey * 1.08, 0, Math.PI * 0.28, Math.PI * 0.72); g.stroke();
      g.globalAlpha = 1;
    },
  },
};
