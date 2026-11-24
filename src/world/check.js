import { CATALOG, buildProp } from './props/index.js';
import { ANIMATION_GROUPS } from '../engine/animations.js';
import { EMOTIONS } from '../engine/emotions.js';
import { WEATHERS } from './sky.js';

/**
 * Check a whole story's direction without rendering it: every page's place, things, spots,
 * cast, animations, emotions, weather and continuity references. Returns one entry per page.
 */
export function checkStory(world) {
  const clips = new Set(Object.values(ANIMATION_GROUPS).flat());
  const report = [];
  const spotCache = new Map();
  const spotsOf = (thing) => {
    if (!spotCache.has(thing.id)) {
      const o = buildProp(thing.kind, thing, { id: thing.id });
      spotCache.set(thing.id, Object.keys(o.userData.spots ?? {}));
    }
    return spotCache.get(thing.id);
  };
  world.scenes.forEach((scene, i) => {
    const state = world.sceneState(i);
    const problems = [...state.warnings];
    for (const t of state.things.values()) {
      if (t.kind === '__terrain') continue;
      const kinds = t.kind === 'scatter' ? (Array.isArray(t.of) ? t.of : [t.of]) : [t.kind];
      for (const k of kinds) if (!CATALOG[k]) problems.push(`Unknown prop kind "${k}" (${t.id}).`);
    }
    if (state.weather && !WEATHERS[state.weather]) problems.push(`Unknown weather "${state.weather}".`);
    for (const c of state.cast) {
      const name = c.character.name;
      if (c.do && !clips.has(c.do)) problems.push(`${name}: no animation "${c.do}".`);
      if (c.feel && !EMOTIONS[c.feel]) problems.push(`${name}: no emotion "${c.feel}".`);
      const hold = typeof c.hold === 'string' ? c.hold : c.hold?.kind;
      if (hold && !CATALOG[hold] && !CATALOG[`held-${hold}`]) problems.push(`${name}: no hand prop "${hold}".`);
      if (typeof c.at === 'string') {
        const [id, spot] = c.at.split('.');
        const thing = state.things.get(id);
        if (!thing) problems.push(`${name} stands at "${c.at}", but there is no "${id}" here.`);
        else if (spot && CATALOG[thing.kind] && !spotsOf(thing).includes(spot)) problems.push(`${name}: "${id}" (${thing.kind}) has no spot "${spot}" (it has: ${spotsOf(thing).join(', ') || 'none'}).`);
      }
    }
    for (const shot of state.shots) {
      for (const ref of shot.on ? (Array.isArray(shot.on) ? shot.on : [shot.on]) : []) {
        if (!state.cast.some((c) => c.who === ref || c.character.name === ref) && !state.things.has(ref)) problems.push(`A shot looks at "${ref}", who is not in this page.`);
      }
    }
    report.push({ page: `${scene.page.path} ${scene.page.title}`, place: state.place?.name, problems: [...new Set(problems)] });
  });
  return { world: [...world.warnings], pages: report };
}
