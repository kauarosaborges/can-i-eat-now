import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyFromSamples,
  dayChunks,
  mergeHealthSync,
  missingHealthTypes,
  requiredHealthTypes,
  stripHealthGroup,
  syncStartDate,
  withRequestedTypes,
} from '../www/src/core/healthMerge.js';
import { expenditureForDay } from '../www/src/core/energy.js';
import { activeTabId, resolveRoute, routeIdFromHash, tabIndexOf, tabRoutes } from '../www/src/core/navigation.js';
import { createDefaultState, parseState, sanitizeSleepDetail, sanitizeState } from '../www/src/core/storage.js';
import { buildSummary, dailyMetric } from '../www/src/core/summary.js';
import { addDaysToKey } from '../www/src/core/time.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-09';
const now = localDate(DAY, '10:00');
const defaults = () => createDefaultState(now, MEAL_NAMES);

test('v3 state migrates to v4 marking the old types as already requested', () => {
  const raw = JSON.stringify({ version: 3, onboarded: true, health: { body: false, activity: true, nutrition: false, writeWeight: false }, energy: { days: { [DAY]: { steps: 4000 } } } });
  const state = parseState(raw, defaults(), now);
  assert.equal(state.version, 4);
  assert.equal(state.health.heart, false);
  assert.ok(state.health.requested.includes('steps'));
  assert.ok(!state.health.requested.includes('distance'));
  assert.deepEqual(missingHealthTypes(state.health), ['distance', 'flightsClimbed']);
  assert.equal(state.energy.days[DAY].steps, 4000);
  assert.equal(state.energy.days[DAY].restingHr, null);
});

test('new energy fields and sleep detail are sanitized on load', () => {
  const raw = JSON.stringify({
    version: 4,
    health: { heart: true, requested: ['heartRate', 'nope', 'heartRate'] },
    energy: {
      days: {
        [DAY]: { distanceM: 5234.6, flights: 12, restingHr: 300, avgHr: 72.4, hrv: 45.2, respiratory: 14.56 },
        '2025-01-01': { restingHr: 60 },
      },
    },
    sleep: {
      log: [
        { wakeKey: DAY, sleptAt: localDate('2026-11-08', '23:00').getTime(), wokeAt: localDate(DAY, '07:00').getTime(), source: 'health', kind: 'night', detail: { asleep: 450, awake: -3, deep: 'x', rem: 90, core: 9999, awakenings: 2.4, awakeKnown: 'yes', hr: 999, hrv: 48.4, resp: 14.44 } },
        { wakeKey: DAY, sleptAt: localDate('2026-11-08', '23:00').getTime(), wokeAt: localDate(DAY, '07:00').getTime(), source: 'confirmed', kind: 'awake', detail: { asleep: 400 } },
      ],
    },
  });
  const state = parseState(raw, defaults(), now);
  assert.deepEqual(state.health.requested, ['heartRate']);
  assert.equal(state.health.heart, true);
  const day = state.energy.days[DAY];
  assert.equal(day.distanceM, 5235);
  assert.equal(day.flights, 12);
  assert.equal(day.restingHr, null);
  assert.equal(day.avgHr, 72);
  assert.equal(day.hrv, 45);
  assert.equal(day.respiratory, 14.6);
  assert.equal(state.energy.days['2025-01-01'], undefined);
  assert.deepEqual(state.sleep.log[0].detail, { asleep: 450, awake: 0, deep: 0, rem: 90, core: 0, awakenings: 2, awakeKnown: false, hrv: 48, resp: 14.4 });
  assert.equal(sanitizeSleepDetail({ asleep: 500, deep: 0, rem: 0, core: 0 }, 480), null);
  assert.equal(sanitizeSleepDetail({ asleep: 300, deep: 200, rem: 200, core: 0 }, 480), null);
  assert.equal(state.sleep.log[1].detail, undefined);
  assert.equal(sanitizeSleepDetail({ asleep: 0 }), null);
  assert.equal(sanitizeSleepDetail('x'), null);
});

test('required and missing types follow enabled groups and requested list', () => {
  const health = { body: false, activity: false, nutrition: false, heart: true, requested: [] };
  assert.deepEqual(requiredHealthTypes(health), ['restingHeartRate', 'heartRate', 'heartRateVariability', 'respiratoryRate']);
  const granted = withRequestedTypes(health, requiredHealthTypes(health));
  assert.deepEqual(missingHealthTypes(granted), []);
  assert.deepEqual(withRequestedTypes(health, ['bogus']).requested, []);
});

test('heart fields merge only when the heart group is on and strip with it', () => {
  const state = makeState({ health: { body: false, activity: true, nutrition: false, heart: false, writeWeight: false, requested: [] }, energy: { days: {} } });
  const snapshot = { days: { [DAY]: { steps: 5000, distanceM: 3000, flights: 4, restingHr: 60, hrv: 40 } } };
  const merged = mergeHealthSync(state, snapshot);
  assert.equal(merged.energy.days[DAY].steps, 5000);
  assert.equal(merged.energy.days[DAY].distanceM, 3000);
  assert.equal(merged.energy.days[DAY].restingHr, null);
  const withHeart = mergeHealthSync({ ...state, health: { ...state.health, heart: true } }, snapshot);
  assert.equal(withHeart.energy.days[DAY].restingHr, 60);
  const stripped = stripHealthGroup(withHeart, 'heart');
  assert.equal(stripped.energy.days[DAY].restingHr, null);
  assert.equal(stripped.energy.days[DAY].hrv, null);
  assert.equal(stripped.energy.days[DAY].steps, 5000);
  const noActivity = stripHealthGroup(withHeart, 'activity');
  assert.equal(noActivity.energy.days[DAY].flights, null);
  assert.equal(noActivity.energy.days[DAY].restingHr, 60);
});

test('samples bucket by local day, average or sum, and drop a truncated oldest day', () => {
  const samples = [
    { startDate: localDate(DAY, '08:00').toISOString(), value: 40 },
    { startDate: localDate(DAY, '23:30').toISOString(), value: 50 },
    { startDate: localDate('2026-11-08', '03:00').toISOString(), value: 14.44 },
    { startDate: localDate('2026-11-07', '03:00').toISOString(), value: 2 },
    { startDate: 'bad', value: 3 },
    { startDate: localDate(DAY, '09:00').toISOString(), value: -1 },
  ];
  assert.deepEqual(dailyFromSamples(samples, 'average'), { [DAY]: 45, '2026-11-08': 14, '2026-11-07': 2 });
  const night = [{ startDate: localDate('2026-11-08', '23:30').toISOString(), endDate: localDate(DAY, '02:00').toISOString(), value: 40 }];
  assert.deepEqual(dailyFromSamples(night, 'average', { keyBy: 'end' }), { [DAY]: 40 });
  assert.deepEqual(dailyFromSamples(samples, 'average', { decimals: 1 })['2026-11-08'], 14.4);
  assert.deepEqual(dailyFromSamples(samples, 'sum', { truncated: true }), { [DAY]: 90, '2026-11-08': 14 });
});

test('tab config keeps history out of the bar and maps it to Hoje', () => {
  assert.deepEqual(tabRoutes().map((route) => route.id), ['today', 'water', 'sleep', 'body', 'settings']);
  assert.equal(resolveRoute('#/history').id, 'history');
  assert.equal(resolveRoute('#/sleep').id, 'sleep');
  assert.equal(resolveRoute('#/nope').id, 'today');
  assert.equal(resolveRoute('').id, 'today');
  assert.equal(routeIdFromHash('#/body?x=1'), 'body');
  assert.equal(activeTabId(resolveRoute('#/history')), 'today');
  assert.equal(tabIndexOf(resolveRoute('#/history')), 0);
  assert.equal(tabIndexOf(resolveRoute('#/settings')), 4);
  const custom = [{ id: 'a', tab: true }, { id: 'b', tab: false, parent: 'missing' }];
  assert.equal(activeTabId(custom[1], custom), null);
  assert.equal(tabIndexOf(custom[1], custom), -1);
});

test('summary metrics expose latest value, 7 day series and hide when empty', () => {
  const days = {};
  for (let offset = 1; offset <= 3; offset += 1) days[addDaysToKey(DAY, -offset)] = { steps: 6000 + offset * 1000 };
  const state = makeState({ energy: { days } });
  const steps = dailyMetric(state, now, 'steps');
  assert.equal(steps.series.length, 7);
  assert.equal(steps.latest.key, addDaysToKey(DAY, -1));
  assert.equal(steps.latest.daysAgo, 1);
  assert.equal(steps.average, 8000);
  assert.equal(dailyMetric(state, now, 'hrv'), null);
  const summary = buildSummary(state, now);
  assert.equal(summary.hrv, null);
  assert.equal(summary.water.series.length, 7);
  assert.equal(summary.weight.logged, false);
  assert.equal(summary.sleep.hasAny, false);
  assert.equal(summary.history.entries.length, 7);
});

test('summed samples use the best single source per day, never iPhone plus Watch', () => {
  const at = (time) => localDate(DAY, time).toISOString();
  const samples = [
    { startDate: at('08:00'), value: 3, sourceName: 'iPhone' },
    { startDate: at('12:00'), value: 2, sourceName: 'iPhone' },
    { startDate: at('08:00'), value: 4, sourceName: 'Watch' },
    { startDate: at('12:00'), value: 2, sourceName: 'Watch' },
    { startDate: localDate('2026-11-08', '09:00').toISOString(), value: 1500, sourceId: 'com.apple.health.watch' },
    { startDate: localDate('2026-11-08', '21:00').toISOString(), value: 100, sourceId: 'com.apple.health.phone' },
  ];
  assert.deepEqual(dailyFromSamples(samples, 'sum'), { [DAY]: 6, '2026-11-08': 1500 });
  assert.deepEqual(dailyFromSamples([{ startDate: at('08:00'), value: 1e308 }], 'sum', { decimals: 1 }), {});
});

test('sync window starts at local midnight so the oldest day is complete', () => {
  const start = syncStartDate(localDate(DAY, '15:42'), 30);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getDate(), 10);
  const chunks = dayChunks(localDate(DAY, '15:42'), 30, 7);
  assert.equal(chunks[0].start.getTime(), start.getTime());
  assert.equal(chunks[chunks.length - 1].end.getTime(), localDate(DAY, '15:42').getTime());
  for (let index = 1; index < chunks.length; index += 1) assert.equal(chunks[index].start.getTime(), chunks[index - 1].end.getTime());
});

test('saving a merged sync runs the sanitizer, so ranges, overflow and retention apply on save too', () => {
  const state = makeState({ health: { body: false, activity: true, nutrition: false, heart: true, writeWeight: false, requested: [] }, energy: { days: { '2025-01-01': { steps: 10 } } } });
  const merged = mergeHealthSync(state, { days: { [DAY]: { steps: Infinity, restingHr: 1e9, hrv: 40, workouts: [{ type: 'run<script>', kcal: 'x', minutes: 1e9 }] } } });
  const saved = sanitizeState(merged, defaults(), now);
  assert.equal(saved.energy.days[DAY].steps, null);
  assert.equal(saved.energy.days[DAY].restingHr, null);
  assert.equal(saved.energy.days[DAY].hrv, 40);
  assert.equal(saved.energy.days[DAY].workouts[0].type, 'runscript');
  assert.equal(saved.energy.days[DAY].workouts[0].kcal, null);
  assert.equal(saved.energy.days['2025-01-01'], undefined);
});

test('the weight forecast uses real basal from Health when present and the estimate otherwise', () => {
  const key = '2026-11-08';
  const withBasal = makeState({ health: { body: false, activity: true, nutrition: false, heart: false, writeWeight: false, requested: [] }, energy: { days: { [key]: { basal: 1650, active: 450 } } } });
  const real = expenditureForDay(withBasal, key, now);
  assert.equal(real.source, 'health');
  assert.equal(real.basal, 1650);
  assert.equal(real.total, 2100);
  const estimate = expenditureForDay(makeState({ energy: { days: {} } }), key, now);
  assert.equal(estimate.source, 'estimate');
});

test('summary shows six cards, folds the rest and never leaves an orphan half card', async () => {
  const { summaryLayout } = await import('../www/src/ui/components/summaryGrid.js');
  const cards = Array.from({ length: 9 }, (_, index) => ({ id: `c${index}` }));
  const folded = summaryLayout(cards, false);
  assert.equal(folded.visible.length, 6);
  assert.equal(folded.hidden, 3);
  assert.equal(folded.toggle, true);
  assert.equal(folded.visible.some((item) => item.wide), false);
  const open = summaryLayout(cards, true);
  assert.equal(open.visible.length, 9);
  assert.equal(open.visible[8].wide, true);
  assert.equal(summaryLayout(cards.slice(0, 3), false).toggle, false);
});

test('registering a night before the planned wake never defaults to a future time', async () => {
  const { defaultNightTimes, sleepTimesFromInputs, validateSleepTimes } = await import('../www/src/ui/components/sleepEntrySheet.js');
  const profile = makeState().profile;
  const early = localDate(DAY, '05:32').getTime();
  const times = defaultNightTimes(profile, DAY, early);
  assert.equal(times.wokeAt, localDate(DAY, '05:30').getTime());
  assert.ok(times.sleptAt < times.wokeAt);
  assert.equal(defaultNightTimes(profile, DAY, localDate(DAY, '10:00').getTime()).wokeAt, localDate(DAY, '07:00').getTime());
  assert.equal(validateSleepTimes(profile, DAY, sleepTimesFromInputs(DAY, '', '07:00'), early), 'missingTime');
  assert.equal(validateSleepTimes(profile, DAY, sleepTimesFromInputs(DAY, '23:00', '05:30'), early), null);
});
