import { Stage } from './engine/stage.js';
import { createCharacter } from './engine/character.js';
import { EMOTIONS } from './engine/emotions.js';
import { HAIR_STYLES, HAIR_COLORS } from './engine/hair.js';
import { EYE_STYLES, EYE_COLORS } from './engine/eyes.js';

// Example specs: everything here is built from the same canonical base.
const PRESETS = [
  { label: 'Base', spec: {} },
  {
    label: 'Tee + shorts',
    spec: {
      skin: '#f3c9a5',
      outfit: { top: '#f2c14e', sleeves: 'short', bottom: '#3d5a80', legs: 'shorts', shoes: '#f4f1ea' },
      face: { eyes: 'round', nose: 'dot', noseColor: '#ee8a7c', blush: true },
    },
  },
  {
    label: 'Long sleeves',
    spec: {
      skin: '#c98d64', height: 1.04, headScale: 0.96,
      outfit: { top: '#5b8c5a', sleeves: 'long', bottom: '#6b4f3a', legs: 'pants', shoes: '#2d2a26' },
      face: { eyes: 'classic', nose: 'triangle', noseColor: '#d9822b', mouth: 'cat', brows: true },
    },
  },
  {
    label: 'Tank top',
    spec: {
      skin: '#8d5a3b', height: 0.96, headScale: 1.05,
      outfit: { top: '#7b4b94', sleeves: 'none', bottom: '#24242b', legs: 'shorts', shoes: '#d1495b' },
      face: { eyes: 'sparkle', eyeColor: '#3a7bd5', eyeLine: '#3b2216', nose: 'dot', noseColor: '#5e3a24', blush: true, blushColor: '#e07a7a' },
    },
  },
];

const $ = (id) => document.getElementById(id);
const stage = new Stage($('stage'));

// Keep the 3D view above the control dock.
const dock = document.querySelector('.dock');
new ResizeObserver(() => { $('stage').style.bottom = `${dock.offsetHeight}px`; }).observe(dock);

function chipRow(container, labels, onPick, initial) {
  const buttons = labels.map((label, i) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
      onPick(i);
    });
    container.append(b);
    return b;
  });
  buttons[initial]?.click();
  return buttons;
}

function toggle(button, onChange) {
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
}

try {
  const character = await createCharacter(PRESETS[0].spec);
  stage.add(character);
  stage.frame(character.root);

  const { bones, triangles, clips } = character.stats;
  $('stats').innerHTML = `${bones} joints<br>${triangles.toLocaleString()} triangles<br>${clips} animations`;

  // Hair and eyes are picked on their own; picking a character loads its eyes into the picker.
  const eyeIds = Object.keys(EYE_STYLES);
  const look = { preset: 0, hair: { style: HAIR_STYLES[0].id, color: HAIR_COLORS[0].value }, eyes: 'classic', eyeColor: EYE_COLORS[0].value };
  const refresh = () => {
    const spec = PRESETS[look.preset].spec;
    character.apply({ ...spec, hair: { ...look.hair }, face: { ...spec.face, eyes: look.eyes, eyeColor: look.eyeColor } });
  };
  const press = (buttons, index) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
  const swatchRow = (container, colors, onPick) => {
    const buttons = chipRow(container, colors.map(() => ''), (i) => onPick(colors[i].value), -1);
    buttons.forEach((b, i) => {
      b.classList.add('swatch');
      b.style.setProperty('--c', colors[i].value);
      b.setAttribute('aria-label', colors[i].label);
      b.title = colors[i].label;
    });
    return buttons;
  };

  let eyeButtons = [], eyeColorButtons = [];
  chipRow($('presets'), PRESETS.map((p) => p.label), (i) => {
    look.preset = i;
    const face = PRESETS[i].spec.face ?? {};
    look.eyes = face.eyes ?? 'classic';
    look.eyeColor = face.eyeColor ?? EYE_COLORS[0].value;
    press(eyeButtons, eyeIds.indexOf(look.eyes));
    press(eyeColorButtons, EYE_COLORS.findIndex((c) => c.value === look.eyeColor));
    refresh();
  }, -1);
  const hairStyles = [{ id: null, label: 'None' }, ...HAIR_STYLES];
  const hairButtons = chipRow($('hair'), hairStyles.map((h) => h.label), (i) => { look.hair.style = hairStyles[i].id; refresh(); }, -1);
  const hairColorButtons = swatchRow($('hair-colors'), HAIR_COLORS, (c) => { look.hair.color = c; refresh(); });
  eyeButtons = chipRow($('eyes'), eyeIds.map((id) => EYE_STYLES[id].label), (i) => { look.eyes = eyeIds[i]; refresh(); }, -1);
  eyeColorButtons = swatchRow($('eye-colors'), EYE_COLORS, (c) => { look.eyeColor = c; refresh(); });
  press(hairButtons, 1);
  press(hairColorButtons, 0);
  $('presets').firstElementChild.click();
  const names = character.clipNames;
  chipRow($('clips'), names, (i) => {
    character.play(names[i]);
    character.talking = names[i] === 'Talk';
  }, names.indexOf('Idle'));
  const emotionIds = Object.keys(EMOTIONS);
  chipRow($('expressions'), emotionIds.map((id) => EMOTIONS[id].label), (i) => character.setEmotion(emotionIds[i]), 0);

  toggle($('toggle-skeleton'), (on) => { character.showSkeleton = on; });
  toggle($('toggle-wire'), (on) => { character.wireframe = on; });
  toggle($('toggle-spin'), (on) => { stage.controls.autoRotate = on; });

  window.lab = { stage, character }; // handy from the browser console
  $('status').hidden = true;
} catch (err) {
  console.error(err);
  $('status').textContent = `Couldn't load the character (${err.message}).`;
}
