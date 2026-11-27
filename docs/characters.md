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
   │                  │               ├─ LeftEar        (the human ear, sized by the ear style; see Ears)
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
  ears: 'human',                   // ears.js: small, big, elf, cat, fox, bunny, bear, mouse, floppy, cow, horse, monkey, none
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

### Fur, markings and tails

The fur is painted in the body shader (`furColor` in `outfit.js`) from rest-pose positions, so
markings stay on the same spot of the body on every body type and in every pose. Each one is laid
out for the anatomy (the head is treated as a ball, the torso as an upright cylinder, the arms and
legs along their own axes) and ends by tapering or softening, never in a straight cut: edges are
soft where fur would be soft (a muzzle, a bib, a saddle) and clean, anti-aliased lines where a
toy would have a seam (patches, spots, paws).

| `fur` key | Look |
|---|---|
| `belly` | a pale oval on the belly |
| `chin` | a pale chin and throat running down into the chest; `'muzzle'` makes the chin smaller and adds two whisker pads under the nose, the fur's color down the bridge between them (cat) |
| `back` | a silver saddle on the lower back: a rounded shield, broader at its top, with a soft, clean edge (about 1.5 cm) and a slightly lighter middle (gorilla) |
| `spots` | `true`: round spots of a few sizes on the back and crown of the head, the back, the outer thighs and the arms, none on the face (frog); `'patches'`: big patches with hand-cut outlines over an ear, the back of the head, the back, a flank, one from the chest (off the middle) round the side to the flank, and the limbs (cow). Both are designed layouts (`MARKS`), up to 16 balls in rest space whose union, wobbled, makes each outline; their edges are crisp, anti-aliased lines |
| `stripes` | tabby: three lines from the forehead back over the crown (the outer two flaring toward the brows), bands of uneven width and spacing that wrap the back and sides of the head, curve down toward the nape in the middle of the back, dip toward the jaw and taper to points before the face, each ending in its own place; bands that start at the spine and sweep down around the sides, thinning out before the belly, the neck and the hips; bars across the outer side of the arms and the back and outer side of the legs |
| `paws` | hands and feet in their own color (hooves, dark or pale paws) |

Any `fur` also makes the coat read as a plush pile rather than skin: the sheen takes the fur's own
hue, a little paler and tighter than skin's, so silhouettes glow like velvet instead of graying,
and a faint grain (a few percent of the color) fades out before it gets finer than a pixel.
Clothes on a furred body keep the plain sheen, and a body without `fur` (every human) renders
exactly as before: all of it sits behind uniforms in the one shared program.

Tails are parts on the `Tail` bone (`{ type: 'tail', shape, color, tip?, stripes? }` in `parts.js`)
that start a little inside the body, so they grow out of it, and wag:

| Shape | Look |
|---|---|
| `cat` | long and plump, rising in a lazy S with the tip hooked over; five rings and a dark tip |
| `dog` | a short, fluffy plume of hair carried up and back off the rump at about 40°, its last third swung over to one side so it stands clear of the back from behind, round in section, turning pale toward the tip |
| `monkey` | long and slender, swept up behind and rolled into a curl at the end |
| `baboon` | thick at the root, carried up in an arch and then hanging, darker toward the end |
| `cow` | a thin rope that grows into a hair tuft (`tip` is the tuft's color), ending a hand above the floor |
| `horse` | three locks of hair from one narrow dock, arching out and falling to about 15 cm above the floor, each tapering to a soft point, their tips splayed and flicked back out |

Furred tails are tubes with a fully rounded tip in the body's fur material (`createFurMaterial` in
`outfit.js`: the same response, sheen and grain), painted by a strip of canvas along their length.
Their markings follow the tail's color, so a recolored cat keeps matching rings: rings are the
color darkened the way the director darkens a recolored body's stripes (`buildSpec`), a pale tip
is the color lightened, and `stripes` or `tip` set them outright. Hair tails (the dog's plume, the
horse's tail, the cow's tuft) are `hairLock`s in the hair's material; a lock's `blend` turns it
into another color along its length (the dog's pale tip). Every tail is under 6,000 triangles.
In a seated pose (sit, sit on the floor or cross-legged, kneel, squat) the long hanging tails
(horse, cow, baboon) swing back (each tail's `lift`, half as much again on the floor, eased in and
out by `Character.update`), so they stay off the seat and the floor. Lying on the back (lie down,
sleep) a tail would reach back into the floor, so every tail turns out to the side to lie beside
the body, and hardly wags.
Ears, snouts, the brow ridge and eye domes take the furred tails' coat too (`furCoat`), so nothing
that grows out of the body shades differently from it.

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
  brow ridge is one sculpted roll that frowns, lifts and worries with the emotion's brows
  (`poseBrowRidge`), and no brows are drawn under it. An emotion's shade (gloomy, furious,
  menacing...) runs on over a snout and darkens the brow ridge (and dims its sheen, which takes
  the color's hue but not its darkness), so a snout or ridge that rises into the shaded face
  doesn't stay bright. On a furred face, with no hair to hide the face canvas's edges, the shade
  fades out in an oval round the eyes before the canvas's sides and top (`Face.softShade`); a
  human's is drawn as before. Where a snout rises into the shade, the snout carries it on its own
  shade layer, and the face's shade is taken off it (see The shade on a snout under Animal
  faces), so the snout darkens with the forehead with no rim and no change of tone. The frog's eyes, in every emotion, are
  drawn on its eye domes, and so are its brows, on the domes' upper fronts (see Animal faces).
- Animal parts get the same care as the human's hair. The horse's mane and tail, the dog's tail
  plume, the cow's tail tuft and the baboon's cheek fur are locks swept along curves (`hairLock`
  in `parts.js`) in the hair's soft, matte material, with flow UVs and darkened undersides. A
  lock on the head can `hug` it: its section wraps onto the skin instead of lying in a plane, so a
  wide, flat lock lies on the head with no edge standing off it (`hug` can also change along
  the lock). The horse's mane is a crest with eight long, flat locks lying down the back of the
  head and curving over to one side, smaller toward the nape, each tip riding a little higher
  than the root of the next like shingles, so from behind it is one dark mass with a soft,
  scalloped edge to one side; and a forelock that falls forward and to the side over the brow.
  The baboon's cheek fur is one soft mass each side, three overlapping locks lying back along the
  jaw from under the eye, full enough to read as a mass from the front, their rounded ends
  scalloping its back edge. Ears
  are sculpted, cupped shells that grow out of the head (see Ears); snouts, the dog's nose, the
  gorilla's brow ridge, horns and eye domes rise out of the head in a soft fillet (see Animal
  faces); the fur's markings are laid out for the anatomy, soft where fur would be and clean
  where a toy would have a seam (see Fur, markings and tails).

```js
const hero = await createCharacter(SPECIES.dog.spec);
stage.add(hero);
hero.play('Walk');
hero.setEmotion('excited');
hero.talking = true;
hero.socket('rightHand').add(someProp);
```

## Ears

`ears.js`, `spec.ears`. Human ears (`human`, `small`, `big`) are part of the body mesh and ride on
the `LeftEar`/`RightEar` bones, which are scaled to size them. Every other style hides them
without a dent: the body swaps to an earless copy of its geometry (`earlessGeometry`, built once
per page and shared by every character that needs it), and the ear bones stay at full size. Each
human ear is a disk of the mesh inside one loop of head vertices; the disk is laid out flat (a
Tutte embedding into a circle, which never folds), mapped into the loop and lifted onto a sphere
fitted to the head around it, blending into the loop's exact heights. The side of the head is
smooth there from every angle, rigid on `Head` like the rest of it, and the fur paints over it
like anywhere else (it has new rest positions).

Animal and elf ears are sculpted shells on the `Head` bone, the right one the left mirrored
(`sculptEar`):

- **Shape.** A closed outline in the ear's own plane is filled with rings around a center. The
  mid-surface is a bowl, so the front is a cupped hollow and the back is rounded; the shell is
  two to three centimetres thick in the middle and thins to a round rim about a centimetre
  across, with a gently rounded tip. An ear can curl along its length (the floppy ear's soft
  fold and hang).
- **Seat.** The base is wide and sunk into the head on the head's own curve (a sphere fitted to
  the head's vertices around it), and it flares toward the head, so the ear grows out of the head
  instead of sitting on it. Ears are rigid on `Head`, so they turn and nod with it.
- **Color.** The back is the fur color (the hair color on a human). The inner color (pink, cream,
  tan, dark brown, a shade of the fur, or the skin's for the elf) is painted per pixel in the
  hollow, with a soft edge a little in from the rim, and fades out before it meets the head; a
  little occlusion deepens the hollow. The material is the furred body's matte velvet (roughness
  0.8, low specular, and the coat's sheen in the painted color's hue and faint grain, `furCoat` in
  `outfit.js`), one shader program for every ear.
- **Cost.** Under 3,000 triangles an ear, built in a few milliseconds.

| Style | Look |
|---|---|
| `cat` | rounded triangles tilted out, a pink hollow |
| `fox` | taller, narrower triangles, a cream hollow |
| `bunny` | long upright ovals leaning back, pink |
| `bear` | small and round, a tan hollow |
| `mouse` | big, round and thin, pink |
| `floppy` | wide at the root, lying over the top-side of the head for its first third, then folding softly down to hang beside the cheek with the hollow toward it (dog) |
| `cow` | leaf-shaped, sticking out sideways below the horns, pink |
| `horse` | tall and narrow with a deep cup, a dark hollow |
| `monkey` | round and cupped, standing out from the side of the head where a human ear is, the fur's second color (the face's) inside |
| `elf` | long and pointed in the skin's color, where the human ear was, sweeping up and back |
| `none` | no ears (frog) |

## Animal faces

Snouts, the dog's nose, the gorilla's brow ridge, the cow's horns and the frog's eye domes are
sculpted to grow out of the head, not sit on it (`parts.js`):

- **The head's skin.** `HEAD_R` is the base head's skin sampled from the mesh (the human ears
  left out): its distance from a point inside the head (`HEAD_C`) in 10° steps of azimuth and
  elevation. From it come `skinZ(x, y)`, the depth of the front of the head (a 5 mm grid made on
  first use), and the skin's normal. A part rises out of this surface in a fillet: its surface is
  the smooth maximum (`smax`) of its own shape and the skin sunk a few millimetres, so it meets
  the face in a soft concave blend and its edge ends just under the skin, where the head hides
  it. Toward that edge its normals turn to the skin's, so the shading runs on into the head, and
  vertex colors bake a little occlusion into the crease and the underside. The real head is
  faintly ridged down the middle of its front (about 1.3 mm), which the sampled skin leaves out;
  where a snout comes out of the skin near the middle it follows that ridge (`midRidge`), so the
  line where it leaves the head stays round instead of dipping in a V. Parts in the skin's
  color use a material matched to the furred body's (`skinMat`: its response, and the coat's
  sheen and grain from `furCoat` in `outfit.js`), so they shade like the head itself.
- **Snouts** (`SNOUTS`) rise out of the lower face, with nostrils pressed in as soft dimples
  (`dimples`) and painted dark inside. Both kinds are meshed by `fanMesh` as rings around their
  middle, evenly spaced along the surface out to where they sink under the skin (about 5k
  triangles), built once per page per shape and copied for each character.
  A wide, flat muzzle (the cow's, the gorilla's) is a depth map over the face (`frontBulge`): a
  few rounded caps (`cap`: a superellipse footprint, a front that can lean back, a rounded fall to
  its edge) in one smooth union. A long or round muzzle (the dog's, the horse's, the baboon's) is
  measured along rays from a point inside the head and inside its main mass (`roundBulge`): a few
  (super)ellipsoids (`ball`) in one smooth union, so it is round underneath too and runs back into
  the chin as a full jaw instead of ending in a shelf. The dog has a puppy's muzzle: a round
  ball carried well forward on the lower face below the eyes, soft puffs either side of the mouth,
  and no bridge up the forehead; above an ellipse round the muzzle (`split`) it is painted in the
  face's color (`top`, by default the character's skin), fading softly over the muzzle's top, so
  the muzzle's cream and the coat meet in a soft stop. The horse has a broad, round muzzle ball on
  the lower face, its nostrils on the front, its top fillet in the face's color, and no bridge
  either; the baboon a long, blunt muzzle, a straight top from the brow to an upright,
  rounded front and a full jaw under it, its sheen lowered and its color dimmed (`sheen`, `dim`)
  so it matches the dark mask round its eyes; the cow a wide, flat muzzle; the gorilla a broad
  muzzle under a wide nose with flared nostrils.
- **The mouth on the snout.** Each snout has its own 512 px canvas, projected from the front over
  the snout's extent: u = 0.5 + (x - cx) / 2rx, v = 0.5 + (y - cy) / 2ry in Head space.
  `Face.drawMuzzle` copies the snout's own paint (its color, nostrils, the dog's face color) and
  draws the mouth, resting, talking or the emotion's, at `SNOUTS[shape].mouth` = [height in Head
  space, size relative to a mouth on the face], on the snout's front under the nose. A part with
  a canvas of its own (a snout, a furred tail) casts its shadow with its own depth material,
  disposed with it, so its canvas is freed with the part (the renderer's shared depth material
  would keep it).
- **The shade on a snout.** The face layer lies 1.5 mm out from the head, so it also lies over a
  snout's low fillet; shading the snout's own canvas as well darkened a jagged rim there, and
  the canvas darkened only the snout's color, not its sheen, so it shaded in another tone. So a
  snout has a shade layer instead (`shadeLayer`): a shell over its upper part in the face layer's
  own material, 1.5 mm out where the snout meets the skin and closer over the rest, on every
  other ring of the snout's fan (about 1k triangles), with a 256 px canvas of its own, hidden
  until an emotion's shade reaches it. `fanMesh` also finds the line where the snout comes out
  of the skin (`rim`), and `shadeMask` fills it, feathered over about 1.5 mm. `Face.shadeMuzzle`
  maps the face's soft shade into the snout's canvas through Head space and keeps the mask's
  inside, and takes the mask's inside off the face's shade: over the fillet, where both layers
  show, the two fade into each other and add up to the one shade, so the snout darkens with the
  forehead with no rim, outline or change of tone. The layer's canvas is redrawn only when the
  shade changes, not while talking.
- **The dog's nose** is a mesh of its own: a rounded inverted triangle puffed like a cushion, two
  nostrils pressed into its lower front (darker inside) and a faint shine, set on the muzzle's
  front tip a third of its depth into it, along the muzzle's normal.
- **The gorilla's brow ridge** is one rounded roll of the forehead: a depth map along the brow
  line, arched over each eye and a little lower between them, a shelf over the eyes and a soft
  groove above, fading into the temples. `poseBrowRidge` rebuilds it for each emotion's brows, and
  under a ridge the face's mask is one soft shape (round the eyes, in at the cheeks, round the
  mouth) whose curved top tucks under the ridge, so none of it shows through.
- **Horns** curve out and up from the top of the head to round tips. Each root flares and grows
  out of the skin (`growFromSkin`: the same fillet, along the lines from `HEAD_C`), colored like
  the fur there (`base`, by default the character's skin) and turning to the horn's color over
  its first few centimetres; the tips are a little darker.
- **Eye domes** (the frog's) are balls half out of the head at `at` ([x, y] in Head space, by
  default [0.112, 0.3]) with radius `size` (0.072), filleted into the skin; the sphere is welded
  along its seam and at its poles first, so its shading and the layer over it run on unbroken.
  Each carries a layer in the face's own material over its front, projected from the front
  exactly like the face (`Face.setLayers`, wired by `Character.setParts`), so the eyes the face
  draws there sit on the domes, in every style and emotion, blinking, crying or shaded, and the
  brows sit on the domes' upper fronts, lower than on a face. The frog's `eyeY` and `eyeSpacing`
  put its eyes there. Like the face, the layers hide in wireframe.

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
