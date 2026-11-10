import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, createDefaultState, loadState, parseState, saveState } from '../www/src/core/storage.js';
import { MEAL_NAMES, localDate } from './helpers.mjs';

const now = localDate('2026-11-09', '10:00');
const defaults = createDefaultState(now, MEAL_NAMES);

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('invalid json, null and wrong version fall back to defaults', () => {
  assert.equal(parseState('{not json', defaults, now), defaults);
  assert.equal(parseState(null, defaults, now), defaults);
  assert.equal(parseState('[]', defaults, now), defaults);
  assert.equal(parseState(JSON.stringify({ version: 99 }), defaults, now), defaults);
});

test('throwing storage falls back to defaults', () => {
  const broken = { getItem: () => { throw new Error('denied'); } };
  assert.equal(loadState(broken, defaults, now), defaults);
});

test('numbers are clamped and enums validated', () => {
  const raw = JSON.stringify({
    version: 1,
    onboarded: true,
    fasting: { mode: 'banana', toleranceMinutes: 9999, minGapMinutes: -5, intermittent: { preset: '18:6', eatingHours: 99, windowStart: '99:00' } },
    profile: { weightKg: 5000, heightCm: 'x', age: -3, activity: 'ultra', glassMl: 1, hotClimate: 'yes', wakeTime: '06:30' },
    meals: [
      { id: 'lunch', name: '  Almoço  ', time: '12:00' },
      { id: 'bad id!', name: 'x', time: '10:00' },
      { id: 'lunch', name: 'dup', time: '13:00' },
      { id: 'late', name: '<img src=x onerror=alert(1)>', time: '25:00' },
    ],
  });
  const state = parseState(raw, defaults, now);
  assert.equal(state.onboarded, true);
  assert.equal(state.fasting.mode, 'intermittent');
  assert.equal(state.fasting.toleranceMinutes, 180);
  assert.equal(state.fasting.minGapMinutes, 60);
  assert.equal(state.fasting.intermittent.preset, '18:6');
  assert.equal(state.fasting.intermittent.eatingHours, 23);
  assert.equal(state.fasting.intermittent.windowStart, '12:00');
  assert.equal(state.profile.weightKg, 300);
  assert.equal(state.profile.heightCm, 170);
  assert.equal(state.profile.age, 10);
  assert.equal(state.profile.activity, 'light');
  assert.equal(state.profile.glassMl, 50);
  assert.equal(state.profile.hotClimate, false);
  assert.equal(state.profile.wakeTime, '06:30');
  assert.deepEqual(state.meals.map((meal) => meal.id), ['lunch', 'late']);
  assert.equal(state.meals[0].name, 'Almoço');
  assert.equal(state.meals[1].time, '12:00');
});

test('days are sanitized and old days pruned', () => {
  const raw = JSON.stringify({
    version: 1,
    days: {
      '2026-11-09': { windowShift: -999, meals: { lunch: { eatenAt: 1, minute: 700 }, bad: { eatenAt: 'x' } }, skips: { dinner: 'noFit', snack: 'weird' }, water: [{ at: 1, ml: 99999 }, { at: 'x', ml: 1 }] },
      '2025-01-01': { meals: {} },
      'not-a-date': {},
    },
  });
  const state = parseState(raw, defaults, now);
  assert.deepEqual(Object.keys(state.days), ['2026-11-09']);
  const day = state.days['2026-11-09'];
  assert.equal(day.windowShift, 0);
  assert.deepEqual(Object.keys(day.meals), ['lunch']);
  assert.deepEqual(day.skips, { dinner: 'noFit' });
  assert.equal(day.water.length, 1);
  assert.equal(day.water[0].ml, 2000);
  assert.equal(typeof day.water[0].id, 'string');
});

test('save then load round trips', () => {
  const storage = memoryStorage();
  const state = { ...defaults, onboarded: true };
  assert.equal(saveState(storage, state), true);
  assert.ok(storage.getItem(STORAGE_KEY));
  assert.deepEqual(loadState(storage, defaults, now), state);
});
