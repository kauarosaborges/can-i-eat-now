import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDay, fastState } from '../www/src/core/fasting.js';
import { buildReminderSchedule } from '../www/src/core/hydration.js';
import { dayFastingHours } from '../www/src/core/history.js';
import { eatMealKeepSchedule, eatMealNow, eatingChoices, emptyDayLog, logSnack, planChanges, removeSnack } from '../www/src/core/meals.js';
import { buildNotificationPlan } from '../www/src/core/notificationPlan.js';
import {
  inferSleep,
  nightMode,
  recordActivity,
  sessionFromHealthSamples,
  shouldOfferSleepConfirm,
  sleepEntryForDay,
  upsertSleepEntry,
  waterScheduleFor,
} from '../www/src/core/sleep.js';
import { createDefaultState, parseState } from '../www/src/core/storage.js';
import { eatingVerdict } from '../www/src/core/verdict.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-09';

function at(time, key = DAY) {
  return localDate(key, time);
}

function minuteOf(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function withSleep(state, sleep) {
  return { ...state, sleep: { log: [], healthEnabled: false, nightAwakeAt: null, ...sleep }, activity: state.activity || [] };
}

test('a snack does not consume a meal nor move the plan', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, DAY);
  const { dayLog, snack } = logSnack(emptyDayLog(), at('02:00'), minuteOf('02:00'));
  assert.equal(dayLog.snacks.length, 1);
  assert.deepEqual(dayLog.meals, {});
  assert.deepEqual(dayLog.adjustments, {});
  assert.equal(dayLog.windowShift, 0);
  assert.equal(removeSnack(dayLog, snack.id).dayLog.snacks.length, 0);
  assert.equal(eatingChoices({ meals: state.meals, plan, dayLog, minute: minuteOf('02:00'), toleranceMinutes: 60 }).choices.length, 0);
});

test('advancing a meal only proposes the new schedule and never applies it by itself', () => {
  const state = makeState({ fasting: { intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } } });
  const plan = classifyDay(state.fasting, DAY);
  const original = emptyDayLog();
  const choices = eatingChoices({ meals: state.meals, plan, dayLog: original, minute: minuteOf('11:40'), toleranceMinutes: 60 });
  assert.equal(choices.recommendedMealId, 'lunch');
  assert.equal(choices.choices.find((choice) => choice.mealId === 'lunch').kind, 'advance');
  const proposal = eatMealNow({ meals: state.meals, plan, dayLog: original, mealId: 'lunch', now: at('11:40'), minute: minuteOf('11:40'), toleranceMinutes: 60, minGapMinutes: 150 });
  assert.equal(planChanges(proposal), true);
  assert.deepEqual(proposal.adjustments.map((item) => [item.id, item.from, item.to]), [['snack', 960, 910], ['dinner', 1170, 1120]]);
  assert.deepEqual(original.adjustments, {});
  assert.deepEqual(original.meals, {});
  const kept = eatMealKeepSchedule({ meals: state.meals, plan, dayLog: original, mealId: 'lunch', now: at('11:40'), minute: minuteOf('11:40') });
  assert.equal(kept.ok, true);
  assert.deepEqual(kept.dayLog.adjustments, {});
  assert.equal(kept.dayLog.windowShift, 0);
  assert.equal(kept.dayLog.meals.lunch.minute, 700);
});

test('meals beyond the tolerance outside the window are offered only as snack', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, DAY);
  assert.deepEqual(eatingChoices({ meals: state.meals, plan, dayLog: emptyDayLog(), minute: minuteOf('10:30'), toleranceMinutes: 60 }).choices, []);
  const within = eatingChoices({ meals: state.meals, plan, dayLog: emptyDayLog(), minute: minuteOf('11:30'), toleranceMinutes: 60 });
  assert.equal(within.recommendedMealId, 'lunch');
  const weekend = classifyDay({ ...state.fasting, mode: 'weekdays' }, '2026-11-14');
  assert.deepEqual(eatingChoices({ meals: state.meals, plan: weekend, dayLog: emptyDayLog(), minute: 720, toleranceMinutes: 60 }).choices, []);
});

test('verdict says no for the minimum gap after any eating event', () => {
  const state = makeState();
  state.days = { [DAY]: logSnack(emptyDayLog(), at('12:00'), 720).dayLog };
  const soon = eatingVerdict(state, at('12:20'));
  assert.equal(soon.canEat, false);
  assert.equal(soon.reason, 'recentlyAte');
  assert.equal(soon.minutesSince, 20);
  assert.equal(soon.availableAt, at('14:30').getTime());
  assert.equal(soon.nextMeal.id, 'lunch');
  const beforeWindow = makeState();
  beforeWindow.days = { [DAY]: logSnack(emptyDayLog(), at('11:30'), 690).dayLog };
  const early = eatingVerdict(beforeWindow, at('11:40'));
  assert.equal(early.reason, 'recentlyAte');
  assert.equal(early.availableAt, at('14:00').getTime());
  const later = eatingVerdict(state, at('14:40'));
  assert.equal(later.canEat, true);
  const lateSnack = makeState();
  lateSnack.days = { [DAY]: logSnack(emptyDayLog(), at('18:30'), 1110).dayLog };
  const near = eatingVerdict(lateSnack, at('19:00'));
  assert.equal(near.canEat, false);
  assert.equal(near.availableAt, null);
});

test('snack at night keeps the fast and restarts its timer', () => {
  const state = makeState();
  state.days = { [DAY]: logSnack(emptyDayLog(), at('02:00'), 120).dayLog };
  const verdict = eatingVerdict(state, at('02:20'));
  assert.equal(verdict.canEat, false);
  assert.equal(verdict.reason, 'recentlyAte');
  assert.equal(verdict.availableAt, at('12:00').getTime());
  assert.equal(eatingVerdict(state, at('05:00')).reason, 'fasting');
  assert.equal(fastState(state, at('03:00')).startedAt, at('02:00').getTime());
  assert.equal(dayFastingHours(state, DAY, at('10:00', '2026-11-10')).mealsCount, 1);
});

test('night mode follows the sleep window, also across midnight', () => {
  const regular = withSleep(makeState(), {});
  assert.equal(nightMode(regular, at('02:00')).active, true);
  assert.equal(nightMode(regular, at('23:30')).active, true);
  assert.equal(nightMode(regular, at('07:30')).active, false);
  const late = withSleep(makeState(), {});
  late.profile = { ...late.profile, sleepTime: '01:00', wakeTime: '09:00' };
  assert.equal(nightMode(late, at('00:30')).active, false);
  assert.equal(nightMode(late, at('03:00')).active, true);
  const awake = withSleep(makeState(), { nightAwakeAt: at('02:00').getTime() });
  assert.deepEqual(nightMode(awake, at('02:30')), { active: true, awake: true });
  const early = withSleep(makeState(), { log: [{ sleptAt: at('23:00', '2026-11-08').getTime(), wokeAt: at('05:00').getTime(), source: 'confirmed' }] });
  assert.equal(nightMode(early, at('05:30')).active, false);
});

test('sleep is inferred from the longest night gap in app activity', () => {
  const profile = makeState().profile;
  let activity = [];
  for (const [key, time] of [['2026-11-08', '22:00'], ['2026-11-08', '23:10'], [DAY, '01:10'], [DAY, '07:40'], [DAY, '08:00']]) {
    activity = recordActivity(activity, at(time, key).getTime());
  }
  const inferred = inferSleep(activity, profile, DAY, at('08:05'));
  assert.equal(inferred.sleptAt, at('01:10').getTime());
  assert.equal(inferred.wokeAt, at('07:40').getTime());
  assert.equal(inferred.source, 'inferred');
  const fallback = inferSleep([], profile, DAY, at('08:05'));
  assert.equal(fallback.sleptAt, at('23:00', '2026-11-08').getTime());
  assert.equal(fallback.wokeAt, at('07:00').getTime());
});

test('activity log keeps three days at five minute resolution', () => {
  let activity = recordActivity([], at('08:01').getTime());
  activity = recordActivity(activity, at('08:03').getTime());
  assert.equal(activity.length, 1);
  activity = recordActivity([at('08:00', '2026-11-05').getTime(), ...activity], at('09:00').getTime());
  assert.equal(activity.length, 2);
});

test('health sleep wins over confirmed and inferred values', () => {
  const profile = makeState().profile;
  let log = upsertSleepEntry([], profile, { sleptAt: at('00:00').getTime(), wokeAt: at('07:00').getTime(), source: 'inferred' });
  log = upsertSleepEntry(log, profile, { sleptAt: at('00:30').getTime(), wokeAt: at('07:30').getTime(), source: 'confirmed' });
  assert.equal(sleepEntryForDay(log, profile, DAY).source, 'confirmed');
  log = upsertSleepEntry(log, profile, { sleptAt: at('01:10').getTime(), wokeAt: at('07:40').getTime(), source: 'health' });
  const entry = sleepEntryForDay(log, profile, DAY);
  assert.equal(entry.source, 'health');
  assert.equal(entry.wokeAt, at('07:40').getTime());
  const state = withSleep(makeState(), { log });
  assert.equal(shouldOfferSleepConfirm(state, at('08:00')), false);
  assert.equal(shouldOfferSleepConfirm(withSleep(makeState(), {}), at('08:00')), true);
  assert.equal(shouldOfferSleepConfirm(withSleep(makeState(), {}), at('04:00')), false);
});

test('health samples become one session using asleep stages', () => {
  const iso = (time, key = DAY) => at(time, key).toISOString();
  const samples = [
    { startDate: iso('23:30', '2026-11-08'), endDate: iso('01:10'), sleepState: 'inBed' },
    { startDate: iso('01:10'), endDate: iso('03:00'), sleepState: 'light' },
    { startDate: iso('03:00'), endDate: iso('03:20'), sleepState: 'awake' },
    { startDate: iso('03:30'), endDate: iso('05:00'), sleepState: 'deep' },
    { startDate: iso('05:00'), endDate: iso('07:40'), sleepState: 'rem' },
  ];
  const session = sessionFromHealthSamples(samples, at('09:00'), makeState().profile);
  assert.equal(session.sleptAt, at('01:10').getTime());
  assert.equal(session.wokeAt, at('07:40').getTime());
  assert.equal(session.source, 'health');
  assert.equal(sessionFromHealthSamples([], at('09:00'), makeState().profile), null);
});

test('confirmed wake moves the water day and keeps reminders out of the last 30 minutes before sleep', () => {
  const base = withSleep(makeState(), {});
  const planned = waterScheduleFor(base, DAY);
  assert.equal(planned.times[0], 420 + planned.intervalMinutes);
  const woke = withSleep(makeState(), { log: [{ sleptAt: at('01:00').getTime(), wokeAt: at('09:00').getTime(), source: 'confirmed' }] });
  const shifted = waterScheduleFor(woke, DAY);
  assert.equal(shifted.times[0], 540 + shifted.intervalMinutes);
  const inferredOnly = withSleep(makeState(), { log: [{ sleptAt: at('01:00').getTime(), wokeAt: at('09:00').getTime(), source: 'inferred' }] });
  assert.equal(waterScheduleFor(inferredOnly, DAY).times[0], planned.times[0]);
  const schedule = buildReminderSchedule({ goalMl: 2400, glassMl: 200, wakeTime: '07:00', sleepTime: '23:00' });
  assert.ok(schedule.times.every((minute) => minute <= 1350));
});

test('notification plan uses the actual wake for water and pauses meal alerts after eating', () => {
  const state = withSleep(makeState(), { log: [{ sleptAt: at('02:00').getTime(), wokeAt: at('10:00').getTime(), source: 'health' }] });
  state.notifications = { enabled: true, kinds: { water: true, mealAllowed: false, windowOpen: false, windowClosing: false } };
  const plan = buildNotificationPlan(state, at('10:05'), 3);
  const schedule = waterScheduleFor(state, DAY);
  assert.equal(plan[0].at.getTime(), at('10:00').getTime() + schedule.intervalMinutes * 60000);

  const meals = makeState();
  meals.notifications = { enabled: true, kinds: { water: false, mealAllowed: true, windowOpen: false, windowClosing: false } };
  meals.days = { [DAY]: logSnack(emptyDayLog(), at('12:15'), 735).dayLog };
  const names = buildNotificationPlan(meals, at('12:20'), 8).map((item) => item.params.name);
  assert.deepEqual(names, ['Snack', 'Dinner']);
});

test('schema version 1 migrates to the current version keeping data', () => {
  const now = at('10:00');
  const defaults = createDefaultState(now, MEAL_NAMES);
  const raw = JSON.stringify({ version: 1, onboarded: true, profile: { weightKg: 82 }, days: { [DAY]: { water: [{ id: 'w-1', at: 1, ml: 300 }] } } });
  const state = parseState(raw, defaults, now);
  assert.equal(state.version, 4);
  assert.equal(state.onboarded, true);
  assert.equal(state.profile.weightKg, 82);
  assert.equal(state.days[DAY].water[0].ml, 300);
  assert.deepEqual(state.days[DAY].snacks, []);
  assert.deepEqual(state.sleep, { log: [], healthEnabled: false, nightAwakeAt: null });
  assert.deepEqual(state.activity, []);
});
