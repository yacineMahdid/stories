// node src/lib/direct.test.ts — checks what Direct mode's edits write (see direct.ts).
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {
  castOps, castToEdit, cameraOps, cameraToEdit, deg360, dressingOps, facingChoice, facingOf, heldChoice, localToWorld, memberIndex,
  momentHint, momentOps, movedFields, newMember, newThing, newThingId, ownDressing, refersTo, round2, roundFov, sceneEntry, sceneEntryKey,
  sceneKey, slugOf, stepKey, withMember, withoutMember, wordsOf, worldToLocal, yawOf, yawToward, type CastEntry, type Listed,
  brief, exactShot, feedbackOps, framedShot, framingOf, FRAMINGS, isExact, isLocked, lockedCamera, lockOps, newNote, newShotAt, newShotLabel,
  noteIndex, noteShot, ownFeedback, ownsCamera, shotName, shotSubjects, toggledDone, unlockOps, withSubject, type CameraView, type Feedback, type Shot,
  closeSubject, idsIn, ONE_SUBJECT, standAt, withCloseSubject,
} from './direct.ts'
import { patchText, parseDirection, applyOp, checkOps, type JsonOp, type Removed } from '../../server/json-style.ts'

let failures = 0
const test = (name: string, fn: () => void) => {
  try { fn(); console.log(`ok   ${name}`) } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').join('\n     ')}`) }
}

const sample = fs.readFileSync(new URL('../../../samples/brindlewick/staging.json', import.meta.url), 'utf8')
const parse = (text: string) => parseDirection(text) as Record<string, any>
const doc = parse(sample)
const mira: Listed = { id: 'shape:mira', name: 'Mira' }
const biscuit: Listed = { id: 'shape:biscuit', name: 'Biscuit' }
const juniper: Listed = { id: 'shape:juniper', name: 'Juniper' }

/* ── the entry key ── */

test('entry key: the page id, a title written by hand (any case), or none', () => {
  assert.equal(sceneEntryKey(doc, 'shape:p1', 'Morning in the square'), 'shape:p1')
  const byTitle = { scenes: { 'Morning In The Square': { weather: 'fog' }, other: {} } }
  assert.equal(sceneEntryKey(byTitle, 'shape:p1', 'Morning in the square'), 'Morning In The Square')
  assert.equal(sceneEntryKey(byTitle, 'shape:p9', ''), null)
  assert.equal(sceneEntryKey({}, 'shape:p1', 'x'), null)
  assert.equal(sceneEntryKey({ scenes: 'broken' }, 'shape:p1', 'x'), null)
})
test('entry key: the id wins over a title; an edit goes under the id when there is no entry', () => {
  const both = { scenes: { 'Morning in the square': {}, 'shape:p1': {} } }
  assert.equal(sceneKey(both, 'shape:p1', 'Morning in the square'), 'shape:p1')
  assert.equal(sceneKey({ scenes: {} }, 'shape:p9', 'New page'), 'shape:p9')
  assert.deepEqual(sceneEntry(doc, 'shape:p9', 'Nothing'), {})
  assert.equal(sceneEntry(doc, 'shape:p3', '').weather, 'storm')
})
test('step keys', () => {
  assert.equal(stepKey('shape:p1', 'cast', 'shape:mira', 'at'), 'shape:p1|direct cast shape:mira at')
})

/* ── units ── */

test('rounding: positions to 0.01, degrees whole 0–359, a lens to 0.1', () => {
  assert.equal(round2(1.23456), 1.23)
  assert.equal(round2(-0.004), 0)
  assert.ok(!Object.is(round2(-0.001), -0))
  assert.equal(roundFov(34.96), 35)
  assert.equal(roundFov(41.234), 41.2)
  assert.deepEqual([deg360(-15), deg360(359.6), deg360(720), deg360(181.2), deg360(-0.2)], [345, 0, 0, 181, 0])
})
test('place units: local → world → local is exact for any rotate; facings follow the place', () => {
  for (const rotate of [0, 37, 90, 180, -45, 359]) {
    const place = { pos: [12.5, -40] as [number, number], rotate }
    for (const p of [[0, 0], [1, 0], [0, 1], [-3.4, 8.7], [100, -0.25]] as [number, number][]) {
      const back = worldToLocal(localToWorld(p, place), place)
      assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1]) < 1e-9, `${rotate}: ${p} → ${back}`)
    }
    for (const deg of [0, 15, 90, 200, 359]) assert.equal(facingOf(yawOf(deg, rotate), rotate), deg)
  }
  // Unturned: local is world from the pin; 0° faces south (+z) and 90° east (+x).
  assert.deepEqual(localToWorld([1, 2], { pos: [10, 20], rotate: 0 }), [11, 22])
  assert.equal(facingOf(yawToward([0, 0], [0, 5])), 0)
  assert.equal(facingOf(yawToward([0, 0], [5, 0])), 90)
  assert.equal(facingOf(yawToward([0, 0], [0, -5])), 180)
  assert.equal(facingOf(yawToward([0, 0], [-5, 0])), 270)
})

/* ── who is who ── */

test('a who means a character by card id, id without "shape:", or name in any case', () => {
  assert.ok(refersTo('shape:mira', 'shape:mira', 'Mira'))
  assert.ok(refersTo('mira', 'shape:mira', 'Mira'))
  assert.ok(refersTo('MIRA', 'shape:mira', 'Mira'))
  assert.ok(!refersTo('Biscuit', 'shape:mira', 'Mira'))
  assert.ok(!refersTo(undefined, 'shape:mira', 'Mira'))
  assert.ok(!refersTo('', 'shape:mira', ''))
  assert.equal(memberIndex([{ who: 'Biscuit' }, { who: 'Mira' }], 'shape:mira', 'Mira'), 1)
  assert.equal(memberIndex([{ who: 'Biscuit' }], 'shape:mira', 'Mira'), -1)
})

/* ── copy on write ── */

const p1 = doc.scenes['shape:p1'].cast as CastEntry[]
// The cast as the stage shows it (castMarks): every entry explicit, `who` as the card id.
const marks: CastEntry[] = [
  { who: 'shape:mira', at: [0.6, 5.2], facing: 'shape:biscuit', do: 'Wave', feel: 'cheerful', hold: 'held-bag' },
  { who: 'shape:biscuit', at: [1.9, 3.1], facing: 'shape:mira', do: 'Wave', feel: 'excited', talk: true },
  { who: 'shape:juniper', at: 'bakery.door', facing: 156, do: 'Stretch', feel: 'happy' },
]
test('copy on write: a page that places everyone it lists edits its own list as written', () => {
  const list = castToEdit(p1, marks, [mira, biscuit, juniper])
  assert.deepEqual(list, p1)
  assert.notEqual(list, p1) // a copy
  list[0].feel = 'sad'
  assert.equal(p1[0].feel, 'cheerful')
  // The entry of someone else isn't filled in from the stage (Juniper keeps no facing).
  assert.equal(withMember(list, 'shape:mira', 'Mira', { feel: 'sad' })[2].facing, undefined)
})
test('copy on write: automatic, inherited, or own plus gathered members: the stage’s marks', () => {
  assert.deepEqual(castToEdit(undefined, marks, [mira, biscuit, juniper]), marks) // automatic or inherited
  assert.deepEqual(castToEdit(p1.slice(0, 2), marks, [mira, biscuit, juniper]), marks) // Juniper is gathered
  assert.deepEqual(castToEdit({ who: 'shape:mira' }, marks, [mira]), marks) // not a list
  assert.deepEqual(castToEdit([], [], []), []) // an empty cast of its own stays empty
  const m = castToEdit(undefined, marks, [])
  m[0].at = [9, 9]
  assert.deepEqual(marks[0].at, [0.6, 5.2])
})
test('moving one gathered member keeps everyone else where the stage shows them', () => {
  const auto: CastEntry[] = [
    { who: 'shape:mira', at: [-0.66, 0.68], facing: 46, do: 'Talk' },
    { who: 'shape:hattie', at: [0.66, 0.68], facing: 314, do: 'Talk' },
  ]
  const moved = { ...auto[0], at: [2.5, 3] as [number, number] }
  const list = withMember(castToEdit(undefined, auto, [mira, { id: 'shape:hattie', name: 'Hattie' }]), 'shape:mira', 'Mira', movedFields(auto[0], moved, 'at'))
  assert.deepEqual(list, [{ ...auto[0], at: [2.5, 3] }, auto[1]])
})

/* ── changing members ── */

test('a field changes in its place; undefined deletes it; the written who stays as written', () => {
  const list: CastEntry[] = [{ who: 'Mira', at: [1, 2], do: 'Wave', feel: 'happy', talk: true }]
  const out = withMember(list, 'shape:mira', 'Mira', { do: 'Cheer', talk: undefined, hold: 'held-cup' })
  assert.deepEqual(out, [{ who: 'Mira', at: [1, 2], do: 'Cheer', feel: 'happy', hold: 'held-cup' }])
  assert.deepEqual(Object.keys(out[0]), ['who', 'at', 'do', 'feel', 'hold'])
  assert.equal(list[0].do, 'Wave') // the list given isn't changed
})
test('someone new is added at the end, who first; taking out removes every entry for them', () => {
  const added = withMember(p1, 'shape:bruno', 'Bruno', newMember('shape:bruno', [1.234, -2.345], -90))
  assert.deepEqual(added.at(-1), { who: 'shape:bruno', at: [1.23, -2.35], facing: 270, do: 'Idle' })
  assert.equal(added.length, 4)
  const twice: CastEntry[] = [{ who: 'shape:mira' }, { who: 'Biscuit' }, { who: 'mira', do: 'Wave' }]
  assert.deepEqual(withoutMember(twice, 'shape:mira', 'Mira'), [{ who: 'Biscuit' }])
  assert.deepEqual(withoutMember(p1, 'shape:juniper', 'Juniper').map((e) => e.who), ['shape:mira', 'shape:biscuit'])
})
test('a move writes at; a walker its path (and at only when it has one); a turn its facing', () => {
  const still: CastEntry = { who: 'shape:mira', at: 'bench-west.left', do: 'Sit' }
  assert.deepEqual(movedFields(still, { who: 'shape:mira', at: [1.5, 2], facing: 90 }, 'at'), { at: [1.5, 2] })
  assert.deepEqual(movedFields(still, { who: 'shape:mira', at: [1.5, 2], facing: 90 }, 'facing'), { facing: 90 })
  const walker: CastEntry = { who: 'shape:bruno', path: [[-2, 6.5], [3, 6.8]], speed: 0.9 }
  const walked: CastEntry = { who: 'shape:bruno', at: [-1, 7.5], facing: 80, path: [[-1, 7.5], [4, 7.8]], speed: 0.9 }
  assert.deepEqual(movedFields(walker, walked, 'at'), { path: [[-1, 7.5], [4, 7.8]] })
  assert.deepEqual(movedFields({ ...walker, at: [-2, 6.5] }, walked, 'at'), { path: [[-1, 7.5], [4, 7.8]], at: [-1, 7.5] })
  assert.deepEqual(movedFields(still, undefined, 'at'), {})
})
test('the cast is written whole under the entry key', () => {
  assert.deepEqual(castOps('Morning', p1), [{ op: 'set', path: ['scenes', 'Morning', 'cast'], value: p1 }])
})

/* ── selects ── */

test('the Facing select: degrees, a cast member (by id or name), the group, the camera, or a thing as written', () => {
  const cast = [mira, biscuit]
  assert.equal(facingChoice(120, cast), '')
  assert.equal(facingChoice(undefined, cast), '')
  assert.equal(facingChoice('shape:biscuit', cast), 'shape:biscuit')
  assert.equal(facingChoice('biscuit', cast), 'shape:biscuit')
  assert.equal(facingChoice('group', cast), 'group')
  assert.equal(facingChoice('camera', cast), 'camera')
  assert.equal(facingChoice('bridge', cast), 'bridge')
  assert.equal(wordsOf('bridge'), 'Bridge')
  assert.equal(wordsOf('stall-pastry'), 'Stall pastry')
  assert.equal(wordsOf('clearing-log.seat2'), 'Clearing log seat 2')
})
test('the Holding select: a kind as written, "lantern" for held-lantern, { kind } too', () => {
  const kinds = ['held-bag', 'held-lantern', 'held-fishingrod']
  assert.equal(heldChoice('held-bag', kinds), 'held-bag')
  assert.equal(heldChoice('lantern', kinds), 'held-lantern')
  assert.equal(heldChoice({ kind: 'held-fishingrod', line: 1.1 }, kinds), 'held-fishingrod')
  assert.equal(heldChoice(undefined, kinds), '')
  assert.equal(heldChoice('held-sword', kinds), 'held-sword') // unknown: kept, shown as it is
})

/* ── props ── */

test('a new prop id is unique across the world: <page slug>-<kind>-<n>', () => {
  assert.equal(slugOf('Lantern Festival', 'shape:p7'), 'lantern-festival')
  assert.equal(slugOf('Café “déjà vu”!', 'shape:p7'), 'cafe-deja-vu')
  assert.equal(slugOf('', 'shape:p7'), 'p7')
  assert.equal(slugOf('A very long title that goes on and on', 'shape:p7'), 'a-very-long-title-that-g')
  assert.equal(newThingId('lantern-festival', 'stall', ['lantern-festival-stall-1', 'lantern-festival-stall-2', 'fountain']), 'lantern-festival-stall-3')
  assert.equal(newThingId('p9', 'tent', []), 'p9-tent-1')
  assert.deepEqual(newThing('p9-tent-1', 'tent', [1.006, -2.004], 365.4), { id: 'p9-tent-1', kind: 'tent', at: [1.01, -2], facing: 5 })
})
test('dressing is written whole; an empty one goes, and so does an entry left empty', () => {
  const list = ownDressing(doc.scenes['shape:p5'])
  assert.equal(list.length, 3)
  list.pop()
  assert.equal(doc.scenes['shape:p5'].dressing.length, 3)
  assert.deepEqual(dressingOps('shape:p5', list), [{ op: 'set', path: ['scenes', 'shape:p5', 'dressing'], value: list }])
  assert.deepEqual(dressingOps('shape:p9', []), [{ op: 'delete', path: ['scenes', 'shape:p9', 'dressing'] }, { op: 'delete', path: ['scenes', 'shape:p9'], ifEmpty: true }])
  assert.deepEqual(ownDressing({}), [])
})

/* ── the moment ── */

test('the moment saves on the page, and its reset deletes the key', () => {
  assert.deepEqual(momentOps('shape:p1', 'time', 9.25), [{ op: 'set', path: ['scenes', 'shape:p1', 'time'], value: 9.25 }])
  assert.deepEqual(momentOps('shape:p3', 'weather', undefined), [{ op: 'delete', path: ['scenes', 'shape:p3', 'weather'] }, { op: 'delete', path: ['scenes', 'shape:p3'], ifEmpty: true }])
  assert.equal(momentHint('time', 'canvas'), 'From the page’s time')
  assert.equal(momentHint('season', 'canvas'), 'From the page’s month')
  assert.equal(momentHint('weather', 'own'), 'Set on this page')
  assert.equal(momentHint('weather', 'default'), 'Default')
})

/* ── the camera (for the camera section) ── */

test('the camera to edit: its own list or shot, else the shots in use, as written', () => {
  const own = doc.scenes['shape:p1'].camera
  assert.deepEqual(cameraToEdit(own, []), own)
  assert.deepEqual(cameraToEdit({ shot: 'wide' }, []), [{ shot: 'wide' }])
  assert.deepEqual(cameraToEdit({ same: 'shape:p1' }, own), own)
  assert.deepEqual(cameraToEdit(undefined, [{ shot: 'medium' }]), [{ shot: 'medium' }])
  assert.deepEqual(cameraOps('shape:p1', own)[0].path, ['scenes', 'shape:p1', 'camera'])
  assert.ok(ownsCamera(own) && ownsCamera({ shot: 'wide' }) && !ownsCamera({ same: 'shape:p1' }) && !ownsCamera(undefined))
})

const view: CameraView = { pos: [3.71, 1.16, 5.92], target: [1.25, 0.55, 4.15], fov: 35 }
test('Use this view: pos, target and fov; label, hold, move (and speed) kept; automatic framing goes', () => {
  const s: Shot = { shot: 'medium', on: ['shape:mira'], from: 200, label: 'Hello', hold: 4, move: 'push', speed: 0.5, distance: 3, height: 1, turn: 10, fov: 30 }
  const out = exactShot(s, view)
  assert.deepEqual(out, { label: 'Hello', hold: 4, move: 'push', speed: 0.5, fov: 35, pos: [3.71, 1.16, 5.92], target: [1.25, 0.55, 4.15] })
  assert.ok(isExact(out) && !isExact(s))
  // A shot already exact keeps its keys where they are.
  const again = exactShot({ label: 'A', pos: [0, 1, 2], target: [0, 1, 0], fov: 40, hold: 2 }, view)
  assert.deepEqual(Object.keys(again), ['label', 'pos', 'target', 'fov', 'hold'])
  assert.deepEqual(again.pos, view.pos)
  assert.equal(s.shot, 'medium') // the shot given isn't changed
  out.pos![0] = 99
  assert.equal(view.pos[0], 3.71) // nor the view
})
test('New shot from this view: { label: "Shot n", pos, target, fov }, n free', () => {
  assert.deepEqual(newShotAt([{ shot: 'wide' }, { shot: 'close' }], view), { label: 'Shot 3', ...view })
  assert.deepEqual(Object.keys(newShotAt([], view)), ['label', 'pos', 'target', 'fov'])
  assert.equal(newShotLabel([{ label: 'Shot 2' }]), 'Shot 3')
  assert.equal(newShotLabel([{ label: 'Shot 3' }, { shot: 'wide' }]), 'Shot 4')
})
test('Framing: shot set, pos, target and fov gone; the rest stays', () => {
  assert.deepEqual(framedShot({ label: 'Hello', hold: 4, move: 'push', pos: [1, 2, 3], target: [0, 1, 0], fov: 30 }, 'close'), { label: 'Hello', hold: 4, move: 'push', shot: 'close' })
  assert.deepEqual(framedShot({ shot: 'wide', on: 'bridge', label: 'B' }, 'medium'), { shot: 'medium', on: 'bridge', label: 'B' })
  assert.equal(framingOf({ pos: [1, 2, 3], target: [0, 0, 0] }, true), 'exact')
  assert.equal(framingOf({ shot: 'low' }, true), 'low')
  assert.equal(framingOf({ label: 'x' }, true), 'medium')
  assert.equal(framingOf(undefined, false), 'wide')
  assert.deepEqual(FRAMINGS.map(([id]) => id), ['establishing', 'wide', 'medium', 'two', 'close', 'over', 'low', 'high', 'top'])
  assert.equal(shotName({ label: 'Hello', shot: 'medium' }, 1), 'Hello')
  // An automatic shot by its framing, as the Framing select names it (sentence case).
  assert.equal(shotName({ shot: 'medium' }, 1), 'Medium')
  assert.equal(shotName({ shot: 'two' }, 0), 'Two shot')
  assert.equal(shotName({ shot: 'close' }, 0), 'Close-up')
  assert.equal(shotName({ shot: 'birdsEye' }, 0), 'Birds eye')
  assert.equal(shotName({}, 1), 'Shot 2')
})
test('a close-up frames one: the first its "on" names, else the first of the cast; choosing writes "on"', () => {
  const cast = [mira, biscuit, juniper]
  assert.equal(closeSubject({ shot: 'close' }, cast), 'shape:mira')
  assert.equal(closeSubject({ shot: 'close', on: ['Biscuit', 'shape:mira'] }, cast), 'shape:biscuit')
  assert.equal(closeSubject({ shot: 'close', on: 'bridge' }, cast), 'shape:mira') // a thing: the director frames the first of the cast
  assert.equal(closeSubject({ shot: 'close' }, []), null)
  assert.deepEqual(withCloseSubject({ shot: 'close', label: 'Mira' }, cast, 'shape:biscuit'), { shot: 'close', label: 'Mira', on: ['shape:biscuit'] })
  assert.deepEqual(withCloseSubject({ shot: 'close', label: 'Mira' }, cast, 'shape:mira'), { shot: 'close', label: 'Mira' }) // framed already
  assert.ok(ONE_SUBJECT.has('close') && !ONE_SUBJECT.has('two'))
})
test('Stand at: a seat drops a Doing that would stand them up; a standing spot keeps it', () => {
  const clips = { sit: ['Sit'], floor: ['SitFloor', 'SitCrossed'], lie: ['LieDown', 'Sleep'], kneel: ['Kneel', 'Squat'] }
  const biscuit = { who: 'shape:biscuit', at: [1.9, 3.1], facing: 328, do: 'Wave', feel: 'excited' } as CastEntry
  const sit = standAt(biscuit, 'bench-east.left', 'sit', clips)
  assert.deepEqual(sit, { at: 'bench-east.left', facing: undefined, do: undefined })
  assert.ok('do' in sit && 'facing' in sit) // both deleted by withMember
  assert.deepEqual(withMember([biscuit], 'shape:biscuit', 'Biscuit', sit), [{ who: 'shape:biscuit', at: 'bench-east.left', feel: 'excited' }])
  assert.deepEqual(standAt({ ...biscuit, do: 'Sit' }, 'bench-east.left', 'sit', clips), { at: 'bench-east.left', facing: undefined })
  assert.deepEqual(standAt(biscuit, 'bakery.door', 'stand', clips), { at: 'bakery.door', facing: undefined })
  assert.deepEqual(standAt(biscuit, 'wall.lean', 'lean', clips), { at: 'wall.lean', facing: undefined })
  assert.deepEqual(standAt({ ...biscuit, do: 'SitCrossed' }, 'campfire.rest', 'floor', clips), { at: 'campfire.rest', facing: undefined })
  assert.deepEqual(standAt(undefined, 'pier.end', 'sit', clips), { at: 'pier.end', facing: undefined })
})
test('ids: every id the file names, also in an entry whose page is gone, for a new prop id', () => {
  const d = { places: { 'shape:square': { things: [{ id: 'fountain', kind: 'fountain' }, { id: 'lamps', kind: 'row', of: 'lamp' }] } },
    scenes: { 'shape:gone': { dressing: [{ id: 'campfire-barrel-6', kind: 'barrel' }] }, 'shape:p3': { changes: [{ add: { id: 'campfire-barrel-5', kind: 'barrel' } }] } },
    characters: { x: { id: 'not-a-thing' } } }
  assert.deepEqual(idsIn(d).sort(), ['campfire-barrel-5', 'campfire-barrel-6', 'fountain', 'lamps'])
  assert.equal(newThingId('campfire', 'barrel', [...idsIn(d), 'campfire-barrel-1', 'campfire-barrel-2', 'campfire-barrel-3', 'campfire-barrel-4']), 'campfire-barrel-7')
  assert.deepEqual(idsIn(null), [])
})
test('entry key: a null entry under the page id doesn\'t count (the title\'s entry does), as the engine stages it', () => {
  const d = { scenes: { 'shape:p8': null, 'first snow at the pier': { camera: [{ shot: 'wide' }] } } }
  assert.equal(sceneEntryKey(d, 'shape:p8', 'First snow at the pier'), 'first snow at the pier')
  assert.ok(sceneEntry(d, 'shape:p8', 'First snow at the pier').camera)
  assert.equal(sceneKey({ scenes: { 'shape:p8': null } }, 'shape:p8', 'Nothing'), 'shape:p8') // none: the page id (the null goes)
})
test('On: whom a shot frames, by card id or name; back to everyone, "on" goes; never nobody', () => {
  const cast = [mira, biscuit, juniper]
  assert.deepEqual([...shotSubjects({ shot: 'wide' }, cast).members], ['shape:mira', 'shape:biscuit', 'shape:juniper'])
  const s = shotSubjects({ on: ['Mira', 'fountain'] }, cast)
  assert.deepEqual([...s.members], ['shape:mira'])
  assert.deepEqual(s.others, ['fountain'])
  assert.deepEqual(withSubject({ shot: 'medium' }, cast, 'shape:juniper', false), { shot: 'medium', on: ['shape:mira', 'shape:biscuit'] })
  assert.deepEqual(withSubject({ shot: 'medium', on: ['shape:mira', 'shape:biscuit'] }, cast, 'shape:juniper', true), { shot: 'medium' })
  assert.deepEqual(withSubject({ on: 'shape:mira' }, cast, 'shape:biscuit', true), { on: ['shape:mira', 'shape:biscuit'] })
  assert.deepEqual(withSubject({ on: ['shape:mira'] }, cast, 'shape:mira', false), { on: ['shape:mira'] }) // nobody: not done
  assert.deepEqual(withSubject({ on: ['bridge', 'shape:mira'] }, cast, 'shape:mira', false), { on: ['bridge'] }) // things stay
})
test('Lock: the shot on screen as the camera is now, every other exact as the director frames it', () => {
  const shots: Shot[] = doc.scenes['shape:p1'].camera
  const views = [{ pos: [0, 10, 30], target: [0, 1, 0], fov: 40 }, { pos: [1, 1.5, 7], target: [1, 1, 4], fov: 33.4 }, { pos: [2, 1.4, 6], target: [0.6, 1.2, 5.2], fov: 30 }] as CameraView[]
  const asked: number[] = []
  const out = lockedCamera(shots, 1, view, (i) => { asked.push(i); return views[i] })
  assert.deepEqual(asked, [0, 2])
  assert.deepEqual(out, [
    { label: 'The square', hold: 4, ...views[0] },
    { label: 'Hello', hold: 4, ...view },
    { label: 'Mira', hold: 3, ...views[2] },
  ])
  // A shot already exact stays as written (its lens filled in when it has none); a move stays.
  const exact = lockedCamera([{ label: 'A', pos: [1, 2, 3], target: [0, 1, 0], move: 'orbit' }, { shot: 'wide' }], 1, view, () => ({ pos: [9, 9, 9], target: [0, 0, 0], fov: 50 }))
  assert.deepEqual(exact, [{ label: 'A', pos: [1, 2, 3], target: [0, 1, 0], move: 'orbit', fov: 50 }, { ...view }])
  assert.ok(out.every(isExact) && !shots.some(isExact))
})

/* ── notes for Claude ── */

test('a note: text, view, shot, about and added, in that order; unknown ones left out', () => {
  const n = newNote({ text: 'Closer to the fountain', view, shot: 'Hello', about: 'shape:mira', added: '2026-11-26T10:00:00.000Z' })
  assert.deepEqual(Object.keys(n), ['text', 'view', 'shot', 'about', 'added'])
  assert.deepEqual(n.view, view)
  assert.deepEqual(newNote({ text: 'x', view: null, shot: null, about: null, added: 'a' }), { text: 'x', added: 'a' })
  assert.equal(noteShot({ label: 'Hello' }, 1), 'Hello')
  assert.equal(noteShot({ shot: 'wide' }, 1), 2) // no label: its number
})
test('notes: done and open again (the key goes), found where they are now', () => {
  const a: Feedback = { text: 'a', added: '1' }, b: Feedback = { text: 'b', added: '2', reply: 'Done it' }
  assert.deepEqual(toggledDone(b), { text: 'b', added: '2', reply: 'Done it', done: true })
  assert.deepEqual(toggledDone(toggledDone(b)), b)
  assert.equal(noteIndex([a, b], b, 1), 1)
  assert.equal(noteIndex([b, a], b, 1), 0) // moved
  assert.equal(noteIndex([a], b, 1), -1) // gone
  assert.deepEqual(ownFeedback({ feedback: [a] }), [a])
  assert.deepEqual(ownFeedback({ feedback: 'junk' }), [])
  assert.deepEqual(feedbackOps('shape:p1', [a]), [{ op: 'set', path: ['scenes', 'shape:p1', 'feedback'], value: [a] }])
  assert.deepEqual(feedbackOps('shape:p9', []), [{ op: 'delete', path: ['scenes', 'shape:p9', 'feedback'] }, { op: 'delete', path: ['scenes', 'shape:p9'], ifEmpty: true }])
})
test('Copy for Claude: the page, its open notes (view, shot, about by name) and its entry exactly, as pretty JSON', () => {
  const entry = { ...doc.scenes['shape:p1'], feedback: [
    { text: 'Mira should stand closer to the fountain,\nfacing Biscuit', view, shot: 'Hello', about: 'shape:mira', added: '2026-11-26T10:00:00.000Z' },
    { text: 'Already done', added: '2026-11-26T10:01:00.000Z', done: true },
    { text: 'The tent is too big', view: { pos: [1, 2, 3], target: [0, 1, 0], fov: 41.5 }, shot: 2, about: 'tent', added: '2026-11-26T10:02:00.000Z' },
  ] }
  const names: Record<string, string> = { 'shape:mira': 'Mira', tent: 'Tent' }
  const text = brief({ page: { id: 'shape:p1', title: 'Morning in the square', path: 'Book 1 · Ch 1 · p. 1' }, file: 'data/staging.json', key: 'shape:p1', entry, notes: entry.feedback, nameOf: (id) => names[id] ?? null })
  const lines = text.split('\n')
  assert.ok(lines.includes('Page: Morning in the square') && lines.includes('Id: shape:p1') && lines.includes('Path: Book 1 · Ch 1 · p. 1'), text)
  assert.ok(lines.includes('Open notes (2):'), 'only the open notes')
  assert.ok(!text.split('Its entry in')[0].includes('Already done'), 'a done note is not among the open ones (only in the entry)')
  assert.ok(lines.includes('1. Mira should stand closer to the fountain,') && lines.includes('   facing Biscuit'))
  assert.ok(lines.includes('   About: Mira (shape:mira)') && lines.includes('   Shot: "Hello"') && lines.includes('   View: {"pos":[3.71,1.16,5.92],"target":[1.25,0.55,4.15],"fov":35}'))
  assert.ok(lines.includes('2. The tent is too big') && lines.includes('   About: Tent (tent)') && lines.includes('   Shot: 2'))
  assert.ok(text.includes('Its entry in data/staging.json, under "scenes" → "shape:p1":\n' + JSON.stringify(entry, null, 2) + '\n'), 'the entry, exactly, as pretty JSON')
  const none = brief({ page: { id: 'shape:p9', title: '', path: '' }, file: 'data/staging.json', key: null, entry: {}, notes: [], nameOf: () => null })
  assert.ok(none.includes('Page: Untitled page') && none.includes('No open notes.') && none.includes('The page has no entry in data/staging.json yet'), none)
})

/* ── the lock ── */

test('lock: the full explicit direction, values the entry has already left alone; unlock deletes "locked"', () => {
  const p1e = doc.scenes['shape:p1']
  const cast = p1.map((e) => ({ ...e, at: typeof e.at === 'string' ? e.at : e.at, facing: e.facing ?? 156 }))
  const camera = lockedCamera(p1e.camera, 1, view, () => view)
  const ops = lockOps('shape:p1', p1e, { place: 'shape:square', time: 9.004, season: 'spring', weather: 'clear', ambient: 'petals', cast, camera, picture: 1 })
  assert.deepEqual(ops.map((o) => o.path.at(-1)), ['place', 'time', 'season', 'weather', 'cast', 'camera', 'locked', 'picture']) // ambient is there already
  const value = (k: string) => (ops.find((o) => o.path.at(-1) === k) as { value: unknown }).value
  assert.equal(value('time'), 9)
  assert.equal(value('locked'), true)
  assert.equal(value('picture'), 1)
  assert.ok((value('camera') as Shot[]).every(isExact))
  // Locked again with the same values: only "locked" (and nothing else) is written.
  const locked = { ...p1e, place: 'shape:square', time: 9, season: 'spring', weather: 'clear', cast, camera, picture: 1 }
  assert.deepEqual(lockOps('shape:p1', locked, { place: 'shape:square', time: 9, season: 'spring', weather: 'clear', ambient: 'petals', cast, camera, picture: 1 }), [{ op: 'set', path: ['scenes', 'shape:p1', 'locked'], value: true }])
  // No ambient, no place (a world with no pins): neither is written.
  const bare = lockOps('shape:p9', {}, { place: null, time: 12, season: 'summer', weather: 'clear', ambient: null, cast: [], camera: [{ ...view }], picture: 0 })
  assert.deepEqual(bare.map((o) => o.path.at(-1)), ['time', 'season', 'weather', 'cast', 'camera', 'locked', 'picture'])
  assert.deepEqual(unlockOps('shape:p1'), [{ op: 'delete', path: ['scenes', 'shape:p1', 'locked'] }])
  assert.ok(isLocked({ locked: true }) && !isLocked({ locked: 'yes' }) && !isLocked({}))
})

/* ── the file: each edit, its Undo and its Redo, byte for byte ── */

// The app's Undo of an edit (inverse() in staging.ts, as json-edit.test.ts copies it): the edits
// that take it back, the last of them carrying what the server said the edit took out.
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const inverseOf = (d: Record<string, any>, op: JsonOp): JsonOp[] => {
  let node = d
  for (let i = 0; i < op.path.length; i++) {
    const key = op.path[i], path = op.path.slice(0, i + 1), has = Object.hasOwn(node, key)
    if (i === op.path.length - 1) {
      if (op.op === 'rename') return has && op.to !== key && !Object.hasOwn(node, op.to) ? [{ op: 'rename', path: [...op.path.slice(0, -1), op.to], to: key }] : []
      return has ? [{ op: 'set', path, value: node[key] }] : op.op === 'set' ? [{ op: 'delete', path }] : []
    }
    if (!isObj(node[key])) {
      if (op.op !== 'set' || (Array.isArray(node[key]) && node[key].length)) return []
      if (has) return [{ op: 'set', path, value: node[key] }]
      const made: JsonOp[] = []
      for (let j = op.path.length - 1; j > i; j--) made.push({ op: 'delete', path: op.path.slice(0, j), ifEmpty: true })
      return [{ op: 'delete', path: op.path }, ...made]
    }
    node = node[key]
  }
  return []
}
const wire = (ops: JsonOp[]) => checkOps(JSON.parse(JSON.stringify(ops)))
const undoFor = (text: string, ops: JsonOp[], removed: (Removed | null)[]) => {
  let d = parseDirection(text)
  const back: JsonOp[] = []
  ops.forEach((op, i) => {
    const us = inverseOf(d, op)
    const r = removed[i]
    if (us.length && r) us[us.length - 1] = { ...us[us.length - 1], restore: r }
    back.unshift(...us)
    d = structuredClone(d)
    applyOp(d, op)
  })
  return wire(back)
}
/** Edits of one undo step, one after another; then its Undo and its Redo. */
const trip = (text: string, edits: JsonOp[][]) => {
  let t = text
  const undos: JsonOp[][] = []
  for (const ops of edits) {
    const r = patchText(t, wire(ops))
    const want = parseDirection(t)
    for (const op of ops) applyOp(want, op)
    assert.deepEqual(parseDirection(r.text), want, 'the file holds something else than the edit')
    undos.unshift(undoFor(t, ops, r.removed))
    t = r.text
  }
  const undone = patchText(t, wire(undos.flat())).text
  const redone = patchText(undone, wire(edits.flat())).text
  assert.equal(undone, text, 'Undo did not give the file back byte for byte')
  assert.equal(redone, t, 'Redo did not make the edit again')
  return t
}
const changed = (a: string, b: string) => {
  const x = a.split('\n'), y = b.split('\n')
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  let ex = x.length - 1, ey = y.length - 1
  while (ex >= i && ey >= i && x[ex] === y[ey]) { ex--; ey-- }
  return { removed: x.slice(i, ex + 1), added: y.slice(i, ey + 1) }
}

test('file: a field of one member changes the cast and nothing else, and goes back exactly', () => {
  const key = sceneKey(doc, 'shape:p1', '')
  const list = withMember(castToEdit(p1, marks, [mira, biscuit, juniper]), 'shape:mira', 'Mira', { feel: 'sad' })
  const out = trip(sample, [castOps(key, list)])
  const d = changed(sample, out)
  assert.ok(d.removed.every((l) => l.includes('"who"')) && d.removed.length <= 3, JSON.stringify(d))
  assert.equal(parse(out).scenes['shape:p1'].cast[0].feel, 'sad')
  assert.deepEqual(parse(out).scenes['shape:p2'], doc.scenes['shape:p2'])
})
test('file: nudges of one member merged in one step go back exactly', () => {
  const key = 'shape:p1'
  const a = withMember(p1, 'shape:mira', 'Mira', { at: [0.7, 5.2] })
  const b = withMember(a, 'shape:mira', 'Mira', { at: [0.8, 5.2] })
  const c = withMember(b, 'shape:mira', 'Mira', { at: [0.8, 5.1] })
  trip(sample, [castOps(key, a), castOps(key, b), castOps(key, c)])
})
test('file: the first edit of an automatic page makes its entry; Undo takes it out again', () => {
  const auto = structuredClone(doc)
  delete auto.scenes['shape:p2'].cast
  const text = patchText(sample, [{ op: 'delete', path: ['scenes', 'shape:p2', 'cast'] }]).text
  const out = trip(text, [castOps('shape:p2', [{ who: 'shape:mira', at: [1, 2], facing: 10, do: 'Talk' }])])
  assert.deepEqual(parse(out).scenes['shape:p2'].cast.length, 1)
  // A page with no entry at all: the entry is made, and goes again.
  trip(sample, [castOps('shape:p9', [newMember('shape:mira', [0, 1.5], 0)])])
})
test('file: props added, moved and removed (also the last one) go back exactly', () => {
  const list = ownDressing(doc.scenes['shape:p5'])
  const id = newThingId(slugOf('Campfire in Whisperwood', 'shape:p5'), 'stump', ['campfire'])
  trip(sample, [dressingOps('shape:p5', [...list, newThing(id, 'stump', [1, 1], 180)])])
  trip(sample, [dressingOps('shape:p5', list.map((t, i) => (i === 1 ? { ...t, at: [-3.5, -3.6], facing: 140 } : t)))])
  trip(sample, [dressingOps('shape:p5', list.slice(1))])
  // p3 has a row too: removing its single prop keeps the row.
  const p3 = ownDressing(doc.scenes['shape:p3'])
  const out = trip(sample, [dressingOps('shape:p3', p3.filter((t) => t.id !== 'storm-branch'))])
  assert.deepEqual(parse(out).scenes['shape:p3'].dressing.map((t: any) => t.id), ['sandbags'])
  // The only prop of a page with nothing else: dressing and entry go, and come back.
  const lone = patchText(sample, [{ op: 'set', path: ['scenes', 'shape:p9'], value: { dressing: [newThing('p9-tent-1', 'tent', [0, 0], 0)] } }]).text
  const gone = trip(lone, [dressingOps('shape:p9', [])])
  assert.ok(!('shape:p9' in parse(gone).scenes))
  assert.equal(gone, sample)
})
test('file: the moment set and reset, on a page with an entry and on one without', () => {
  trip(sample, [momentOps('shape:p1', 'time', 9.25)])
  trip(sample, [momentOps('shape:p1', 'time', 9.25), momentOps('shape:p1', 'time', 10.5)])
  const out = trip(sample, [momentOps('shape:p3', 'weather', undefined)])
  assert.ok(!('weather' in parse(out).scenes['shape:p3']))
  const made = trip(sample, [momentOps('shape:p9', 'season', 'winter')])
  const reset = trip(made, [momentOps('shape:p9', 'season', undefined)])
  assert.equal(reset, sample) // the entry it made goes with the reset
})
test('file: a hand-written title key gets the edit, in its place', () => {
  const text = patchText(sample, [{ op: 'rename', path: ['scenes', 'shape:p8'], to: 'First snow at the pier' }]).text
  const d = parse(text)
  const key = sceneKey(d, 'shape:p8', 'First Snow at the Pier')
  assert.equal(key, 'First snow at the pier')
  const own = d.scenes[key].cast as CastEntry[]
  const out = trip(text, [castOps(key, withMember(own, 'shape:pell', 'Old Pell', { feel: 'sleepy' }))])
  const after = parse(out).scenes
  assert.ok(!('shape:p8' in after))
  assert.equal(after['First snow at the pier'].cast[0].feel, 'sleepy')
})

test('file: the camera: Use this view, New shot, Remove shot, Framing and On go back exactly', () => {
  const own: Shot[] = doc.scenes['shape:p1'].camera
  trip(sample, [cameraOps('shape:p1', own.map((s, i) => (i === 1 ? exactShot(s, view) : s)))])
  trip(sample, [cameraOps('shape:p1', [...own, newShotAt(own, view)])])
  trip(sample, [cameraOps('shape:p1', own.filter((_, i) => i !== 2))])
  trip(sample, [cameraOps('shape:p1', own.map((s, i) => (i === 0 ? framedShot(s, 'wide') : s)))])
  trip(sample, [cameraOps('shape:p1', own.map((s, i) => (i === 1 ? withSubject(s, [mira, biscuit, juniper], 'shape:juniper', true) : s)))])
  // An automatic camera (p2 without one): the first edit gives it its own; Undo takes it out.
  const text = patchText(sample, [{ op: 'delete', path: ['scenes', 'shape:p2', 'camera'] }]).text
  const out = trip(text, [cameraOps('shape:p2', [exactShot({ shot: 'medium' }, view)])])
  assert.deepEqual(parse(out).scenes['shape:p2'].camera, [{ ...view }])
  // Two views of the same shot in one step (it merges): back exactly.
  trip(sample, [cameraOps('shape:p1', own.map((s, i) => (i === 1 ? exactShot(s, view) : s))), cameraOps('shape:p1', own.map((s, i) => (i === 1 ? exactShot(s, { ...view, fov: 30 }) : s)))])
})
test('file: notes added, done and deleted (also the last, on a page with no entry) go back exactly', () => {
  const n1 = newNote({ text: 'Closer to the fountain', view, shot: 'Hello', about: 'shape:mira', added: '2026-11-26T10:00:00.000Z' })
  const n2 = newNote({ text: 'Warmer light', view, shot: 1, added: '2026-11-26T10:05:00.000Z' })
  const a = trip(sample, [feedbackOps('shape:p1', [n1])])
  const b = trip(a, [feedbackOps('shape:p1', [n1, n2])])
  trip(b, [feedbackOps('shape:p1', [toggledDone(n1), n2])])
  trip(b, [feedbackOps('shape:p1', [n2])])
  assert.deepEqual(parse(b).scenes['shape:p1'].feedback, [n1, n2])
  // A page with no entry: the note makes one, deleting it takes the entry away again.
  const made = trip(sample, [feedbackOps('shape:p9', [n1])])
  assert.equal(trip(made, [feedbackOps('shape:p9', [])]), sample)
  // A note on a locked page changes nothing else.
  const locked = patchText(sample, [{ op: 'set', path: ['scenes', 'shape:p8', 'locked'], value: true }]).text
  const noted = trip(locked, [feedbackOps('shape:p8', [n2])])
  const d = parse(noted).scenes['shape:p8']
  assert.equal(d.locked, true)
  assert.deepEqual({ ...d, feedback: undefined }, { ...parse(locked).scenes['shape:p8'], feedback: undefined })
})
test('file: the lock is one step and goes back exactly; unlock, and a page locked under its title', () => {
  const p1e = doc.scenes['shape:p1']
  const cast = p1.map((e) => ({ ...e, facing: e.facing ?? 156 }))
  const camera = lockedCamera(p1e.camera, 2, view, () => ({ pos: [0, 8, 20], target: [0, 1, 0], fov: 40 }))
  const ops = lockOps('shape:p1', p1e, { place: 'shape:square', time: 9, season: 'spring', weather: 'clear', ambient: 'petals', cast, camera, picture: 2 })
  const out = trip(sample, [ops])
  const e = parse(out).scenes['shape:p1']
  assert.equal(e.locked, true)
  assert.equal(e.picture, 2)
  assert.deepEqual(e.cast, cast)
  assert.deepEqual(e.camera, camera)
  assert.equal(e.ambient, 'petals')
  assert.deepEqual(parse(out).scenes['shape:p2'], doc.scenes['shape:p2'])
  // Its dressing, changes and continues stay as they are (p4 continues p3; p3 has changes and dressing).
  for (const k of ['shape:p3', 'shape:p4']) {
    const en = doc.scenes[k]
    const lk = trip(sample, [lockOps(k, en, { place: 'shape:mill', time: 7, season: 'spring', weather: 'fog', ambient: null, cast: en.cast, camera: lockedCamera(en.camera, 0, view, () => view), picture: 0 })])
    const after = parse(lk).scenes[k]
    for (const f of ['dressing', 'changes', 'continues', 'feedback']) assert.deepEqual(after[f], en[f], `${k} ${f}`)
  }
  const unlocked = trip(out, [unlockOps('shape:p1')])
  const u = parse(unlocked).scenes['shape:p1']
  assert.ok(!('locked' in u) && u.picture === 2 && JSON.stringify(u.camera) === JSON.stringify(camera))
  // A page with no entry at all: the lock makes it whole; Undo takes it away.
  trip(sample, [lockOps('shape:p9', {}, { place: 'shape:square', time: 12, season: 'summer', weather: 'clear', ambient: null, cast: [newMember('shape:mira', [0, 1.5], 0)], camera: [{ ...view }], picture: 0 })])
  // Keyed by a title written by hand: the lock goes there.
  const titled = patchText(sample, [{ op: 'rename', path: ['scenes', 'shape:p8'], to: 'First snow at the pier' }]).text
  const td = parse(titled)
  const key = sceneKey(td, 'shape:p8', 'First Snow at the Pier')
  const lt = trip(titled, [lockOps(key, td.scenes[key], { place: 'shape:pier', time: 15.5, season: 'winter', weather: 'snow', ambient: null, cast: td.scenes[key].cast, camera: lockedCamera(td.scenes[key].camera, 0, view, () => view), picture: 0 })])
  assert.ok(parse(lt).scenes['First snow at the pier'].locked === true && !('shape:p8' in parse(lt).scenes))
})

if (failures) { console.log(`${failures} failed`); process.exit(1) }
console.log('all passed')
