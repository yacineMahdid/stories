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
  skin: '#f8d3b0',
  height: 1,                 // overall scale
  headScale: 1,
  outfit: {                  // painted in the shader from rest-pose position: clean hems
    top: '#f2c14e', sleeves: 'none' | 'short' | 'elbow' | 'long', hem: 0.29,
    bottom: '#3d5a80', legs: 'shorts' | 'knee' | 'pants',
    shoes: '#f4f1ea',
  },
  face: {
    eyes: 'classic' | 'round' | 'sparkle' | 'dot', eyeColor, eyeLine, eyeSize, eyeSpacing,
    nose: 'triangle' | 'dot' | 'none', noseColor,
    mouth: 'smile' | 'flat' | 'cat' | 'grin', mouthColor,
    blush: true, blushColor, brows: true, browColor,
  },
}
```

## Animation

`src/engine/animations.js` is a library of procedural clips baked for the canonical rig:
Idle, Walk, Run, Wave, Nod, Shake, Talk, Jump, Sit, Cheer. Every clip writes every body
bone, so cross-fades are clean. Faces: neutral, happy, sad, surprised, angry, sleepy, with
automatic blinking and mouth flaps while talking.

```js
const hero = await createCharacter(spec);
stage.add(hero);
hero.play('Walk');
hero.setExpression('happy');
hero.talking = true;
hero.socket('rightHand').add(someProp);
```

## Trying it

Serve the repo root (for example `python3 -m http.server`) and open `lab.html`.
