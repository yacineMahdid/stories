import { Parts, finish, spot, light, roundBox, roundCyl, cyl, sphere, lathe, PALETTE, SCALE } from '../kit.js';

// Prop family: village (street furniture and small props). See ../kit.js for the conventions.

export const VILLAGE = {
  bench: {
    label: 'Bench',
    about: 'A park bench with wooden slats on cast-iron legs. Two seats facing its front.',
    params: {
      length: { default: 1.3, min: 0.8, max: 2.4, about: 'seat length' },
      wood: { default: PALETTE.wood, type: 'color' },
      frame: { default: PALETTE.iron, type: 'color' },
      back: { default: true, about: 'with a backrest' },
    },
    examples: [{}, { back: false, length: 1.0 }, { wood: PALETTE.woodRed, frame: PALETTE.woodDark }],
    build(p) {
      const parts = new Parts();
      const L = p.length, seat = SCALE.seat, depth = 0.26;
      const slats = 3;
      for (let i = 0; i < slats; i++) {
        const z = -depth / 2 + (i + 0.5) * (depth / slats);
        parts.add(roundBox(L, 0.035, depth / slats - 0.014, 0.012), p.wood, { at: [0, seat - 0.035, z] });
      }
      const legX = L / 2 - 0.1;
      for (const x of [-legX, legX]) {
        parts.add(roundBox(0.045, seat - 0.035, 0.045, 0.012), p.frame, { at: [x, 0, depth / 2 - 0.05] });
        parts.add(roundBox(0.045, seat - 0.035, 0.045, 0.012), p.frame, { at: [x, 0, -depth / 2 + 0.05] });
        parts.add(roundBox(0.05, 0.03, depth + 0.02, 0.012), p.frame, { at: [x, seat - 0.065, 0] });
        if (p.back) {
          parts.add(roundBox(0.045, 0.34, 0.045, 0.012), p.frame, { at: [x, seat - 0.04, -depth / 2 + 0.01], rot: [-0.18, 0, 0] });
          // armrest curl
          parts.add(roundBox(0.045, 0.03, depth * 0.75, 0.012), p.frame, { at: [x, seat + 0.13, 0.01] });
          parts.add(roundCyl(0.03, 0.035, { bevel: 0.01, segments: 10 }), p.frame, { at: [x - 0.017, seat + 0.145, depth * 0.38 + 0.01], rot: [0, 0, Math.PI / 2] });
        }
      }
      if (p.back) {
        for (let i = 0; i < 2; i++) {
          parts.add(roundBox(L - 0.02, 0.06, 0.03, 0.012), p.wood, { at: [0, seat + 0.1 + i * 0.1, -depth / 2 - 0.005 - i * 0.018], rot: [-0.18, 0, 0] });
        }
      }
      const half = L / 4 + 0.02;
      return finish(parts.build('bench'), {
        footprint: { w: L + 0.1, d: depth + 0.12 },
        spots: {
          left: spot([half, seat, 0.04], 0, 'sit'),
          right: spot([-half, seat, 0.04], 0, 'sit'),
          front: spot([0, 0, depth / 2 + 0.45], 180, 'stand'),
        },
      });
    },
  },

  lamp: {
    label: 'Lamp post',
    about: 'A cast-iron street lamp with a glass lantern that lights up at dusk.',
    params: {
      height: { default: SCALE.lamp, min: 1.4, max: 3.4 },
      color: { default: PALETTE.iron, type: 'color' },
      lit: { default: 'night', options: ['night', 'always', 'never'], about: 'when it glows' },
    },
    examples: [{}, { height: 1.8, color: PALETTE.woodDark }, { color: '#2f6a5a' }],
    build(p) {
      const parts = new Parts();
      const H = p.height;
      parts.add(lathe([[0, 0], [0.13, 0], [0.14, 0.03], [0.12, 0.08], [0.075, 0.14], [0.055, 0.2], [0, 0.2]], 20), p.color);
      parts.add(cyl(0.035, H - 0.55, { top: 0.03, segments: 12 }), p.color, { at: [0, 0.2, 0] });
      parts.add(roundCyl(0.06, 0.05, { bevel: 0.015, segments: 14 }), p.color, { at: [0, H - 0.4, 0] });
      // lantern: a glass core inside four slim posts, under a little roof
      const glow = p.lit === 'never' ? { slot: 'glass', color: '#b9c9cf', glowAmount: 0 }
        : p.lit === 'always' ? { slot: 'emit', color: '#ffe3ad', emit: 1.4 } : { slot: 'lamp', color: '#fff2cf' };
      parts.add(roundCyl(0.105, 0.24, { top: 0.13, bevel: 0.02, segments: 16 }), glow, { at: [0, H - 0.36, 0] });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        parts.add(roundBox(0.022, 0.27, 0.022, 0.006), p.color, { at: [Math.cos(a) * 0.125, H - 0.37, Math.sin(a) * 0.125] });
      }
      parts.add(lathe([[0, 0], [0.19, 0], [0.18, 0.025], [0.1, 0.09], [0.03, 0.13], [0, 0.13]], 18), p.color, { at: [0, H - 0.12, 0] });
      parts.add(sphere(0.035, 10, 8), p.color, { at: [0, H + 0.02, 0] });
      const lights = p.lit === 'never' ? [] : [light([0, H - 0.24, 0], { intensity: 1.3, distance: 7, when: p.lit === 'always' ? 'always' : 'night' })];
      return finish(parts.build('lamp'), {
        footprint: { r: 0.18 },
        spots: { lean: spot([0, 0, 0.32], 0, 'stand') },
        lights,
        height: H,
      });
    },
  },
};
