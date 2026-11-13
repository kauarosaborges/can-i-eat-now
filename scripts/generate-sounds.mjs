import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 44100;
const PEAK = 0.7;
const FADE_IN_SECONDS = 0.006;
const FADE_OUT_SECONDS = 0.05;
const BELL_PARTIALS = [
  [1, 1],
  [2.76, 0.32],
  [5.4, 0.12],
];

function createBuffer(seconds) {
  return new Float64Array(Math.round(seconds * SAMPLE_RATE));
}

function addBell(buffer, { frequency, start, decay, gain }) {
  const offset = Math.round(start * SAMPLE_RATE);
  for (let index = offset; index < buffer.length; index += 1) {
    const time = (index - offset) / SAMPLE_RATE;
    const envelope = Math.exp(-time / decay) * Math.min(1, time / 0.003);
    if (time > 0.05 && envelope < 0.0005) break;
    let sample = 0;
    for (const [ratio, weight] of BELL_PARTIALS) sample += weight * Math.sin(2 * Math.PI * frequency * ratio * time) * Math.exp(-time * ratio * 0.9 / decay);
    buffer[index] += sample * envelope * gain;
  }
}

function addDrop(buffer, { from, to, start, decay, gain }) {
  const offset = Math.round(start * SAMPLE_RATE);
  let phase = 0;
  for (let index = offset; index < buffer.length; index += 1) {
    const time = (index - offset) / SAMPLE_RATE;
    const envelope = Math.exp(-time / decay) * Math.min(1, time / 0.004);
    if (time > 0.05 && envelope < 0.0005) break;
    const glide = 1 - Math.exp(-time / 0.045);
    const frequency = from + (to - from) * glide;
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;
    buffer[index] += (Math.sin(phase) + 0.18 * Math.sin(phase * 2)) * envelope * gain;
  }
}

function finish(buffer) {
  let peak = 0;
  for (const value of buffer) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0 ? PEAK / peak : 1;
  const fadeIn = Math.round(FADE_IN_SECONDS * SAMPLE_RATE);
  const fadeOut = Math.round(FADE_OUT_SECONDS * SAMPLE_RATE);
  const samples = new Int16Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    let gain = scale;
    if (index < fadeIn) gain *= index / fadeIn;
    const remaining = buffer.length - 1 - index;
    if (remaining < fadeOut) gain *= remaining / fadeOut;
    samples[index] = Math.max(-32767, Math.min(32767, Math.round(buffer[index] * gain * 32767)));
  }
  return samples;
}

export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) buffer.writeInt16LE(samples[index], 44 + index * 2);
  return buffer;
}

export function synthWater() {
  const buffer = createBuffer(0.75);
  addDrop(buffer, { from: 520, to: 980, start: 0, decay: 0.1, gain: 1 });
  addDrop(buffer, { from: 430, to: 760, start: 0.22, decay: 0.12, gain: 0.45 });
  return finish(buffer);
}

export function synthChime() {
  const buffer = createBuffer(1.7);
  addBell(buffer, { frequency: 1046.5, start: 0, decay: 0.5, gain: 0.8 });
  addBell(buffer, { frequency: 1318.5, start: 0.17, decay: 0.5, gain: 0.8 });
  addBell(buffer, { frequency: 1568, start: 0.34, decay: 0.65, gain: 0.9 });
  return finish(buffer);
}

export function synthSoft() {
  const buffer = createBuffer(1.1);
  addBell(buffer, { frequency: 1318.5, start: 0, decay: 0.32, gain: 0.8 });
  addBell(buffer, { frequency: 987.8, start: 0.2, decay: 0.45, gain: 0.8 });
  return finish(buffer);
}

export const SOUNDS = {
  'sound-water.wav': synthWater,
  'sound-chime.wav': synthChime,
  'sound-soft.wav': synthSoft,
};

export function writeSounds(directory) {
  mkdirSync(directory, { recursive: true });
  for (const [name, synth] of Object.entries(SOUNDS)) writeFileSync(join(directory, name), encodeWav(synth()));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeSounds(join(dirname(fileURLToPath(import.meta.url)), '..', 'www'));
}
