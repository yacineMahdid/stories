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
- Emotions work the same on every species. On a snout (dog, horse, cow, baboon, gorilla) the
  mouth, resting, talking or the emotion's, is drawn on the snout under the nose: the snout
  has its own canvas, projected from the front (`muzzle()` in `parts.js`). The gorilla's
  brow ridge is two halves that frown, lift and worry with the emotion's brows
  (`poseBrowRidge`), and no brows are drawn under it.

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
are now broader and less even, Ponytail's tail swings out to one side, and Long's lower layer
comes out flush with the top one.) The Look panel's *Hair texture* select and the lab's chips list
only the style's textures; they write `texture` only when it isn't the style's natural one. The
texture is the person's: on a style change it is the one in the file, else one picked earlier,
else the one the last style drew, whichever the new style offers (an afro's coils make coily
puffs on Two buns, a straight Spiky becomes a crew cut on Fade); it is written only when it isn't
the new style's natural one, and a picked texture comes back on a later style that offers it
(an undone pick is forgotten). A texture in the file that the style doesn't offer shows in the
select as "Curly: drawn Straight", so it can be cleared. A style the engine doesn't know, say
from a newer `staging.json`, draws no hair and logs one warning; the character still loads, and a
file that failed to load is fetched again by the next look that needs it.

| Style | `style` | Textures, natural first | Own meshes (`files`) | Look |
|---|---|---|---|---|
| Spiky | `spiky` | straight | | short, ears out, a zigzag fringe of pointed tips |
| Side part | `swept` | straight | | short back and sides, one lock swept across from a part; pixie cuts too |
| Buzz cut | `buzz` | straight | | a close cap that follows the skull, a little scalp showing |
| Fade | `fade` | coily, straight | `fade-straight` | a short rounded top over sides that fade into the skin; straight is a crew cut |
| Quiff | `quiff` | straight | | a tall front lock rolling back over short sides; pompadour, slicked back |
| Short curls | `curls` | curly, coily | `curls-coily` | a rounded cap of chunky curls over the forehead and ears; coily is a short rounded crop with a clean hairline |
| Shaggy | `shaggy` | straight | | a choppy mop between Spiky and Bob; bowl and mop-top cuts |
| Balding | `balding` | straight | | a bare dome, a band round the back from short sideburns, tufts above the ears |
| Bob | `bob` | straight, wavy, curly | `bob-wavy`, `bob-curly` | a blunt fringe, sides to the jaw |
| Afro | `afro` | coily, curly | `afro-curly` | a big round cloud growing out of a soft hairline; curly makes its outline and hairline of curls |
| Long | `long` | straight, wavy, curly | `long-wavy`, `long-curly` | past the shoulders, with a fringe |
| Center part | `parted` | straight | | long, parted in the middle, the forehead open |
| Ponytail | `ponytail` | straight | | a tail that swings out to one side |
| Pigtails | `pigtails` | straight | | a center part, bangs, two smooth bunches |
| Braids | `braids` | straight, curly, coily | `braids-curly`, `braids-coily` | two three-strand plaits beside the face; curly and coily have no fringe and a center part, curly a fuller cap of bigger curls, coily a low, tight one |
| Cornrows | `cornrows` | coily | | raised braided rows back to the nape, short braid ends |
| Locs | `locs` | coily | | rope-like locs to the shoulders from a sectioned scalp; twists and box braids too |
| Top bun | `bun` | straight, curly, coily | `bun-curly`, `bun-puff` | a wound bun on top; curly is a loose puff of big curls over a curly cap, coily a dense round puff |
| Two buns | `buns` | straight, curly, coily | `buns-curly`, `buns-puff` | two buns high on the head; two loose curly puffs, or two dense afro puffs |
| Updo | `updo` | coily, straight | `updo-straight` | swept up into a tall crown of rolled twists, nape and ears bare; straight has a smooth bun and rolls |

### Textures

- **Straight**: the sculpted locks below, with a tile of fine strand grooves.
- **Wavy**: locks that snake in a gentle S, a rippled outline and tips flicking in and out.
- **Curly**: chunky curl clumps, a scalloped outline with curls along the fringe, ringlets where
  hair hangs, and a tile of short curved arcs.
- **Coily**: big soft rounded forms (a cloud, puffs, rolls, rows) with low lumps and a fine,
  felted tile of tiny rings; the most matte, with the faintest sheen.

Every texture a style offers besides its natural one has a mesh of its own, listed in the style's
`files`: wavy and curly Bob and Long, the curly Afro, the coily Short curls, the straight Fade
(a crew cut) and Updo (smooth rolls), and curly and coily Braids, Top bun and Two buns (curly:
bigger, looser curl clumps and curls along the hairline; coily: low, tight and dense). A texture
that would only swap the tile on the natural mesh (a coily buzz cut, a curly balding band) is not
offered: it would not change the look. Each mesh is drawn with its texture's tile: straight and
wavy use the strands tile, curly the curls tile and coily the coils tile. The tiles are drawn once
per page, on first use, as canvas textures shared by every character (`setHairTexture`); a
texture change swaps the tiles and the material's normal strength, roughness and sheen, never
the shader.

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
  Hair pulled to a tie (buns, tails, the quiff, the updo) is laid out for the back of the head,
  which shows three or four deep creases at clearly unequal spacings, spread across it rather
  than bunched (two or three a side on pigtails and braids); each of the broadest chunks is split by one shallow crease that starts
  lower down, and a crease between broad chunks is deeper. The irregularity is seeded, so every
  build is the same.
- **Partings** are soft grooves where two flow sections meet; the locks' relief fades out
  right at the part line, so the two sides meet without a step. Where the scalp shows (center
  parts, cornrow and loc partings) the skin shows through (see below).
- **Tails, plaits, ropes and rolls** grow out of the scalp: each starts buried in the shell or
  the head with a closed end, so no gap or open end shows at the root; free ends are rounded or
  tied.
- **Hairline:** the shell dips under the skin along the style's hairline, measured exactly to
  its segments, so edges come out as smooth curves with a rounded edge. Thin hair instead lies on
  the skin where it ends: the last centimetres of the buzz cut, the fade and the cornrows, the
  fade's faded sides and the updo's nape are a film 2 mm over the skin, with the skin's own
  normals and no occlusion, so hair and skin meet without a ledge; thin hair stays at least
  2.5 mm over the skin elsewhere (partings, the locs' sections), so neither fights the skin for
  depth in a story shot even 35 m away. The buzz cut and the updo's nape thin out into the skin's
  colour at the edge, and the fade's sides keep a faint tint of the hair that grades out to bare
  skin over their last 4-5 cm (the line-up at the forehead stays crisp). Cornrows start flush
  with the skin at the hairline and rise over the next two centimetres. Thin shells (buzz cut,
  fade, cornrows, the locs' cap) take the skin's normals tilted by their own relief, so the
  low-poly skull's facets never show through them.
- **Sideburns:** Balding's band ends in front of the ear in a short sideburn with an upright front
  edge and rounded corners, flatter than the tufts above the ears.
- **Volumes** (the afro's cloud) grow out of the hairline: over the ears and at the nape the hair
  is about a centimetre thick a centimetre in and two and a half at three centimetres in, and the
  cloud reaches its full size a hand's width from the edge, so the underside rolls in to the head
  and the front curves into the hairline. Its lumps start a few centimetres in; the curly afro's
  hairline is a gentle scallop with small round curls on its rim.
- **Puffs** (the curly and coily buns) sink into the hair they sit on; their tile follows a chart
  whose two poles both lie in the buried underside, so no pole shows on the puff.
- **Motion:** hair is rigid on the `Head` bone, so hanging hair doesn't swing with the body.
  Front pieces end above the shoulders or behind them, and the clips keep the hands out of the
  hair: *Wave* raises the arm out to the side and waves at shoulder height, clear of hair that
  hangs beside the cheeks (long hair, locs, a bob).

### Files

`assets/characters/canonical/hair/<file>.glb`: 34 files, the 20 styles plus the 14 texture
meshes. Each is a quantized binary glTF (`KHR_mesh_quantization`) with one mesh and no node
transform:

- `POSITION`: int16, normalized, directly in Head-bone metres, so the mesh is parented to the
  `Head` bone as it is and follows every head movement.
- `NORMAL`: int8, normalized.
- `TEXCOORD_0`: int16, normalized, storing uv / 16 (`UV_SCALE`, shared with `hair.js`, whose
  tiles repeat 16 times). u runs across the strands and v along them, root to tip, in units of
  a tile, which covers 0.24 × 0.48 m of hair. The buzz cut, the fade, short curls, the afro,
  the curly bob and long hair and the locs' cap (whose sections still run out from the crown)
  use a conformal chart whose two poles both lie where there is no hair (under the chin, on the
  neck), and the puffs one whose poles lie in their buried underside, so curls and coils stay
  round and no pole pinches the tile anywhere it shows.
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
files its looks use. The 34 files take 31.6 MB in all, from 0.26 MB (Balding) to 1.43 MB (Long
curly), or 0.17 to 0.91 MB gzipped; each has between 8,063 (Balding) and 45,304 (Long curly)
vertices. Every shell thins out its grid near the grid's pole, where its rows are finer around
than anywhere else (no row is finer than at its widest), so it takes about a sixth less than it
otherwise would.

### Material

`hair.js` gives the hair a matte material: rough, low specular, no clearcoat, and a soft sheen
tinted from the hair color (never white). On black and dark brown hair the sheen is nearly
neutral and the darkest browns lose a little saturation, so under a warm light black stays
black and brown stays brown instead of turning coppery. Curls and coils are more matte than
strands, with a fainter sheen. Where `COLOR_0` g is above zero, the hair's color mixes toward
the character's skin, with the body's own sheen and roughness, so faded sides and partings take
the skin tone. Under hair much lighter than the skin (gray or blonde on deep skin) up to four
times as much of the skin shows there, so a buzz cut reads as stubble over the scalp rather than
a light cap, and a fade's sides as bare skin. `setHairColor(material, color, skin)` takes the skin
too, and `apply()` sets the hair again, so a skin change re-tints them. All hair shares one
shader program, whatever its style, texture or color.

### Guessing hair from a card

A character with no look in `staging.json` gets one guessed from its card's appearance and role
(`guessSpec` in `src/world/staging.js`). The guess is shown in the Look panel and saved only when
something is changed there.

- **Style words**, the first match in this order: balding, cornrows, updo, locs, two buns, afro,
  braids, pigtails, ponytail, top bun, bob, center part, long, quiff, fade, buzz cut, short
  curls, spiky, shaggy, side part. A named length comes before a parting or a combed-back word,
  so long hair with a side part is Long and a bob with curtain bangs is a Bob; a middle parting
  on short hair isn't Center part. A colour or size word may sit between a style word and its
  noun, the usual way cards put it: "black dreads", "a golden braid", "two little buns", "messy
  brown hair", "gelled black hair", "cropped dark hair", "thinning white hair". The length can
  also come after the hair ("whose hair is long and grey", "whose hair is thinning"). Every braid
  or plait word gives Braids, except box, micro, knotless and goddess braids (Locs), cornrows,
  feed-in and stitch braids (Cornrows), and braids pinned, piled or swept up (Updo). Dreadlocks,
  sisterlocks, dreads (with, in or wearing dreads), two-strand, Senegalese, passion or chunky
  twists and a person with or in twists give Locs. Hair pulled or tied back into a bun, a knot or
  a puff, even "a neat bun", is a Top bun, not a Ponytail. A bob needs a, an, her, his or their
  before it, with up to two words between ("a bob", "a tidy bob", "her short curly bob"), or a
  length, colour or style word; a capitalised Bob is a name ("Bob is her uncle", "Short Bob, the
  miller") and "a quick bob of her head" is a nod. Two buns needs two, space or double buns, or
  hair in buns, so "a tray of buns" is no hairstyle, and buns to eat or hold ("a baker who bakes
  two buns", "a boy holding a bun") are no hairstyle unless hair words are there ("a baker with a
  neat grey bun" keeps it). A beehive among bees is a hive. "Her smile fades", "high-top
  sneakers", "he dreads Mondays", "a mystery with twists", "an afro comb", "whose crew cut the
  ropes" and "to and fro" name no style.
- **Texture words that come with a style:** afro puffs and two puffs give Two buns, coily; a
  high or afro puff, a pineapple updo or hair in a pineapple, Top bun, coily; a crew cut, flat
  top, short back and sides, high and tight or military haircut, Fade, straight; tight curls, a
  short, small, tiny or teeny afro or a TWA, Short curls, coily; ringlets and long curls, Long,
  curly; long or beach waves, Long, wavy; flat twists, Updo, coily. A hi-top or high-top fade is
  a Fade.
- **Other texture words** count only where the style offers that texture: coily (coily, coils,
  kinky, tight curls, afro-textured), curly (curly, curls but not "lip curls" or "curls up",
  ringlets, corkscrews, frizzy, permed), wavy (wavy, loose, soft, beachy or gentle waves) and
  straight (straight or sleek hair). Those of a beard, moustache or brows ("a wavy white beard")
  and curls of smoke or steam are not the hair's.
- **No hair** for bald, bald-headed, a shaved or shaven head (also "shaved-head", "his head
  shaved", "shaves his head"), no hair and hairless, unless balding words say otherwise ("going
  bald", "a bald patch", "bald on top" give Balding).
- **No style word:** a style from a pool for who the character is. Older men: balding, side
  part, buzz cut, quiff, short curls. Men and boys: spiky, side part, buzz cut, fade, quiff, short
  curls, shaggy, afro, locs. Older women: top bun, short curls, bob, updo, side part. Everyone
  else: bob, long, center part, ponytail, pigtails, braids, top bun, two buns, shaggy, short
  curls, afro, side part, spiky. Short hair ("short brown hair", "short-haired") leaves out the
  long styles (long, center part, ponytail, pigtails, braids, locs). A texture the text names
  narrows the pool to the styles where it shows (as their natural texture or with a mesh of their
  own); with none left, to every such style (for men, Long), so "a girl with curly red hair" gets
  a style that shows curls and "a man with wavy hair" a long wavy cut.
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
