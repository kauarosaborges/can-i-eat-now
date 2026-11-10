import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeMeasurements, isIgnoredHealthWeight } from '../www/src/core/body.js';
import { mealMinuteProblem, repairDayPlans } from '../www/src/core/dayRepair.js';
import {
  averageBalance,
  effectiveHeightCm,
  emaAlphaForGap,
  emaTrend,
  expenditureForDay,
  forecastTomorrow,
  glycogenLevelThrough,
  intakeForDay,
  plannedIntake,
  trendWeightKg,
  weightNeedsConfirmation,
} from '../www/src/core/energy.js';
import { classifyDay } from '../www/src/core/fasting.js';
import { addIgnored, mergeHealthSync, stripHealthGroup, validWeight } from '../www/src/core/healthMerge.js';
import { buildTimeline, eatMealNow, emptyDayLog, setManualMealTime } from '../www/src/core/meals.js';
import { localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-10';

function at(time, key = DAY) {
  return localDate(key, time);
}

function keyOffset(offset) {
  const date = at('12:00');
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function bodyState(extra = {}) {
  const state = makeState(extra.fasting ? { fasting: extra.fasting } : {});
  state.profile = { ...state.profile, sex: 'male', age: 40, heightCm: 180, weightKg: 80, activity: 'sedentary', exerciseMinutes: 0, heightSource: null };
  state.body = { weights: [], fat: [], goalKg: null, healthHeightCm: null, ignoredHealth: [], ...(extra.body || {}) };
  state.energy = { days: extra.energyDays || {} };
  state.health = { body: false, activity: false, nutrition: false, writeWeight: false, ...(extra.health || {}) };
  if (extra.days) state.days = extra.days;
  return state;
}

function weight(key, kg, time = '07:00', source = 'manual') {
  return { id: `kg-${key}-${kg}`, at: at(time, key).getTime(), kg, source };
}

test('Health intake of zero counts as a real fasting day when nutrition is on', () => {
  const state = bodyState({ fasting: { mode: 'weekdays' }, health: { nutrition: true }, energyDays: { '2026-11-08': { intake: 0 } } });
  const intake = intakeForDay(state, '2026-11-08', at('12:00'));
  assert.deepEqual([intake.source, intake.kcal], ['health', 0]);
  const off = bodyState({ fasting: { mode: 'weekdays' }, energyDays: { '2026-11-08': { intake: 0 } } });
  assert.equal(intakeForDay(off, '2026-11-08', at('12:00')).source, 'log');
});

test('partial and implausible days fall back to estimates and stay out of the average balance', () => {
  const health = bodyState({ health: { nutrition: true }, energyDays: { [keyOffset(-1)]: { intake: 200 }, [DAY]: { intake: 500 } } });
  const yesterday = intakeForDay(health, keyOffset(-1), at('12:00'));
  assert.equal(yesterday.source, 'estimated');
  assert.equal(yesterday.kcal, 1550);
  const today = intakeForDay(health, DAY, at('13:00'));
  assert.equal(today.source, 'health');
  assert.equal(today.projectedKcal, 500 + 250 + 600);
  const staleExpenditure = bodyState({ energyDays: { [keyOffset(-1)]: { basal: 300, active: 100 } } });
  const expenditure = expenditureForDay(staleExpenditure, keyOffset(-1), at('12:00'));
  assert.equal(expenditure.source, 'estimate');
  assert.equal(expenditure.fallback, true);
  const days = {};
  for (let offset = 1; offset <= 10; offset += 1) days[keyOffset(-offset)] = { ...emptyDayLog(), meals: { lunch: { eatenAt: at('12:30', keyOffset(-offset)).getTime(), minute: 750, portion: 'normal' } } };
  days[keyOffset(-2)].meals = {};
  days[keyOffset(-2)].snacks = [{ id: 's-1', at: at('10:00', keyOffset(-2)).getTime(), minute: 600, portion: 'less' }];
  const average = averageBalance(bodyState({ days }), at('12:00'));
  assert.equal(average, 700 - 2076);
});

test('EMA uses per day alpha, resets after long gaps and drives the estimates', () => {
  assert.equal(emaAlphaForGap(1), 0.1);
  assert.ok(Math.abs(emaAlphaForGap(3) - (1 - 0.9 ** 3)) < 1e-12);
  const trend = emaTrend([weight('2026-11-01', 80), weight('2026-11-04', 83)]);
  assert.ok(Math.abs(trend[1].trend - (80 + (1 - 0.9 ** 3) * 3)) < 1e-9);
  const reset = emaTrend([weight('2026-10-01', 90), weight('2026-11-01', 80)]);
  assert.equal(reset[1].trend, 80);
  const state = bodyState({ body: { weights: [weight('2026-11-08', 80), weight('2026-11-09', 90)] } });
  assert.ok(Math.abs(trendWeightKg(state) - 81) < 1e-9);
  const forecast = forecastTomorrow(bodyState({ body: { weights: [weight('2026-11-09', 80, '07:00'), weight('2026-11-09', 80.4, '20:00'), weight('2026-11-10', 80.2)] } }), at('12:00'));
  assert.equal(forecast.weighIns, 2);
});

test('weight entries out of range are invalid and big jumps ask for confirmation', () => {
  assert.equal(validWeight(Number.NaN), false);
  assert.equal(validWeight(29.9), false);
  assert.equal(validWeight(301), false);
  assert.equal(validWeight(80), true);
  const state = bodyState({ body: { weights: [weight('2026-11-09', 70)] } });
  assert.equal(weightNeedsConfirmation(state, 154, at('07:00').getTime()), true);
  assert.equal(weightNeedsConfirmation(state, 72, at('07:00').getTime()), false);
  assert.equal(weightNeedsConfirmation(bodyState({ body: { weights: [weight('2026-11-01', 70)] } }), 154, at('07:00').getTime()), false);
});

test('glycogen looks back over consecutive fasting days without double counting', () => {
  const state = bodyState({ fasting: { mode: 'weekdays' } });
  const saturday = glycogenLevelThrough(state, '2026-11-14', at('20:00', '2026-11-15'));
  const sunday = glycogenLevelThrough(state, '2026-11-15', at('20:00', '2026-11-15'));
  assert.ok(saturday < 0);
  assert.ok(sunday >= -1.2 && sunday <= saturday);
  const forecast = forecastTomorrow(state, at('20:00', '2026-11-15'));
  assert.ok(forecast.glycogenKg <= 0 && forecast.glycogenKg >= -1.2);
});

test('a manual time outside the window keeps the meal allowed and counted', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, DAY);
  const dayLog = setManualMealTime(emptyDayLog(), 'dinner', 1290);
  const timeline = buildTimeline(state.meals, plan, dayLog, 1285, 60);
  const dinner = timeline.find((item) => item.id === 'dinner');
  assert.equal(dinner.status, 'allowedNow');
  assert.equal(dinner.canEatNow, true);
  const eaten = eatMealNow({ meals: state.meals, plan, dayLog, mealId: 'dinner', now: at('21:30'), minute: 1290, toleranceMinutes: 60, minGapMinutes: 150 });
  assert.equal(eaten.ok, true);
  const intakeState = bodyState({ days: { [DAY]: dayLog } });
  assert.equal(plannedIntake(intakeState, DAY), 700 + 250 + 600);
});

test('manual time sheet validation explains sleep and before wake problems', () => {
  const state = makeState();
  const plan = classifyDay(state.fasting, DAY);
  assert.equal(mealMinuteProblem(state, DAY, plan, 180, { allowOutsideWindow: true }), 'sleep');
  state.sleep = { log: [{ wakeKey: DAY, sleptAt: at('01:00').getTime(), wokeAt: at('09:00').getTime(), source: 'confirmed', kind: 'night' }], healthEnabled: false, nightAwakeAt: null };
  assert.equal(mealMinuteProblem(state, DAY, plan, 480, { allowOutsideWindow: true }), 'beforeWake');
  assert.equal(mealMinuteProblem(state, DAY, plan, 1290, { allowOutsideWindow: true }), null);
});

test('the proposal treats manual meals as fixed points and skips followers that would collide', () => {
  const state = makeState({ fasting: { intermittent: { preset: 'custom', eatingHours: 12, windowStart: '08:00' } } });
  state.meals = [
    { id: 'lunch', name: 'Lunch', time: '12:30', kcal: 700 },
    { id: 'snack', name: 'Snack', time: '15:00', kcal: 250 },
    { id: 'tea', name: 'Tea', time: '16:30', kcal: 100 },
    { id: 'dinner', name: 'Dinner', time: '18:30', kcal: 600 },
  ];
  const plan = classifyDay(state.fasting, DAY);
  const dayLog = setManualMealTime(emptyDayLog(), 'tea', 990);
  const result = eatMealNow({ meals: state.meals, plan, dayLog, mealId: 'lunch', now: at('13:30'), minute: 810, toleranceMinutes: 60, minGapMinutes: 150 });
  assert.deepEqual(result.skipped.map((item) => item.id), ['snack']);
  assert.ok(!result.adjustments.some((item) => item.id === 'tea'));
  const dinner = result.adjustments.find((item) => item.id === 'dinner');
  assert.equal(dinner.to, 1170);
  assert.ok(dinner.to >= 990 + 150);
});

test('repair only touches today and future days', () => {
  const state = makeState({ fasting: { mode: 'weekdays' } });
  state.days = {
    [keyOffset(-1)]: { ...emptyDayLog(), adjustments: { lunch: 360 } },
    [DAY]: { ...emptyDayLog(), adjustments: { lunch: 360 } },
  };
  const repaired = repairDayPlans(state, at('10:00'));
  assert.deepEqual(repaired.days[keyOffset(-1)].adjustments, { lunch: 360 });
  assert.deepEqual(repaired.days[DAY].adjustments, {});
});

test('health sync merges onto fresh state and drops groups disabled meanwhile', () => {
  const fresh = bodyState({ health: { body: false, activity: true, nutrition: false }, body: { weights: [weight('2026-11-09', 80)] } });
  const snapshot = {
    body: { weights: [weight('2026-11-10', 79, '06:00', 'health')], fat: [], heightCm: 175 },
    days: { [DAY]: { steps: 9000, intake: 1500 } },
  };
  const merged = mergeHealthSync(fresh, snapshot);
  assert.equal(merged.body.weights.length, 1);
  assert.equal(merged.body.healthHeightCm, null);
  assert.equal(merged.energy.days[DAY].steps, 9000);
  assert.equal(merged.energy.days[DAY].intake, null);
});

test('height from Health only fills when the user has not set it', () => {
  const state = bodyState({ health: { body: true }, body: { healthHeightCm: 175 } });
  assert.equal(effectiveHeightCm(state), 175);
  state.profile.heightSource = 'manual';
  assert.equal(effectiveHeightCm(state), 180);
  const stripped = stripHealthGroup(bodyState({ body: { healthHeightCm: 175, weights: [weight('2026-11-09', 80, '07:00', 'health')], fat: [{ id: 'f', at: 1, pct: 20, source: 'health' }] } }), 'body');
  assert.equal(stripped.body.healthHeightCm, null);
  assert.deepEqual([stripped.body.weights.length, stripped.body.fat.length], [0, 0]);
});

test('ignored Health weights are not resurrected by sync', () => {
  const removed = weight('2026-11-09', 80, '07:00', 'health');
  const state = bodyState({ health: { body: true } });
  state.body = addIgnored(state.body, removed);
  assert.equal(isIgnoredHealthWeight(state.body.ignoredHealth, removed), true);
  const merged = mergeHealthSync(state, { body: { weights: [{ ...removed, id: 'other' }], fat: [], heightCm: null }, days: {} });
  assert.equal(merged.body.weights.length, 0);
  const edited = mergeHealthSync(state, { body: { weights: [{ ...removed, id: 'new', kg: 79.5 }], fat: [], heightCm: null }, days: {} });
  assert.equal(edited.body.weights.length, 1);
});

test('dedupe keeps a stable order regardless of input order', () => {
  const base = at('07:00').getTime();
  const entries = [
    { id: 'b', at: base, kg: 80, source: 'health' },
    { id: 'a', at: base + 10000, kg: 80.01, source: 'manual' },
    { id: 'c', at: base + 86400000, kg: 79, source: 'manual' },
  ];
  const forward = dedupeMeasurements(entries, 'kg', 0.05).map((entry) => entry.id);
  const backward = dedupeMeasurements([...entries].reverse(), 'kg', 0.05).map((entry) => entry.id);
  assert.deepEqual(forward, ['a', 'c']);
  assert.deepEqual(backward, forward);
});
