import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyMassIndex,
  fatFreeMassIndex,
  isSiteComplete,
  jacksonPollockDensity,
  leeMuscleMass,
  navyBodyFat,
  needsThirdReading,
  optionalSkinfoldSites,
  protocolSites,
  sessionResults,
  siriBodyFat,
  siteValue,
  skinfoldBodyFat,
} from '../www/src/core/bodyComposition.js';
import { classify, referenceFor, worstStatus } from '../www/src/core/bodyReferences.js';
import { averageReadings, categoryStatus, classifyBloodPressure, isUrgent, mergeBloodPressure, validateReading } from '../www/src/core/bloodPressure.js';
import { buildMeasurementReport, monthKeyOf } from '../www/src/core/measurementReport.js';
import { CSV_BOM, escapeCsvText, formatCsvNumber, toCsv } from '../www/src/core/csv.js';
import { nextOccurrence, occurrenceIn, reminderDue, reminderNotificationAt } from '../www/src/core/measurementReminder.js';
import { buildNotificationPlan } from '../www/src/core/notificationPlan.js';
import { mergeHealthSync, stripHealthGroup } from '../www/src/core/healthMerge.js';
import { createDefaultState, parseState, sanitizeState } from '../www/src/core/storage.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

const close = (actual, expected, tolerance = 0.0001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);

test('JP3 men and women match hand worked examples of the published equations', () => {
  close(jacksonPollockDensity('jp3', 'male', 45, 22), 1.0697557, 1e-7);
  close(siriBodyFat(1.0697557), 12.72, 0.01);
  close(jacksonPollockDensity('jp3', 'female', 47, 30), 1.0537305, 1e-7);
  close(siriBodyFat(1.0537305), 19.76, 0.01);
});

test('JP7 men and women follow the 1978 and 1980 coefficients', () => {
  close(jacksonPollockDensity('jp7', 'male', 100, 35), 1.112 - 0.043499 + 0.0055 - 0.0100891, 1e-7);
  close(jacksonPollockDensity('jp7', 'female', 120, 40), 1.097 - 0.0563652 + 0.008064 - 0.0051312, 1e-7);
  assert.equal(jacksonPollockDensity('jp7', 'unspecified', 100, 35), null);
  assert.equal(siriBodyFat(0), null);
});

test('protocol sites depend on sex for JP3 and optional sites cover the muscle estimate', () => {
  assert.deepEqual(protocolSites('jp3', 'male'), ['chest', 'abdomen', 'thigh']);
  assert.deepEqual(protocolSites('jp3', 'female'), ['triceps', 'suprailiac', 'thigh']);
  assert.equal(protocolSites('jp7', 'male').length, 7);
  assert.deepEqual(protocolSites('jp3', 'unspecified'), []);
  assert.deepEqual(optionalSkinfoldSites('jp3', 'male'), ['triceps', 'calf']);
  assert.deepEqual(optionalSkinfoldSites('jp7', 'female'), ['calf']);
  assert.deepEqual(optionalSkinfoldSites('tape', 'female'), []);
});

test('site value is the mean of the two closest readings and a third is asked over 2 mm', () => {
  assert.equal(siteValue([10, 11]), 10.5);
  assert.equal(needsThirdReading([10, 12]), false);
  assert.equal(needsThirdReading([10, 12.5]), true);
  assert.equal(isSiteComplete([10, 12.5]), false);
  assert.equal(siteValue([10, 14, 13.4]), 13.7);
  assert.equal(isSiteComplete([10, 14, 13.4]), true);
  assert.equal(siteValue([1, 100]), null);
  assert.equal(siteValue([]), null);
});

test('skinfold body fat needs every protocol site', () => {
  const skinfolds = { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] };
  assert.deepEqual(skinfoldBodyFat('jp3', 'male', skinfolds, 22), { sumMm: 45, pct: 12.7 });
  assert.equal(skinfoldBodyFat('jp3', 'male', { chest: [10, 10] }, 22), null);
});

test('US Navy metric equation agrees with the published inch version', () => {
  const male = navyBodyFat({ sex: 'male', heightCm: 177.8, neckCm: 38.1, waistCm: 86.36 });
  const maleInches = 86.01 * Math.log10(34 - 15) - 70.041 * Math.log10(70) + 36.76;
  close(male, maleInches, 0.5);
  const female = navyBodyFat({ sex: 'female', heightCm: 165.1, neckCm: 33.02, waistCm: 76.2, hipCm: 99.06 });
  const femaleInches = 163.205 * Math.log10(30 + 39 - 13) - 97.684 * Math.log10(65) - 78.387;
  close(female, femaleInches, 0.5);
  assert.equal(navyBodyFat({ sex: 'female', heightCm: 165, neckCm: 33, waistCm: 76 }), null);
  assert.equal(navyBodyFat({ sex: 'male', heightCm: 170, neckCm: 50, waistCm: 40 }), null);
});

test('Lee 2000 muscle estimate uses corrected girths and needs all inputs', () => {
  const input = { sex: 'male', age: 30, heightCm: 180, armCm: 32, tricepsMm: 10, thighCm: 55, thighMm: 15, calfCm: 38, calfMm: 8 };
  assert.equal(leeMuscleMass(input), 33.9);
  assert.equal(leeMuscleMass({ ...input, sex: 'female' }), 31.5);
  assert.equal(leeMuscleMass({ ...input, calfMm: undefined }), null);
});

test('session results derive fat mass, lean mass, FFMI, BMI and ratios', () => {
  const session = {
    protocol: 'jp3',
    sex: 'male',
    age: 22,
    weightKg: 80,
    heightCm: 180,
    skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] },
    girths: { waist: 85, hip: 100, neck: 38 },
  };
  const result = sessionResults(session);
  assert.equal(result.jp3, 12.7);
  assert.equal(result.jp7, null);
  assert.equal(result.fatSource, 'jp3');
  assert.equal(result.fatMassKg, 10.2);
  assert.equal(result.leanMassKg, 69.8);
  assert.equal(result.ffmi, fatFreeMassIndex(69.8, 180));
  assert.equal(result.bmi, bodyMassIndex(80, 180));
  assert.equal(result.whr, 0.85);
  assert.equal(result.whtr, 0.47);
  assert.equal(result.muscleKg, null);
  assert.equal(result.outsideJpAge, false);
  const tape = sessionResults({ ...session, protocol: 'tape', skinfolds: {}, weightKg: null });
  assert.equal(tape.fatSource, 'navy');
  assert.equal(tape.fatMassKg, null);
});

test('reference ranges classify fat by sex and age and edges go to the upper band', () => {
  assert.equal(classify('fat', 15, { sex: 'male', age: 30 }), 'good');
  assert.equal(classify('fat', 20, { sex: 'male', age: 30 }), 'borderline');
  assert.equal(classify('fat', 25, { sex: 'male', age: 30 }), 'out');
  assert.equal(classify('fat', 7.9, { sex: 'male', age: 30 }), 'borderline');
  assert.equal(classify('fat', 33.9, { sex: 'female', age: 45 }), 'good');
  assert.equal(classify('fat', 34, { sex: 'female', age: 45 }), 'borderline');
  assert.equal(classify('fat', 42, { sex: 'female', age: 70 }), 'out');
  assert.equal(classify('fat', 20, { sex: 'unspecified', age: 30 }), null);
  assert.equal(referenceFor('fat', { sex: 'female', age: 25 }).good.min, 21);
});

test('waist, WHR, WHtR, BMI and FFMI ranges', () => {
  assert.equal(classify('waist', 93.9, { sex: 'male' }), 'good');
  assert.equal(classify('waist', 94, { sex: 'male' }), 'borderline');
  assert.equal(classify('waist', 102, { sex: 'male' }), 'out');
  assert.equal(classify('waist', 80, { sex: 'female' }), 'borderline');
  assert.equal(classify('waist', 88, { sex: 'female' }), 'out');
  assert.equal(classify('whr', 0.89, { sex: 'male' }), 'good');
  assert.equal(classify('whr', 0.9, { sex: 'male' }), 'out');
  assert.equal(classify('whr', 0.85, { sex: 'female' }), 'out');
  assert.equal(classify('whtr', 0.49), 'good');
  assert.equal(classify('whtr', 0.5), 'borderline');
  assert.equal(classify('whtr', 0.6), 'out');
  assert.equal(classify('bmi', 18.4), 'borderline');
  assert.equal(classify('bmi', 24.9), 'good');
  assert.equal(classify('bmi', 30), 'out');
  assert.equal(classify('ffmi', 16.9, { sex: 'male' }), 'out');
  assert.equal(classify('ffmi', 15.5, { sex: 'female' }), 'borderline');
  assert.equal(worstStatus(['good', null, 'borderline']), 'borderline');
});

test('blood pressure follows the 2025 Brazilian guideline with the higher number winning', () => {
  assert.equal(classifyBloodPressure(119, 79), 'normal');
  assert.equal(classifyBloodPressure(120, 70), 'prehypertension');
  assert.equal(classifyBloodPressure(110, 80), 'prehypertension');
  assert.equal(classifyBloodPressure(139, 89), 'prehypertension');
  assert.equal(classifyBloodPressure(140, 70), 'stage1');
  assert.equal(classifyBloodPressure(130, 90), 'stage1');
  assert.equal(classifyBloodPressure(159, 99), 'stage1');
  assert.equal(classifyBloodPressure(160, 85), 'stage2');
  assert.equal(classifyBloodPressure(125, 100), 'stage2');
  assert.equal(classifyBloodPressure(179, 109), 'stage2');
  assert.equal(classifyBloodPressure(180, 80), 'stage3');
  assert.equal(classifyBloodPressure(120, 110), 'stage3');
  assert.equal(isUrgent(180, 70), true);
  assert.equal(isUrgent(150, 110), true);
  assert.equal(isUrgent(179, 109), false);
  assert.equal(categoryStatus('normal'), 'good');
  assert.equal(categoryStatus('prehypertension'), 'borderline');
  assert.equal(categoryStatus('stage2'), 'out');
});

test('blood pressure validation and averaging', () => {
  assert.equal(validateReading({ systolic: 120, diastolic: 80, pulse: 70 }), null);
  assert.equal(validateReading({ systolic: 59, diastolic: 40 }), 'systolic');
  assert.equal(validateReading({ systolic: 120, diastolic: 161 }), 'diastolic');
  assert.equal(validateReading({ systolic: 90, diastolic: 90 }), 'order');
  assert.equal(validateReading({ systolic: 120, diastolic: 80, pulse: 250 }), 'pulse');
  assert.deepEqual(averageReadings([{ systolic: 122, diastolic: 81, pulse: 70 }, { systolic: 118, diastolic: 78, pulse: null }]), { systolic: 120, diastolic: 80, pulse: 70, count: 2 });
  assert.equal(averageReadings([{ systolic: 10, diastolic: 5 }]), null);
});

test('health blood pressure is deduplicated against manual readings', () => {
  const manual = { id: 'a', at: 1000, systolic: 120, diastolic: 80, source: 'manual' };
  const health = { id: 'b', at: 30000, systolic: 120, diastolic: 80, source: 'health' };
  const other = { id: 'c', at: 200000, systolic: 130, diastolic: 85, source: 'health' };
  const merged = mergeBloodPressure([manual], [health, other]);
  assert.deepEqual(merged.map((entry) => entry.id), ['a', 'c']);
});

function session(at, extra = {}) {
  return {
    id: `ms-${at}`,
    at,
    protocol: 'jp3',
    sex: 'male',
    age: 22,
    weightKg: 80,
    heightCm: 180,
    waistSite: 'navel',
    skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] },
    girths: { waist: 90 },
    ...extra,
  };
}

test('monthly report keeps the latest value per month, deltas and the JP difference', () => {
  const sep = localDate('2026-09-03', '07:00').getTime();
  const sepLate = localDate('2026-09-20', '07:00').getTime();
  const oct = localDate('2026-10-02', '07:00').getTime();
  const sessions = [
    session(sep, { girths: { waist: 92 } }),
    session(sepLate, { girths: { waist: 91 } }),
    session(oct, { girths: { waist: 95 } }),
    session(oct + 3600000, { id: 'jp7', protocol: 'jp7', skinfolds: { chest: [10, 10], midaxillary: [12, 12], triceps: [10, 10], subscapular: [14, 14], abdomen: [20, 20], suprailiac: [12, 12], thigh: [15, 15] }, girths: { waist: 96 } }),
  ];
  const pressure = [
    { at: sep, systolic: 120, diastolic: 80, pulse: 70 },
    { at: sepLate, systolic: 130, diastolic: 84, pulse: null },
  ];
  const report = buildMeasurementReport({ sessions, bloodPressure: pressure, sex: 'male', age: 22 });
  assert.deepEqual(report.months, ['2026-09', '2026-10']);
  const waist = report.rows.find((row) => row.id === 'waist');
  assert.deepEqual(waist.cells.map((cell) => cell.value), [91, 96]);
  assert.deepEqual(waist.cells.map((cell) => cell.delta), [null, 5]);
  assert.deepEqual(waist.cells.map((cell) => cell.deltaFrom), [null, '2026-09']);
  assert.deepEqual(waist.cells.map((cell) => cell.status), ['good', 'borderline']);
  const diff = report.rows.find((row) => row.id === 'fatDiff');
  assert.equal(diff.cells[0].value, null);
  assert.ok(Number.isFinite(diff.cells[1].value));
  const systolic = report.rows.find((row) => row.id === 'systolic');
  assert.deepEqual(systolic.cells.map((cell) => cell.value), [125, null]);
  assert.equal(systolic.cells[0].status, 'borderline');
  assert.equal(report.rows.find((row) => row.id === 'pulse').cells[0].value, 70);
  assert.equal(report.rows.some((row) => row.id === 'neck'), false);
  assert.equal(buildMeasurementReport({ sessions, bloodPressure: [], sex: 'male', age: 22 }, 1).months.length, 1);
  assert.equal(monthKeyOf(sep), '2026-09');
});

test('CSV uses BOM, semicolons, comma decimals and neutralizes formulas', () => {
  assert.equal(formatCsvNumber(12.345, 1), '12,3');
  assert.equal(formatCsvNumber(-0.04, 1), '0');
  assert.equal(formatCsvNumber(-1.25, 1), '-1,3');
  assert.equal(escapeCsvText('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(escapeCsvText('+1'), "'+1");
  assert.equal(escapeCsvText('-x'), "'-x");
  assert.equal(escapeCsvText('@cmd'), "'@cmd");
  assert.equal(escapeCsvText('\tx'), "'\tx");
  assert.equal(escapeCsvText('a;b'), '"a;b"');
  assert.equal(escapeCsvText('say "hi"'), '"say ""hi"""');
  const csv = toCsv([['Métrica', 'Jan'], ['Cintura', { number: 90.25, decimals: 1 }], ['=HYPERLINK("x")', null]]);
  assert.ok(csv.startsWith(CSV_BOM));
  assert.equal(csv, `${CSV_BOM}Métrica;Jan\r\nCintura;90,3\r\n"'=HYPERLINK(""x"")";\r\n`);
});

test('monthly reminder clamps the day, is due after the date and respects grace and dismissal', () => {
  const reminder = { enabled: true, day: 31, time: '07:30', dismissedMonth: null };
  assert.equal(occurrenceIn(2026, 1, reminder).getDate(), 28);
  assert.equal(nextOccurrence(reminder, localDate('2026-11-12', '08:00')).getDate(), 30);
  const measurements = { reminder: { ...reminder, day: 10 }, sessions: [{ at: localDate('2026-10-10', '07:00').getTime() }] };
  assert.equal(reminderDue(measurements, localDate('2026-11-10', '07:00')), false);
  assert.equal(reminderDue(measurements, localDate('2026-11-10', '07:30')), true);
  assert.equal(reminderDue({ ...measurements, sessions: [{ at: localDate('2026-11-05', '07:00').getTime() }] }, localDate('2026-11-12', '08:00')), false);
  assert.equal(reminderDue({ ...measurements, reminder: { ...measurements.reminder, dismissedMonth: '2026-11' } }, localDate('2026-11-12', '08:00')), false);
  assert.equal(reminderDue({ ...measurements, sessions: [] }, localDate('2026-11-12', '08:00')), false);
  assert.equal(reminderDue({ ...measurements, reminder: { ...measurements.reminder, enabled: false } }, localDate('2026-11-12', '08:00')), false);
  const at = reminderNotificationAt(measurements, localDate('2026-11-12', '08:00'));
  assert.equal(at.getMonth(), 11);
  assert.equal(at.getDate(), 10);
  const justMeasured = { ...measurements, sessions: [{ at: localDate('2026-12-06', '07:00').getTime() }] };
  assert.equal(reminderNotificationAt(justMeasured, localDate('2026-12-07', '08:00')).getMonth(), 0);
});

test('notification plan includes the monthly reminder beyond the normal horizon', () => {
  const state = makeState();
  state.notifications = { enabled: true, kinds: { water: true, mealAllowed: true, windowOpen: true, windowClosing: true } };
  state.measurements = { ...createDefaultState(localDate('2026-11-09'), MEAL_NAMES).measurements, sessions: [session(localDate('2026-10-28', '07:00').getTime())], reminder: { enabled: true, day: 28, time: '07:00', dismissedMonth: null } };
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '08:00'));
  const item = plan.find((entry) => entry.kind === 'measurement');
  assert.ok(item);
  assert.equal(item.at.getDate(), 28);
  assert.equal(plan.length <= 60, true);
  state.measurements.reminder.enabled = false;
  assert.equal(buildNotificationPlan(state, localDate('2026-11-09', '08:00')).some((entry) => entry.kind === 'measurement'), false);
});

test('v4 state migrates to v5 with empty measurements and new write flags off', () => {
  const now = localDate('2026-11-09', '10:00');
  const raw = JSON.stringify({ version: 4, onboarded: true, health: { heart: true, writeWeight: true, requested: ['heartRate'] } });
  const state = parseState(raw, createDefaultState(now, MEAL_NAMES), now);
  assert.equal(state.version, 5);
  assert.equal(state.health.writeWeight, true);
  assert.equal(state.health.writeBodyFat, false);
  assert.equal(state.health.writeBloodPressure, false);
  assert.deepEqual(state.measurements.sessions, []);
  assert.equal(state.measurements.reminder.enabled, true);
});

test('measurement sanitizer drops invalid sites, readings, pressure and old data', () => {
  const now = localDate('2026-11-09', '10:00');
  const defaults = createDefaultState(now, MEAL_NAMES);
  const state = sanitizeState(
    {
      ...defaults,
      measurements: {
        sessions: [
          { id: 'ok', at: now.getTime() - 1000, protocol: 'jp7', sex: 'female', age: 40, weightKg: 70, heightCm: 165, skinfolds: { triceps: [12, 1, 13, 14, 15], evil: [10], chest: 'x' }, girths: { waist: 80, neck: 5, '__proto__': 1 } },
          { id: 'old', at: now.getTime() - 2000 * 86400000, protocol: 'jp3', sex: 'male', skinfolds: { chest: [10] } },
          { id: 'nosex', at: now.getTime(), protocol: 'jp3', sex: 'unspecified', skinfolds: { chest: [10] } },
          { id: 'empty', at: now.getTime(), protocol: 'tape', sex: 'male', girths: {} },
        ],
        bloodPressure: [
          { id: 'p1', at: now.getTime(), systolic: 120, diastolic: 80, pulse: 70, arm: 'left', source: 'manual' },
          { id: 'p2', at: now.getTime(), systolic: 80, diastolic: 90 },
          { id: 'p3', at: now.getTime(), systolic: 300, diastolic: 90 },
          { id: 'p4', at: now.getTime() + 5000, systolic: 120, diastolic: 80, arm: 'top', source: 'health' },
        ],
        draft: { protocol: 'jp3', step: 999, updatedAt: now.getTime(), skinfolds: { thigh: [20, 21] }, sex: 'x' },
        reminder: { enabled: 'yes', day: 45, time: '25:00', dismissedMonth: '2026-13' },
        waistSite: 'weird',
      },
    },
    defaults,
    now,
  );
  const measurements = state.measurements;
  assert.deepEqual(measurements.sessions.map((item) => item.id), ['ok']);
  assert.deepEqual(measurements.sessions[0].skinfolds, { triceps: [12, 13, 14] });
  assert.deepEqual(measurements.sessions[0].girths, { waist: 80 });
  assert.deepEqual(measurements.bloodPressure.map((item) => item.id), ['p1']);
  assert.equal(measurements.draft.step, 60);
  assert.equal(measurements.draft.sex, null);
  assert.deepEqual(measurements.reminder, { enabled: true, day: 31, time: '07:00', dismissedMonth: null });
  assert.equal(measurements.waistSite, 'navel');
  const stale = sanitizeState({ ...defaults, measurements: { draft: { protocol: 'jp3', updatedAt: now.getTime() - 30 * 86400000 } } }, defaults, now);
  assert.equal(stale.measurements.draft, null);
});

test('health sync merges blood pressure only with the heart group and strips it when turned off', () => {
  const now = localDate('2026-11-09', '10:00');
  const state = makeState({ health: { body: false, activity: false, nutrition: false, heart: true, writeWeight: false, requested: [] }, energy: { days: {} } });
  state.measurements = { ...state.measurements, bloodPressure: [{ id: 'm', at: now.getTime(), systolic: 120, diastolic: 80, pulse: null, source: 'manual' }], ignoredHealthPressure: [{ at: now.getTime() - 3600000, systolic: 140, diastolic: 90 }] };
  const merged = mergeHealthSync(state, {
    body: null,
    days: {},
    bloodPressure: [
      { id: 'h1', at: now.getTime() + 1000, systolic: 120, diastolic: 80, pulse: null, source: 'health' },
      { id: 'h2', at: now.getTime() - 3600000, systolic: 140, diastolic: 90, pulse: null, source: 'health' },
      { id: 'h3', at: now.getTime() - 7200000, systolic: 118, diastolic: 76, pulse: null, source: 'health' },
    ],
  });
  assert.deepEqual(merged.measurements.bloodPressure.map((entry) => entry.id), ['h3', 'm']);
  assert.deepEqual(stripHealthGroup(merged, 'heart').measurements.bloodPressure.map((entry) => entry.id), ['m']);
  const off = mergeHealthSync({ ...state, health: { ...state.health, heart: false } }, { body: null, days: {}, bloodPressure: [{ id: 'h3', at: 1, systolic: 118, diastolic: 76, source: 'health' }] });
  assert.deepEqual(off.measurements.bloodPressure.map((entry) => entry.id), ['m']);
});
