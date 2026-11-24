// Body types: blend shapes for girth (chubby / muscle / slim, built into the base mesh) plus
// bone scaling for proportions. Legs and torso are stretched along Y; the child bones are
// counter-scaled so feet, chest, arms and head keep their shape.

export const BODY_TYPES = {
  standard: { label: 'Standard' },
  slim: { label: 'Slim', morphs: { slim: 1 }, legs: 1.04 },
  chubby: { label: 'Chubby', morphs: { chubby: 1 } },
  round: { label: 'Round', morphs: { chubby: 1.7 }, legs: 0.86 },
  muscular: { label: 'Muscular', morphs: { muscle: 1.1 }, legs: 1.03 },
  stocky: { label: 'Stocky', morphs: { chubby: 0.45, muscle: 0.7 }, legs: 0.86, torso: 0.95 },
  tall: { label: 'Tall', morphs: { slim: 0.3 }, legs: 1.24, torso: 1.08 },
  lanky: { label: 'Lanky', morphs: { slim: 1 }, legs: 1.34, torso: 1.12 },
  short: { label: 'Short', legs: 0.8, torso: 0.94 },
  kid: { label: 'Kid', morphs: { slim: 0.35 }, legs: 0.85, torso: 0.9, head: 1.08 },
};

const LEG_LENGTH = 0.18; // hip joint to ankle, in body units

export function applyBody(character, id = 'standard') {
  const type = BODY_TYPES[id] ?? BODY_TYPES.standard;
  const mesh = character.bodyMesh;
  const dict = mesh.morphTargetDictionary ?? {};
  for (const [name, index] of Object.entries(dict)) mesh.morphTargetInfluences[index] = type.morphs?.[name] ?? 0;

  const B = character.bones;
  const legs = type.legs ?? 1;
  const torso = type.torso ?? 1;
  for (const side of ['Left', 'Right']) {
    B[`${side}UpLeg`].scale.set(1, legs, 1);
    B[`${side}Foot`].scale.set(1, 1 / legs, 1);
  }
  B.Spine.scale.set(1, torso, 1);
  B.Spine1.scale.set(1, 1 / torso, 1);
  character.model.position.y = LEG_LENGTH * (legs - 1); // keep the feet on the ground
  return type;
}
