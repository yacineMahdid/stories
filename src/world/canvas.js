/**
 * Reads a Story Canvas file (data/world.json, a tldraw snapshot) without tldraw: map pins,
 * characters and story pages in reading order, the same way the canvas app numbers them
 * (Story ⊃ Book ⊃ Chapter ⊃ Page; rows top to bottom, left to right inside each box).
 */

/** Where a pin points: the tip of its marker (the SVG is 28×36 at the shape's top-left). */
export const PIN_TIP = [14, 35];

const STRUCTURAL = new Set(['story', 'book', 'chapter', 'scene']);

export function readCanvas(snapshot) {
  const store = snapshot?.document?.store ?? snapshot?.store ?? {};
  const records = Object.values(store);
  const shapes = new Map(records.filter((r) => r.typeName === 'shape').map((r) => [r.id, r]));

  // Absolute page position of a shape (parents are pages or other shapes; rotation is ignored).
  const abs = new Map();
  const position = (s) => {
    if (abs.has(s.id)) return abs.get(s.id);
    let x = s.x ?? 0, y = s.y ?? 0;
    const parent = shapes.get(s.parentId);
    if (parent) { const p = position(parent); x += p[0]; y += p[1]; }
    abs.set(s.id, [x, y]);
    return [x, y];
  };
  const pageOf = (s) => {
    let cur = s;
    while (cur && shapes.has(cur.parentId)) cur = shapes.get(cur.parentId);
    return cur?.parentId ?? null;
  };
  const bounds = (s) => {
    const [x, y] = position(s);
    return { x, y, minY: y, maxY: y + (s.props?.h ?? 0), w: s.props?.w ?? 0 };
  };

  const pins = new Map();
  const characters = new Map();
  for (const s of shapes.values()) {
    if (s.type === 'pin') {
      const [x, y] = position(s);
      const p = s.props ?? {};
      pins.set(s.id, { id: s.id, name: p.name ?? '', kind: p.kind ?? 'place', color: p.color, description: p.description ?? '', at: [x + PIN_TIP[0], y + PIN_TIP[1]], page: pageOf(s) });
    } else if (s.type === 'character') {
      const p = s.props ?? {};
      characters.set(s.id, { id: s.id, name: p.name ?? '', role: p.role ?? '', color: p.color, appearance: p.appearance ?? '', personality: p.personality ?? '', born: p.born ?? null });
    }
  }

  // Reading order, mirroring app/src/lib/structure.ts.
  const childrenOf = (parentId) => {
    const kids = [...shapes.values()]
      .filter((s) => s.parentId === parentId && STRUCTURAL.has(s.type))
      .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
    return kids
      .map((s) => ({ s, b: bounds(s) }))
      .sort((a, b) => {
        const sameRow = a.b.minY < b.b.maxY && b.b.minY < a.b.maxY;
        return sameRow ? a.b.x - b.b.x : a.b.y - b.b.y;
      })
      .map((x) => x.s);
  };
  const pages = [];
  const walk = (parentId, ctx) => {
    for (const shape of childrenOf(parentId)) {
      if (shape.type === 'scene') {
        const number = ++ctx.pages.n;
        const path = [ctx.book && `Book ${ctx.book}`, ctx.chapter && `Ch ${ctx.chapter}`, `p. ${number}`].filter(Boolean).join(' · ');
        const p = shape.props ?? {};
        pages.push({
          id: shape.id, title: p.title ?? '', when: p.when ?? '', at: p.at ?? {}, summary: p.summary ?? '',
          characterIds: p.characterIds ?? [], locationIds: p.locationIds ?? [], modifiers: p.modifiers ?? {},
          path, number, storyId: ctx.storyId, chapter: ctx.chapterTitle ?? '', book: ctx.bookTitle ?? '',
        });
        continue;
      }
      const n = (ctx.counters[shape.type] = (ctx.counters[shape.type] ?? 0) + 1);
      let next;
      if (shape.type === 'story') next = { storyId: shape.id, pages: { n: 0 }, counters: {}, storyTitle: shape.props?.title };
      else if (shape.type === 'book') next = { ...ctx, book: n, bookTitle: shape.props?.title, pages: { n: 0 }, counters: {} };
      else next = { ...ctx, chapter: n, chapterTitle: shape.props?.title, counters: ctx.counters };
      walk(shape.id, next);
    }
  };
  walk('page:story', { storyId: null, pages: { n: 0 }, counters: {} });
  pages.forEach((p, i) => { p.index = i; });

  const stories = [...shapes.values()].filter((s) => s.type === 'story').map((s) => ({ id: s.id, title: s.props?.title ?? '', synopsis: s.props?.synopsis ?? '' }));
  return { pins, characters, pages, stories };
}

/** "Year 3, month 4, day 12, 09:00" style label for a page's world time. */
export function formatWorldTime(t = {}) {
  if (t.year == null) return '';
  const parts = [`Year ${t.year}`];
  if (t.month != null) parts.push(`month ${t.month}`);
  if (t.day != null) parts.push(`day ${t.day}`);
  let s = parts.join(', ');
  if (t.hour != null) s += `, ${String(Math.floor(t.hour)).padStart(2, '0')}:${String(Math.round((t.hour % 1) * 60)).padStart(2, '0')}`;
  return s;
}
