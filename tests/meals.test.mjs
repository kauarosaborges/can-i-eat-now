import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODIFIED_MEAL_ID, classifyDay } from '../www/src/core/fasting.js';
import { buildTimeline, eatMealNow, emptyDayLog, nextMeal, sanitizeMealName, skipMeal } from '../www/src/core/meals.js';
import { localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-09';

function setup(fastingOverrides = {}) {
  const state = makeState({ fasting: fastingOverrides });
  const plan = classifyDay(state.fasting, DAY);
  return { state, plan };
}

function eat(state, plan, dayLog, mealId, time) {
  return eatMealNow({
    meals: state.meals,
    plan,
    dayLog,
    mealId,
    now: localDate(DAY, time),
    toleranceMinutes: state.fasting.toleranceMinutes,
    minGapMinutes: state.fasting.minGapMinutes,
  });
}

test('timeline marks meals outside the eating window as not allowed', () => {
  const { state, plan } = setup();
  const timeline = buildTimeline(state.meals, plan, emptyDayLog(), 600, 60);
  const statuses = Object.fromEntries(timeline.map((item) => [item.id, item.status]));
  assert.equal(statuses.breakfast, 'notAllowed');
  assert.equal(statuses.lunch, 'upcoming');
  assert.equal(statuses.snack, 'upcoming');
  assert.equal(statuses.dinner, 'upcoming');
});

test('timeline shows allowed now, done and missed', () => {
  const { state, plan } = setup();
  let log = eat(state, plan, emptyDayLog(), 'lunch', '12:30').dayLog;
  const timeline = buildTimeline(state.meals, plan, log, 16 * 60 + 5, 60);
  const statuses = Object.fromEntries(timeline.map((item) => [item.id, item.status]));
  assert.equal(statuses.lunch, 'done');
  assert.equal(statuses.snack, 'allowedNow');
  assert.equal(statuses.dinner, 'upcoming');
  assert.equal(nextMeal(timeline).id, 'snack');
  log = skipMeal(log, 'snack');
  const after = buildTimeline(state.meals, plan, log, 16 * 60 + 5, 60);
  assert.equal(after.find((item) => item.id === 'snack').status, 'skipped');
});

test('missed meals before a later done meal cannot be eaten anymore', () => {
  const { state, plan } = setup();
  const log = eat(state, plan, emptyDayLog(), 'snack', '17:00').dayLog;
  const timeline = buildTimeline(state.meals, plan, log, 17 * 60 + 5, 60);
  const lunch = timeline.find((item) => item.id === 'lunch');
  assert.equal(lunch.status, 'missed');
  assert.equal(lunch.canEatNow, false);
});

test('weekend fasting day blocks every meal', () => {
  const state = makeState({ fasting: { mode: 'weekdays' } });
  const plan = classifyDay(state.fasting, '2026-11-14');
  const timeline = buildTimeline(state.meals, plan, emptyDayLog(), 720, 60);
  assert.ok(timeline.every((item) => item.status === 'notAllowed' && !item.canEatNow));
  const result = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: 'lunch', now: localDate('2026-11-14', '12:00'), toleranceMinutes: 60, minGapMinutes: 150 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'fastingDay');
});

test('eating early inside the window shifts following meals by the same delta', () => {
  const { state, plan } = setup({ intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } });
  const result = eat(state, plan, emptyDayLog(), 'lunch', '11:40');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'inside');
  assert.equal(result.delta, -50);
  assert.deepEqual(result.adjustments.map((item) => [item.id, item.to]), [['snack', 910], ['dinner', 1120]]);
});

test('advance within tolerance shifts the window earlier for today only', () => {
  const { state, plan } = setup();
  const result = eat(state, plan, emptyDayLog(), 'lunch', '11:20');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'advance');
  assert.equal(result.advanceMinutes, 40);
  assert.equal(result.dayLog.windowShift, -40);
  assert.equal(result.delta, -70);
  assert.equal(result.adjustments.find((item) => item.id === 'snack').to, 890);
  assert.equal(result.adjustments.find((item) => item.id === 'dinner').to, 1100);
  const tomorrow = classifyDay(state.fasting, '2026-11-10');
  assert.deepEqual(tomorrow.window, { start: 720, end: 1200 });
});

test('outside tolerance eating is refused', () => {
  const { state, plan } = setup();
  const result = eat(state, plan, emptyDayLog(), 'lunch', '10:30');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'tooEarly');
});

test('minimum gap pushes the next meal when the delta is not enough', () => {
  const { state, plan } = setup({ intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } });
  state.meals = [
    { id: 'lunch', name: 'Lunch', time: '12:30' },
    { id: 'snack', name: 'Snack', time: '14:00' },
    { id: 'dinner', name: 'Dinner', time: '19:30' },
  ];
  const result = eat(state, plan, emptyDayLog(), 'lunch', '12:00');
  assert.equal(result.delta, -30);
  assert.deepEqual(result.adjustments.map((item) => [item.id, item.to]), [['snack', 870], ['dinner', 1140]]);
});

test('late meal pushes the next one and skips it when it no longer fits', () => {
  const { state, plan } = setup();
  const result = eat(state, plan, emptyDayLog(), 'lunch', '13:30');
  assert.equal(result.delta, 60);
  assert.equal(result.adjustments.find((item) => item.id === 'snack').to, 1020);
  assert.deepEqual(result.skipped.map((item) => item.id), ['dinner']);
  assert.equal(result.dayLog.skips.dinner, 'noFit');
  const timeline = buildTimeline(state.meals, plan, result.dayLog, 17 * 60, 60);
  assert.equal(timeline.find((item) => item.id === 'dinner').status, 'skipped');
});

test('late lunch shifts snack and dinner keeping the gap and window end', () => {
  const { state, plan } = setup();
  const result = eat(state, plan, emptyDayLog(), 'lunch', '13:00');
  assert.deepEqual(result.adjustments.map((item) => [item.id, item.to]), [['snack', 990]]);
  assert.deepEqual(result.skipped.map((item) => item.id), ['dinner']);
});

test('modified fasting day allows exactly one small meal', () => {
  const state = makeState({ fasting: { mode: 'alternate', alternate: { cycleStart: '2026-11-08', fastingDayType: 'modified', modifiedMealTime: '13:00', modifiedMealKcal: 500 } } });
  const plan = classifyDay(state.fasting, DAY);
  assert.equal(plan.fastingType, 'modified');
  const timeline = buildTimeline(state.meals, plan, emptyDayLog(), 12 * 60 + 40, 60);
  const small = timeline.find((item) => item.id === MODIFIED_MEAL_ID);
  assert.equal(small.status, 'upcoming');
  assert.equal(small.canEatNow, true);
  assert.ok(timeline.filter((item) => item.id !== MODIFIED_MEAL_ID).every((item) => item.status === 'notAllowed'));
  const first = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: MODIFIED_MEAL_ID, now: localDate(DAY, '12:40'), toleranceMinutes: 60, minGapMinutes: 150 });
  assert.equal(first.ok, true);
  assert.equal(first.kind, 'advance');
  const blocked = eatMealNow({ meals: state.meals, plan, dayLog: first.dayLog, mealId: 'lunch', now: localDate(DAY, '13:10'), toleranceMinutes: 60, minGapMinutes: 150 });
  assert.equal(blocked.ok, false);
});

test('meal names are trimmed, stripped and limited', () => {
  assert.equal(sanitizeMealName('  Ceia  ', 'x'), 'Ceia');
  assert.equal(sanitizeMealName('   ', 'fallback'), 'fallback');
  assert.equal(sanitizeMealName('a'.repeat(50), 'x').length, 30);
  assert.equal(sanitizeMealName(42, 'x'), 'x');
});
