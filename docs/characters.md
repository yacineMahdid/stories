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
  hair: { style: 'bob', color, texture? }, // hair.js: 20 styles; straight, wavy, curly or coily (see Hair)
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

## Hair

A look's hair is `{ style, color, texture? }`; no `hair` means bald. The style is one of the 20
in `HAIR_STYLES` (`hair.js`), the color any CSS color (the Look panel and the lab offer
`HAIR_COLORS`), and the texture one of `HAIR_TEXTURES`: straight, wavy, curly or coily.

Each style offers only the textures that change its look, natural first. A texture that is
missing, unknown or not offered draws the style's natural one (`hairTexture(style, texture)`),
so `{ style: 'spiky', texture: 'curly' }` is plain Spiky and every saved `{ style, color }`
keeps working. (The seven styles that came first keep their outlines and hairlines; their locks
are now broader and less even, and Ponytail's tail swings out.) The Look panel's *Hair texture*
select and the lab's chips list only the style's textures; they write `texture` only when it
isn't the style's natural one, and a style change keeps it only while the new style offers it
(and it isn't that style's natural one). A style the engine doesn't know, say from a newer
`staging.json`, draws no hair and logs one warning; the character still loads.

| Style | `style` | Textures, natural first | Own meshes (`files`) | Look |
|---|---|---|---|---|
| Spiky | `spiky` | straight | | short, ears out, a zigzag fringe of pointed tips |
| Side part | `swept` | straight | | short back and sides, one lock swept across from a part; pixie cuts too |
| Buzz cut | `buzz` | straight, coily | | a close cap that follows the skull, a little scalp showing |
| Fade | `fade` | coily, straight | | a short rounded top over sides that fade into the skin; straight is a crew cut |
| Quiff | `quiff` | straight | | a tall front lock rolling back over short sides; pompadour, slicked back |
| Short curls | `curls` | curly, coily | | a rounded cap of chunky curls over the forehead and ears |
| Shaggy | `shaggy` | straight | | a choppy mop between Spiky and Bob; bowl and mop-top cuts |
| Balding | `balding` | straight, curly, coily | | a bare dome, a band round the back, tufts above the ears |
| Bob | `bob` | straight, wavy, curly | `bob-wavy`, `bob-curly` | a blunt fringe, sides to the jaw |
| Afro | `afro` | coily, curly | | a big round cloud with a soft outline and a rounded hairline |
| Long | `long` | straight, wavy, curly | `long-wavy`, `long-curly` | past the shoulders, with a fringe |
| Center part | `parted` | straight | | long, parted in the middle, the forehead open |
| Ponytail | `ponytail` | straight | | a tail that swings out to one side |
| Pigtails | `pigtails` | straight | | a center part, bangs, two smooth bunches |
| Braids | `braids` | straight, curly, coily | | two three-strand plaits beside the face |
| Cornrows | `cornrows` | coily | | raised braided rows back to the nape, short braid ends |
| Locs | `locs` | coily | | rope-like locs to the shoulders from a sectioned scalp; twists and box braids too |
| Top bun | `bun` | straight, curly, coily | `bun-puff` (curly and coily) | a wound bun on top; a soft round puff when curly or coily |
| Two buns | `buns` | straight, curly, coily | `buns-puff` (curly and coily) | two buns high on the head; two afro puffs when curly or coily |
| Updo | `updo` | coily, straight | | swept up into a tall crown of rolled twists, nape and ears bare |

### Textures

- **Straight**: the sculpted locks below, with a tile of fine strand grooves.
- **Wavy**: locks that snake in a gentle S, a rippled outline and tips flicking in and out.
- **Curly**: chunky curl clumps, a scalloped outline with curls along the fringe, ringlets where
  hair hangs, and a tile of short curved arcs.
- **Coily**: big soft rounded forms (a cloud, puffs, rolls, rows) with low lumps and a fine,
  felted tile of tiny rings; the most matte, with the faintest sheen.

A texture is drawn one of two ways. Where it has to change the shape, it has its own mesh,
listed in the style's `files`: wavy and curly Bob and Long, and a round puff that curly and coily
share for each bun style. Otherwise the style's own mesh is drawn with that texture's tile:
straight and wavy use the strands tile, curly the curls tile and coily the coils tile. A style
lists a texture only where one of the two changes its look. The tiles are drawn once per page,
on first use, as canvas textures shared by every character (`setHairTexture`); a texture change
swaps the tiles and the material's normal strength, roughness and sheen, never the shader.

### Sculpting

Each file is built by `tools/build_hair.py` as a shell hugging the head plus extra shapes
(tails, plaits, ropes, rolls, puffs, ringlets, the long hair's lower layer), all in Head-bone
space. The hair is sculpted, not a smooth helmet:

- **Flow.** Strands grow away from a crown, or are pulled toward a tie (ponytail, pigtails,
  buns, the updo, cornrows); bangs can have their own section, be combed or swept away from a
  part.
- **Locks** follow the flow: a few broad, rounded locks of irregular widths, with creases
  between them that range from deep to shallow, so a short cut reads as soft chunks rather than
  even ribs. They merge where the strands converge and end in rounded tips where the hair ends.
  The irregularity is seeded, so every build is the same.
- **Partings** are soft grooves where two flow sections meet; the locks' relief fades out
  right at the part line, so the two sides meet without a step. Where the scalp shows (center
  parts, cornrow and loc partings) the skin shows through (see below).
- **Tails, plaits, ropes and rolls** grow out of the scalp: each starts buried in the shell or
  the head with a closed end, so no gap or open end shows at the root; free ends are rounded or
  tied.
- **Hairline:** the shell dips under the skin along the style's hairline, measured exactly to
  its segments, so edges come out as smooth curves, with the same soft edge on every style.

### Files

`assets/characters/canonical/hair/<file>.glb`: 26 files, the 20 styles plus the 6 texture
meshes. Each is a quantized binary glTF (`KHR_mesh_quantization`) with one mesh and no node
transform:

- `POSITION`: int16, normalized, directly in Head-bone metres, so the mesh is parented to the
  `Head` bone as it is and follows every head movement.
- `NORMAL`: int8, normalized.
- `TEXCOORD_0`: int16, normalized, storing uv / 16 (`UV_SCALE`, shared with `hair.js`, whose
  tiles repeat 16 times). u runs across the strands and v along them, root to tip, in units of
  a tile, which covers 0.24 × 0.48 m of hair.
- `COLOR_0`: uint8, normalized, four channels:
  - r: baked occlusion (creases, the hairline, under buns, tails and rolls, inside long hair);
  - g: skin mix, how much the skin shows through (faded sides, the buzz cut's scalp, partings,
    the balding crown's edge);
  - b: reserved (0);
  - a: strand strength × (1 − skin), how much of the tile shows (it fades where strands
    converge).
- uint16 indices: at most 48k vertices per file.
- `extras`: `{ attachTo: 'Head', style, texture, tile: [0.24, 0.48], uvScale: 16 }`.

`index.json` lists `[{ id, label, textures, files }]`; nothing reads it. A page fetches only the
files its looks use. The 26 files take {{TOTAL_SIZE}} in all; each has between {{MIN_VERTS}} and
{{MAX_VERTS}} vertices.

### Material

`hair.js` gives the hair a matte material: rough, low specular, no clearcoat, and a soft sheen
tinted from the hair color (never white). On black and dark brown hair the sheen is nearly
neutral and the darkest browns lose a little saturation, so under a warm light black stays
black and brown stays brown instead of turning coppery. Curls and coils are more matte than
strands, with a fainter sheen. Where `COLOR_0` g is above zero, the hair's color mixes toward
the character's skin, with the body's own sheen and roughness, so faded sides and partings take
the skin tone. `setHairColor(material, color, skin)` takes the skin too, and `apply()` sets the
hair again, so a skin change re-tints them. All hair shares one shader program, whatever its
style, texture or color.

### Guessing hair from a card

A character with no look in `staging.json` gets one guessed from its card's appearance and role
(`guessSpec` in `src/world/staging.js`). The guess is shown in the Look panel and saved only when
something is changed there.

- **Style words**, the first match in this order: balding, cornrows, updo, locs, two buns, afro,
  braids, pigtails, ponytail, top bun, quiff, fade, buzz cut, short curls, shaggy, spiky, side
  part, center part, bob, long. Every braid or plait word gives Braids, except box, micro,
  knotless and goddess braids (Locs) and cornrows, feed-in and stitch braids (Cornrows).
  Dreadlocks, sisterlocks, two-strand, Senegalese or passion twists and hair in twists give
  Locs. A bob needs a word before it ("a bob", "her curly bob"), so "Bob is her uncle" is no
  haircut; Two buns needs two, space or double buns, or hair in buns, so "a tray of buns" is no
  hairstyle. "Her smile fades", "high-top sneakers", "he dreads Mondays" and "to and fro" name
  no style.
- **Texture words that come with a style:** afro puffs and two puffs give Two buns, coily; a
  high or afro puff, a pineapple updo or hair in a pineapple, Top bun, coily; a crew cut, flat
  top, short back and sides, high and tight or military haircut, Fade, straight; tight curls, a
  short afro or a TWA, Short curls, coily; ringlets and long curls, Long, curly; long or beach
  waves, Long, wavy; flat twists, Updo, coily.
- **Other texture words** count only where the style offers that texture: coily (coily, coils,
  kinky, tight curls, afro-textured), curly (curly, curls but not "lip curls" or "curls up",
  ringlets, corkscrews, frizzy, permed), wavy (wavy, loose, soft, beachy or gentle waves) and
  straight (straight or sleek hair).
- **No hair** for bald, bald-headed, a shaved or shaven head and hairless, unless balding words
  say otherwise ("going bald", "a bald patch", "bald on top" give Balding).
- **No style word:** a style from a pool for who the character is. Older men: balding, side
  part, buzz cut, quiff, short curls. Men and boys: spiky, side part, buzz cut, fade, quiff, short
  curls, shaggy, afro, locs. Older women: top bun, short curls, bob, updo, side part. Everyone
  else: bob, long, center part, ponytail, pigtails, braids, top bun, two buns, shaggy, short
  curls, afro, side part, spiky. A texture the text names narrows the pool to the styles where it
  shows (as their natural texture or with a mesh of their own); with none left, to every such
  style, so "a girl with curly red hair" gets a style that shows curls.
- **The pick** uses a second hash of the card's id (of `<id>/hair`, mixed), not the one that
  picks the skin tone, so every style meets every skin tone. With no texture word the texture is
  the style's `textures[(hash >>> 8) % 5]`, else its natural one: about 60% natural on a style
  with three textures. The texture is written only when it isn't the natural one.
- **Never from skin tone or ethnicity.** Style and texture come only from hair words and the
  hash. Skin words ("dark-skinned") set the skin and nothing else, and ethnicity words set nothing
  ("Afro-Caribbean" is not an afro).

Changing these rules re-rolls every guessed look that hasn't been saved yet.

## Building the assets

```
python3 tools/build_base.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/base.gltf
python3 tools/build_hair.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/hair
python3 tools/build_hair.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/hair bob-curly,locs
```

`build_hair.py` takes an optional third argument to rebuild only some outputs, by file name: a
style (`locs`) or a texture mesh (`bob-curly`). Builds are deterministic, so files you don't
rebuild, or rebuild from the same input, stay byte-identical.

## Trying it

Serve the repo root (for example `python3 -m http.server`) and open `lab.html`. Its Hair tab
has the styles, a *Hair texture* row with the style's own textures (hidden for a style with
one) and the colors.
