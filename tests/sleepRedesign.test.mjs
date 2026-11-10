import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDay } from '../www/src/core/fasting.js';
import { eatMealNow, eatingChoices, emptyDayLog, logSnack, proposalSignature } from '../www/src/core/meals.js';
import {
  actualWakeMinute,
  awakeNightEntry,
  inferSleep,
  isValidDayWake,
  nightMode,
  removeHealthEntries,
  sessionFromHealthSamples,
  sleepEntryForDay,
  upsertSleepEntry,
  waterScheduleFor,
} from '../www/src/core/sleep.js';
import { createDefaultState, parseState } from '../www/src/core/storage.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-09';
const PREVIOUS = '2026-11-08';

function at(time, key = DAY) {
  return localDate(key, time);
}

function iso(time, key = DAY) {
  return at(time, key).toISOString();
}

function sleepState(log = [], extra = {}) {
  const state = makeState();
  state.sleep = { log, healthEnabled: false, nightAwakeAt: null, ...extra };
  return state;
}

test('a wake only counts inside the plausible morning window', () => {
  const profile = makeState().profile;
  assert.equal(isValidDayWake(profile, DAY, at('04:00').getTime()), true);
  assert.equal(isValidDayWake(profile, DAY, at('13:00').getTime()), true);
  assert.equal(isValidDayWake(profile, DAY, at('03:30').getTime()), false);
  assert.equal(isValidDayWake(profile, DAY, at('15:00').getTime()), false);
  const nap = upsertSleepEntry([], profile, { sleptAt: at('14:00').getTime(), wokeAt: at('15:30').getTime(), source: 'health' });
  assert.deepEqual(nap, []);
  const partial = sleepState([{ sleptAt: at('23:00', PREVIOUS).getTime(), wokeAt: at('02:30').getTime(), source: 'confirmed' }]);
  assert.equal(actualWakeMinute(partial, DAY), null);
  assert.equal(nightMode(partial, at('03:00')).active, true);
});

test('late wakers keep their entry for the right night', () => {
  const profile = makeState().profile;
  const log = upsertSleepEntry([], profile, { sleptAt: at('03:00').getTime(), wokeAt: at('12:30').getTime(), source: 'confirmed' });
  assert.equal(log[0].wakeKey, DAY);
  assert.equal(sleepEntryForDay(log, profile, DAY).wokeAt, at('12:30').getTime());
  assert.equal(sleepEntryForDay(log, profile, '2026-11-10'), null);
  const stale = [{ wakeKey: DAY, sleptAt: at('20:00', '2026-11-07').getTime(), wokeAt: at('21:00', PREVIOUS).getTime(), source: 'confirmed', kind: 'night' }];
  assert.equal(sleepEntryForDay(stale, profile, DAY), null);
});

test('health picks the longest merged night session and ignores naps, partial and fresh sessions', () => {
  const profile = makeState().profile;
  const samples = [
    { startDate: iso('14:00', PREVIOUS), endDate: iso('15:00', PREVIOUS), sleepState: 'asleep' },
    { startDate: iso('23:00', PREVIOUS), endDate: iso('01:30'), sleepState: 'light' },
    { startDate: iso('02:30'), endDate: iso('07:00'), sleepState: 'deep' },
  ].reverse();
  const session = sessionFromHealthSamples(samples, at('09:00'), profile, DAY);
  assert.equal(session.sleptAt, at('23:00', PREVIOUS).getTime());
  assert.equal(session.wokeAt, at('07:00').getTime());
  assert.equal(session.wakeKey, DAY);
  const partial = sessionFromHealthSamples([{ startDate: iso('23:00', PREVIOUS), endDate: iso('02:30'), sleepState: 'asleep' }], at('03:30'), profile, DAY);
  assert.equal(partial, null);
  const fresh = sessionFromHealthSamples([{ startDate: iso('23:00', PREVIOUS), endDate: iso('06:50'), sleepState: 'asleep' }], at('07:00'), profile, DAY);
  assert.equal(fresh, null);
});

test('night mode ends only with the valid day wake and night awake resets each night', () => {
  const woke = sleepState([{ wakeKey: DAY, sleptAt: at('23:30', PREVIOUS).getTime(), wokeAt: at('05:00').getTime(), source: 'confirmed', kind: 'night' }]);
  assert.equal(nightMode(woke, at('05:30')).active, false);
  const yesterday = sleepState([{ wakeKey: PREVIOUS, sleptAt: at('23:30', '2026-11-07').getTime(), wokeAt: at('07:00', PREVIOUS).getTime(), source: 'confirmed', kind: 'night' }]);
  assert.equal(nightMode(yesterday, at('02:00')).active, true);
  const oldAwake = sleepState([], { nightAwakeAt: at('02:00', PREVIOUS).getTime() });
  assert.deepEqual(nightMode(oldAwake, at('01:00')), { active: true, awake: false });
  const thisNight = sleepState([], { nightAwakeAt: at('00:30').getTime() });
  assert.deepEqual(nightMode(thisNight, at('01:00')), { active: true, awake: true });
});

test('inference sums broken night gaps', () => {
  const profile = makeState().profile;
  const activity = ['23:20', '01:00', '01:10', '03:00', '03:05', '05:00', '07:15'].map((time, index) => at(time, index === 0 ? PREVIOUS : DAY).getTime());
  const result = inferSleep(activity, profile, DAY, at('08:00'));
  assert.equal(result.sleptAt, at('23:20', PREVIOUS).getTime());
  assert.equal(result.wokeAt, at('07:15').getTime());
  const awake = ['22:00', '22:40', '23:20', '00:00', '00:40', '01:20', '02:00', '02:40', '03:20', '04:00', '04:40', '05:20', '06:00', '06:40', '07:20'];
  const busy = awake.map((time) => at(time, time >= '12:00' ? PREVIOUS : DAY).getTime());
  const fallback = inferSleep(busy, profile, DAY, at('08:00'));
  assert.equal(fallback.wokeAt, at('07:00').getTime());
});

test('no sleep keeps the planned water day and does not shift the wake', () => {
  const profile = makeState().profile;
  const log = upsertSleepEntry([], profile, awakeNightEntry(profile, DAY), at('08:00').getTime());
  const state = sleepState(log);
  assert.equal(actualWakeMinute(state, DAY), null);
  assert.equal(waterScheduleFor(state, DAY).times[0], waterScheduleFor(sleepState(), DAY).times[0]);
  assert.equal(sleepEntryForDay(log, profile, DAY).kind, 'awake');
});

test('sleep entries older than 30 days are dropped on upsert and on load', () => {
  const profile = makeState().profile;
  const old = { wakeKey: '2026-09-01', sleptAt: at('23:00', '2026-08-31').getTime(), wokeAt: at('07:00', '2026-09-01').getTime(), source: 'confirmed', kind: 'night' };
  const log = upsertSleepEntry([old], profile, { sleptAt: at('23:00', PREVIOUS).getTime(), wokeAt: at('07:00').getTime(), source: 'confirmed' }, at('08:00').getTime());
  assert.equal(log.length, 1);
  const now = at('08:00');
  const raw = JSON.stringify({ version: 2, sleep: { log: [old, { ...old, wakeKey: DAY, sleptAt: at('23:00', PREVIOUS).getTime(), wokeAt: at('07:00').getTime() }] } });
  const state = parseState(raw, createDefaultState(now, MEAL_NAMES), now);
  assert.equal(state.sleep.log.length, 1);
  assert.equal(state.sleep.log[0].wakeKey, DAY);
});

test('turning health off removes only health entries', () => {
  const log = [
    { wakeKey: DAY, sleptAt: 1, wokeAt: 2, source: 'health', kind: 'night' },
    { wakeKey: DAY, sleptAt: 1, wokeAt: 2, source: 'confirmed', kind: 'night' },
  ];
  assert.deepEqual(removeHealthEntries(log).map((entry) => entry.source), ['confirmed']);
});

test('eating choices warn about recent eating but still offer everything', () => {
  const state = makeState({ fasting: { intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } } });
  const plan = classifyDay(state.fasting, DAY);
  const { dayLog } = logSnack(emptyDayLog(), at('11:30'), 690);
  const choices = eatingChoices({ meals: state.meals, plan, dayLog, minute: 700, toleranceMinutes: 60, now: at('11:40'), lastEatingAt: at('11:30').getTime(), minGapMinutes: 150 });
  assert.equal(choices.recentMinutes, 10);
  assert.ok(choices.choices.some((choice) => choice.mealId === 'lunch'));
  const later = eatingChoices({ meals: state.meals, plan, dayLog, minute: 900, toleranceMinutes: 60, now: at('15:00'), lastEatingAt: at('11:30').getTime(), minGapMinutes: 150 });
  assert.equal(later.recentMinutes, null);
});

test('proposal signature detects a plan that changed before confirm', () => {
  const state = makeState({ fasting: { intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } } });
  const plan = classifyDay(state.fasting, DAY);
  const input = { meals: state.meals, plan, mealId: 'lunch', toleranceMinutes: 60, minGapMinutes: 150 };
  const shown = eatMealNow({ ...input, dayLog: emptyDayLog(), now: at('11:40'), minute: 700 });
  const same = eatMealNow({ ...input, dayLog: emptyDayLog(), now: at('11:40'), minute: 700 });
  assert.equal(proposalSignature(shown), proposalSignature(same));
  const later = eatMealNow({ ...input, dayLog: emptyDayLog(), now: at('11:55'), minute: 715 });
  assert.notEqual(proposalSignature(shown), proposalSignature(later));
  const changedDay = { ...emptyDayLog(), skips: { snack: 'user' } };
  const withSkip = eatMealNow({ ...input, dayLog: changedDay, now: at('11:40'), minute: 700 });
  assert.notEqual(proposalSignature(shown), proposalSignature(withSkip));
});
