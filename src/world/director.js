import * as THREE from 'three';
import { Terrain, WATER_LEVEL, resolveFlatHeights } from './terrain.js';
import { CATALOG, buildProp } from './props/index.js';
import { PropLights } from './lights.js';
import { spotTransform, placeCharacter, poseLift, POSE_CLIPS } from './blocking.js';
import { Parts, blob, cone, roundCyl, instanced, rng, seasonal, PALETTE, hashString } from './kit.js';
import { yawTo } from './staging.js';
import { createCharacter } from '../engine/character.js';
import { SPECIES } from '../engine/species.js';
import { EMOTIONS } from '../engine/emotions.js';

/**
 * The director stages one scene at a time on a WorldStage: it builds the set (terrain and
 * every thing around the scene's place), puts the cast on their marks, sets the moment
 * (hour, weather, season) and frames the shots. Sets are reused when the next scene happens
 * at the same place in the same state, so stepping through a story is quick.
 */

const D2R = Math.PI / 180;
const TERRAIN_SIZE = 200;
const REGION = 92;      // things farther than this from the place are not built
const ACTION = 34;      // grass tufts and wild flowers grow within this radius of the place

/* ───────────── the set ───────────── */

class SceneSet {
  constructor(world, state) {
    this.world = world;
    this.place = state.place;
    this.center = state.place?.pos ?? [0, 0];
    this.season = state.season;
    this.object = new THREE.Group();
    this.object.name = 'set';
    this.objects = new Map();   // thing id -> Object3D
    this.ticks = [];
    this.lights = null;
    this.warnings = [];
  }

  inRegion(pos) {
    return Math.hypot(pos[0] - this.center[0], pos[1] - this.center[1]) < REGION;
  }

  build(state, stage) {
    const ctx = { season: state.season, hour: state.hour, weather: state.weather };
    const things = [...state.things.values()].filter((t) => t.kind !== '__terrain' && t.kind !== 'scatter' && this.inRegion(t.pos));
    const scatters = [...state.things.values()].filter((t) => t.kind === 'scatter' && this.inRegion(t.pos));

    // 1. Build every prop (their footprints shape the ground).
    for (const t of things) {
      const params = { ...t };
      const object = buildProp(t.kind, params, { ...ctx, id: t.id });
      if (object.userData.placeholder) this.warnings.push(`No prop called "${t.kind}" (${t.id}).`);
      object.userData.thing = t;
      this.objects.set(t.id, object);
    }

    // 2. Terrain: world features, place features, changes, plus level pads under buildings.
    const features = [...this.world.terrain, ...[...state.things.values()].filter((t) => t.kind === '__terrain').map((t) => t.feature)].map((f) => ({ ...f }));
    resolveFlatHeights(features);
    const probe = { features, seed: 7, roll: 0.35 };
    const rawHeight = (x, z) => Terrain.prototype.rawHeight.call(probe, x, z);
    for (const [id, object] of this.objects) {
      const t = object.userData.thing;
      const def = CATALOG[t.kind];
      if (def?.family !== 'buildings' || ['bridge', 'wall', 'gate'].includes(t.kind)) continue;
      const fp = object.userData.footprint ?? { r: 1 };
      const r = (fp.r ?? Math.hypot(fp.w ?? 1, fp.d ?? 1) / 2) * (t.scale ?? 1);
      features.push({ type: 'flat', at: t.pos, r: r + 0.6, blend: 2.5, height: t.lift ? 0 : rawHeight(t.pos[0], t.pos[1]), thing: id });
    }
    this.terrain = new Terrain({ center: this.center, size: TERRAIN_SIZE, res: 300, season: state.season, features, seed: 7, colors: this.world.direction.colors ?? {} });
    this.object.add(this.terrain.object);

    // 3. Place the props on the ground, on the water, or across it (a bridge rests on its banks).
    for (const [id, object] of this.objects) {
      const t = object.userData.thing;
      const def = CATALOG[t.kind];
      let y;
      if (def?.floats) y = WATER_LEVEL;
      else if (t.ground === false) y = 0;
      else {
        y = this.terrain.heightAt(t.pos[0], t.pos[1]);
        if (y < WATER_LEVEL + 0.05 || def?.spans || t.kind === 'bridge') y = Math.max(this.restingHeight(object, t), WATER_LEVEL + 0.2);
      }
      object.position.set(t.pos[0], y + (t.lift ?? 0), t.pos[1]);
      object.rotation.y = (t.facing ?? 0) * D2R;
      object.scale.setScalar(t.scale ?? 1);
      this.object.add(object);
      object.updateMatrixWorld(true);
      if (object.userData.tick) this.ticks.push(object);
    }

    // 4. Scatters, wild ground cover and the forest edge.
    const footprints = [...this.objects.values()].map((o) => {
      const fp = o.userData.footprint ?? { r: 0.5 };
      return { x: o.position.x, z: o.position.z, r: (fp.r ?? Math.hypot(fp.w ?? 1, fp.d ?? 1) / 2) * o.scale.x + 0.3 };
    });
    for (const s of scatters) this.scatter(s, footprints, ctx);
    this.wild(state, footprints, ctx);
    this.forestEdge(state, ctx);

    // 5. Lights.
    this.lights = new PropLights(stage.scene, { max: 12 });
    for (const object of this.objects.values()) this.lights.addFrom(object);
  }

  /** The highest ground under a prop's footprint edge: where something that spans water rests. */
  restingHeight(object, t) {
    const fp = object.userData.footprint ?? { r: 1 };
    const s = t.scale ?? 1;
    const hw = ((fp.w ?? (fp.r ?? 1) * 2) / 2) * s, hd = ((fp.d ?? (fp.r ?? 1) * 2) / 2) * s;
    const yaw = (t.facing ?? 0) * D2R, c = Math.cos(yaw), sn = Math.sin(yaw);
    let best = -Infinity;
    for (const [lx, lz] of [[hw, 0], [-hw, 0], [0, hd], [0, -hd], [hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) {
      const x = t.pos[0] + lx * c + lz * sn, z = t.pos[1] - lx * sn + lz * c;
      best = Math.max(best, this.terrain.heightAt(x, z));
    }
    return best;
  }

  /** Spread a scatter entry over its area on suitable ground, as instanced copies. */
  scatter(s, footprints, ctx) {
    const place = this.world.places.get(s.place);
    const area = s.area ?? { r: 8 };
    const r = rng(s.seed ?? hashString(s.id));
    const center = area.at ? this.world.localToWorld(area.at, place) : s.pos;
    const poly = area.points ? area.points.map((p) => this.world.localToWorld(p, place)) : null;
    const inside = (x, z) => {
      if (poly) {
        let ins = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, zi] = poly[i], [xj, zj] = poly[j];
          if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) ins = !ins;
        }
        return ins;
      }
      if (area.size) {
        const rot = ((area.rotate ?? 0) + (place?.rotate ?? 0)) * D2R;
        const dx = x - center[0], dz = z - center[1];
        const lx = dx * Math.cos(-rot) + dz * Math.sin(-rot), lz = -dx * Math.sin(-rot) + dz * Math.cos(-rot);
        return Math.abs(lx) < area.size[0] / 2 && Math.abs(lz) < area.size[1] / 2;
      }
      return Math.hypot(x - center[0], z - center[1]) < (area.r ?? 8);
    };
    const bound = poly
      ? poly.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity])
      : area.size ? [center[0] - Math.hypot(...area.size) / 2, center[1] - Math.hypot(...area.size) / 2, center[0] + Math.hypot(...area.size) / 2, center[1] + Math.hypot(...area.size) / 2]
        : [center[0] - (area.r ?? 8), center[1] - (area.r ?? 8), center[0] + (area.r ?? 8), center[1] + (area.r ?? 8)];
    const avoid = s.avoid ? { at: s.avoid.at ? this.world.localToWorld(s.avoid.at, place) : center, r: s.avoid.r ?? 4 } : null;
    const kinds = Array.isArray(s.of) ? s.of : [s.of ?? 'tree'];
    const spacing = s.spacing ?? (kinds.includes('tree') ? 2.2 : 0.6);
    const placed = [];
    const groups = new Map();
    const count = s.count ?? 20;
    for (let tries = 0; placed.length < count && tries < count * 30; tries++) {
      const x = bound[0] + r.next() * (bound[2] - bound[0]);
      const z = bound[1] + r.next() * (bound[3] - bound[1]);
      if (!inside(x, z)) continue;
      if (avoid && Math.hypot(x - avoid.at[0], z - avoid.at[1]) < avoid.r) continue;
      if (this.terrain.isWater(x, z, -0.05) && !s.onWater) continue;
      const surf = this.terrain.surfaceAt(x, z);
      if (!s.onPaths && (surf.dirt > 0.3 || surf.stone > 0.3 || surf.brick > 0.3)) continue;
      if (surf.slope > 0.35) continue;
      if (footprints.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + spacing * 0.4)) continue;
      if (placed.some((p) => Math.hypot(x - p[0], z - p[1]) < spacing)) continue;
      placed.push([x, z]);
      const kind = r.pick(kinds);
      const params = {};
      for (const [k, v] of Object.entries(s.params ?? {})) params[k] = Array.isArray(v) ? r.pick(v) : v;
      const slot = r.int(0, 2);
      const key = `${kind}|${JSON.stringify(params)}|${slot}`;
      if (!groups.has(key)) groups.set(key, { kind, params, slot, matrices: [] });
      const scale = (s.scale ?? 1) * (0.85 + r.next() * 0.3);
      const y = this.terrain.heightAt(x, z);
      groups.get(key).matrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.angle()),
        new THREE.Vector3(scale, scale, scale),
      ));
    }
    for (const g of groups.values()) {
      const proto = buildProp(g.kind, g.params, { ...ctx, id: `${s.id}:${g.kind}:${g.slot}` });
      if (proto.userData.placeholder) { this.warnings.push(`No prop called "${g.kind}" to scatter.`); continue; }
      const inst = instanced(proto, g.matrices);
      inst.name = `scatter:${s.id}:${g.kind}`;
      this.object.add(inst);
      footprints.push(...g.matrices.map((m) => ({ x: m.elements[12], z: m.elements[14], r: 0.6 })));
    }
  }

  /** Grass tufts and a few wild flowers on open grass near the action. */
  wild(state, footprints, ctx) {
    const density = this.place?.wild ?? { grass: 0.55, flowers: 0.05 };
    const winter = state.season === 'winter';
    const r = rng(hashString(`${this.place?.id}:wild`));
    const cover = [['grass', winter ? density.grass * 0.25 : density.grass, 0.35], ['flowers', winter ? 0 : density.flowers, 1.2]];
    for (const [kind, perUnit, gap] of cover) {
      if (!CATALOG[kind] || !perUnit) continue;
      const total = Math.min(Math.round(Math.PI * ACTION * ACTION * perUnit * 0.5), kind === 'grass' ? 2600 : 260);
      const variants = [[], [], []];
      for (let i = 0; i < total * 3 && variants.flat().length < total; i++) {
        const a = r.angle(), d = Math.sqrt(r.next()) * ACTION;
        const x = this.center[0] + Math.cos(a) * d, z = this.center[1] + Math.sin(a) * d;
        if (r.next() > 1.15 - THREE.MathUtils.smoothstep(d, ACTION * 0.6, ACTION)) continue; // thin out toward the edge
        if (!this.terrain.isGrass(x, z)) continue;
        if (footprints.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + gap * 0.5)) continue;
        const s = 0.8 + r.next() * 0.45;
        variants[i % 3].push(new THREE.Matrix4().compose(
          new THREE.Vector3(x, this.terrain.heightAt(x, z), z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.angle()),
          new THREE.Vector3(s, s, s),
        ));
      }
      variants.forEach((matrices, k) => {
        if (!matrices.length) return;
        const params = kind === 'flowers' ? { color: ['mixed', 'white', 'yellow'][k], count: 3 + k } : {};
        const proto = buildProp(kind, params, { ...ctx, id: `wild-${kind}-${k}` });
        if (proto.userData.placeholder) return;
        const inst = instanced(proto, matrices);
        inst.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        inst.name = `wild:${kind}`;
        this.object.add(inst);
      });
    }
  }

  /** Low-cost trees along the far edge of the terrain so the land feels wooded. */
  forestEdge(state, ctx) {
    const dir = this.world.direction.edge ?? {};
    if (dir.trees === false) return;
    const r = rng(hashString(`${this.place?.id}:edge`));
    const leaf = seasonal(PALETTE.leaf, state.season);
    const pine = seasonal(PALETTE.pine, state.season);
    const protos = [farTree('round', leaf, state.season), farTree('pine', pine, state.season), farTree('round', seasonal(PALETTE.leafAlt, state.season), state.season)];
    const sets = protos.map(() => []);
    const half = TERRAIN_SIZE / 2;
    const n = dir.count ?? 520;
    for (let i = 0; i < n * 3 && sets.flat().length < n; i++) {
      const x = this.center[0] + (r.next() * 2 - 1) * half * 0.97;
      const z = this.center[1] + (r.next() * 2 - 1) * half * 0.97;
      const d = Math.max(Math.abs(x - this.center[0]), Math.abs(z - this.center[1]));
      if (d < (dir.inner ?? 52) + r.next() * 10) continue;
      if (this.terrain.isWater(x, z, -0.2)) continue;
      const surf = this.terrain.surfaceAt(x, z);
      if (surf.dirt > 0.2 || surf.stone > 0.2 || surf.sand > 0.4 || surf.slope > 0.4) continue;
      const k = r.next() < (dir.pines ?? 0.45) ? 1 : r.next() < 0.5 ? 0 : 2;
      const s = 0.8 + r.next() * 0.7;
      sets[k].push(new THREE.Matrix4().compose(
        new THREE.Vector3(x, this.terrain.heightAt(x, z) - 0.05, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.angle()),
        new THREE.Vector3(s, s * (0.9 + r.next() * 0.3), s),
      ));
    }
    sets.forEach((m, k) => { if (m.length) { const inst = instanced(protos[k], m); inst.name = 'edge-trees'; this.object.add(inst); } });
  }

  update(t, dt, focus) {
    for (const o of this.ticks) o.userData.tick(t, dt);
    this.lights?.update(focus, t);
  }

  dispose() {
    this.lights?.dispose();
    this.terrain?.dispose();
    // Geometry belongs to this set; kit materials are shared by every set and stay.
    this.object.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
    this.object.removeFromParent();
  }
}

/** A simple distant tree: a soft canopy or a stack of cones on a short trunk. */
function farTree(variant, color, season) {
  const p = new Parts();
  const bare = season === 'winter' && variant === 'round';
  p.add(roundCyl(0.16, 1.1, { top: 0.11, bevel: 0.04, segments: 7, steps: 1 }), PALETTE.woodDark);
  if (variant === 'pine') {
    p.add(cone(1.05, 1.5, 9), { slot: 'foliage', color }, { at: [0, 0.8, 0] });
    p.add(cone(0.8, 1.3, 9), { slot: 'foliage', color }, { at: [0, 1.6, 0] });
    p.add(cone(0.52, 1.1, 9), { slot: 'foliage', color }, { at: [0, 2.35, 0] });
  } else if (!bare) {
    p.add(blob(1.25, { detail: 1, amp: 0.1, seed: 3, squash: [1, 0.92, 1] }), { slot: 'foliage', color }, { at: [0, 2.1, 0] });
  } else {
    p.add(roundCyl(0.08, 1.2, { top: 0.03, bevel: 0.02, segments: 6, steps: 1 }), PALETTE.woodDark, { at: [0, 1, 0], rot: [0, 0, 0.4] });
    p.add(roundCyl(0.08, 1.1, { top: 0.03, bevel: 0.02, segments: 6, steps: 1 }), PALETTE.woodDark, { at: [0, 1, 0], rot: [0.3, 0, -0.35] });
  }
  return p.build('far-tree');
}

/* ───────────── the director ───────────── */

export class Director {
  constructor(stage, world) {
    this.stage = stage;
    this.world = world;
    this.set = null;
    this.setKey = null;
    this.state = null;
    this.cast = new Map();       // character id -> { character, entry, walker, held }
    this.characters = new Map(); // character id -> Character (kept between scenes)
    this.shotIndex = 0;
    this.shots = [];
    this.cameraMove = null;
    this.userCamera = false;
    stage.controls.addEventListener('start', () => { this.userCamera = true; });
    stage.add(this);
  }

  setKeyFor(state) {
    const things = [...state.things.values()].map((t) => JSON.stringify(t)).sort().join('|');
    return `${state.place?.id}|${state.season}|${hashString(things)}`;
  }

  /** Stage scene `index`. `overrides` (hour, weather, season, ambient) come from the viewer. */
  async show(index, overrides = {}) {
    const state = this.world.sceneState(index);
    if (!state) return null;
    Object.assign(state, Object.fromEntries(Object.entries(overrides).filter(([, v]) => v != null)));
    this.state = state;
    const key = this.setKeyFor(state);
    if (key !== this.setKey) {
      this.set?.dispose();
      this.set = new SceneSet(this.world, state);
      this.set.build(state, this.stage);
      this.stage.scene.add(this.set.object);
      this.setKey = key;
    }
    this.stage.setMoment({ hour: state.hour, weather: state.weather, season: state.season, day: state.day, ambient: state.ambient });
    await this.stageCast(state);
    this.shots = state.shots;
    this.shot(0);
    for (const w of this.set.warnings) if (!state.warnings.includes(w)) state.warnings.push(w);
    return state;
  }

  /** Change the moment without restaging (the viewer's sliders). Season changes rebuild the set. */
  async retime({ hour, weather, season, ambient }) {
    if (!this.state) return;
    if (season && season !== this.state.season) return this.show(this.state.index, { hour: hour ?? this.state.hour, weather: weather ?? this.state.weather, season, ambient });
    if (hour != null) this.state.hour = hour;
    if (weather) this.state.weather = weather;
    if (ambient !== undefined) this.state.ambient = ambient;
    this.stage.setMoment({ hour: this.state.hour, weather: this.state.weather, season: this.state.season, day: this.state.day, ambient: this.state.ambient });
  }

  /* cast */

  async characterFor(entry) {
    const c = entry.character;
    const spec = buildSpec(this.world.specFor(c, entry.look));
    if (entry.scale) spec.height = (spec.height ?? 1) * entry.scale;
    const key = JSON.stringify(spec);
    let character = this.characters.get(c.id);
    if (!character) {
      character = await createCharacter(spec);
      character.specKey = key;
      this.characters.set(c.id, character);
    } else if (character.specKey !== key) {
      await character.apply(spec);
      character.specKey = key;
    }
    return character;
  }

  async stageCast(state) {
    const keep = new Set(state.cast.map((e) => e.who));
    for (const [id, member] of this.cast) {
      if (!keep.has(id)) { member.character.root.removeFromParent(); }
      if (member.held) {
        this.set?.lights?.removeFrom(member.held);
        if (this.set) this.set.ticks = this.set.ticks.filter((o) => o !== member.held);
        member.held.removeFromParent();
      }
    }
    this.cast.clear();
    const members = await Promise.all(state.cast.map(async (entry) => ({ entry, character: await this.characterFor(entry) })));
    // Positions first (facing can point at other cast members).
    for (const m of members) {
      m.mark = this.markFor(m.entry, state);
      this.stage.scene.add(m.character.root);
    }
    const centroid = members.length ? members.reduce((a, m) => [a[0] + m.mark.position.x / members.length, a[1] + m.mark.position.z / members.length], [0, 0]) : [0, 0];
    for (const m of members) {
      const { entry, character, mark } = m;
      let yaw = mark.yaw;
      const f = entry.facing;
      if (typeof f === 'number') yaw = (f + (state.place?.rotate ?? 0)) * D2R;
      else if (f === 'group') yaw = Math.atan2(centroid[0] - mark.position.x, centroid[1] - mark.position.z);
      else if (typeof f === 'string') {
        const target = this.positionOf(f, members, state);
        if (target) yaw = Math.atan2(target.x - mark.position.x, target.z - mark.position.z);
      }
      let clip = entry.do && character.actions.has(entry.do) ? entry.do : null;
      if (entry.do && !clip) state.warnings.push(`No animation called "${entry.do}" (${entry.character.name}).`);
      let pose = mark.pose;
      if (mark.free) {
        // Off a prop, "Sit" means sitting on the ground, and lying clips rest on the ground.
        if (clip === 'Sit') clip = 'SitFloor';
        if (clip === 'LieDown' || clip === 'Sleep') pose = 'lie';
      }
      placeCharacter(character, { position: mark.position, yaw, pose }, clip ?? (pose !== 'stand' ? POSE_CLIPS[pose] : 'Idle'));
      const feel = entry.feel && EMOTIONS[entry.feel] ? entry.feel : 'neutral';
      if (entry.feel && !EMOTIONS[entry.feel]) state.warnings.push(`No emotion called "${entry.feel}" (${entry.character.name}).`);
      character.setEmotion(feel);
      character.talking = !!entry.talk;
      // Desynchronize idle loops so a crowd doesn't breathe in unison.
      character.mixer.setTime((hashString(entry.who) % 1000) / 333);
      const member = { character, entry, walker: null, held: null };
      if (entry.hold) member.held = this.hold(character, entry.hold, state);
      if (entry.path?.length) member.walker = new Walker(this, character, entry, state);
      this.cast.set(entry.who, member);
    }
  }

  hold(character, hold, state) {
    const spec = typeof hold === 'string' ? { kind: hold } : hold;
    const kind = CATALOG[spec.kind] ? spec.kind : CATALOG[`held-${spec.kind}`] ? `held-${spec.kind}` : spec.kind;
    const object = buildProp(kind, spec, { season: state.season, hour: state.hour, weather: state.weather, id: `${kind}:held` });
    const hand = spec.hand ?? CATALOG[kind]?.hand ?? 'rightHand';
    character.socket(hand).add(object);
    character.root.updateMatrixWorld(true);
    this.set?.lights?.addFrom(object, { moving: true });
    if (object.userData.tick) this.set?.ticks.push(object);
    return object;
  }

  /** Where a cast entry stands: { position, yaw, pose }. */
  markFor(entry, state) {
    const place = state.place;
    const at = entry.at ?? (entry.path ? entry.path[0] : [0, 1.5]);
    if (typeof at === 'string') {
      const [thingId, spotName] = at.split('.');
      const object = this.set.objects.get(thingId);
      if (object) {
        const s = spotTransform(object, spotName);
        if (s) return s;
        const p = object.position.clone();
        return { position: p.add(new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), object.rotation.y)), yaw: object.rotation.y, pose: 'stand' };
      }
      state.warnings.push(`${entry.character.name} stands at "${at}", which is not in the scene.`);
    }
    const [x, z] = typeof at === 'string' ? place.pos : this.world.resolveAt(at, place, state.things);
    const y = this.set.terrain.heightAt(x, z);
    return { position: new THREE.Vector3(x, Math.max(y, WATER_LEVEL), z), yaw: (place?.rotate ?? 0) * D2R, pose: entry.pose ?? 'stand', free: true };
  }

  positionOf(ref, members, state) {
    const member = members.find((m) => m.entry.who === ref || m.entry.character.name.toLowerCase() === String(ref).toLowerCase());
    if (member) return member.mark.position;
    const object = this.set.objects.get(ref);
    if (object) return object.position;
    if (ref === 'center' && state.place) return new THREE.Vector3(state.place.pos[0], 0, state.place.pos[1]);
    if (ref === 'camera') return this.stage.camera.position;
    return null;
  }

  /* camera */

  subjects(shot) {
    const out = [];
    const refs = shot.on ? (Array.isArray(shot.on) ? shot.on : [shot.on]) : [...this.cast.keys()];
    for (const ref of refs) {
      const member = this.cast.get(ref) ?? [...this.cast.values()].find((m) => m.entry.character.name.toLowerCase() === String(ref).toLowerCase());
      if (member) {
        const root = member.character.root;
        const h = (member.character.spec.height ?? 1) * (member.entry.pose === 'lie' ? 0.4 : 1);
        out.push({ center: root.position.clone().add(new THREE.Vector3(0, h * 0.5, 0)), head: root.position.clone().add(new THREE.Vector3(0, h * 0.72, 0)), radius: 0.4 * h, yaw: root.rotation.y, height: h, character: true });
        continue;
      }
      const object = this.set.objects.get(ref);
      if (object) {
        const box = new THREE.Box3().setFromObject(object);
        const c = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        out.push({ center: c, head: c.clone().setY(box.max.y * 0.8 + c.y * 0.2), radius: Math.max(size.x, size.y, size.z) * 0.5, yaw: object.rotation.y, height: size.y });
      }
    }
    return out;
  }

  shot(i) {
    if (!this.shots.length) return;
    this.shotIndex = ((i % this.shots.length) + this.shots.length) % this.shots.length;
    const shot = this.shots[this.shotIndex];
    const place = this.state.place;
    const cam = this.stage.camera;
    const controls = this.stage.controls;
    this.userCamera = false;
    let pos, target, fov = shot.fov ?? 35;

    if (shot.pos && shot.target) {
      const [px, pz] = this.world.localToWorld([shot.pos[0], shot.pos[2]], place);
      const [tx, tz] = this.world.localToWorld([shot.target[0], shot.target[2]], place);
      pos = new THREE.Vector3(px, shot.pos[1], pz);
      target = new THREE.Vector3(tx, shot.target[1], tz);
    } else {
      const subs = this.subjects(shot);
      const kind = shot.shot ?? (subs.length ? 'medium' : 'wide');
      const box = new THREE.Box3();
      for (const s of subs) box.expandByPoint(s.center.clone().addScalar(s.radius)).expandByPoint(s.center.clone().addScalar(-s.radius));
      const placeCenter = new THREE.Vector3(place.pos[0], this.set.terrain.heightAt(place.pos[0], place.pos[1]), place.pos[1]);
      const center = subs.length ? box.getCenter(new THREE.Vector3()) : placeCenter.clone().setY(placeCenter.y + 1);
      const extent = subs.length ? Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.6) : (place.radius ?? 10);
      // Look from where the subjects face (so we see faces), turned a little for a 3/4 view.
      let from = shot.from != null ? (shot.from + (place.rotate ?? 0)) * D2R : null;
      if (from == null) {
        if (subs.length) {
          let sx = 0, sz = 0;
          for (const s of subs) { sx += Math.sin(s.yaw); sz += Math.cos(s.yaw); }
          if (Math.hypot(sx, sz) > 0.3 * subs.length) {
            from = Math.atan2(sx, sz) + (shot.turn ?? 22) * D2R;
          } else if (subs.length >= 2) {
            // Facing each other: look across the line between them, from the southern side.
            const ab = subs[1].center.clone().sub(subs[0].center);
            let px = ab.z, pz = -ab.x;
            if (pz < 0) { px = -px; pz = -pz; }
            from = Math.atan2(px, pz) + (shot.turn ?? 12) * D2R;
          } else from = ((place.rotate ?? 0) + 20) * D2R;
        } else from = ((place.rotate ?? 0) + 20) * D2R;
      }
      const dir = new THREE.Vector3(Math.sin(from), 0, Math.cos(from));
      const half = Math.tan((fov * D2R) / 2);
      const aspect = Math.max(cam.aspect, 0.5);
      const fit = (r) => r / half / Math.min(1, aspect * 0.9);
      let dist, height;
      target = center.clone();
      switch (kind) {
        case 'establishing':
          fov = shot.fov ?? 40;
          target = placeCenter.clone().setY(placeCenter.y + 1.2);
          dist = shot.distance ?? Math.max((place.radius ?? 10) * 2.3, 20);
          height = shot.height ?? dist * 0.5;
          break;
        case 'wide':
          dist = shot.distance ?? fit(extent + 1.8) * 0.92;
          height = shot.height ?? 1.1 + dist * 0.2;
          target.y = center.y - 0.1;
          break;
        case 'close': {
          const s = subs[0] ?? { head: center, height: 1 };
          target = s.head.clone();
          dist = shot.distance ?? 1.75 * s.height;
          height = shot.height ?? 0.1;
          fov = shot.fov ?? 30;
          break;
        }
        case 'two':
        case 'medium':
          dist = shot.distance ?? fit(extent * 0.95 + 0.38);
          height = shot.height ?? 0.55 + dist * 0.12;
          break;
        case 'over': {
          const a = subs[0], b = subs[1] ?? subs[0];
          if (a && b) {
            const ab = b.center.clone().sub(a.center).setY(0).normalize();
            const side = new THREE.Vector3(ab.z, 0, -ab.x);
            pos = a.center.clone().addScaledVector(ab, -1.25).addScaledVector(side, 0.5).setY(a.center.y + 0.45);
            target = b.head.clone();
          }
          fov = shot.fov ?? 34;
          break;
        }
        case 'low':
          dist = shot.distance ?? fit(extent * 1.25 + 0.6);
          height = shot.height ?? -0.5;
          target.y += 0.2;
          break;
        case 'high':
          dist = shot.distance ?? fit(extent * 1.4 + 1.5);
          height = shot.height ?? dist * 0.95;
          break;
        case 'top':
          dist = 0.01;
          height = shot.height ?? fit(extent + 6) * 1.1;
          break;
        default:
          dist = shot.distance ?? fit(extent * 1.2 + 0.5);
          height = shot.height ?? 0.6 + dist * 0.12;
      }
      if (!pos) {
        pos = target.clone().addScaledVector(dir, dist).setY(target.y + height);
        // Don't let a lamp post or a tree stand between the camera and the subjects: swing
        // around the target in small steps until the view is clear.
        // An explicit `from` is honored within a small swing.
        if (subs.length && kind !== 'establishing' && kind !== 'top') {
          pos = this.clearView(pos, target, subs, shot.from == null ? 80 : 24) ?? pos;
        }
      }
    }
    // Keep the camera above the ground.
    const ground = this.set.terrain.heightAt(pos.x, pos.z);
    pos.y = Math.max(pos.y, Math.max(ground, WATER_LEVEL) + 0.25);
    cam.fov = fov;
    cam.near = 0.05;
    cam.far = 2500;
    cam.position.copy(pos);
    controls.target.copy(target);
    cam.updateProjectionMatrix();
    controls.update();
    this.cameraMove = shot.move && shot.move !== 'still' ? { kind: shot.move, speed: shot.speed ?? 1, t: 0, origin: pos.clone(), target: target.clone() } : null;
    const radius = shot.shot === 'establishing' ? (place.radius ?? 10) * 2.2 : Math.max(pos.distanceTo(target) * 0.9, 12);
    this.stage.focus(target.clone().setY(0), Math.min(radius, 48));
    return shot;
  }

  /**
   * A camera position near `pos` (same distance and height, swung around `target`) where no
   * prop stands in front of the subjects on screen: a lamp post between two people ruins a
   * two-shot even when it hides neither of them.
   */
  clearView(pos, target, subs, maxSwing = 80) {
    const boxes = this.blockerBoxes(target);
    const cam = this.stage.camera.clone();
    const corners = (box) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const rectOf = (points, c) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, near = Infinity;
      for (const p of points) {
        const d = p.distanceTo(c.position);
        near = Math.min(near, d);
        const v = p.clone().project(c);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      return { x0, x1, y0, y1, near };
    };
    const subjectPoints = subs.flatMap((s) => [s.center.clone().addScalar(-s.radius), s.center.clone().addScalar(s.radius), s.head]);
    // How much stands in front of the subjects on screen. A thin post counts as a quarter of
    // the frame's width, because it splits the picture even when it hides little.
    const occlusion = (p) => {
      cam.position.copy(p);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      const sr = rectOf(subjectPoints, cam);
      const nearest = Math.min(...subs.map((s) => s.center.distanceTo(p) - s.radius));
      const w = Math.max(sr.x1 - sr.x0, 1e-3), h = Math.max(sr.y1 - sr.y0, 1e-3);
      let score = 0;
      for (const b of boxes) {
        // The camera inside something (a canopy, a house) sees nothing else.
        if (b.clone().expandByScalar(0.35).containsPoint(p)) { score += 3; continue; }
        const r = rectOf(corners(b), cam);
        if (r.near > nearest - 0.15) continue;
        // A big thing close to the lens (a roof, a canopy) spoils the frame even beside the cast.
        const fx = Math.min(r.x1, 1) - Math.max(r.x0, -1), fy = Math.min(r.y1, 1) - Math.max(r.y0, -1);
        if (fx > 0 && fy > 0 && r.near < nearest * 0.6) score += Math.max(0, (fx * fy) / 4 - 0.06) * 1.6;
        const ox = Math.min(r.x1, sr.x1) - Math.max(r.x0, sr.x0);
        const oy = Math.min(r.y1, sr.y1) - Math.max(r.y0, sr.y0);
        if (ox <= 0 || oy <= 0) continue;
        score += Math.max(ox / w, 0.25) * (oy / h);
      }
      return score;
    };
    // Seeing the back of the cast costs a little: a clear view of their backs can still beat a
    // cluttered view of their faces.
    const faces = subs.filter((s) => s.character);
    const backs = (p) => {
      if (!faces.length) return 0;
      let b = 0;
      for (const s of faces) {
        const dx = p.x - s.center.x, dz = p.z - s.center.z;
        const d = Math.hypot(dx, dz) || 1;
        b += (1 - (Math.sin(s.yaw) * dx + Math.cos(s.yaw) * dz) / d) / 2;
      }
      return (b / faces.length) * 0.45;
    };
    const off = pos.clone().sub(target);
    let best = pos, bestScore = occlusion(pos) + backs(pos);
    if (bestScore - backs(pos) < 0.02) return pos;
    // Try swinging around the subjects, coming closer or backing off, and rising; small
    // departures from the intended framing cost a little, so they only win when they help.
    const flat = off.clone().setY(0);
    const rise = off.y;
    const steps = [0, 8, -8, 16, -16, 24, -24, 36, -36, 50, -50, 65, -65, 80, -80, 100, -100, 125, -125, 150, -150, 180];
    for (const step of steps) {
      // Beyond the allowed swing only while every view so far is badly blocked.
      if (Math.abs(step) > maxSwing && bestScore < 0.6) continue;
      for (const [k, up] of [[1, 0], [0.75, 0], [1, 0.8], [0.75, 0.8], [1.2, 1.6], [0.9, 2.4]]) {
        if (!step && k === 1 && !up) continue;
        const o = flat.clone().multiplyScalar(k).applyAxisAngle(new THREE.Vector3(0, 1, 0), step * D2R).setY(rise * k + up);
        const p = target.clone().add(o);
        const score = occlusion(p) + backs(p) + Math.abs(step) * 0.0015 + Math.abs(1 - k) * 0.12 + up * 0.06;
        if (window.DEBUG_FRAMING) console.log('framing', step, k, up, score.toFixed(2));
        if (score < bestScore - 0.03) { best = p; bestScore = score; }
      }
      if (bestScore < 0.04) break;
    }
    return best;
  }

  /** Bounding boxes of everything that could stand in front of the camera near a point. */
  blockerBoxes(near) {
    const boxes = [];
    for (const o of this.set.objects.values()) {
      if (o.position.distanceTo(near) > 30) continue;
      const b = new THREE.Box3().setFromObject(o);
      if (!b.isEmpty() && b.max.y - b.min.y > 0.25) boxes.push(b);
    }
    const m = new THREE.Matrix4();
    for (const group of this.set.object.children) {
      if (!group.name?.startsWith('scatter:')) continue;
      for (const inst of group.children) {
        if (!inst.isInstancedMesh) continue;
        inst.geometry.computeBoundingBox();
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m);
          const b = inst.geometry.boundingBox.clone().applyMatrix4(m);
          if (b.max.y - b.min.y > 0.4 && b.getCenter(new THREE.Vector3()).distanceTo(near) < 25) boxes.push(b);
        }
      }
    }
    return boxes;
  }

  update(dt) {
    for (const member of this.cast.values()) {
      member.walker?.update(dt);
      member.character.update(dt);
    }
    if (this.set) this.set.update(this.stageTime(), dt, this.stage.controls.target);
    const m = this.cameraMove;
    if (m && !this.userCamera) {
      m.t += dt * m.speed;
      const cam = this.stage.camera;
      const controls = this.stage.controls;
      const off = m.origin.clone().sub(m.target);
      if (m.kind === 'orbit') off.applyAxisAngle(new THREE.Vector3(0, 1, 0), m.t * 0.06);
      if (m.kind === 'push') off.multiplyScalar(Math.max(0.55, 1 - m.t * 0.035));
      if (m.kind === 'pull') off.multiplyScalar(1 + Math.min(m.t * 0.035, 0.6));
      cam.position.copy(m.target).add(off);
      if (m.kind === 'pan') {
        const side = new THREE.Vector3(off.z, 0, -off.x).normalize().multiplyScalar(Math.sin(m.t * 0.25) * 1.2);
        cam.position.add(side);
        controls.target.copy(m.target).add(side);
      }
    }
  }

  stageTime() {
    return this.stage.sky.uniforms.uTime.value;
  }
}

/** Walk a cast member along a path (place-local points), back and forth or round and round. */
class Walker {
  constructor(director, character, entry, state) {
    this.character = character;
    this.speed = entry.speed ?? 1.1;
    this.loop = entry.loop ?? 'pingpong';
    this.terrain = director.set.terrain;
    this.points = entry.path.map((p) => { const [x, z] = director.world.resolveAt(p, state.place, state.things); return new THREE.Vector3(x, 0, z); });
    this.lengths = [0];
    for (let i = 1; i < this.points.length; i++) this.lengths.push(this.lengths[i - 1] + this.points[i].distanceTo(this.points[i - 1]));
    this.total = this.lengths[this.lengths.length - 1];
    this.s = 0;
    this.dir = 1;
    this.clip = entry.do && character.actions.has(entry.do) ? entry.do : this.speed > 2.2 ? 'Run' : 'Walk';
    character.play(this.clip, 0);
    this.update(0);
  }

  update(dt) {
    if (this.total < 0.01) return;
    this.s += dt * this.speed * this.dir;
    if (this.s > this.total) {
      if (this.loop === 'pingpong') { this.s = this.total - (this.s - this.total); this.dir = -1; }
      else if (this.loop === 'once') { this.s = this.total; }
      else this.s %= this.total;
    }
    if (this.s < 0) { this.s = -this.s; this.dir = 1; }
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i] < this.s) i++;
    const a = this.points[i - 1], b = this.points[i];
    const u = (this.s - this.lengths[i - 1]) / Math.max(this.lengths[i] - this.lengths[i - 1], 1e-6);
    const p = a.clone().lerp(b, Math.min(Math.max(u, 0), 1));
    p.y = this.terrain.heightAt(p.x, p.z);
    const root = this.character.root;
    root.position.copy(p);
    const d = b.clone().sub(a).multiplyScalar(this.dir);
    const want = Math.atan2(d.x, d.z);
    let delta = want - root.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    root.rotation.y += delta * Math.min(1, dt * 8 + (dt === 0 ? 1 : 0));
  }
}

/** A direction look becomes a full character spec: species defaults under the overrides. */
export function buildSpec(look = {}) {
  const { species = 'human', guessed, name, ...rest } = look;
  const base = SPECIES[species]?.spec ?? {};
  const merged = { ...base, ...rest };
  for (const k of ['face', 'fur', 'outfit']) if (base[k] || rest[k]) merged[k] = { ...(base[k] ?? {}), ...(rest[k] ?? {}) };
  if (base.parts && !rest.parts) merged.parts = base.parts;
  void guessed; void name;
  return merged;
}

export { poseLift };
