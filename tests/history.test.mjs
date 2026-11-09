import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory, dayFastingHours } from '../www/src/core/history.js';
import { localDate, makeState } from './helpers.mjs';

function dayWithMeals(key, times) {
  const meals = {};
  times.forEach((time, index) => {
    const date = localDate(key, time);
    meals[`m${index}`] = { eatenAt: date.getTime(), minute: date.getHours() * 60 + date.getMinutes() };
  });
  return { windowShift: 0, meals, skips: {}, adjustments: {}, water: [], lastReminder: -1 };
}

test('fasting hours per day subtract the eating span', () => {
  const state = makeState({ days: { '2026-11-08': dayWithMeals('2026-11-08', ['12:00', '19:30']) } });
  const summary = dayFastingHours(state, '2026-11-08', localDate('2026-11-09', '10:00'));
  assert.equal(summary.hours, 16);
  assert.equal(summary.mealsCount, 2);
});

test('past eating day without logs has no data', () => {
  const state = makeState();
  assert.equal(dayFastingHours(state, '2026-11-05', localDate('2026-11-09', '10:00')).hours, null);
});

test('streak counts consecutive on track days and tolerates an unfinished today', () => {
  const days = {};
  for (const key of ['2026-11-06', '2026-11-07', '2026-11-08']) days[key] = dayWithMeals(key, ['12:00', '19:30']);
  days['2026-11-05'] = dayWithMeals('2026-11-05', ['08:00', '21:00']);
  const state = makeState({ days });
  const history = buildHistory(state, localDate('2026-11-09', '10:00'));
  assert.equal(history.entries.length, 14);
  assert.equal(history.streak, 3);
});

test('weekend fasting days count when no meal was logged', () => {
  const state = makeState({ fasting: { mode: 'weekdays' }, days: { '2026-11-13': dayWithMeals('2026-11-13', ['12:00']) } });
  const history = buildHistory(state, localDate('2026-11-15', '20:00'));
  const last = history.entries.slice(-3);
  assert.deepEqual(last.map((entry) => entry.onTrack), [true, true, true]);
  assert.equal(history.streak, 3);
});
