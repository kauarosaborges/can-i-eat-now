import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreNightEntries, sessionFromHealthSamples, upsertSleepEntry, removeNightEntries, sameDetail, vitalsInWindow } from '../www/src/core/sleep.js';
import {
  durationScore,
  heartAdjustment,
  interruptionsScore,
  lastNightKey,
  nightEntry,
  nightTone,
  regularityFor,
  scoreLabel,
  scoreNight,
  sleepGoalMinutes,
  sleepOverview,
  stagesScore,
} from '../www/src/core/sleepQuality.js';
import { addDaysToKey } from '../www/src/core/time.js';
import { localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-09';
const PREVIOUS = '2026-11-08';

function at(time, key = DAY) {
  return localDate(key, time);
}

function iso(time, key = DAY) {
  return at(time, key).toISOString();
}

function night(key, slept, woke, extra = {}) {
  const sleptKey = Number(slept.slice(0, 2)) < 12 ? key : addDaysToKey(key, -1);
  return { wakeKey: key, sleptAt: at(slept, sleptKey).getTime(), wokeAt: at(woke, key).getTime(), source: 'confirmed', kind: 'night', ...extra };
}

function withLog(log, energyDays = {}) {
  const state = makeState();
  state.sleep = { log, healthEnabled: false, nightAwakeAt: null };
  state.energy = { days: energyDays };
  return state;
}

test('sleep goal comes from the planned sleep and wake times, clamped', () => {
  assert.equal(sleepGoalMinutes({ sleepTime: '23:00', wakeTime: '07:00' }), 480);
  assert.equal(sleepGoalMinutes({ sleepTime: '22:30', wakeTime: '06:00' }), 450);
  assert.equal(sleepGoalMinutes({ sleepTime: '02:00', wakeTime: '05:00' }), 300);
  assert.equal(sleepGoalMinutes({ sleepTime: '07:00', wakeTime: '07:00' }), 480);
});

test('component scores behave at the edges', () => {
  assert.equal(durationScore(480, 480), 100);
  assert.equal(durationScore(600, 480), 100);
  assert.equal(durationScore(192, 480), 0);
  assert.equal(durationScore(360, 480), 58);
  assert.ok(durationScore(800, 480) >= 70 && durationScore(800, 480) < 100);
  assert.equal(interruptionsScore(null), null);
  assert.equal(interruptionsScore({ awake: 5, awakenings: 1, awakeKnown: true }), 100);
  assert.equal(interruptionsScore({ awake: 30, awakenings: 4, awakeKnown: true }), 58);
  assert.equal(interruptionsScore({ awake: 0, awakenings: 0, awakeKnown: false }), null);
  assert.equal(interruptionsScore({ awake: 0, awakenings: 0 }), null);
  assert.equal(stagesScore({ asleep: 400, deep: 0, rem: 0, core: 0 }), null);
  assert.equal(stagesScore({ deep: 70, rem: 90, core: 240 }), 100);
  assert.equal(stagesScore({ deep: 20, rem: 40, core: 340 }), 42);
  assert.equal(scoreLabel(80), 'good');
  assert.equal(scoreLabel(60), 'fair');
  assert.equal(scoreLabel(59), 'poor');
});

test('a full manual night without detail is re-weighted instead of penalized', () => {
  const state = withLog([night(DAY, '23:00', '07:00')]);
  const result = scoreNight(state, DAY);
  assert.equal(result.score, 100);
  assert.equal(result.label, 'good');
  assert.equal(result.components.interruptions, null);
  assert.equal(result.components.stages, null);
  assert.equal(result.components.regularity, null);
  assert.equal(result.weakest, null);
});

test('short sleep is the weakest factor and drags the label down', () => {
  const state = withLog([night(DAY, '02:00', '07:00')]);
  const result = scoreNight(state, DAY);
  assert.equal(result.minutes, 300);
  assert.equal(result.weakest, 'duration');
  assert.equal(result.label, 'poor');
});

test('stages and interruptions count when Health detail exists', () => {
  const detail = { asleep: 450, awake: 40, deep: 20, rem: 40, core: 390, awakenings: 6, awakeKnown: true };
  const state = withLog([night(DAY, '23:00', '07:10', { source: 'health', detail })]);
  const result = scoreNight(state, DAY);
  assert.equal(result.minutes, 450);
  assert.equal(result.basis, 'asleep');
  assert.equal(result.target, 432);
  assert.equal(result.components.duration, 100);
  assert.equal(result.components.interruptions, 31);
  assert.ok(result.components.stages < 60);
  assert.equal(result.weakest, 'interruptions');
  assert.ok(result.score < 80);
});

test('regularity needs three nights and drops with scattered bedtimes', () => {
  const steady = [night(DAY, '23:00', '07:00'), night(PREVIOUS, '23:10', '07:05'), night('2026-11-07', '22:50', '06:55')];
  const result = regularityFor(withLog(steady), DAY);
  assert.equal(result.nights, 3);
  assert.equal(result.score, 100);
  assert.equal(regularityFor(withLog(steady.slice(0, 2)), DAY), null);
  const scattered = [night(DAY, '23:00', '07:00'), night(PREVIOUS, '01:30', '09:30'), night('2026-11-07', '21:00', '05:30')];
  const messy = regularityFor(withLog(scattered), DAY);
  assert.ok(messy.score < 40);
  assert.equal(scoreNight(withLog(scattered), DAY).weakest, 'regularity');
});

test('night vitals from the sleep window nudge the score only a little and only with a baseline', () => {
  const base = { asleep: 430, awake: 10, deep: 0, rem: 0, core: 0, awakenings: 1, awakeKnown: true };
  const log = [];
  for (let offset = 1; offset <= 5; offset += 1) log.push(night(addDaysToKey(DAY, -offset), '23:00', '07:00', { source: 'health', detail: { ...base, hr: 54, hrv: 50, resp: 14 } }));
  log.push(night(DAY, '23:00', '07:00', { source: 'health', detail: { ...base, hr: 64, hrv: 35, resp: 16 } }));
  const state = withLog(log);
  const adjust = heartAdjustment(state, DAY);
  assert.equal(adjust.points, -5);
  assert.deepEqual(adjust.effects.map((effect) => effect.metric), ['hr', 'hrv', 'resp']);
  assert.equal(heartAdjustment(withLog([night(DAY, '23:00', '07:00', { source: 'health', detail: { ...base, hr: 70 } })]), DAY), null);
  const result = scoreNight(state, DAY);
  assert.equal(result.weakest, 'heart');
  assert.ok(result.score >= 90);
});

test('daily heart data of a partial day never changes the score of a finished night', () => {
  const log = [night(DAY, '23:00', '07:00')];
  const before = scoreNight(withLog(log), DAY).score;
  const days = {};
  for (let offset = 0; offset <= 5; offset += 1) days[addDaysToKey(DAY, -offset)] = { restingHr: offset === 0 ? 80 : 55, hrv: offset === 0 ? 20 : 60 };
  assert.equal(scoreNight(withLog(log, days), DAY).score, before);
});

test('in bed nights are compared to the full goal and asleep nights to 90 percent of it', () => {
  const inBed = scoreNight(withLog([night(DAY, '23:00', '06:12')]), DAY);
  assert.equal(inBed.basis, 'inBed');
  assert.equal(inBed.target, 480);
  assert.equal(inBed.minutes, 432);
  const asleep = scoreNight(withLog([night(DAY, '23:00', '07:00', { source: 'health', detail: { asleep: 432, awake: 20, deep: 0, rem: 0, core: 0, awakenings: 1, awakeKnown: true } })]), DAY);
  assert.equal(asleep.target, 432);
  assert.equal(asleep.components.duration, 100);
  assert.ok(inBed.components.duration < asleep.components.duration);
});

test('an asleep only night without awake data leaves interruptions out', () => {
  const profile = makeState().profile;
  const session = sessionFromHealthSamples([{ startDate: iso('00:00'), endDate: iso('07:00'), sleepState: 'asleep' }], at('09:00'), profile, DAY);
  assert.equal(session.detail.awakeKnown, false);
  const state = withLog(upsertSleepEntry([], profile, session));
  assert.equal(scoreNight(state, DAY).components.interruptions, null);
});

test('awake samples from another source are subtracted from asleep and stages', () => {
  const profile = makeState().profile;
  const samples = [
    { startDate: iso('00:00'), endDate: iso('07:00'), sleepState: 'asleep' },
    { startDate: iso('00:00'), endDate: iso('04:00'), sleepState: 'light' },
    { startDate: iso('02:00'), endDate: iso('03:00'), sleepState: 'awake' },
  ];
  const session = sessionFromHealthSamples(samples, at('09:00'), profile, DAY);
  assert.equal(session.detail.asleep, 360);
  assert.equal(session.detail.awake, 60);
  assert.equal(session.detail.core, 180);
  assert.equal(session.detail.awakeKnown, true);
});

test('night vitals average only samples inside the session window', () => {
  const sleptAt = at('00:00').getTime();
  const wokeAt = at('07:00').getTime();
  const samples = [
    { endDate: iso('01:00'), value: 50 },
    { endDate: iso('05:00'), value: 60 },
    { endDate: iso('12:00'), value: 120 },
    { endDate: iso('03:00'), value: Infinity },
  ];
  assert.equal(vitalsInWindow(samples, sleptAt, wokeAt), 55);
  assert.equal(vitalsInWindow([], sleptAt, wokeAt), null);
});

test('old nights stay after the wake time changes in settings', () => {
  const state = withLog([night(DAY, '23:00', '07:00'), night(PREVIOUS, '23:00', '06:30')]);
  state.profile = { ...state.profile, wakeTime: '11:00', sleepTime: '02:00' };
  assert.ok(nightEntry(state, DAY));
  assert.ok(nightEntry(state, PREVIOUS));
});

test('undo of a deleted night never overwrites an edit made after', () => {
  const profile = makeState().profile;
  const original = night(DAY, '23:00', '07:00');
  const edited = night(DAY, '22:00', '06:00');
  const restored = restoreNightEntries([edited], profile, DAY, [original]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].sleptAt, edited.sleptAt);
  assert.equal(restoreNightEntries([], profile, DAY, [original]).length, 1);
});

test('chart tones are calm: near goal and a bit under share the sleep color, only far under is orange', () => {
  const item = (minutes) => ({ entry: {}, awake: false, minutes, target: 480 });
  assert.equal(nightTone(item(470)), 'sleep');
  assert.equal(nightTone(item(400)), 'sleep-soft');
  assert.equal(nightTone(item(300)), 'off');
  assert.equal(nightTone({ entry: null }), 'empty');
});

test('a no sleep night has no score and overview ignores it in averages', () => {
  const state = withLog([night(DAY, '23:00', '07:00', { kind: 'awake' }), night(PREVIOUS, '23:30', '06:30')]);
  const result = scoreNight(state, DAY);
  assert.equal(result.awake, true);
  assert.equal(result.score, null);
  const overview = sleepOverview(state, at('12:00'), 7);
  assert.equal(overview.nights, 1);
  assert.equal(overview.averageMinutes, 420);
  assert.equal(overview.averageBedMinute, 23 * 60 + 30);
  assert.equal(overview.averageWakeMinute, 6 * 60 + 30);
  assert.equal(overview.series.length, 7);
});

test('average bedtime handles nights around midnight', () => {
  const state = withLog([night(DAY, '23:30', '07:00'), night(PREVIOUS, '00:30', '07:00')]);
  assert.equal(sleepOverview(state, at('12:00'), 7).averageBedMinute, 0);
});

test('last night key switches to today in the morning', () => {
  const state = withLog([]);
  assert.equal(lastNightKey(state, at('02:00')), PREVIOUS);
  assert.equal(lastNightKey(state, at('05:00')), DAY);
  assert.equal(lastNightKey(withLog([night(DAY, '22:00', '04:10')]), at('04:15')), DAY);
});

test('health sessions keep stage totals and awakenings without changing session bounds', () => {
  const profile = makeState().profile;
  const samples = [
    { startDate: iso('23:00', PREVIOUS), endDate: iso('07:00'), sleepState: 'inBed' },
    { startDate: iso('23:10', PREVIOUS), endDate: iso('01:00'), sleepState: 'light' },
    { startDate: iso('01:00'), endDate: iso('02:00'), sleepState: 'deep' },
    { startDate: iso('02:00'), endDate: iso('02:10'), sleepState: 'awake' },
    { startDate: iso('02:10'), endDate: iso('04:00'), sleepState: 'rem' },
    { startDate: iso('04:00'), endDate: iso('04:00'), sleepState: 'awake' },
    { startDate: iso('04:00'), endDate: iso('06:50'), sleepState: 'light' },
  ];
  const session = sessionFromHealthSamples(samples, at('09:00'), profile, DAY);
  assert.equal(session.sleptAt, at('23:10', PREVIOUS).getTime());
  assert.equal(session.wokeAt, at('06:50').getTime());
  assert.deepEqual(session.detail, { asleep: 450, awake: 10, deep: 60, rem: 110, core: 280, awakenings: 1, awakeKnown: true });
  const log = upsertSleepEntry([], profile, session);
  assert.deepEqual(log[0].detail, session.detail);
  assert.equal(sameDetail(log[0].detail, session.detail), true);
  assert.equal(sameDetail(null, session.detail), false);
});

test('sessions without stage data count gaps as awakenings and inBed only has no detail', () => {
  const profile = makeState().profile;
  const asleep = [
    { startDate: iso('23:00', PREVIOUS), endDate: iso('02:00'), sleepState: 'asleep' },
    { startDate: iso('02:20'), endDate: iso('07:00'), sleepState: 'asleep' },
  ];
  const session = sessionFromHealthSamples(asleep, at('09:00'), profile, DAY);
  assert.deepEqual(session.detail, { asleep: 460, awake: 20, deep: 0, rem: 0, core: 0, awakenings: 1, awakeKnown: true });
  const inBed = sessionFromHealthSamples([{ startDate: iso('23:00', PREVIOUS), endDate: iso('07:00'), sleepState: 'inBed' }], at('09:00'), profile, DAY);
  assert.equal(inBed.detail, undefined);
});

test('removing a night keeps Health entries and other nights', () => {
  const profile = makeState().profile;
  const log = [night(DAY, '23:00', '07:00'), night(DAY, '23:00', '07:00', { source: 'health' }), night(PREVIOUS, '23:00', '07:00')];
  const next = removeNightEntries(log, profile, DAY);
  assert.equal(next.length, 2);
  assert.ok(next.some((entry) => entry.source === 'health' && entry.wakeKey === DAY));
  assert.ok(next.some((entry) => entry.wakeKey === PREVIOUS));
});
