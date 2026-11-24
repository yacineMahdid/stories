import { Stage } from './engine/stage.js';
import { createCharacter } from './engine/character.js';
import { EXPRESSIONS } from './engine/face.js';

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

  chipRow($('presets'), PRESETS.map((p) => p.label), (i) => character.apply(PRESETS[i].spec), 0);
  const names = character.clipNames;
  chipRow($('clips'), names, (i) => {
    character.play(names[i]);
    character.talking = names[i] === 'Talk';
  }, names.indexOf('Idle'));
  chipRow($('expressions'), EXPRESSIONS.map((e) => e[0].toUpperCase() + e.slice(1)), (i) => character.setExpression(EXPRESSIONS[i]), 0);

  toggle($('toggle-skeleton'), (on) => { character.showSkeleton = on; });
  toggle($('toggle-wire'), (on) => { character.wireframe = on; });
  toggle($('toggle-spin'), (on) => { stage.controls.autoRotate = on; });

  $('status').hidden = true;
} catch (err) {
  console.error(err);
  $('status').textContent = `Couldn't load the character (${err.message}).`;
}
