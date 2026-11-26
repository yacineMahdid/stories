import { Stage } from './engine/stage.js';
import { createCharacter } from './engine/character.js';
import { EMOTIONS } from './engine/emotions.js';
import { HAIR_STYLES, HAIR_COLORS, HAIR_TEXTURES, hairTexture } from './engine/hair.js';
import { EYE_STYLES, EYE_COLORS } from './engine/eyes.js';
import { MOUTH_STYLES, NOSE_STYLES } from './engine/face-parts.js';
import { BODY_TYPES } from './engine/body.js';
import { EAR_STYLES } from './engine/ears.js';
import { ANIMATION_GROUPS } from './engine/animations.js';
import { SPECIES } from './engine/species.js';

// Example outfits, painted on any species.
const OUTFITS = [
  { label: 'None', outfit: null },
  { label: 'Tee + shorts', outfit: { top: '#f2c14e', sleeves: 'short', bottom: '#3d5a80', legs: 'shorts', shoes: '#f4f1ea' } },
  { label: 'Long sleeves', outfit: { top: '#5b8c5a', sleeves: 'long', bottom: '#6b4f3a', legs: 'pants', shoes: '#2d2a26' } },
  { label: 'Tank top', outfit: { top: '#7b4b94', sleeves: 'none', bottom: '#24242b', legs: 'shorts', shoes: '#d1495b' } },
  { label: 'Overalls', outfit: { top: '#f4f1ea', sleeves: 'short', bottom: '#4a6fa5', legs: 'pants', hem: 0.36, shoes: '#7a4a2c' } },
];

const SKINS = [
  { label: 'Porcelain', value: '#fde3cf' }, { label: 'Fair', value: '#f8d3b0' }, { label: 'Light', value: '#efc39b' },
  { label: 'Medium', value: '#d9a37a' }, { label: 'Tan', value: '#c28a63' }, { label: 'Brown', value: '#a86f4c' },
  { label: 'Dark', value: '#8d5a3b' }, { label: 'Deep', value: '#5e3a28' },
];

const $ = (id) => document.getElementById(id);
const stage = new Stage($('stage'));

// Keep the 3D view above the control dock.
const dock = document.querySelector('.dock');
new ResizeObserver(() => { $('stage').style.bottom = `${dock.offsetHeight}px`; }).observe(dock);

function chipRow(container, labels, onPick) {
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
  return buttons;
}

function swatchRow(container, colors, onPick) {
  const buttons = chipRow(container, colors.map(() => ''), (i) => onPick(colors[i].value));
  buttons.forEach((b, i) => {
    b.classList.add('swatch');
    b.style.setProperty('--c', colors[i].value);
    b.setAttribute('aria-label', colors[i].label);
    b.title = colors[i].label;
  });
  return buttons;
}

const press = (buttons, index) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));

function toggle(button, onChange) {
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
}

// Tabs: one group of rows at a time keeps the dock short on phones.
const groups = [...document.querySelectorAll('.group')];
const tabButtons = groups.map((group) => {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: group.dataset.tab });
  b.setAttribute('role', 'tab');
  b.addEventListener('click', () => {
    groups.forEach((g) => { g.hidden = g !== group; });
    tabButtons.forEach((t) => t.setAttribute('aria-selected', String(t === b)));
  });
  $('tabs').append(b);
  return b;
});
tabButtons[0].setAttribute('aria-selected', 'true');

try {
  const character = await createCharacter({});
  stage.add(character);
  stage.frame(character.root);

  const { bones, triangles, clips } = character.stats;
  $('stats').innerHTML = `${bones} joints<br>${triangles.toLocaleString()} triangles<br>${clips} animations`;

  // The look is a species plus individual picks; picking a species loads its defaults.
  const ids = (o) => Object.keys(o);
  const speciesIds = ids(SPECIES), eyeIds = ids(EYE_STYLES), mouthIds = ids(MOUTH_STYLES), noseIds = ids(NOSE_STYLES);
  const bodyIds = ids(BODY_TYPES), earIds = ids(EAR_STYLES);
  const hairStyles = [{ id: null, label: 'None' }, ...HAIR_STYLES];
  const look = {
    species: 'human', outfit: 0, skin: SKINS[1].value, body: 'standard', ears: 'human',
    hair: { style: HAIR_STYLES[0].id, color: HAIR_COLORS[0].value },
    eyes: 'classic', eyeColor: EYE_COLORS[0].value, mouth: 'smile', nose: 'triangle',
  };
  const refresh = () => {
    const spec = SPECIES[look.species].spec;
    character.apply({
      ...spec, outfit: OUTFITS[look.outfit].outfit,
      skin: look.skin, body: look.body, ears: look.ears, hair: look.hair.style ? { ...look.hair } : null,
      face: { ...spec.face, eyes: look.eyes, eyeColor: look.eyeColor, mouth: look.mouth, nose: look.nose },
    });
  };

  // Re-fit the camera when the character's size changes (species, body type).
  const reframe = () => character.ready.then(() => stage.frame(character.root, true));
  const rows = {};

  // The texture chips list the style's own textures, natural first. A picked texture stays while
  // the next style offers it; the natural one is never stored (as in the app's staging.json).
  const textureLabels = Object.fromEntries(HAIR_TEXTURES.map((t) => [t.id, t.label]));
  const syncTextures = () => {
    const textures = HAIR_STYLES.find((h) => h.id === look.hair.style)?.textures ?? [];
    if (textures.indexOf(look.hair.texture) < 1) delete look.hair.texture;
    $('hair-texture-row').hidden = textures.length < 2;
    $('hair-textures').replaceChildren();
    rows.hairTextures = chipRow($('hair-textures'), textures.map((t) => textureLabels[t]), (i) => {
      if (i > 0) look.hair.texture = textures[i];
      else delete look.hair.texture;
      refresh();
    });
    press(rows.hairTextures, textures.indexOf(hairTexture(look.hair.style, look.hair.texture)));
  };

  const sync = () => {
    press(rows.skins, SKINS.findIndex((c) => c.value === look.skin));
    press(rows.hair, hairStyles.findIndex((h) => h.id === look.hair.style));
    syncTextures();
    press(rows.eyes, eyeIds.indexOf(look.eyes));
    press(rows.eyeColors, EYE_COLORS.findIndex((c) => c.value === look.eyeColor));
    press(rows.mouths, mouthIds.indexOf(look.mouth));
    press(rows.noses, noseIds.indexOf(look.nose));
    press(rows.bodies, bodyIds.indexOf(look.body));
    press(rows.ears, earIds.indexOf(look.ears));
  };
  rows.species = chipRow($('species'), speciesIds.map((id) => SPECIES[id].label), (i) => {
    look.species = speciesIds[i];
    const spec = SPECIES[look.species].spec, face = spec.face ?? {};
    const human = look.species === 'human';
    Object.assign(look, {
      skin: spec.skin ?? SKINS[1].value, body: spec.body ?? 'standard', ears: spec.ears ?? 'human',
      eyes: face.eyes ?? 'classic', eyeColor: face.eyeColor ?? EYE_COLORS[0].value,
      mouth: face.mouth ?? 'smile', nose: face.nose ?? 'triangle',
    });
    look.hair.style = human ? (look.hair.style ?? HAIR_STYLES[0].id) : null;
    sync();
    refresh();
    reframe();
  });
  rows.outfits = chipRow($('outfits'), OUTFITS.map((o) => o.label), (i) => { look.outfit = i; refresh(); });
  rows.skins = swatchRow($('skins'), SKINS, (c) => { look.skin = c; refresh(); });
  rows.hair = chipRow($('hair'), hairStyles.map((h) => h.label), (i) => { look.hair.style = hairStyles[i].id; syncTextures(); refresh(); });
  rows.hairColors = swatchRow($('hair-colors'), HAIR_COLORS, (c) => { look.hair.color = c; refresh(); });
  rows.eyes = chipRow($('eyes'), eyeIds.map((id) => EYE_STYLES[id].label), (i) => { look.eyes = eyeIds[i]; refresh(); });
  rows.eyeColors = swatchRow($('eye-colors'), EYE_COLORS, (c) => { look.eyeColor = c; refresh(); });
  rows.mouths = chipRow($('mouths'), mouthIds.map((id) => MOUTH_STYLES[id]), (i) => { look.mouth = mouthIds[i]; refresh(); });
  rows.noses = chipRow($('noses'), noseIds.map((id) => NOSE_STYLES[id]), (i) => { look.nose = noseIds[i]; refresh(); });
  rows.bodies = chipRow($('bodies'), bodyIds.map((id) => BODY_TYPES[id].label), (i) => { look.body = bodyIds[i]; refresh(); reframe(); });
  rows.ears = chipRow($('ears'), earIds.map((id) => EAR_STYLES[id].label), (i) => { look.ears = earIds[i]; refresh(); });
  press(rows.hairColors, 0);
  press(rows.outfits, 0);
  rows.species[0].click();

  // One row of animations per group; one pick across all rows.
  const readable = (name) => name.split(/(?=[A-Z])/).map((w, i) => (i ? w.toLowerCase() : w)).join(' ');
  const animButtons = [];
  for (const [group, names] of Object.entries(ANIMATION_GROUPS)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span class="label"></span><div class="chips"></div>';
    row.querySelector('.label').textContent = group;
    $('anim-rows').append(row);
    const buttons = chipRow(row.querySelector('.chips'), names.map(readable), (i) => {
      for (const b of animButtons) b.setAttribute('aria-pressed', String(b === buttons[i]));
      character.play(names[i]);
      character.talking = names[i] === 'Talk';
    });
    buttons.forEach((b, i) => { b.dataset.clip = names[i]; });
    animButtons.push(...buttons);
  }
  animButtons.find((b) => b.dataset.clip === 'Idle').click();
  const emotionIds = ids(EMOTIONS);
  chipRow($('expressions'), emotionIds.map((id) => EMOTIONS[id].label), (i) => character.setEmotion(emotionIds[i]))[0].click();

  toggle($('toggle-skeleton'), (on) => { character.showSkeleton = on; });
  toggle($('toggle-wire'), (on) => { character.wireframe = on; });
  toggle($('toggle-spin'), (on) => { stage.controls.autoRotate = on; });

  window.lab = { stage, character }; // handy from the browser console
  $('status').hidden = true;
} catch (err) {
  console.error(err);
  $('status').textContent = `Couldn't load the character (${err.message}).`;
}
