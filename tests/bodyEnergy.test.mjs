import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, dailyWeights, latestWeightKg, mergeWeights } from '../www/src/core/body.js';
import {
  GLYCOGEN_MAX_DROP_KG,
  balanceToFatKg,
  bmrMifflinStJeor,
  emaTrend,
  estimatedDailyExpenditure,
  expenditureForDay,
  forecastTomorrow,
  glycogenDropForFastHours,
  glycogenLevelAfterDay,
  goalEstimate,
  intakeForDay,
  uncertaintyKg,
  weightProjection,
} from '../www/src/core/energy.js';
import { computeDailyGoal } from '../www/src/core/hydration.js';
import { emptyDayLog, logSnack } from '../www/src/core/meals.js';
import { createDefaultState, parseState } from '../www/src/core/storage.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

const DAY = '2026-11-10';

function at(time, key = DAY) {
  return localDate(key, time);
}

function bodyState(overrides = {}) {
  const state = makeState();
  state.profile = { ...state.profile, sex: 'male', age: 40, heightCm: 180, weightKg: 80, activity: 'sedentary', exerciseMinutes: 0, ...(overrides.profile || {}) };
  state.body = { weights: [], fat: [], goalKg: null, ...(overrides.body || {}) };
  state.energy = { days: overrides.energyDays || {} };
  state.health = { body: false, activity: false, nutrition: false, writeWeight: false };
  if (overrides.days) state.days = overrides.days;
  if (overrides.fasting) state.fasting = { ...state.fasting, ...overrides.fasting };
  return state;
}

function weighIns(values, startKey = '2026-10-20') {
  return values.map((kg, index) => {
    const date = localDate(startKey, '07:00');
    date.setDate(date.getDate() + index);
    return { id: `kg-${index}`, at: date.getTime(), kg, source: 'manual' };
  });
}

test('Mifflin St Jeor BMR by sex and averaged when unknown', () => {
  assert.equal(bmrMifflinStJeor({ sex: 'male', weightKg: 80, heightCm: 180, age: 40 }), 1730);
  assert.equal(bmrMifflinStJeor({ sex: 'female', weightKg: 80, heightCm: 180, age: 40 }), 1564);
  assert.equal(bmrMifflinStJeor({ sex: 'unspecified', weightKg: 80, heightCm: 180, age: 40 }), 1647);
});

test('estimated expenditure uses activity factor, exercise and the latest weight', () => {
  const state = bodyState({ profile: { activity: 'moderate', exerciseMinutes: 30 }, body: { weights: weighIns([90]) } });
  const estimate = estimatedDailyExpenditure(state, at('12:00'));
  assert.equal(estimate.basal, 1830);
  assert.equal(estimate.total, Math.round(1830 * 1.55 + 120));
});

test('expenditure prefers Health totals, then basal plus active, then estimate', () => {
  const now = at('12:00', '2026-11-11');
  const state = bodyState({ energyDays: { [DAY]: { basal: 1700, active: 500, total: 2300 }, '2026-11-09': { basal: 1700, active: 400 } } });
  assert.deepEqual([expenditureForDay(state, DAY, now).source, expenditureForDay(state, DAY, now).total], ['health', 2300]);
  assert.equal(expenditureForDay(state, '2026-11-09', now).total, 2100);
  const estimate = expenditureForDay(state, '2026-11-08', now);
  assert.equal(estimate.source, 'estimate');
  assert.equal(estimate.total, Math.round(1730 * 1.2));
});

test('today expenditure is partial so far but projected for the full day', () => {
  const state = bodyState({ energyDays: { [DAY]: { basal: 850, active: 200 }, '2026-11-09': { active: 600 }, '2026-11-08': { active: 400 } } });
  const today = expenditureForDay(state, DAY, at('12:00'));
  assert.equal(today.total, 1050);
  assert.equal(today.projectedTotal, Math.round(1700 + 200 + 500 * 0.5));
  const estimate = expenditureForDay(bodyState(), DAY, at('12:00'));
  assert.equal(estimate.total, Math.round(1730 * 1.2 * 0.5));
  assert.equal(estimate.projectedTotal, Math.round(1730 * 1.2));
});

test('intake prefers Health, then the log with portions, then the plan', () => {
  const now = at('22:00');
  const health = bodyState({ energyDays: { [DAY]: { intake: 1800 } } });
  health.health.nutrition = true;
  assert.deepEqual([intakeForDay(health, DAY, now).source, intakeForDay(health, DAY, now).kcal], ['health', 1800]);
  const log = { ...emptyDayLog(), meals: { lunch: { eatenAt: at('12:30').getTime(), minute: 750, portion: 'more' }, dinner: { eatenAt: at('19:30').getTime(), minute: 1170, portion: 'less' } } };
  const withSnack = logSnack(log, at('16:00'), 960).dayLog;
  withSnack.snacks[0].portion = 'normal';
  const logged = intakeForDay(bodyState({ days: { [DAY]: withSnack } }), DAY, now);
  assert.equal(logged.source, 'log');
  assert.equal(logged.kcal, Math.round(700 * 1.3 + 600 * 0.7 + 250));
  const planned = intakeForDay(bodyState(), '2026-11-08', now);
  assert.deepEqual([planned.source, planned.kcal], ['plan', 700 + 250 + 600]);
  const zero = bodyState({ fasting: { mode: 'weekdays' } });
  assert.deepEqual([intakeForDay(zero, '2026-11-08', now).source, intakeForDay(zero, '2026-11-08', now).kcal], ['log', 0]);
});

test('balance converts to fat at 7700 kcal per kg', () => {
  assert.equal(balanceToFatKg(-7700), -1);
  assert.equal(balanceToFatKg(770), 0.1);
});

test('glycogen and water component is bounded and rebounds after refeeding', () => {
  assert.equal(glycogenDropForFastHours(10), 0);
  assert.equal(glycogenDropForFastHours(24), -GLYCOGEN_MAX_DROP_KG / 2);
  assert.equal(glycogenDropForFastHours(60), -GLYCOGEN_MAX_DROP_KG);
  const fasted = glycogenLevelAfterDay({ intakeKcal: 0, expenditureKcal: 2000, hoursFastedByMorning: 36 });
  assert.equal(fasted, -GLYCOGEN_MAX_DROP_KG);
  assert.equal(glycogenLevelAfterDay({ intakeKcal: 1800, expenditureKcal: 2000, hoursFastedByMorning: 12, previousLevel: fasted }), 0);
  assert.equal(glycogenLevelAfterDay({ intakeKcal: 600, expenditureKcal: 2000, hoursFastedByMorning: 14, previousLevel: fasted }), fasted / 2);
  assert.ok(glycogenLevelAfterDay({ intakeKcal: 0, expenditureKcal: 2000, hoursFastedByMorning: 500, previousLevel: -9 }) >= -GLYCOGEN_MAX_DROP_KG);
});

test('EMA trend smooths weigh-ins with alpha 0.1', () => {
  const trend = emaTrend(weighIns([80, 82, 79]));
  assert.equal(trend[0].trend, 80);
  assert.equal(trend[1].trend, 80.2);
  assert.ok(Math.abs(trend[2].trend - 80.08) < 1e-9);
  assert.equal(dailyWeights([...weighIns([80]), { id: 'x', at: weighIns([80])[0].at + 3600000, kg: 81, source: 'manual' }]).length, 1);
});

test('projection uses average balance when available, else the trend slope, else nothing', () => {
  const now = at('09:00');
  const days = {};
  for (let offset = 1; offset <= 14; offset += 1) {
    const date = at('12:00');
    date.setDate(date.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    days[key] = { ...emptyDayLog(), meals: { lunch: { eatenAt: date.getTime(), minute: 750, portion: 'normal' } } };
  }
  const withBalance = weightProjection(bodyState({ days, body: { weights: weighIns([80, 80, 80]) } }), now);
  assert.equal(withBalance.source, 'balance');
  assert.ok(Math.abs(withBalance.slope - (700 - 2076) / 7700) < 1e-9);
  assert.equal(withBalance.points.length, 28);
  const trendOnly = weightProjection(bodyState({ body: { weights: weighIns([82, 81.5, 81, 80.5, 80, 79.5, 79, 78.5]) } }), now);
  assert.equal(trendOnly.source, 'trend');
  assert.ok(trendOnly.slope < 0);
  assert.equal(weightProjection(bodyState({ body: { weights: weighIns([80]) } }), now).source, 'none');
});

test('goal date handles direction, little data and reached goals', () => {
  const now = at('09:00');
  assert.deepEqual(goalEstimate({ goalKg: 75, currentKg: 80, slope: -0.1, weighIns: 10, now }), { status: 'estimated', days: 50, date: '2026-12-30' });
  assert.equal(goalEstimate({ goalKg: 75, currentKg: 80, slope: 0.05, weighIns: 10, now }).status, 'wrongWay');
  assert.equal(goalEstimate({ goalKg: 75, currentKg: 80, slope: -0.1, weighIns: 2, now }).status, 'insufficient');
  assert.equal(goalEstimate({ goalKg: 79.9, currentKg: 80, slope: -0.1, weighIns: 10, now }).status, 'reached');
  assert.equal(goalEstimate({ goalKg: 40, currentKg: 80, slope: -0.01, weighIns: 10, now }).status, 'tooFar');
  assert.equal(goalEstimate({ goalKg: null, currentKg: 80, slope: -0.1, weighIns: 10, now }).status, 'noGoal');
});

test('tomorrow forecast includes the fasting drop and a band that narrows with data', () => {
  const fastDay = bodyState({ fasting: { mode: 'weekdays' }, body: { weights: weighIns([80, 80, 80], '2026-11-12') } });
  const forecast = forecastTomorrow(fastDay, at('20:00', '2026-11-14'));
  assert.ok(forecast.glycogenKg < 0);
  assert.ok(forecast.kg < forecast.base);
  assert.ok(forecast.high - forecast.low > 0);
  assert.ok(uncertaintyKg(0) > uncertaintyKg(20));
  const refeed = forecastTomorrow(fastDay, at('20:00', '2026-11-16'));
  assert.ok(refeed.glycogenKg > 0);
});

test('weights dedupe by time and value preferring manual entries; hydration follows the latest weight', () => {
  const at0 = at('07:00').getTime();
  const merged = mergeWeights([{ id: 'h', at: at0, kg: 80, source: 'health' }], [{ id: 'm', at: at0 + 20000, kg: 80.02, source: 'manual' }, { id: 'n', at: at0 + 86400000, kg: 79.5, source: 'health' }]);
  assert.deepEqual(merged.map((entry) => entry.id), ['m', 'n']);
  const state = bodyState({ body: { weights: merged } });
  assert.equal(latestWeightKg(state), 79.5);
  assert.equal(ageOn({ birthDate: '1990-11-11', age: 20 }, at('09:00')), 35);
  assert.equal(ageOn({ birthDate: null, age: 41 }, at('09:00')), 41);
  assert.equal(computeDailyGoal({ ...state.profile, weightKg: latestWeightKg(state) }).goalMl, computeDailyGoal({ ...state.profile, weightKg: 79.5 }).goalMl);
});

test('schema v2 migrates to v3 with body, health and energy defaults', () => {
  const now = at('09:00');
  const raw = JSON.stringify({ version: 2, onboarded: true, meals: [{ id: 'lunch', name: 'Almoço', time: '12:30' }], profile: { weightKg: 81 }, sleep: { log: [], healthEnabled: true } });
  const state = parseState(raw, createDefaultState(now, MEAL_NAMES), now);
  assert.equal(state.version, 3);
  assert.equal(state.sleep.healthEnabled, true);
  assert.equal(state.meals[0].kcal, 700);
  assert.deepEqual(state.body, { weights: [], fat: [], goalKg: null, healthHeightCm: null, ignoredHealth: [] });
  assert.deepEqual(state.health, { body: false, activity: false, nutrition: false, writeWeight: false });
  assert.deepEqual(state.energy, { days: {} });
  assert.equal(state.profile.snackKcal, 250);
  const old = parseState(JSON.stringify({ version: 3, energy: { days: { '2026-01-01': { basal: 1600 }, [DAY]: { steps: 9000 } } } }), createDefaultState(now, MEAL_NAMES), now);
  assert.deepEqual(Object.keys(old.energy.days), [DAY]);
});

test('early in the day the full basal comes from typical days, never from extrapolating a few hours', () => {
  const state = bodyState({ energyDays: { [DAY]: { basal: 900, active: 50 } } });
  const early = expenditureForDay(state, DAY, at('03:00'));
  assert.equal(early.projectedTotal, Math.round(1730 + 50 + Math.round(1730 * 0.2) * (1 - 0.125)));
  const typical = bodyState({ energyDays: { [DAY]: { basal: 900, active: 50 }, '2026-11-09': { basal: 1650, active: 400 } } });
  assert.equal(expenditureForDay(typical, DAY, at('03:00')).projectedTotal, Math.round(1650 + 50 + 400 * 0.875));
});
