// Species: each is a spec patch on the canonical base (fur and patterns, ears, body type, face
// layout, and extra parts like snouts, horns, manes and tails). Same rig, same animations.

export const SPECIES = {
  human: { label: 'Human', spec: {} },
  monkey: {
    label: 'Monkey',
    spec: {
      skin: '#8a5a3c', fur: { second: '#f0c9a2', belly: true, paws: '#e8bf98' }, ears: 'big',
      face: { mask: { color: '#f0c9a2', shape: 'heart' }, eyes: 'round', eyeColor: '#2a1f1a', eyeLine: '#3b2216', nose: 'nostrils', noseColor: '#7a4a35', mouth: 'smile' },
      parts: [{ type: 'tail', shape: 'monkey', color: '#8a5a3c' }],
    },
  },
  baboon: {
    label: 'Baboon',
    spec: {
      skin: '#9a8c6a', fur: { second: '#cfc39e', belly: true, paws: '#4a4038' }, ears: 'small', body: 'stocky',
      face: { mask: { color: '#5b4b46', shape: 'heart' }, eyes: 'sharp', eyeColor: '#8a6a3a', eyeLine: '#2a201c', nose: 'none', mouth: 'flat', mouthY: 50, mouthColor: '#1f1514', brows: true, browColor: '#2f2622' },
      parts: [{ type: 'snout', shape: 'baboon', color: '#5b4b46', nostrils: '#241b1a' }, { type: 'ruff', color: '#b8ab84' }, { type: 'tail', shape: 'baboon', color: '#9a8c6a' }],
    },
  },
  gorilla: {
    label: 'Gorilla',
    spec: {
      skin: '#4b4648', fur: { second: '#a39e9c', back: true, paws: '#36323a' }, ears: 'small', body: 'muscular',
      face: { mask: { color: '#726b6e', shape: 'heart' }, eyes: 'round', eyeSize: 0.82, eyeColor: '#2a1f1a', eyeLine: '#141012', nose: 'none', mouth: 'flat', mouthY: 40, mouthColor: '#1c1416' },
      parts: [{ type: 'brow', color: '#4b4648' }, { type: 'snout', shape: 'gorilla', color: '#726b6e', nostrils: '#151112' }],
    },
  },
  cow: {
    label: 'Cow',
    spec: {
      skin: '#f4f1ec', fur: { third: '#2b2b2b', spots: 'patches', paws: '#4a3f3a' }, ears: 'cow', body: 'chubby',
      face: { eyes: 'doll', eyeColor: '#3a2a22', nose: 'none', mouth: 'smile', mouthY: 46, blush: true },
      parts: [{ type: 'snout', shape: 'cow', color: '#f3b9bb', nostrils: '#8a4a50' }, { type: 'horns', color: '#efe6d2' }, { type: 'tail', shape: 'cow', color: '#f4f1ec', tip: '#2b2b2b' }],
    },
  },
  dog: {
    label: 'Dog',
    spec: {
      skin: '#d9a25a', fur: { second: '#f6e6cc', belly: true, chin: true }, ears: 'floppy',
      face: { eyes: 'round', nose: 'none', mouth: 'smile', mouthY: 44, blush: true },
      parts: [{ type: 'snout', shape: 'dog', color: '#f6e6cc', nose: '#2a2224' }, { type: 'tail', shape: 'dog', color: '#d9a25a' }],
    },
  },
  cat: {
    label: 'Cat',
    spec: {
      skin: '#e8913c', fur: { second: '#fff3e6', third: '#c07730', belly: true, chin: 'muzzle', stripes: true }, ears: 'cat',
      face: { eyes: 'classic', eyeColor: '#4f8a3a', nose: 'heart', noseColor: '#f08a9a', mouth: 'cat', whiskers: '#5a3a2a', blush: true },
      parts: [{ type: 'tail', shape: 'cat', color: '#e8913c' }],
    },
  },
  horse: {
    label: 'Horse',
    spec: {
      skin: '#8b5a3c', fur: { second: '#d9b89c', paws: '#3a2a22' }, ears: 'horse', body: 'tall',
      face: { eyes: 'droopy', eyeColor: '#3a2416', nose: 'none', mouth: 'smile', mouthY: 54 },
      parts: [{ type: 'snout', shape: 'horse', color: '#d9b89c', nostrils: '#5a3a2a' }, { type: 'mane', color: '#3a2a22' }, { type: 'tail', shape: 'horse', color: '#3a2a22' }],
    },
  },
  frog: {
    label: 'Frog',
    spec: {
      skin: '#7cc36a', fur: { second: '#e2f2b8', third: '#58a84c', belly: true, chin: true, spots: true }, ears: 'none', body: 'stocky',
      face: { eyes: 'round', eyeSize: 1.15, eyeSpacing: 1.12, eyeY: -18, nose: 'nostrils', noseColor: '#3f7a35', mouth: 'bigsmile', blush: true, blushColor: '#f29a9a' },
      parts: [{ type: 'domes', color: '#7cc36a' }],
    },
  },
};
