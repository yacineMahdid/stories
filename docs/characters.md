# Characters

Every character is the **canonical base** plus a **spec**. The mesh, skeleton and
animations are shared; the spec sets skin, outfit, face and proportions.

## The base (`assets/characters/canonical/base.gltf`)

Built by `python3 tools/build_base.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/base.gltf`.

- 1 unit tall, feet on `y = 0`, facing `+Z`. "Left" is the character's own left (`+X`).
- Chibi proportions shared by all three references studied: the head is about 43% of the
  height, the legs about 20%.
- 30 joints, Mixamo-style names, identity rest rotations (a pose is just Euler angles):

```
Root
└─ Hips
   ├─ Spine ─ Spine1 ─┬─ Neck ─ Head ─┬─ HeadTop_End   (socket: hats, hair)
   │                  │               ├─ LeftEar        (socket: animal ears)
   │                  │               └─ RightEar
   │                  ├─ LeftShoulder ─ LeftArm ─ LeftForeArm ─ LeftHand ─ LeftHand_End  (socket: held props)
   │                  └─ RightShoulder ─ RightArm ─ RightForeArm ─ RightHand ─ RightHand_End
   ├─ LeftUpLeg ─ LeftLeg ─ LeftFoot ─ LeftToeBase ─ LeftToe_End
   ├─ RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase ─ RightToe_End
   └─ Tail                                                    (socket: tails)
```

- Skin weights are computed from body regions with smooth blends at every joint; the head is
  rigid on `Head`.
- A **face layer** (thin shell over the front of the head, rigid on `Head`) carries a canvas
  texture: eyes, nose, mouth, brows and blush are drawn in code, so expressions, blinking and
  talking are just redraws.

## Spec

```js
{
  skin: '#f8d3b0',                 // skin, or fur for animals
  height: 1, headScale: 1,
  body: 'standard',                // body.js: slim, chubby, round, muscular, stocky, tall, lanky, short, kid
  ears: 'human',                   // ears.js: small, big, elf, cat, fox, bunny, bear, mouse, floppy, cow, horse, none
  hair: { style: 'bob', color },   // hair.js: spiky, bob, swept, pigtails, ponytail, bun, long
  outfit: { top, sleeves, hem, bottom, legs, shoes },   // outfit.js, painted in the body shader
  fur: { second, third, paws, belly, chin, back, spots, stripes },  // outfit.js fur patterns
  parts: [{ type: 'snout', shape: 'dog', color }, ...], // parts.js: snout, brow, horns, domes, mane, ruff, tail
  face: {                          // face.js
    eyes, eyeColor, eyeLine, eyeSize, eyeSpacing,      // eyes.js: 17 styles
    nose, noseColor, mouth, mouthColor, lipColor,       // face-parts.js: 13 noses, 19 resting mouths
    blush, brows, mask, whiskers, eyeY, noseY, mouthY,
  },
}
```

`species.js` holds ready-made specs for a human and eight animals (monkey, baboon, gorilla,
cow, dog, cat, horse, frog), all on the same rig and animations.

## Animation and emotion

- `animations.js` + `moves.js`: 56 procedural clips in groups (basics, getting around,
  sitting and lying, falls and getting hurt, gestures, actions). One-shot moves (falls,
  throws, get up...) play once and hold. `pose-tools.js` aims arms and legs by direction and
  keyframes one-shots.
- `emotions.js`: 42 manga-style emotions. Each picks eye modes, brows, mouth, cheeks, tears
  and eye shade on the face canvas, floats symbols around the head (`symbols.js`: sweat
  drops, anger veins, steam, !, ?, Zzz, hearts, dizzy stars, gloom lines, menacing ゴ...) and
  can add a body motion (tremble, bounce, sway, slump...).

```js
const hero = await createCharacter(SPECIES.dog.spec);
stage.add(hero);
hero.play('Walk');
hero.setEmotion('excited');
hero.talking = true;
hero.socket('rightHand').add(someProp);
```

## Building the assets

```
python3 tools/build_base.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/base.gltf
python3 tools/build_hair.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/hair
```

## Trying it

Serve the repo root (for example `python3 -m http.server`) and open `lab.html`.
