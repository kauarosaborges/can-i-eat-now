import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODIFIED_MEAL_ID, classifyDay, dayContext, fastState, isAlternateFastingDay } from '../www/src/core/fasting.js';
import { dayFastingHours } from '../www/src/core/history.js';
import {
  addWaterEntry,
  buildReminderSchedule,
  dueReminder,
  hydrationDayContext,
  nextReminderMinute,
  removeWaterEntry,
  validateWaterAmount,
} from '../www/src/core/hydration.js';
import {
  buildTimeline,
  eatMealNow,
  emptyDayLog,
  mealsOutsideWindow,
  resetDayPlan,
  sanitizeMealName,
  skipMeal,
  undoEatMeal,
  undoSkipMeal,
} from '../www/src/core/meals.js';
import {
  BACKUP_KEY_PREFIX,
  STORAGE_KEY,
  createDefaultState,
  loadStateWithReport,
  mergeSettings,
  resolveNotificationsEnabled,
} from '../www/src/core/storage.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

function nightState(windowStart = '20:00', preset = '16:8', meals) {
  const state = makeState({ fasting: { intermittent: { preset, eatingHours: 8, windowStart } } });
  if (meals) state.meals = meals;
  return state;
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('window from 20:00 to 04:00 keeps eating after midnight and fasts from 04:00', () => {
  const state = nightState();
  assert.equal(fastState(state, localDate('2026-11-10', '01:00')).phase, 'eating');
  assert.equal(fastState(state, localDate('2026-11-10', '03:00')).phase, 'eating');
  const fast = fastState(state, localDate('2026-11-10', '05:00'));
  assert.equal(fast.phase, 'fasting');
  assert.equal(fast.startedAt, localDate('2026-11-10', '04:00').getTime());
  assert.equal(fast.targetEnd, localDate('2026-11-10', '20:00').getTime());
});

test('OMAD at 23:30 lasts a full hour across midnight', () => {
  const state = nightState('23:30', 'omad');
  assert.deepEqual(classifyDay(state.fasting, '2026-11-09').window, { start: 1410, end: 1470 });
  assert.equal(fastState(state, localDate('2026-11-10', '00:20')).phase, 'eating');
  assert.equal(fastState(state, localDate('2026-11-10', '00:40')).phase, 'fasting');
});

test('a meal at 01:00 belongs to the previous day window', () => {
  const meals = [
    { id: 'first', name: 'First', time: '20:30' },
    { id: 'late', name: 'Late', time: '01:00' },
  ];
  const state = nightState('20:00', '16:8', meals);
  const now = localDate('2026-11-10', '00:50');
  const context = dayContext(state.fasting, state.days, now);
  assert.equal(context.key, '2026-11-09');
  assert.equal(context.minute, 1490);
  const dayLog = { ...emptyDayLog(), meals: { first: { eatenAt: localDate('2026-11-09', '20:30').getTime(), minute: 1230 } } };
  const timeline = buildTimeline(state.meals, context.plan, dayLog, context.minute, 60);
  const late = timeline.find((item) => item.id === 'late');
  assert.equal(late.scheduledMinutes, 1500);
  assert.equal(late.status, 'allowedNow');
  const result = eatMealNow({ meals: state.meals, plan: context.plan, dayLog, mealId: 'late', now, minute: context.minute, toleranceMinutes: 60, minGapMinutes: 150 });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'inside');
  assert.equal(result.dayLog.meals.late.minute, 1490);
});

test('day context switches to today once the previous window and its tolerance are over', () => {
  const state = nightState();
  assert.equal(dayContext(state.fasting, state.days, localDate('2026-11-10', '04:30')).key, '2026-11-09');
  assert.equal(dayContext(state.fasting, state.days, localDate('2026-11-10', '05:30')).key, '2026-11-10');
  assert.equal(dayContext(makeState().fasting, {}, localDate('2026-11-10', '01:00')).key, '2026-11-10');
});

test('custom 23h window starting 23:00 does not swallow the next day advance range', () => {
  const state = makeState({ fasting: { intermittent: { preset: 'custom', eatingHours: 23, windowStart: '23:00' } } });
  assert.equal(dayContext(state.fasting, state.days, localDate('2026-11-10', '21:30')).key, '2026-11-09');
  assert.equal(dayContext(state.fasting, state.days, localDate('2026-11-10', '22:30')).key, '2026-11-10');
});

test('undo of a meal keeps water logged afterwards', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, '2026-11-09');
  const eaten = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: 'lunch', now: localDate('2026-11-09', '13:30'), toleranceMinutes: 60, minGapMinutes: 150 });
  const withWater = addWaterEntry(eaten.dayLog, { id: 'w-1', at: 1, ml: 250 });
  const undone = undoEatMeal(withWater, eaten.undo);
  assert.equal(undone.ok, true);
  assert.equal(undone.dayLog.meals.lunch, undefined);
  assert.deepEqual(undone.dayLog.adjustments, {});
  assert.deepEqual(undone.dayLog.skips, {});
  assert.equal(undone.dayLog.water.length, 1);
});

test('undo of an early meal restores the window shift only if nothing changed it', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, '2026-11-09');
  const eaten = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: 'lunch', now: localDate('2026-11-09', '11:20'), toleranceMinutes: 60, minGapMinutes: 150 });
  assert.equal(undoEatMeal(eaten.dayLog, eaten.undo).dayLog.windowShift, 0);
  const stale = { ...eaten.undo, eatenAt: 1 };
  assert.equal(undoEatMeal(eaten.dayLog, stale).ok, false);
});

test('undo of a water entry removes only that entry', () => {
  let log = addWaterEntry(emptyDayLog(), { id: 'w-a', at: 1, ml: 250 });
  log = addWaterEntry(log, { id: 'w-b', at: 2, ml: 250 });
  const result = removeWaterEntry(log, 'w-a');
  assert.deepEqual(result.dayLog.water.map((entry) => entry.id), ['w-b']);
  assert.equal(removeWaterEntry(result.dayLog, 'w-a').ok, false);
});

test('undo of a skip removes only a user skip', () => {
  const log = skipMeal(emptyDayLog(), 'lunch');
  assert.equal(undoSkipMeal(log, 'lunch').dayLog.skips.lunch, undefined);
  const noFit = { ...emptyDayLog(), skips: { dinner: 'noFit' } };
  assert.equal(undoSkipMeal(noFit, 'dinner').ok, false);
});

test('notifications are enabled only when wanted and granted', () => {
  assert.equal(resolveNotificationsEnabled(true, 'granted'), true);
  assert.equal(resolveNotificationsEnabled(false, 'granted'), false);
  assert.equal(resolveNotificationsEnabled(true, 'denied'), false);
  assert.equal(resolveNotificationsEnabled(true, 'default'), false);
});

test('modified fasting day turns into fasting once the single meal is eaten', () => {
  const state = makeState({ fasting: { mode: 'alternate', alternate: { cycleStart: '2026-11-08', fastingDayType: 'modified', modifiedMealTime: '13:00', modifiedMealKcal: 500 } } });
  const plan = classifyDay(state.fasting, '2026-11-09');
  const eaten = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: MODIFIED_MEAL_ID, now: localDate('2026-11-09', '13:10'), toleranceMinutes: 60, minGapMinutes: 150 });
  state.days = { '2026-11-09': eaten.dayLog };
  const fast = fastState(state, localDate('2026-11-09', '13:20'));
  assert.equal(fast.phase, 'fasting');
  assert.equal(fast.startedAt, localDate('2026-11-09', '13:10').getTime());
  assert.equal(fastState(makeState({ fasting: state.fasting }), localDate('2026-11-09', '13:20')).phase, 'eating');
});

test('reminders after midnight are sorted, next reminder wraps and water day lasts until sleep', () => {
  const schedule = buildReminderSchedule({ goalMl: 2500, glassMl: 250, wakeTime: '07:00', sleepTime: '02:00' });
  assert.deepEqual(schedule.times, [...schedule.times].sort((left, right) => left - right));
  assert.ok(schedule.times.every((at) => at < 1560));
  assert.equal(schedule.times[schedule.times.length - 1], 1500);
  assert.equal(nextReminderMinute(schedule.times, 1430), 1500);
  const profile = { wakeTime: '07:00', sleepTime: '02:00' };
  const context = hydrationDayContext(profile, localDate('2026-11-10', '01:05'));
  assert.equal(context.key, '2026-11-09');
  assert.equal(context.minute, 1505);
  assert.equal(dueReminder(schedule.times, context.minute, 1410), 1500);
  assert.equal(hydrationDayContext(profile, localDate('2026-11-10', '03:00')).key, '2026-11-10');
  assert.equal(hydrationDayContext({ wakeTime: '07:00', sleepTime: '23:00' }, localDate('2026-11-10', '00:30')).key, '2026-11-10');
});

test('night shift worker gets the 00:00 reminder at 23:30', () => {
  const schedule = buildReminderSchedule({ goalMl: 2000, glassMl: 250, wakeTime: '22:00', sleepTime: '06:00' });
  assert.equal(nextReminderMinute(schedule.times, 1410), 1440);
});

test('corrupt or unknown version state is backed up before reset', () => {
  const now = localDate('2026-11-09', '10:00');
  const defaults = createDefaultState(now, MEAL_NAMES);
  const raw = JSON.stringify({ version: 3, onboarded: true });
  const storage = memoryStorage({ [STORAGE_KEY]: raw });
  const report = loadStateWithReport(storage, defaults, now);
  assert.equal(report.status, 'unknownVersion');
  assert.equal(report.state, defaults);
  assert.ok(report.backupKey.startsWith(BACKUP_KEY_PREFIX));
  assert.equal(storage.getItem(report.backupKey), raw);
  assert.equal(storage.getItem(STORAGE_KEY), null);

  const corrupt = memoryStorage({ [STORAGE_KEY]: '{oops' });
  const corruptReport = loadStateWithReport(corrupt, defaults, now);
  assert.equal(corruptReport.status, 'corrupt');
  assert.equal(corrupt.getItem(corruptReport.backupKey), '{oops');
  assert.equal(loadStateWithReport(memoryStorage(), defaults, now).backupKey, null);
});

test('custom water amount is validated between 50 and 2000', () => {
  assert.deepEqual(validateWaterAmount('300'), { ok: true, value: 300 });
  assert.equal(validateWaterAmount('0').error, 'tooSmall');
  assert.equal(validateWaterAmount('49').error, 'tooSmall');
  assert.equal(validateWaterAmount('-5').error, 'invalid');
  assert.equal(validateWaterAmount('99999').error, 'tooLarge');
  assert.equal(validateWaterAmount('').error, 'invalid');
  assert.equal(validateWaterAmount('2.5').error, 'invalid');
});

test('alternate cycle starting in the future keeps eating days before it', () => {
  assert.equal(isAlternateFastingDay('2026-11-20', '2026-11-09'), false);
  assert.equal(isAlternateFastingDay('2026-11-20', '2026-11-19'), false);
  assert.equal(isAlternateFastingDay('2026-11-20', '2026-11-21'), true);
  const state = makeState({ fasting: { mode: 'alternate', alternate: { cycleStart: '2026-11-20', fastingDayType: 'zero', modifiedMealTime: '13:00', modifiedMealKcal: 500 } } });
  assert.equal(classifyDay(state.fasting, '2026-11-09').isFastingDay, false);
});

test('eating a later meal first leaves earlier meals available until overdue', () => {
  const state = makeState({ fasting: { intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } } });
  const plan = classifyDay(state.fasting, '2026-11-09');
  const eaten = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: 'dinner', now: localDate('2026-11-09', '12:00'), toleranceMinutes: 60, minGapMinutes: 150 });
  const atNoon = buildTimeline(state.meals, plan, eaten.dayLog, 12 * 60, 60);
  const lunch = atNoon.find((item) => item.id === 'lunch');
  assert.equal(lunch.status, 'allowedNow');
  assert.equal(lunch.canEatNow, true);
  assert.equal(atNoon.find((item) => item.id === 'snack').status, 'upcoming');
  const late = buildTimeline(state.meals, plan, eaten.dayLog, 14 * 60, 60).find((item) => item.id === 'lunch');
  assert.equal(late.status, 'missed');
  assert.equal(late.canEatNow, false);
});

test('meals sharing the same time are all allowed together', () => {
  const state = makeState();
  state.meals = [
    { id: 'a', name: 'A', time: '13:00' },
    { id: 'b', name: 'B', time: '13:00' },
    { id: 'c', name: 'C', time: '13:00' },
  ];
  const plan = classifyDay(state.fasting, '2026-11-09');
  const timeline = buildTimeline(state.meals, plan, emptyDayLog(), 13 * 60, 60);
  assert.deepEqual(timeline.map((item) => item.status), ['allowedNow', 'allowedNow', 'allowedNow']);
  const eaten = eatMealNow({ meals: state.meals, plan, dayLog: emptyDayLog(), mealId: 'b', now: localDate('2026-11-09', '13:00'), toleranceMinutes: 60, minGapMinutes: 150 });
  const after = buildTimeline(state.meals, plan, eaten.dayLog, 13 * 60 + 5, 60);
  assert.equal(after.find((item) => item.id === 'a').status, 'allowedNow');
  assert.equal(after.find((item) => item.id === 'c').status, 'allowedNow');
  const soon = buildTimeline(state.meals, plan, emptyDayLog(), 12 * 60 + 45, 60);
  assert.deepEqual(soon.map((item) => item.status), ['allowedNow', 'allowedNow', 'allowedNow']);
});

test('meal names never cut an emoji in half', () => {
  const name = `${'a'.repeat(29)}\u{1F34E}extra`;
  const cleaned = sanitizeMealName(name, 'x');
  assert.equal(Array.from(cleaned).length, 30);
  assert.ok(cleaned.endsWith('\u{1F34E}'));
});

test('meals outside the intermittent window are reported', () => {
  const state = makeState();
  assert.deepEqual(mealsOutsideWindow(state.meals, state.fasting, '2026-11-09'), ['breakfast']);
  const night = nightState();
  night.meals = [{ id: 'late', name: 'Late', time: '01:00' }, { id: 'noon', name: 'Noon', time: '12:00' }];
  assert.deepEqual(mealsOutsideWindow(night.meals, night.fasting, '2026-11-09'), ['noon']);
  assert.deepEqual(mealsOutsideWindow(state.meals, { ...state.fasting, mode: 'weekdays' }, '2026-11-09'), []);
});

test('changing the plan clears the stale window shift and adjustments of the day', () => {
  const log = { ...emptyDayLog(), windowShift: -45, adjustments: { snack: 900 }, skips: { dinner: 'noFit', lunch: 'user' }, water: [{ id: 'w', at: 1, ml: 250 }] };
  const reset = resetDayPlan(log);
  assert.equal(reset.windowShift, 0);
  assert.deepEqual(reset.adjustments, {});
  assert.deepEqual(reset.skips, { lunch: 'user' });
  assert.equal(reset.water.length, 1);
});

test('saving settings keeps day logs written meanwhile', () => {
  const state = makeState({ days: { '2026-11-09': { ...emptyDayLog(), water: [{ id: 'w', at: 1, ml: 250 }] } } });
  const draft = { ...makeState(), profile: { ...state.profile, weightKg: 90 } };
  const merged = mergeSettings(state, draft);
  assert.equal(merged.profile.weightKg, 90);
  assert.equal(merged.days['2026-11-09'].water.length, 1);
});

test('history counts eating after midnight inside the right calendar day', () => {
  const state = nightState();
  state.days = {
    '2026-11-08': {
      ...emptyDayLog(),
      meals: {
        first: { eatenAt: localDate('2026-11-08', '20:30').getTime(), minute: 1230 },
        late: { eatenAt: localDate('2026-11-09', '01:00').getTime(), minute: 1500 },
      },
    },
  };
  const summary = dayFastingHours(state, '2026-11-09', localDate('2026-11-10', '10:00'));
  assert.equal(summary.hours, 22.5);
  assert.equal(summary.mealsCount, 1);
});
