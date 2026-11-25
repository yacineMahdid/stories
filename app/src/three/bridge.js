// The 3D engine (src/engine, src/world at the repo root) wired for the Story Canvas app.
// Plain JS so TypeScript never type-checks the engine; bridge.d.ts describes what the app uses.
import { Stage } from '../../../src/engine/stage.js';
import { createCharacter } from '../../../src/engine/character.js';
import { SPECIES } from '../../../src/engine/species.js';
import { HAIR_STYLES, HAIR_COLORS } from '../../../src/engine/hair.js';
import { EYE_STYLES } from '../../../src/engine/eyes.js';
import { BODY_TYPES } from '../../../src/engine/body.js';
import { WorldStage } from '../../../src/world/world-stage.js';
import { readCanvas } from '../../../src/world/canvas.js';
import { World, guessSpec, PLACE_PRESETS, directionKey } from '../../../src/world/staging.js';
import { Director, buildSpec } from '../../../src/world/director.js';
import { WEATHERS } from '../../../src/world/sky.js';
import { ANIMATION_GROUPS } from '../../../src/engine/animations.js';
import { EMOTIONS } from '../../../src/engine/emotions.js';
import { CATALOG } from '../../../src/world/props/index.js';

export const lookOptions = {
  species: Object.entries(SPECIES).map(([id, s]) => ({ id, label: s.label })),
  hair: [{ id: '', label: 'None' }, ...HAIR_STYLES],
  hairColors: HAIR_COLORS,
  eyes: Object.entries(EYE_STYLES).map(([id, e]) => ({ id, label: e.label })),
  bodies: Object.entries(BODY_TYPES).map(([id, b]) => ({ id, label: b.label })),
  sleeves: ['none', 'short', 'elbow', 'long'],
  legs: ['shorts', 'knee', 'pants'],
};
export const placePresets = PLACE_PRESETS;
export { directionKey };

/** The full character spec a look becomes (species defaults filled in), to show real values. */
export function effectiveSpec(look) { return buildSpec(look); }
export const weathers = Object.entries(WEATHERS).map(([id, w]) => ({ id, label: w.label }));

/** What a cast entry and a page's props can be, for the Direct panel's selects. */
const GROUP_KINDS = new Set(['row', 'ring', 'scatter']);
const FAMILY_LABELS = { nature: 'Nature', buildings: 'Buildings', village: 'Village', waterside: 'Waterside' };
export const directOptions = {
  /** `do`: every animation, by group */
  animations: Object.entries(ANIMATION_GROUPS).map(([group, names]) => ({ group, names: [...names] })),
  /** `feel`: every emotion, Neutral first */
  emotions: Object.entries(EMOTIONS).map(([id, e]) => ({ id, label: e.label ?? id })).sort((a, b) => (a.id === 'neutral' ? -1 : b.id === 'neutral' ? 1 : 0)),
  /** `hold`: every hand prop (held-*) */
  held: Object.entries(CATALOG).filter(([kind]) => kind.startsWith('held-')).map(([id, d]) => ({ id, label: d.label ?? id })),
  /** a page's dressing: every set piece, by family (no hand props, no rows, rings or scatters) */
  props: [],
};
for (const [id, d] of Object.entries(CATALOG)) {
  if (id.startsWith('held-') || GROUP_KINDS.has(id)) continue;
  const family = d.family ?? 'other';
  let group = directOptions.props.find((g) => g.family === family);
  if (!group) directOptions.props.push(group = { family, label: FAMILY_LABELS[family] ?? family, kinds: [] });
  group.kinds.push({ id, label: d.label ?? id });
}

/** A first 3D look for a character card, from its name, role and appearance text. */
export function guessLook(card, species) {
  const { guessed, ...look } = guessSpec(card, species);
  void guessed;
  return look;
}

function dataUrlToBlob(url) {
  const [head, body] = url.split(',');
  const bytes = atob(body);
  const a = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) a[i] = bytes.charCodeAt(i);
  return new Blob([a], { type: head.match(/:(.*?);/)[1] });
}

/** Render one frame at a given size and return it as a PNG (with an optional painted backdrop). */
function capture(renderer, scene, camera, width, height, backdrop) {
  const el = renderer.domElement;
  const prev = { w: el.width, h: el.height, ratio: renderer.getPixelRatio(), aspect: camera.aspect };
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  let url;
  if (backdrop) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, backdrop[0]);
    grad.addColorStop(1, backdrop[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
    g.drawImage(el, 0, 0);
    url = c.toDataURL('image/png');
  } else {
    url = el.toDataURL('image/png');
  }
  renderer.setPixelRatio(prev.ratio);
  renderer.setSize(prev.w / prev.ratio, prev.h / prev.ratio, false);
  camera.aspect = prev.aspect;
  camera.updateProjectionMatrix();
  return dataUrlToBlob(url);
}

/* ───────────── character studio ───────────── */

/** One studio renderer for character looks, moved into whichever panel shows it. */
class Studio {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'three-view studio';
    this.stage = new Stage(this.el);
    this.character = null;
    this.key = null;
    this.busy = Promise.resolve();
  }

  mount(parent) { parent.appendChild(this.el); this.stage.resize(); this.resume(); }
  unmount(parent) { if (this.el.parentElement === parent) { this.el.remove(); this.suspend(); } }
  /** Stop drawing while nobody can see it (unmounted, or covered by the full stage). */
  suspend() { this.stage.renderer.setAnimationLoop(null); }
  resume() { if (this.el.isConnected) this.stage.renderer.setAnimationLoop((t) => this.stage.tick(t)); }

  /** Show a look; `card` names whose it is: another card starts from the front again. */
  show(look, card = null) {
    this.busy = this.busy.then(async () => {
      const spec = buildSpec(look);
      const key = JSON.stringify(spec);
      const sameCard = card === this.card;
      this.card = card;
      if (key === this.key) { if (!sameCard) this.stage.frame(this.character.root); return; }
      this.key = key;
      if (!this.character) {
        this.character = await createCharacter(spec);
        this.stage.add(this.character);
        this.character.play('Idle', 0);
        this.stage.frame(this.character.root);
      } else {
        await this.character.apply(spec);
        this.stage.frame(this.character.root, sameCard); // the same card keeps the angle you turned it to
      }
    }).catch((e) => console.error('[3d] character', e));
    return this.busy;
  }

  /** A portrait of the current look, 3:4, standing in a soft studio light. */
  async portrait(color = '#e8590c') {
    await this.busy;
    if (!this.character) return null;
    const c = this.character;
    c.setEmotion('happy');
    c.play('Idle', 0);
    c.update(0.6);
    const tint = (hex, k) => {
      const n = parseInt(hex.replace('#', ''), 16);
      const mixc = (v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0');
      return `#${mixc((n >> 16) & 255)}${mixc((n >> 8) & 255)}${mixc(n & 255)}`;
    };
    // Always from the front three-quarter view, whatever angle the model was turned to.
    const cam = this.stage.camera, controls = this.stage.controls;
    const saved = { pos: cam.position.clone(), target: controls.target.clone() };
    this.stage.frame(c.root);
    controls.update();
    const blob = capture(this.stage.renderer, this.stage.scene, cam, 600, 800, [tint(color, 0.82), tint(color, 0.55)]);
    cam.position.copy(saved.pos);
    controls.target.copy(saved.target);
    controls.update();
    c.setEmotion('neutral');
    return blob;
  }
}

let studio = null;
export function getStudio() {
  if (!studio) {
    studio = new Studio();
    if (import.meta.env?.DEV) window.studioView = studio; // handy for debugging in the console
  }
  return studio;
}

/* ───────────── world views (pages and places) ───────────── */

/** A 3D view of the live canvas: one page staged with its cast, or one map place on its own. */
export class WorldView {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'three-view world';
    this.stage = new WorldStage(this.el, { preserveDrawingBuffer: true });
    this.director = null;
    this.world = null;
    this.busy = Promise.resolve();
    this.directing = false;
  }

  mount(parent) { parent.appendChild(this.el); this.stage.resize(); this.resume(); }
  unmount(parent) { if (this.el.parentElement === parent) { this.el.remove(); this.suspend(); } }
  /** Stop drawing while nobody can see it (unmounted, or covered by the full stage). */
  suspend() { this.stage.paused = true; }
  resume() { if (this.el.isConnected) this.stage.paused = false; }

  /**
   * snapshot: tldraw getSnapshot(store).document; direction: data/staging.json contents.
   * When nothing the 3D world reads has changed (a still put on a card, a card resized), the
   * world is kept, and showing the same page or place again costs nothing.
   */
  setWorld(document, direction) {
    const canvas = readCanvas({ document });
    const sig = JSON.stringify([[...canvas.pins.values()], [...canvas.characters.values()], canvas.pages, canvas.stories]);
    if (this.world && sig === this.worldSig && direction === this.worldDirection) return this.world;
    this.worldSig = sig;
    this.worldDirection = direction;
    this.worldVersion = (this.worldVersion ?? 0) + 1;
    this.world = new World(canvas, direction ?? {});
    if (!this.director) {
      this.director = new Director(this.stage, this.world);
      this.director.setDirecting(this.directing);
    } else this.director.setWorld(this.world);
    return this.world;
  }

  /** On screen now: this page or place of this very world, and no other show waiting? */
  showing(kind, id, overrides) {
    const s = this.shown;
    return !!s && s.ticket === this.ticket && this.matches(s, kind, id, overrides);
  }
  matches(s, kind, id, overrides) {
    return s.kind === kind && s.id === id && s.version === this.worldVersion && !Object.values(overrides ?? {}).some((v) => v != null);
  }
  /** The shot the camera is on. */
  get shotIndex() { return this.director?.shotIndex ?? 0; }

  pages() {
    return (this.world?.scenes ?? []).map((s, i) => ({ index: i, id: s.page.id, title: s.page.title, path: s.page.path }));
  }

  /** Run staging work one job at a time; a failed job never blocks the ones after it. */
  queue(job) {
    this.jobs = (this.jobs ?? 0) + 1;
    const run = this.busy.then(() => (this.disposed ? null : job()));
    this.busy = run.catch((e) => console.error('[3d]', e)).finally(() => { this.jobs--; });
    return run;
  }
  /** Staging work waiting or under way (a re-stage in flight: leave the models alone until it is done). */
  get pending() { return (this.jobs ?? 0) > 0; }
  /** Resolves once no staging work is waiting or under way (also work queued meanwhile). */
  idle() { return this.busy.then(() => (this.pending && !this.disposed ? this.idle() : undefined)); }

  /**
   * Stage a page. `keepShot` re-stages the same page on the shot it was on (framed again unless
   * the camera was moved by hand); `keepCamera` re-stages it and leaves the camera exactly where it
   * is. Another page starts on its first shot either way.
   * Only the latest show matters: one still waiting when a newer one comes is skipped (null).
   */
  showPage(pageId, overrides = {}, { keepShot = false, keepCamera = false } = {}) {
    const ticket = this.ticket = (this.ticket ?? 0) + 1;
    return this.queue(async () => {
      if (ticket !== this.ticket) return null;
      if ((keepShot || keepCamera) && this.shown && this.matches(this.shown, 'page', pageId, overrides)) { this.shown.ticket = ticket; return this.director.state; }
      const i = this.world?.sceneIndex.get(pageId);
      if (i == null) return null;
      const version = this.worldVersion;
      const state = await this.director.showState(this.world.sceneState(i), overrides, { keepShot, keepCamera });
      this.shown = state ? { kind: 'page', id: pageId, version, ticket } : null;
      return state;
    });
  }

  /**
   * Stage the page on screen again as the direction has it: the time, weather and season the viewer
   * picked (retime) go, the camera stays. Null when no page is on screen.
   */
  restage() {
    const s = this.shown;
    if (s?.kind !== 'page') return Promise.resolve(null);
    this.shown = null;
    return this.showPage(s.id, {}, { keepCamera: true });
  }

  showPlace(pinId, moment = {}) {
    const ticket = this.ticket = (this.ticket ?? 0) + 1;
    return this.queue(async () => {
      if (ticket !== this.ticket) return null;
      if (this.shown && this.matches(this.shown, 'place', pinId, moment)) { this.shown.ticket = ticket; return this.director.state; }
      const version = this.worldVersion;
      const state = await this.director.showPlace(pinId, moment);
      this.shown = state ? { kind: 'place', id: pinId, version, ticket } : null;
      return state;
    });
  }

  shot(i) { return this.director?.shot(i); }
  get shots() { return this.director?.shots ?? []; }
  get state() { return this.director?.state ?? null; }
  /** Staging notes for what is on screen: the page's and the direction file's. */
  get warnings() { return [...new Set([...(this.director?.state?.warnings ?? []), ...(this.world?.warnings ?? [])])]; }
  retime(moment) { return this.queue(() => this.director?.retime(moment)); }

  /* ── directing (the Direct mode of the full stage; see Director in src/world/director.js) ── */

  /** Direct mode on or off: while on, the camera stays where it is and shot moves hold still. */
  setDirecting(on) {
    this.directing = !!on;
    this.director?.setDirecting(this.directing);
  }
  /** The orbit controls: turn them off (`enabled = false`) while a pointer drags something. */
  get controls() { return this.stage.controls; }
  /** Moved by hand since the last shot framed it (orbit, or setCameraView). */
  get userCamera() { return !!this.director?.userCamera; }

  pick(clientX, clientY) { return this.director?.pick(clientX, clientY) ?? null; }
  groundPoint(clientX, clientY) { return this.director?.groundPoint(clientX, clientY) ?? null; }
  moveCast(id, x, z) { return !!this.director?.moveCast(id, x, z); }
  turnCast(id, yaw) { return !!this.director?.turnCast(id, yaw); }
  moveThing(id, x, z) { return !!this.director?.moveThing(id, x, z); }
  turnThing(id, yaw) { return !!this.director?.turnThing(id, yaw); }
  nudge(kind, id, right, away) { return !!this.director?.nudge(kind, id, right, away); }
  turn(kind, id, deg) { return !!this.director?.turn(kind, id, deg); }
  select(kind, id = null) { return !!this.director?.select(kind, id); }
  get selected() { return this.director?.selected ?? null; }
  cameraView() { return this.director?.cameraView() ?? null; }
  setCameraView(view) { return !!this.director?.setCameraView(view); }
  shotView(i) { return this.director?.shotView(i) ?? null; }
  castMarks() { return this.director?.castMarks() ?? []; }
  castInfo() { return this.director?.castInfo() ?? []; }
  thingMark(id) { return this.director?.thingMark(id) ?? null; }
  centerMark() { return this.director?.centerMark() ?? null; }
  freeMark(clear) { return this.director?.freeMark(clear) ?? null; }
  spotsNear(x, z, r) { return this.director?.spotsNear(x, z, r) ?? []; }
  toLocal(p) { return this.director?.toLocal(p) ?? [...p]; }
  fromLocal(p) { return this.director?.fromLocal(p) ?? [...p]; }
  localFacing(yaw) { return this.director?.localFacing(yaw) ?? 0; }
  worldYaw(deg) { return this.director?.worldYaw(deg) ?? 0; }
  facingToCamera(at) { return this.director?.facingToCamera(at) ?? 0; }
  /** Every thing id in the world (places, every page's dressing and added things): a new prop's id must be none of these. */
  thingIds() { return this.world?.thingIds() ?? []; }

  /**
   * A still of what the camera sees now, or with `shot` of that shot (framed for the still, then
   * the camera goes back). The selection marker is never in it.
   */
  async still(width = 1280, height = 720, { shot = null } = {}) {
    await this.busy;
    this.stage.applyMoment();
    const restore = this.director?.stillOf(shot);
    try {
      return capture(this.stage.renderer, this.stage.scene, this.stage.camera, width, height, null);
    } finally { restore?.(); }
  }

  /** Close for good, once whatever is staging has finished. */
  dispose() {
    this.disposed = true;
    this.director && (this.director.disposed = true);
    this.el.remove();
    this.busy.finally(() => {
      this.director?.dispose();
      this.stage.dispose();
    });
  }
}

let preview = null;
/** The inspector's world view (shared by page and pin previews). */
export function getPreview() {
  if (!preview) {
    preview = new WorldView();
    if (import.meta.env?.DEV) window.previewView = preview; // handy for debugging in the console
  }
  return preview;
}

/** The full stage covers the inspector: its small views stop drawing until it closes. */
export function coverPreviews(covered) {
  for (const v of [preview, studio]) {
    if (!v) continue;
    if (covered) v.suspend();
    else v.resume();
  }
}
