import * as THREE from 'three';
import { WorldStage } from './world/world-stage.js';
import { CATALOG, FAMILIES, buildProp } from './world/props/index.js';
import { PALETTE, material, seasonal, WORLD_UNIFORMS } from './world/kit.js';
import { PropLights } from './world/lights.js';
import { spotTransform, placeCharacter } from './world/blocking.js';
import { WEATHERS } from './world/sky.js';

// The Prop Lab: every example of the chosen props in a grid, under any season, hour and
// weather. URL parameters (also used by the capture scripts):
//   family=nature | kind=tree,bush | example=0,2 | season=autumn | hour=18.5 | weather=rain
//   char=1 (a character beside each prop for scale) | cast=1 (characters on every spot)
//   spots=1 | footprint=1 | labels=0 | view=front|top|iso|close | focus=N | cols=N
//   still=1 (freeze time) | ui=0 (hide the dock and cards)

const q = new URLSearchParams(location.search);
const state = {
  family: q.get('family') ?? null,
  kinds: q.get('kind') ? q.get('kind').split(',') : null,
  examples: q.get('example') ? q.get('example').split(',').map(Number) : null,
  season: q.get('season') ?? 'summer',
  hour: Number(q.get('hour') ?? 11),
  weather: q.get('weather') ?? 'clear',
  char: q.get('char') === '1',
  cast: q.get('cast') === '1' || q.get('cast') === 'all',
  castAll: q.get('cast') === 'all',
  spots: q.get('spots') === '1',
  footprint: q.get('footprint') === '1',
  labels: q.get('labels') !== '0',
  view: q.get('view') ?? 'iso',
  focus: q.get('focus') != null ? Number(q.get('focus')) : null,
  cols: q.get('cols') ? Number(q.get('cols')) : null,
  still: q.get('still') === '1',
};
if (q.get('ui') === '0') document.body.classList.add('bare');
if (!state.family && !state.kinds) state.family = Object.keys(FAMILIES).find((f) => Object.keys(FAMILIES[f]).length) ?? 'nature';

const stage = new WorldStage(document.getElementById('stage'), { preserveDrawingBuffer: true });
const lights = new PropLights(stage.scene, { max: 14 });
const labelsEl = document.getElementById('labels');
const statusEl = document.getElementById('status');
const errors = [];
let world = new THREE.Group();
stage.scene.add(world);
let cells = [];
let characters = [];
let ticks = [];

// Ground: a wide disc painted the season's grass (snow and rain come from the kit material).
const groundMat = material('solid', { rough: 0.95 });
let ground = null;
function makeGround(radius) {
  if (ground) { ground.geometry.dispose(); ground.removeFromParent(); }
  const g = new THREE.CircleGeometry(radius, 96).rotateX(-Math.PI / 2);
  const c = new THREE.Color(seasonal(PALETTE.grass, state.season));
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const k = 1 + 0.05 * Math.sin(x * 0.9) * Math.cos(z * 0.7) + 0.03 * Math.sin(x * 2.3 + z * 1.7);
    colors.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ground = new THREE.Mesh(g, groundMat);
  ground.receiveShadow = true;
  stage.scene.add(ground);
}

function selectedKinds() {
  if (state.kinds) return state.kinds.filter((k) => CATALOG[k] || true);
  return Object.keys(FAMILIES[state.family] ?? {});
}

let characterModule = null;
async function makeCharacter(i) {
  characterModule ??= await import('./engine/character.js');
  const looks = [
    { skin: '#f8d3b0', hair: { style: 'bob', color: '#4a2f22' }, outfit: { top: '#e2483c', sleeves: 'short', bottom: '#2f3640', legs: 'shorts', shoes: '#4766d6' } },
    { skin: '#e8b48a', hair: { style: 'spiky', color: '#1f1b1a' }, outfit: { top: '#4f86c6', sleeves: 'long', bottom: '#5a4636', legs: 'pants', shoes: '#3a2a22' } },
    { skin: '#f6dcc4', hair: { style: 'ponytail', color: '#e0b45c' }, outfit: { top: '#5aa56a', sleeves: 'none', bottom: '#f2c94c', legs: 'knee', shoes: '#e2483c' } },
  ];
  return characterModule.createCharacter(looks[i % looks.length]);
}

function disposeWorld() {
  for (const c of characters) { stage.remove(c); c.dispose(); }
  characters = [];
  world.traverse((o) => { if (o.isMesh && o.userData.ownGeometry) o.geometry.dispose(); });
  world.removeFromParent();
  world = new THREE.Group();
  stage.scene.add(world);
  lights.clear();
  ticks = [];
  labelsEl.replaceChildren();
}

const DEBUG = {
  stand: '#3fbf6a', sit: '#3f86e0', lie: '#a764d8', lean: '#ee9a3a', floor: '#3fb3b3', kneel: '#d0577a',
};

function spotMarker(pose) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: DEBUG[pose] ?? '#ff00ff', depthTest: false, transparent: true, opacity: 0.85 });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), m);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 10).rotateX(Math.PI / 2).translate(0, 0, 0.16), m);
  dot.userData.ownGeometry = arrow.userData.ownGeometry = true;
  g.add(dot, arrow);
  g.renderOrder = 10;
  return g;
}

async function build() {
  statusEl.hidden = false;
  statusEl.textContent = 'Building props…';
  disposeWorld();
  stage.setMoment({ hour: state.hour, weather: state.weather, season: state.season });
  const ctx = { season: state.season, hour: state.hour, weather: state.weather, night: WORLD_UNIFORMS.uGlow.value };

  const items = [];
  for (const kind of selectedKinds()) {
    const def = CATALOG[kind];
    const examples = def?.examples?.length ? def.examples : [{}];
    examples.forEach((ex, i) => {
      if (state.examples && !state.examples.includes(i)) return;
      items.push({ kind, params: ex, label: `${kind}${examples.length > 1 ? ` · ${exampleName(ex, i)}` : ''}`, index: i });
    });
  }

  // Build everything first, then lay out a grid sized by the biggest footprints.
  for (const item of items) {
    try {
      item.object = buildProp(item.kind, item.params, { ...ctx, id: `${item.kind}-${item.index}` });
    } catch (e) {
      errors.push(`${item.kind}: ${e.message}`);
      continue;
    }
    const box = new THREE.Box3().setFromObject(item.object);
    item.size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    item.box = box;
  }
  const built = items.filter((it) => it.object);
  const cols = state.cols ?? Math.max(1, Math.ceil(Math.sqrt(built.length * 1.6)));
  const rows = [];
  built.forEach((it, i) => { (rows[Math.floor(i / cols)] ??= []).push(it); });
  const gap = 1.4;
  let z = 0;
  for (const row of rows) {
    const depth = Math.max(...row.map((it) => it.size.z)) + gap + (state.char ? 0.4 : 0);
    const widths = row.map((it) => Math.max(it.size.x, 0.6) + gap + (state.char ? 0.9 : 0));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = -total / 2;
    row.forEach((it, i) => {
      const cx = x + widths[i] / 2;
      const center = new THREE.Vector3((it.box.min.x + it.box.max.x) / 2, 0, (it.box.min.z + it.box.max.z) / 2);
      it.object.position.set(cx - center.x, 0, z + depth / 2 - center.z);
      it.cell = new THREE.Vector3(cx, 0, z + depth / 2);
      x += widths[i];
    });
    z += depth;
  }
  // Center the grid on the origin.
  for (const it of built) { it.object.position.z -= z / 2; it.cell.z -= z / 2; }
  const holders = [];
  for (const it of built) {
    if (CATALOG[it.kind]?.held) { holders.push(it); continue; }
    world.add(it.object);
    it.object.updateMatrixWorld(true);
    lights.addFrom(it.object);
    if (it.object.userData.tick) ticks.push(it.object);
  }
  cells = built;
  // Held props: a character holds each one (the prop is built in the hand socket's space).
  await Promise.all(holders.map((it, i) => makeCharacter(i).then((c) => {
    const def = CATALOG[it.kind];
    const hand = it.params.hand ?? def.hand ?? 'rightHand';
    c.socket(hand).add(it.object);
    c.root.position.copy(it.object.position).setY(0);
    it.object.position.set(0, 0, 0);
    c.play(it.params.clip ?? def.clip ?? 'Idle', 0);
    stage.add(c);
    characters.push(c);
    c.update(0.5);
    it.object.updateMatrixWorld(true);
    lights.addFrom(it.object);
    if (it.object.userData.tick) ticks.push(it.object);
    it.size.set(0.6, 1.1, 0.6);
  })));

  // Overlays: spots, footprints, scale characters, characters on spots.
  for (const it of built) {
    const ud = it.object.userData;
    if (state.spots) {
      for (const name of Object.keys(ud.spots ?? {})) {
        const s = spotTransform(it.object, name);
        const m = spotMarker(s.pose);
        m.position.copy(s.position);
        m.rotation.y = s.yaw;
        world.add(m);
      }
    }
    if (state.footprint) {
      const fp = ud.footprint ?? {};
      const geo = fp.w ? new THREE.EdgesGeometry(new THREE.PlaneGeometry(fp.w, fp.d).rotateX(-Math.PI / 2)) : new THREE.EdgesGeometry(new THREE.CircleGeometry(fp.r ?? 0.5, 48).rotateX(-Math.PI / 2));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#d4612c' }));
      line.userData.ownGeometry = true;
      line.position.copy(it.object.position).setY(0.02);
      world.add(line);
    }
  }
  const tasks = [];
  if (state.char) {
    built.slice(0, 16).forEach((it, i) => tasks.push(makeCharacter(i).then((c) => {
      c.root.position.set(it.cell.x - Math.max(it.size.x, 0.6) / 2 - 0.45, 0, it.cell.z + it.size.z / 2 - 0.1);
      c.play(i % 2 ? 'Idle' : 'Wave', 0);
      stage.add(c);
      characters.push(c);
    })));
  }
  if (state.cast) {
    let n = 0;
    for (const it of built) {
      for (const [name, sp] of Object.entries(it.object.userData.spots ?? {})) {
        if (n >= 24) break;
        if (!state.castAll && (sp.pose ?? 'stand') === 'stand') continue;
        const k = n++;
        tasks.push(makeCharacter(k).then((c) => {
          placeCharacter(c, spotTransform(it.object, name));
          stage.add(c);
          characters.push(c);
        }));
      }
    }
  }
  await Promise.all(tasks);

  // Ground, shadows and camera.
  const bounds = new THREE.Box3();
  for (const it of built) bounds.expandByObject(it.object);
  for (const c of characters) bounds.expandByPoint(c.root.position.clone().setY(1));
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2, 2));
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) / 2 + 3;
  makeGround(Math.max(320, radius * 4));
  stage.focus(bounds.getCenter(new THREE.Vector3()).setY(0), radius + 2);
  frameCamera(state.focus != null && built[state.focus] ? new THREE.Box3().setFromObject(built[state.focus].object) : bounds);

  // Labels under each cell.
  if (state.labels) {
    for (const it of built) {
      const el = document.createElement('span');
      el.textContent = it.label;
      labelsEl.appendChild(el);
      it.labelEl = el;
    }
  }
  updateInfo(built);
  statusEl.hidden = built.length > 0;
  if (!built.length) statusEl.textContent = 'No props in this family yet.';
  return built;
}

function exampleName(ex, i) {
  const keys = ['variant', 'style', 'shape', 'kind', 'type', 'state', 'goods', 'color'];
  for (const k of keys) if (ex[k] != null && typeof ex[k] !== 'object') return String(ex[k]);
  return `#${i + 1}`;
}

function frameCamera(box) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x * 0.92, size.y * 1.25, size.z, 1.2) * 0.5;
  const fov = THREE.MathUtils.degToRad(stage.camera.fov);
  const aspect = stage.camera.aspect;
  const dist = Math.max(r / Math.tan(fov / 2), (r / Math.tan(fov / 2)) / Math.min(aspect, 1)) * 1.08;
  const dirs = {
    iso: new THREE.Vector3(0.45, 0.55, 1),
    front: new THREE.Vector3(0, 0.22, 1),
    top: new THREE.Vector3(0, 1, 0.12),
    close: new THREE.Vector3(0.35, 0.3, 1),
  };
  const dir = (dirs[state.view] ?? dirs.iso).normalize();
  const target = center.clone().setY(Math.max(size.y * 0.38, 0.3));
  stage.controls.target.copy(target);
  stage.camera.position.copy(target).addScaledVector(dir, state.view === 'close' ? dist * 0.7 : dist);
  stage.camera.near = 0.05;
  stage.camera.far = 3000;
  stage.camera.updateProjectionMatrix();
  stage.controls.update();
}

function updateInfo(built) {
  const kinds = [...new Set(built.map((b) => b.kind))];
  const title = document.getElementById('title');
  const about = document.getElementById('about');
  const params = document.getElementById('params');
  if (kinds.length === 1 && CATALOG[kinds[0]]) {
    const def = CATALOG[kinds[0]];
    title.textContent = def.label ?? kinds[0];
    about.textContent = def.about ?? '';
    params.textContent = Object.entries(def.params ?? {}).map(([k, p]) => `${k}${p.options ? `: ${p.options.join(' | ')}` : p.default != null ? ` = ${p.default}` : ''}`).join(' · ');
  } else {
    title.textContent = `Prop Lab · ${state.family ?? kinds.join(', ')}`;
    about.textContent = `${kinds.length} props, ${built.length} examples. Pick one below to read what it can do.`;
    params.textContent = '';
  }
  let tris = 0, calls = 0;
  world.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
    calls++;
  });
  window.propsLab.stats = { props: built.length, kinds, triangles: Math.round(tris), meshes: calls };
  document.getElementById('stats').innerHTML = `${built.length} props<br>${Math.round(tris).toLocaleString()} tris<br>${calls} meshes`;
}

// Labels follow their cell on screen.
const _v = new THREE.Vector3();
stage.onFrame = (dt) => {
  const t = WORLD_UNIFORMS.uTime.value;
  for (const o of ticks) o.userData.tick(t, dt);
  lights.update(stage.controls.target, t);
  if (!state.labels) return;
  const w = stage.renderer.domElement.clientWidth, h = stage.renderer.domElement.clientHeight;
  for (const it of cells) {
    if (!it.labelEl) continue;
    _v.set(it.cell.x, 0, it.cell.z + it.size.z / 2 + 0.25).project(stage.camera);
    const visible = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    it.labelEl.style.display = visible ? '' : 'none';
    it.labelEl.style.left = `${(_v.x * 0.5 + 0.5) * w}px`;
    it.labelEl.style.top = `${(-_v.y * 0.5 + 0.5) * h + 4}px`;
  }
};

/* ───────────── controls ───────────── */

function chips(el, items, isOn, onPick) {
  el.replaceChildren();
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = item.label;
    b.setAttribute('aria-pressed', String(isOn(item)));
    b.addEventListener('click', () => onPick(item));
    el.appendChild(b);
  }
}

const TIMES = [{ label: 'Dawn', hour: 6.4 }, { label: 'Morning', hour: 9 }, { label: 'Noon', hour: 12.5 }, { label: 'Evening', hour: 17.6 }, { label: 'Sunset', hour: 18.6 }, { label: 'Night', hour: 22 }];

function renderControls() {
  chips(document.getElementById('families'), Object.keys(FAMILIES).map((f) => ({ label: f[0].toUpperCase() + f.slice(1), id: f })),
    (f) => !state.kinds && state.family === f.id, (f) => { state.family = f.id; state.kinds = null; refresh(); });
  const familyKinds = Object.keys(FAMILIES[state.family] ?? {});
  chips(document.getElementById('kinds'), [{ label: 'All', id: null }, ...familyKinds.map((k) => ({ label: CATALOG[k].label ?? k, id: k }))],
    (k) => (k.id ? state.kinds?.length === 1 && state.kinds[0] === k.id : !state.kinds), (k) => { state.kinds = k.id ? [k.id] : null; refresh(); });
  chips(document.getElementById('seasons'), ['spring', 'summer', 'autumn', 'winter'].map((s) => ({ label: s[0].toUpperCase() + s.slice(1), id: s })),
    (s) => state.season === s.id, (s) => { state.season = s.id; refresh(); });
  chips(document.getElementById('times'), TIMES, (t) => Math.abs(state.hour - t.hour) < 0.01, (t) => { state.hour = t.hour; stage.setMoment({ hour: state.hour, weather: state.weather, season: state.season }); renderControls(); });
  chips(document.getElementById('weathers'), Object.entries(WEATHERS).map(([id, w]) => ({ id, label: w.label })),
    (w) => state.weather === w.id, (w) => { state.weather = w.id; stage.setMoment({ hour: state.hour, weather: state.weather, season: state.season }); renderControls(); });
  chips(document.getElementById('shows'), [{ id: 'char', label: 'Scale' }, { id: 'cast', label: 'Sitters' }, { id: 'spots', label: 'Spots' }, { id: 'labels', label: 'Labels' }],
    (s) => state[s.id], (s) => { state[s.id] = !state[s.id]; refresh(); });
}

let building = Promise.resolve();
function refresh() {
  renderControls();
  building = building.then(() => build()).catch((e) => { errors.push(String(e)); console.error(e); });
  window.propsLab.ready = building;
  return building;
}

window.propsLab = { stage, state, errors, stats: {}, ready: null, refresh, cells: () => cells };
window.addEventListener('error', (e) => errors.push(e.message));
refresh().then(() => {
  if (state.still) {
    // Settle a few frames (shadows, environment), then hold still for captures.
    for (let i = 0; i < 3; i++) stage.step(1 / 30);
    stage.paused = true;
    stage.step(0);
  }
  window.propsLab.done = true;
});
