import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkEatAt,
  classifyDay,
  currentStage,
  fastProgress,
  fastState,
  isAlternateFastingDay,
} from '../www/src/core/fasting.js';
import { addDaysToKey } from '../www/src/core/time.js';
import { localDate, makeState } from './helpers.mjs';

test('intermittent presets derive the window end', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, '2026-11-09');
  assert.deepEqual(plan.window, { start: 720, end: 1200 });
  assert.equal(plan.isFastingDay, false);

  const omad = classifyDay({ ...state.fasting, intermittent: { preset: 'omad', eatingHours: 8, windowStart: '18:00' } }, '2026-11-09');
  assert.deepEqual(omad.window, { start: 1080, end: 1140 });

  const custom = classifyDay({ ...state.fasting, intermittent: { preset: 'custom', eatingHours: 10, windowStart: '09:00' } }, '2026-11-09');
  assert.deepEqual(custom.window, { start: 540, end: 1140 });
});

test('intermittent window may cross midnight', () => {
  const state = makeState();
  const plan = classifyDay({ ...state.fasting, intermittent: { preset: '16:8', eatingHours: 8, windowStart: '20:00' } }, '2026-11-09');
  assert.deepEqual(plan.window, { start: 1200, end: 1680 });
});

test('weekday mode fasts on weekend by default and on custom days', () => {
  const state = makeState({ fasting: { mode: 'weekdays' } });
  assert.equal(classifyDay(state.fasting, '2026-11-13').isFastingDay, false);
  assert.equal(classifyDay(state.fasting, '2026-11-14').isFastingDay, true);
  assert.equal(classifyDay(state.fasting, '2026-11-15').isFastingDay, true);
  assert.equal(classifyDay(state.fasting, '2026-11-16').isFastingDay, false);

  const custom = { ...state.fasting, weekdays: { fastingDays: [3] } };
  assert.equal(classifyDay(custom, '2026-11-11').isFastingDay, true);
  assert.equal(classifyDay(custom, '2026-11-14').isFastingDay, false);
});

test('alternate day parity holds across months, years and DST dates', () => {
  const start = '2026-01-30';
  assert.equal(isAlternateFastingDay(start, '2026-01-30'), false);
  assert.equal(isAlternateFastingDay(start, '2026-01-31'), true);
  assert.equal(isAlternateFastingDay(start, '2026-02-01'), false);
  assert.equal(isAlternateFastingDay(start, '2026-03-01'), false);
  assert.equal(isAlternateFastingDay(start, '2026-03-02'), true);
  assert.equal(isAlternateFastingDay(start, '2026-01-29'), false);
  assert.equal(isAlternateFastingDay(start, '2026-01-28'), false);
  let key = start;
  for (let index = 0; index < 400; index += 1) {
    assert.equal(isAlternateFastingDay(start, key), index % 2 === 1, key);
    key = addDaysToKey(key, 1);
  }
  assert.equal(isAlternateFastingDay('2026-03-07', '2026-03-09'), false);
  assert.equal(isAlternateFastingDay('2026-10-31', '2026-11-03'), true);
});

test('alternate fasting day can be zero or modified', () => {
  const state = makeState({ fasting: { mode: 'alternate', alternate: { cycleStart: '2026-11-09', fastingDayType: 'zero', modifiedMealTime: '13:00', modifiedMealKcal: 500 } } });
  const zero = classifyDay(state.fasting, '2026-11-10');
  assert.equal(zero.fastingType, 'zero');
  assert.equal(zero.window, null);

  const modifiedFasting = { ...state.fasting, alternate: { ...state.fasting.alternate, fastingDayType: 'modified' } };
  const modified = classifyDay(modifiedFasting, '2026-11-10');
  assert.equal(modified.fastingType, 'modified');
  assert.deepEqual(modified.window, { start: 780, end: 840 });
  assert.equal(modified.modifiedMeal.kcal, 500);
});

test('checkEatAt handles inside, advance within tolerance, too early, late and fasting day', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, '2026-11-09');
  assert.equal(checkEatAt(plan, null, 800, 60).kind, 'inside');
  const advance = checkEatAt(plan, null, 680, 60);
  assert.equal(advance.allowed, true);
  assert.equal(advance.kind, 'advance');
  assert.equal(advance.windowShift, -40);
  assert.equal(advance.advanceMinutes, 40);
  const early = checkEatAt(plan, null, 600, 60);
  assert.equal(early.allowed, false);
  assert.equal(early.reason, 'tooEarly');
  assert.equal(early.minutesUntilAllowed, 60);
  assert.equal(checkEatAt(plan, null, 1220, 60).kind, 'late');
  assert.equal(checkEatAt(plan, null, 1300, 60).reason, 'tooLate');
  const weekend = classifyDay({ ...state.fasting, mode: 'weekdays' }, '2026-11-14');
  assert.equal(checkEatAt(weekend, null, 720, 60).reason, 'fastingDay');
});

test('tolerance is measured from the original window even after a shift', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, '2026-11-09');
  const shifted = { windowShift: -40, meals: {} };
  assert.equal(checkEatAt(plan, shifted, 690, 60).kind, 'inside');
  const further = checkEatAt(plan, shifted, 665, 60);
  assert.equal(further.allowed, true);
  assert.equal(further.windowShift, -55);
  assert.equal(further.advanceMinutes, 15);
  assert.equal(checkEatAt(plan, shifted, 659, 60).allowed, false);
});

test('fast state starts at last meal and targets next window', () => {
  const state = makeState({
    days: { '2026-11-08': { windowShift: 0, meals: { dinner: { eatenAt: localDate('2026-11-08', '19:00').getTime(), minute: 1140 } }, skips: {}, adjustments: {}, water: [], lastReminder: -1 } },
  });
  const now = localDate('2026-11-09', '09:00');
  const fast = fastState(state, now);
  assert.equal(fast.phase, 'fasting');
  assert.equal(fast.startedAt, localDate('2026-11-08', '19:00').getTime());
  assert.equal(fast.targetEnd, localDate('2026-11-09', '12:00').getTime());
  const progress = fastProgress(fast, now);
  assert.equal(progress.elapsedMs, 14 * 3600000);
  assert.equal(progress.remainingMs, 3 * 3600000);
});

test('fast state falls back to window end without meals and reports eating phase', () => {
  const state = makeState();
  const fast = fastState(state, localDate('2026-11-09', '09:00'));
  assert.equal(fast.startedAt, localDate('2026-11-08', '20:00').getTime());
  assert.equal(fastState(state, localDate('2026-11-09', '13:00')).phase, 'eating');
});

test('weekend fast targets monday midnight', () => {
  const state = makeState({ fasting: { mode: 'weekdays' } });
  const fast = fastState(state, localDate('2026-11-14', '10:00'));
  assert.equal(fast.phase, 'fasting');
  assert.equal(fast.targetEnd, localDate('2026-11-16', '00:00').getTime());
  assert.equal(fast.startedAt, localDate('2026-11-14', '00:00').getTime());
});

test('stages are reached by hours fasted', () => {
  assert.equal(currentStage(5), null);
  assert.equal(currentStage(12).key, 'glycogenLow');
  assert.equal(currentStage(17).key, 'ketosisLight');
  assert.equal(currentStage(30).key, 'autophagy');
});
