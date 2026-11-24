// Emotions in the language of manga: each one picks how the eyes, brows, mouth and cheeks are
// drawn on the face canvas, adds floating symbols around the head, and can add a small body
// motion on top of whatever animation is playing.
//
//   eyes:    'style' (the character's own eye style) or a special mode: happy, closed, squeeze,
//            heart, star, spiral, x, blank, tiny, glow, hollow, money, dots, flat, wink,
//            half, wide, teary, determined
//   gaze:    [dx, dy] canvas pixels for the irises (style-based modes)
//   brows:   soft, raised, sad, worried, angry, furious, determined, skeptical
//   mouth:   smile, flat, cat, grin, laugh, shout, gasp, small, frown, wail, wavy, sour,
//            gritted, shark, smirk, pout, tongue, drool, teeth
//   cheeks:  blush, hatch, pale, puff
//   tears:   corner, streams, waterfall, laugh
//   shade:   0..1, a dark shadow over the eyes
//   glow:    color of glowing eyes
//   symbols: sweat, sweats, vein, steam, exclaim, question, zzz, hearts, notes, sparkles,
//            gloom, stars, bulb, dots, menace, shock, bubble, cloud, fountains
//   motion:  tremble, bounce, sway, slump, chinup, tilt, nodoff, sob

export const EMOTIONS = {
  neutral: { label: 'Neutral' },
  happy: { label: 'Happy', eyes: 'happy', mouth: 'grin', cheeks: 'blush' },
  laughing: { label: 'Laughing', eyes: 'squeeze', mouth: 'laugh', cheeks: 'blush', tears: 'laugh', motion: 'bounce' },
  excited: { label: 'Excited', eyes: 'star', mouth: 'grin', cheeks: 'blush', symbols: ['sparkles'], motion: 'bounce' },
  love: { label: 'In love', eyes: 'heart', mouth: 'smile', cheeks: 'blush', symbols: ['hearts'] },
  cheerful: { label: 'Cheerful', eyes: 'happy', mouth: 'small', cheeks: 'blush', symbols: ['notes'], motion: 'sway' },
  proud: { label: 'Proud', eyes: 'closed', brows: 'soft', mouth: 'teeth', symbols: ['sparkles'], motion: 'chinup' },
  wink: { label: 'Wink', eyes: 'wink', mouth: 'tongue', cheeks: 'blush' },
  embarrassed: { label: 'Embarrassed', eyes: 'style', gaze: [-7, 5], brows: 'worried', mouth: 'wavy', cheeks: 'hatch', symbols: ['sweat'] },
  sheepish: { label: 'Sheepish', eyes: 'happy', brows: 'worried', mouth: 'smile', cheeks: 'blush', symbols: ['sweat'] },
  nervous: { label: 'Nervous', eyes: 'tiny', brows: 'worried', mouth: 'wavy', symbols: ['sweats'], motion: 'tremble' },
  surprised: { label: 'Surprised', eyes: 'wide', brows: 'raised', mouth: 'gasp', symbols: ['exclaim'] },
  shocked: { label: 'Shocked', eyes: 'blank', brows: 'raised', mouth: 'shout', cheeks: 'pale', symbols: ['gloom', 'shock'] },
  scared: { label: 'Scared', eyes: 'tiny', brows: 'worried', mouth: 'wavy', cheeks: 'pale', symbols: ['sweats'], motion: 'tremble' },
  confused: { label: 'Confused', eyes: 'style', brows: 'skeptical', mouth: 'wavy', symbols: ['question'], motion: 'tilt' },
  thinking: { label: 'Thinking', eyes: 'style', gaze: [8, -14], brows: 'skeptical', mouth: 'flat', symbols: ['dots'], motion: 'tilt' },
  idea: { label: 'Idea!', eyes: 'wide', brows: 'raised', mouth: 'grin', symbols: ['bulb'] },
  sad: { label: 'Sad', eyes: 'teary', brows: 'sad', mouth: 'frown', tears: 'corner', motion: 'slump' },
  crying: { label: 'Crying', eyes: 'squeeze', brows: 'sad', mouth: 'wail', tears: 'streams', motion: 'sob' },
  waterworks: { label: 'Waterworks', eyes: 'squeeze', brows: 'sad', mouth: 'wail', tears: 'waterfall', symbols: ['fountains'], motion: 'sob' },
  gloomy: { label: 'Gloomy', eyes: 'hollow', brows: 'sad', mouth: 'frown', shade: 0.3, symbols: ['gloom', 'cloud'], motion: 'slump' },
  haunted: { label: 'Haunted', eyes: 'hollow', mouth: 'flat', shade: 0.55, cheeks: 'pale' },
  angry: { label: 'Angry', eyes: 'style', brows: 'angry', mouth: 'gritted', symbols: ['vein'] },
  furious: { label: 'Furious', eyes: 'glow', glow: '#ffffff', shade: 0.75, brows: 'furious', mouth: 'shark', symbols: ['vein', 'steam'], motion: 'tremble' },
  frustrated: { label: 'Frustrated', eyes: 'squeeze', brows: 'furious', mouth: 'gritted', tears: 'streams', symbols: ['vein'], motion: 'tremble' },
  annoyed: { label: 'Annoyed', eyes: 'half', brows: 'angry', mouth: 'flat', symbols: ['vein'] },
  pouting: { label: 'Pouting', eyes: 'half', gaze: [12, 0], brows: 'angry', mouth: 'pout', cheeks: 'puff', symbols: ['steam'] },
  disgusted: { label: 'Disgusted', eyes: 'half', brows: 'angry', mouth: 'sour', cheeks: 'pale' },
  smug: { label: 'Smug', eyes: 'half', gaze: [10, 0], brows: 'skeptical', mouth: 'smirk', motion: 'chinup' },
  mischief: { label: 'Mischievous', eyes: 'half', gaze: [-10, 0], brows: 'angry', mouth: 'cat', cheeks: 'blush' },
  scheming: { label: 'Scheming', eyes: 'glow', glow: '#ffd23f', shade: 0.6, brows: 'angry', mouth: 'shark', symbols: ['menace'] },
  menacing: { label: 'Menacing', eyes: 'glow', glow: '#ff3b30', shade: 0.85, brows: 'furious', mouth: 'flat', symbols: ['menace'] },
  determined: { label: 'Determined', eyes: 'determined', brows: 'determined', mouth: 'teeth', symbols: ['shock'] },
  battlecry: { label: 'Battle cry', eyes: 'determined', brows: 'furious', mouth: 'shout', symbols: ['shock', 'steam'], motion: 'tremble' },
  deadpan: { label: 'Deadpan', eyes: 'dots', mouth: 'flat', symbols: ['sweat'] },
  unimpressed: { label: 'Unimpressed', eyes: 'flat', mouth: 'flat' },
  dizzy: { label: 'Dizzy', eyes: 'spiral', mouth: 'wavy', symbols: ['stars'], motion: 'sway' },
  knockedout: { label: 'Knocked out', eyes: 'x', mouth: 'tongue', symbols: ['stars'], motion: 'slump' },
  sleepy: { label: 'Sleepy', eyes: 'half', mouth: 'small', symbols: ['zzz'], motion: 'nodoff' },
  asleep: { label: 'Asleep', eyes: 'closed', mouth: 'small', symbols: ['zzz', 'bubble'], motion: 'nodoff' },
  hungry: { label: 'Hungry', eyes: 'star', mouth: 'drool', symbols: ['sparkles'] },
  greedy: { label: 'Greedy', eyes: 'money', mouth: 'teeth', cheeks: 'blush', symbols: ['sparkles'] },
};

// The original six expressions map onto emotions.
export const EXPRESSION_ALIASES = { surprised: 'surprised', sleepy: 'sleepy', angry: 'angry', sad: 'sad', happy: 'happy', neutral: 'neutral' };
