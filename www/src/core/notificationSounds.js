export const SOUND_FILES = {
  water: 'sound-water.wav',
  mealAllowed: 'sound-chime.wav',
  windowOpen: 'sound-chime.wav',
  windowClosing: 'sound-soft.wav',
  measurement: 'sound-soft.wav',
};

export function soundFor(kind) {
  return Object.hasOwn(SOUND_FILES, kind) ? SOUND_FILES[kind] : null;
}
