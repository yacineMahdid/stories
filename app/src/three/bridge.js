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

/** A first 3D look for a character card, from its name, role and appearance text. */
export function guessLook(card) {
  const { guessed, ...look } = guessSpec(card);
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

  show(look) {
    this.busy = this.busy.then(async () => {
      const spec = buildSpec(look);
      const key = JSON.stringify(spec);
      if (key === this.key) return;
      this.key = key;
      if (!this.character) {
        this.character = await createCharacter(spec);
        this.stage.add(this.character);
        this.character.play('Idle', 0);
        this.stage.frame(this.character.root);
      } else {
        await this.character.apply(spec);
        this.stage.frame(this.character.root, true);
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
    const blob = capture(this.stage.renderer, this.stage.scene, this.stage.camera, 600, 800, [tint(color, 0.82), tint(color, 0.55)]);
    c.setEmotion('neutral');
    return blob;
  }
}

let studio = null;
export function getStudio() { return (studio ??= new Studio()); }

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
  }

  mount(parent) { parent.appendChild(this.el); this.stage.resize(); this.resume(); }
  unmount(parent) { if (this.el.parentElement === parent) { this.el.remove(); this.suspend(); } }
  /** Stop drawing while nobody can see it (unmounted, or covered by the full stage). */
  suspend() { this.stage.paused = true; }
  resume() { if (this.el.isConnected) this.stage.paused = false; }

  /** snapshot: tldraw getSnapshot(store).document; direction: data/staging.json contents. */
  setWorld(document, direction) {
    this.world = new World(readCanvas({ document }), direction ?? {});
    if (!this.director) this.director = new Director(this.stage, this.world);
    else this.director.setWorld(this.world);
    return this.world;
  }

  pages() {
    return (this.world?.scenes ?? []).map((s, i) => ({ index: i, id: s.page.id, title: s.page.title, path: s.page.path }));
  }

  /** Run staging work one job at a time; a failed job never blocks the ones after it. */
  queue(job) {
    const run = this.busy.then(() => (this.disposed ? null : job()));
    this.busy = run.catch((e) => console.error('[3d]', e));
    return run;
  }

  /** Stage a page. `keepShot` re-stages the same page without resetting the camera. */
  showPage(pageId, overrides = {}, { keepShot = false } = {}) {
    return this.queue(() => {
      const i = this.world?.sceneIndex.get(pageId);
      if (i == null) return null;
      return this.director.showState(this.world.sceneState(i), overrides, { keepShot });
    });
  }

  showPlace(pinId, moment = {}) {
    return this.queue(() => this.director.showPlace(pinId, moment));
  }

  shot(i) { return this.director?.shot(i); }
  get shots() { return this.director?.shots ?? []; }
  get state() { return this.director?.state ?? null; }
  /** Staging notes for what is on screen: the page's and the direction file's. */
  get warnings() { return [...new Set([...(this.director?.state?.warnings ?? []), ...(this.world?.warnings ?? [])])]; }
  retime(moment) { return this.queue(() => this.director?.retime(moment)); }

  /** A 16:9 still of what the camera sees now. */
  async still(width = 1280, height = 720) {
    await this.busy;
    this.stage.applyMoment();
    return capture(this.stage.renderer, this.stage.scene, this.stage.camera, width, height, null);
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
export function getPreview() { return (preview ??= new WorldView()); }

/** The full stage covers the inspector: its small views stop drawing until it closes. */
export function coverPreviews(covered) {
  for (const v of [preview, studio]) {
    if (!v) continue;
    if (covered) v.suspend();
    else v.resume();
  }
}
