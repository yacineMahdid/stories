import { WorldStage } from './world/world-stage.js';
import { readCanvas, formatWorldTime } from './world/canvas.js';
import { World } from './world/staging.js';
import { Director } from './world/director.js';
import { WEATHERS } from './world/sky.js';

// The Scene Viewer: a Story Canvas world plus its 3D direction, staged page by page.
// URL: ?story=<direction json> (default data/staging.json, else the sample),
//      &page=N (1-based) &shot=N &hour=H &weather=W &season=S &ui=0 &still=1

const q = new URLSearchParams(location.search);
if (q.get('ui') === '0') document.body.classList.add('bare');
const $ = (id) => document.getElementById(id);
const statusEl = $('status');

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// Your own story first (data/staging.json, or data/world.json staged automatically), else the sample.
async function loadStory() {
  const tries = q.get('story') ? [q.get('story')] : ['data/staging.json', 'data/world.json', 'samples/brindlewick/staging.json'];
  let lastError;
  for (const url of tries) {
    try {
      const json = await fetchJSON(url);
      if (json.document || json.store) return { direction: {}, snapshot: json, url };
      const direction = json;
      const worldUrl = new URL(direction.world ?? 'world.json', new URL(url, location.href)).href;
      const snapshot = await fetchJSON(worldUrl);
      return { direction, snapshot, url };
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

const stage = new WorldStage($('stage'), { preserveDrawingBuffer: q.get('still') === '1' });
let world, director;
const view = { index: 0, overrides: {}, playing: false, playTimer: null };

function fmtHour(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${String(hh % 24).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

function chips(el, items, isOn, onPick, render = (i) => i.label) {
  el.replaceChildren();
  items.forEach((item, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = render(item, i);
    b.setAttribute('aria-pressed', String(isOn(item, i)));
    b.addEventListener('click', () => onPick(item, i));
    if (item.className) b.className = item.className;
    el.appendChild(b);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/* ───────────── page card ───────────── */

function renderCard(state) {
  const { page, place } = state;
  $('crumbs').textContent = [page.book, page.chapter].filter(Boolean).concat(page.path).join(' · ');
  $('title').textContent = page.title || 'Untitled page';
  const time = formatWorldTime(page.at);
  $('when').textContent = [page.when, time].filter(Boolean).join(' — ') || `${fmtHour(state.hour)}, ${state.season}`;
  $('where').innerHTML = place ? `<b>${escapeHtml(place.name)}</b>${place.description ? ` <span>— ${escapeHtml(place.description)}</span>` : ''}` : '';
  $('summary').textContent = page.summary;
  $('cast').innerHTML = state.cast.map((c) => `<span>${escapeHtml(c.character.name)}${c.do ? ` · ${escapeHtml(c.do)}` : ''}${c.feel ? ` · ${escapeHtml(c.feel)}` : ''}</span>`).join('');
  $('notes').innerHTML = [
    ...state.changes.map((c) => `<div class="here">${escapeHtml(c.text)} <em>from this page on</em></div>`),
    ...state.notes.map((n) => `<div>${escapeHtml(n.text)} <em>since ${escapeHtml(n.since)}${n.title ? ` “${escapeHtml(n.title)}”` : ''}</em></div>`),
  ].join('');
  const warn = $('warn');
  const warnings = [...new Set([...state.warnings, ...world.warnings])];
  warn.hidden = !warnings.length;
  warn.querySelector('summary').textContent = `${warnings.length} staging note${warnings.length === 1 ? '' : 's'}`;
  warn.querySelector('ul').innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
}

/* ───────────── map ───────────── */

const mapCanvas = $('map').querySelector('canvas');
let mapView = null;
function renderMap(state) {
  const g = mapCanvas.getContext('2d');
  const W = mapCanvas.width, H = mapCanvas.height;
  const css = getComputedStyle(document.documentElement);
  const pins = [...world.places.values()];
  const xs = pins.map((p) => p.pos[0]), zs = pins.map((p) => p.pos[1]);
  const pad = 26;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minZ = Math.min(...zs) - pad, maxZ = Math.max(...zs) + pad;
  const s = Math.min(W / (maxX - minX), H / (maxZ - minZ));
  const ox = (W - (maxX - minX) * s) / 2, oz = (H - (maxZ - minZ) * s) / 2;
  const P = ([x, z]) => [ox + (x - minX) * s, oz + (z - minZ) * s];
  mapView = { P, pins };
  g.clearRect(0, 0, W, H);
  g.fillStyle = css.getPropertyValue('--map-bg');
  g.fillRect(0, 0, W, H);
  // Water and paths from the terrain features.
  for (const f of world.terrain) {
    if (['river', 'path'].includes(f.type) && f.points) {
      g.strokeStyle = f.type === 'river' ? '#7cc4e0' : 'rgba(176,138,92,0.7)';
      g.lineWidth = Math.max(2, (f.width ?? (f.type === 'river' ? 4 : 1.6)) * s);
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      f.points.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    } else if (['sea', 'pond', 'lake'].includes(f.type)) {
      g.fillStyle = '#9fd4e8';
      g.beginPath();
      if (f.points) f.points.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      else { const [x, y] = P(f.at); g.arc(x, y, (f.r ?? 5) * s, 0, Math.PI * 2); }
      g.fill();
    }
  }
  for (const p of pins) {
    const [x, y] = P(p.pos);
    const on = state.place?.id === p.id;
    g.fillStyle = p.pin.color ?? css.getPropertyValue('--pin');
    g.beginPath();
    g.arc(x, y, on ? 9 : 6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = on ? 4 : 2;
    g.strokeStyle = '#fff';
    g.stroke();
    g.font = `${on ? 600 : 500} 19px Inter, system-ui, sans-serif`;
    g.fillStyle = css.getPropertyValue('--map-ink');
    g.textAlign = 'center';
    g.fillText(p.name, x, y - (on ? 16 : 12));
  }
  // Where the camera looks from.
  const cam = stage.camera.position, tgt = stage.controls.target;
  const [cx, cy] = P([cam.x, cam.z]), [tx, ty] = P([tgt.x, tgt.z]);
  g.strokeStyle = css.getPropertyValue('--accent');
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke();
  g.fillStyle = css.getPropertyValue('--accent');
  g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
  $('map-caption').textContent = state.place ? state.place.name : 'Map';
}
mapCanvas.addEventListener('click', (e) => {
  if (!mapView) return;
  const r = mapCanvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * mapCanvas.width, y = ((e.clientY - r.top) / r.height) * mapCanvas.height;
  let best = null, bd = 30;
  for (const p of mapView.pins) { const [px, py] = mapView.P(p.pos); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = p; } }
  if (!best) return;
  const i = world.scenes.findIndex((s) => world.sceneState(world.scenes.indexOf(s))?.place?.id === best.id);
  if (i >= 0) go(i);
});

/* ───────────── controls ───────────── */

function renderControls(state) {
  chips($('pages'), world.scenes.map((s) => ({ ...s, className: 'page' })), (_, i) => i === view.index, (_, i) => go(i),
    (s) => `<small>${escapeHtml(s.page.path.split(' · ').pop())}</small>${escapeHtml(s.page.title || 'Untitled')}`);
  const shots = director.shots;
  chips($('shots'), [...shots.map((s, i) => ({ label: `${i + 1} · ${s.label ?? s.shot ?? 'custom'}`, i })), { label: 'Free camera', i: -1 }],
    (s) => (s.i === -1 ? director.userCamera : !director.userCamera && director.shotIndex === s.i),
    (s) => { if (s.i >= 0) director.shot(s.i); else director.userCamera = true; renderControls(director.state); });
  const hour = $('hour');
  hour.value = String(state.hour);
  $('hour-out').textContent = fmtHour(state.hour);
  chips($('weathers'), Object.entries(WEATHERS).map(([id, w]) => ({ id, label: w.label })), (w) => state.weather === w.id,
    (w) => { view.overrides.weather = w.id; director.retime({ weather: w.id }).then(() => renderControls(director.state)); });
  chips($('seasons'), ['spring', 'summer', 'autumn', 'winter'].map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1) })), (s) => state.season === s.id,
    async (s) => { view.overrides.season = s.id; statusEl.hidden = false; statusEl.textContent = 'Changing season…'; await director.retime({ season: s.id }); statusEl.hidden = true; renderAll(); });
  $('prev').disabled = view.index === 0;
  $('next').disabled = view.index >= world.scenes.length - 1;
  $('play').setAttribute('aria-pressed', String(view.playing));
  $('play').textContent = view.playing ? 'Stop' : 'Play';
  const active = $('pages').querySelector('[aria-pressed="true"]');
  active?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderAll() {
  const state = director.state;
  renderCard(state);
  renderControls(state);
  renderMap(state);
}

$('hour').addEventListener('input', (e) => {
  const h = Number(e.target.value);
  view.overrides.hour = h;
  $('hour-out').textContent = fmtHour(h);
  director.retime({ hour: h });
});
$('prev').addEventListener('click', () => go(view.index - 1));
$('next').addEventListener('click', () => go(view.index + 1));
if (window.innerWidth < 640) { $('page').classList.add('collapsed'); $('collapse').textContent = '+'; }
$('collapse').addEventListener('click', () => {
  const card = $('page');
  card.classList.toggle('collapsed');
  $('collapse').innerHTML = card.classList.contains('collapsed') ? '+' : '&minus;';
});
$('play').addEventListener('click', () => (view.playing ? stopPlay() : startPlay()));
window.addEventListener('hashchange', () => {
  const n = /^#page-(\d+)$/.exec(location.hash)?.[1];
  if (n && world && Number(n) - 1 !== view.index) go(Number(n) - 1);
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') go(view.index + 1);
  if (e.key === 'ArrowLeft') go(view.index - 1);
});

let going = Promise.resolve();
function go(index, { fade = true } = {}) {
  if (!world || index < 0 || index >= world.scenes.length) return going;
  going = going.then(async () => {
    const changing = index !== view.index || !director.state;
    view.index = index;
    view.overrides = {};
    if (fade && changing && director.state) { $('fade').classList.add('on'); await new Promise((r) => setTimeout(r, 450)); }
    statusEl.hidden = false;
    statusEl.textContent = 'Staging the scene…';
    try {
      await director.show(index, view.firstOverrides ?? {});
      view.firstOverrides = null;
    } catch (e) {
      console.error(e);
      statusEl.textContent = `Could not stage this page: ${e.message}`;
      return;
    }
    statusEl.hidden = true;
    renderAll();
    // Each page has its own link (#page-3); the artifact viewer only passes plain hashes.
    try { history.replaceState(null, '', `#page-${index + 1}`); } catch { /* sandboxed frames may refuse */ }
    $('fade').classList.remove('on');
  });
  return going;
}

/* ───────────── play: every page, every shot ───────────── */

function startPlay() {
  view.playing = true;
  renderControls(director.state);
  let shot = director.shotIndex;
  const tick = async () => {
    if (!view.playing) return;
    const shots = director.shots;
    const hold = (shots[shot]?.hold ?? 5) * 1000;
    view.playTimer = setTimeout(async () => {
      if (!view.playing) return;
      shot++;
      if (shot < shots.length) { director.shot(shot); renderControls(director.state); tick(); return; }
      if (view.index >= world.scenes.length - 1) { stopPlay(); return; }
      shot = 0;
      await go(view.index + 1);
      tick();
    }, hold);
  };
  tick();
}

function stopPlay() {
  view.playing = false;
  clearTimeout(view.playTimer);
  renderControls(director.state);
}

/* ───────────── start ───────────── */

stage.onFrame = (() => {
  let acc = 0;
  return (dt) => { acc += dt; if (acc > 0.25 && director?.state) { acc = 0; renderMap(director.state); } };
})();

(async () => {
  try {
    const { direction, snapshot } = await loadStory();
    world = new World(readCanvas(snapshot), direction);
    director = new Director(stage, world);
    const fromHash = /^#page-(\d+)$/.exec(location.hash)?.[1];
    const page = Math.max(1, Math.min(Number(fromHash ?? q.get('page') ?? 1), world.scenes.length)) - 1;
    const over = {};
    if (q.get('hour')) over.hour = Number(q.get('hour'));
    if (q.get('weather')) over.weather = q.get('weather');
    if (q.get('season')) over.season = q.get('season');
    view.firstOverrides = over;
    view.index = page;
    await go(page, { fade: false });
    if (q.get('shot')) { director.shot(Number(q.get('shot')) - 1); renderControls(director.state); }
    // cam=px,py,pz,tx,ty,tz puts the camera anywhere (world units), for inspecting a set.
    const cam = q.get('cam')?.split(',').map(Number);
    if (cam?.length === 6 && cam.every(Number.isFinite)) {
      director.userCamera = true;
      stage.camera.position.set(cam[0], cam[1], cam[2]);
      stage.controls.target.set(cam[3], cam[4], cam[5]);
      stage.controls.update();
      stage.focus(stage.controls.target.clone().setY(0), 30);
    }
    window.viewer = { stage, world, director, go, view, ready: true, play: startPlay, stop: stopPlay, check: async () => (await import('./world/check.js')).checkStory(world) };
    if (q.get('still') === '1') {
      for (let i = 0; i < 4; i++) stage.step(1 / 30);
      stage.paused = true;
      stage.step(0);
    }
    window.viewer.done = true;
  } catch (e) {
    console.error(e);
    statusEl.hidden = false;
    statusEl.textContent = `Could not load the story: ${e.message}`;
    window.viewer = { error: String(e), done: true };
  }
})();
