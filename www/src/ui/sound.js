import { SOUND_FILES, soundFor } from '../core/notificationSounds.js';

const RESUME_TIMEOUT_MS = 300;
const buffers = new Map();

function withTimeout(promise, ms) {
  return Promise.race([Promise.resolve(promise), new Promise((resolve) => setTimeout(resolve, ms))]);
}
let context = null;

function createContext() {
  if (context) return context;
  const Constructor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!Constructor) return null;
  try {
    context = new Constructor();
  } catch {
    context = null;
  }
  return context;
}

async function load(file) {
  if (buffers.has(file)) return buffers.get(file);
  const pending = fetch(file)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('sound unavailable'))))
    .then((data) => new Promise((resolve, reject) => context.decodeAudioData(data, resolve, reject)));
  buffers.set(file, pending);
  pending.catch(() => buffers.delete(file));
  return pending;
}

function unlock() {
  const audio = createContext();
  if (!audio) return;
  if (audio.state === 'running' && buffers.size > 0) return;
  const resume = audio.state !== 'running' ? audio.resume() : Promise.resolve();
  Promise.resolve(resume)
    .then(() => {
      for (const file of new Set(Object.values(SOUND_FILES))) load(file).catch(() => {});
    })
    .catch(() => {});
}

export function installSoundUnlock() {
  if (typeof document === 'undefined') return;
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}

export async function playKindSound(kind) {
  const file = soundFor(kind);
  if (!file) return false;
  try {
    const audio = createContext();
    if (!audio) return false;
    if (audio.state !== 'running') await withTimeout(audio.resume(), RESUME_TIMEOUT_MS);
    if (audio.state !== 'running') return false;
    const buffer = await load(file);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start();
    return true;
  } catch {
    return false;
  }
}
