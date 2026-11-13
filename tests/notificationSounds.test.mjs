import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASUREMENT_KIND, NOTIFICATION_KINDS } from '../www/src/core/notificationPlan.js';
import { SOUND_FILES, soundFor } from '../www/src/core/notificationSounds.js';
import { sanitizeState } from '../www/src/core/storage.js';
import { toNativeNotification } from '../www/src/ui/nativeNotifications.js';
import { SAMPLE_RATE, SOUNDS, encodeWav } from '../scripts/generate-sounds.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { makeState } from './helpers.mjs';

function item(kind) {
  return { id: 1, at: new Date(2030, 0, 1), kind, titleKey: 'notificationPlan.waterTitle', bodyKey: 'notificationPlan.waterBody', params: { ml: 250 } };
}

test('every notification kind has a sound file that ships in www', () => {
  for (const kind of [...NOTIFICATION_KINDS, MEASUREMENT_KIND]) {
    const file = soundFor(kind);
    assert.ok(file, kind);
    assert.ok(existsSync(new URL(`../www/${file}`, import.meta.url)), file);
  }
  assert.equal(soundFor('unknown'), null);
  assert.equal(soundFor('constructor'), null);
});

test('native notifications carry the sound of their kind', () => {
  for (const kind of [...NOTIFICATION_KINDS, MEASUREMENT_KIND]) {
    assert.equal(toNativeNotification(item(kind)).sound, SOUND_FILES[kind]);
  }
  assert.equal(toNativeNotification(item('water')).sound, 'sound-water.wav');
  assert.equal(toNativeNotification(item('mealAllowed')).sound, toNativeNotification(item('windowOpen')).sound);
  assert.equal(toNativeNotification(item('other')).sound, undefined);
});

test('generated sounds are valid short mono 16-bit wav files', () => {
  for (const [name, synth] of Object.entries(SOUNDS)) {
    const samples = synth();
    const wav = encodeWav(samples);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), samples.length * 2);
    assert.equal(wav.length, 44 + samples.length * 2);
    assert.equal(wav.readUInt32LE(4), wav.length - 8);
    const seconds = samples.length / SAMPLE_RATE;
    assert.ok(seconds > 0.3 && seconds < 2, name);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    assert.ok(peak > 10000 && peak < 32767, name);
    assert.ok(Math.abs(samples[0]) < 500 && Math.abs(samples[samples.length - 1]) < 500, name);
  }
});

test('shipped wav files match the generator output', () => {
  for (const [name, synth] of Object.entries(SOUNDS)) {
    assert.ok(readFileSync(new URL(`../www/${name}`, import.meta.url)).equals(encodeWav(synth())), name);
  }
});

test('in-app sound setting defaults to on and is sanitized', () => {
  const defaults = makeState();
  assert.equal(defaults.notifications.inAppSound, true);
  const base = { ...defaults, onboarded: true };
  const now = new Date(2030, 0, 1);
  const read = (notifications) => sanitizeState({ ...base, notifications }, defaults, now).notifications.inAppSound;
  assert.equal(read({ enabled: true, kinds: {} }), true);
  assert.equal(read({ enabled: true, inAppSound: false, kinds: {} }), false);
  assert.equal(read({ enabled: true, inAppSound: true, kinds: {} }), true);
  assert.equal(read({ enabled: true, inAppSound: 'no', kinds: {} }), true);
  assert.equal(read(null), true);
});
