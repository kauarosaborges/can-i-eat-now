import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navyBodyFat, needsThirdReading, siteValue, skinfoldBodyFat } from '../www/src/core/bodyComposition.js';
import { classify } from '../www/src/core/bodyReferences.js';
import { entryUrgent, mergeBloodPressure, readingsPeak } from '../www/src/core/bloodPressure.js';
import { buildMeasurementReport, previousMonthKey, primarySession } from '../www/src/core/measurementReport.js';
import { escapeCsvText } from '../www/src/core/csv.js';
import { mergeHealthSync } from '../www/src/core/healthMerge.js';
import { BACKUP_KEY_PREFIX, STORAGE_KEY, clearBackups, clearState, createDefaultState, sanitizeState } from '../www/src/core/storage.js';
import { editDraftFor, sessionFromDraft } from '../www/src/ui/measureActions.js';
import { MEAL_NAMES, localDate, makeState } from './helpers.mjs';

const now = localDate('2026-11-09', '10:00');

test('the 2 mm rule compares tenths, so float noise never asks for a third reading', () => {
  for (const pair of [[2.4, 4.4], [2.9, 4.9], [3.4, 5.4], [6.3, 8.3], [12.1, 14.1]]) assert.equal(needsThirdReading(pair), false, pair.join(' '));
  assert.equal(needsThirdReading([6.3, 8.4]), true);
});

test('equal gaps between three readings resolve to the median regardless of order', () => {
  assert.equal(siteValue([10, 14, 18]), 14);
  assert.equal(siteValue([18, 14, 10]), 14);
  assert.equal(siteValue([14, 10, 18]), 14);
  assert.equal(siteValue([10, 10.4, 18]), 10.2);
  assert.equal(siteValue([18, 10.4, 10]), 10.2);
});

test('body fat below the stored limit is not produced', () => {
  assert.equal(skinfoldBodyFat('jp3', 'male', { chest: [2, 2], abdomen: [2, 2], thigh: [2, 2] }, 18), null);
  assert.equal(navyBodyFat({ sex: 'male', heightCm: 200, neckCm: 45, waistCm: 60 }), null);
});

test('Gallagher women 40 to 59 healthy band ends at 34', () => {
  assert.equal(classify('fat', 33.9, { sex: 'female', age: 50 }), 'good');
  assert.equal(classify('fat', 34, { sex: 'female', age: 50 }), 'borderline');
  assert.equal(classify('fat', 40, { sex: 'female', age: 50 }), 'out');
});

test('two manual pressure readings within a minute are both kept, health duplicates still collapse', () => {
  const first = { id: 'a', at: 1000, systolic: 118, diastolic: 78, source: 'manual' };
  const second = { id: 'b', at: 20000, systolic: 118, diastolic: 78, source: 'manual' };
  const health = { id: 'c', at: 30000, systolic: 118, diastolic: 78, source: 'health' };
  const healthAgain = { id: 'd', at: 30500, systolic: 118, diastolic: 78, source: 'health' };
  assert.deepEqual(mergeBloodPressure([first, second], [health, healthAgain]).map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(mergeBloodPressure([], [health, healthAgain]).map((entry) => entry.id), ['c']);
});

test('pressure cap evicts health readings before manual ones', () => {
  const manual = { id: 'm', at: 1, systolic: 120, diastolic: 80, source: 'manual' };
  const health = [2, 3, 4].map((step) => ({ id: `h${step}`, at: step * 120000, systolic: 120 + step, diastolic: 80, source: 'health' }));
  assert.deepEqual(mergeBloodPressure([manual], health, 2).map((entry) => entry.id), ['m', 'h4']);
});

test('a single reading at 180/110 or more is urgent even when the average is lower', () => {
  const readings = [{ systolic: 200, diastolic: 120, pulse: null }, { systolic: 120, diastolic: 80, pulse: null }];
  assert.deepEqual(readingsPeak(readings), { systolic: 200, diastolic: 120 });
  assert.equal(entryUrgent({ systolic: 160, diastolic: 100 }), false);
  assert.equal(entryUrgent({ systolic: 160, diastolic: 100, peakSystolic: 200, peakDiastolic: 120 }), true);
  assert.equal(entryUrgent({ systolic: 181, diastolic: 90 }), true);
});

function tapeSession(id, at, extra) {
  return { id, at, protocol: 'tape', sex: 'male', age: 40, weightKg: null, heightCm: 180, waistSite: 'navel', skinfolds: {}, girths: {}, ...extra };
}

test('the report takes every derived row of a month from one coherent session', () => {
  const sessions = [
    tapeSession('a', localDate('2026-10-05', '07:00').getTime(), { weightKg: 80, girths: { neck: 38, waist: 90, hip: 100 } }),
    tapeSession('b', localDate('2026-10-20', '07:00').getTime(), { girths: { waist: 92 } }),
  ];
  assert.equal(primarySession(sessions).id, 'a');
  const report = buildMeasurementReport({ sessions, bloodPressure: [], sex: 'male', age: 40 });
  const value = (id) => report.rows.find((row) => row.id === id).cells[0].value;
  assert.equal(value('waist'), 90);
  assert.equal(value('whr'), 0.9);
  assert.equal(value('weight'), 80);
});

test('JP3 and JP7 of the same month come from their own sessions and the difference is coherent', () => {
  const jp7 = { id: 'j7', at: localDate('2026-10-03', '07:00').getTime(), protocol: 'jp7', sex: 'male', age: 30, weightKg: 80, heightCm: 180, waistSite: 'navel', skinfolds: { chest: [10, 10], midaxillary: [10, 10], triceps: [10, 10], subscapular: [12, 12], abdomen: [20, 20], suprailiac: [12, 12], thigh: [15, 15] }, girths: { waist: 88 } };
  const jp3 = { id: 'j3', at: localDate('2026-10-03', '08:00').getTime(), protocol: 'jp3', sex: 'male', age: 30, weightKg: 80, heightCm: 180, waistSite: 'navel', skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] }, girths: {} };
  const report = buildMeasurementReport({ sessions: [jp7, jp3], bloodPressure: [], sex: 'male', age: 30 });
  const row = (id) => report.rows.find((item) => item.id === id);
  assert.equal(row('waist').cells[0].value, 88);
  assert.equal(row('fatDiff').cells[0].value, Math.round((row('fatJp7').cells[0].value - row('fatJp3').cells[0].value) * 10) / 10);
});

test('delta keeps the month it compares to, and references follow the session context', () => {
  const sessions = [
    { id: 'jul', at: localDate('2026-07-03', '07:00').getTime(), protocol: 'tape', sex: 'female', age: 45, weightKg: 70, heightCm: 165, waistSite: 'navel', skinfolds: {}, girths: { waist: 80 } },
    { id: 'oct', at: localDate('2026-10-03', '07:00').getTime(), protocol: 'tape', sex: 'female', age: 45, weightKg: 70, heightCm: 165, waistSite: 'navel', skinfolds: {}, girths: { waist: 82 } },
  ];
  const report = buildMeasurementReport({ sessions, bloodPressure: [], sex: 'male', age: 30 });
  const waist = report.rows.find((row) => row.id === 'waist');
  assert.equal(waist.cells[1].deltaFrom, '2026-07');
  assert.notEqual(waist.cells[1].deltaFrom, previousMonthKey('2026-10'));
  assert.equal(waist.reference.good.max, 80);
  assert.equal(previousMonthKey('2026-01'), '2025-12');
});

test('editing keeps the original age, height and the empty weight of the session', () => {
  const state = makeState();
  state.profile = { ...state.profile, heightCm: 190, heightSource: 'manual', age: 50 };
  state.body = { ...state.body, weights: [{ id: 'w', at: now.getTime(), kg: 90, source: 'manual' }] };
  const session = tapeSession('old', localDate('2026-03-01', '07:00').getTime(), { age: 33, heightCm: 172, girths: { waist: 90 } });
  const rebuilt = sessionFromDraft(state, editDraftFor(session, now), now);
  assert.equal(rebuilt.id, 'old');
  assert.equal(rebuilt.at, session.at);
  assert.equal(rebuilt.age, 33);
  assert.equal(rebuilt.heightCm, 172);
  assert.equal(rebuilt.weightKg, null);
});

test('edit drafts live in their own slot and never leak into a new session draft', () => {
  const defaults = createDefaultState(now, MEAL_NAMES);
  const session = tapeSession('s1', now.getTime() - 86400000, { girths: { waist: 90 }, age: 41, heightCm: 175 });
  const draft = { ...editDraftFor(session, now), editingId: 's1' };
  const state = sanitizeState({ ...defaults, measurements: { ...defaults.measurements, sessions: [session], draft, editDraft: { ...draft, heightCm: 999, age: 1 } } }, defaults, now);
  assert.equal(state.measurements.draft.editingId, null);
  assert.equal(state.measurements.draft.editingAt, null);
  assert.equal(state.measurements.editDraft.editingId, 's1');
  assert.equal(state.measurements.editDraft.heightCm, 175);
  assert.equal(state.measurements.editDraft.age, 41);
  const orphan = sanitizeState({ ...defaults, measurements: { ...defaults.measurements, sessions: [], editDraft: draft } }, defaults, now);
  assert.equal(orphan.measurements.editDraft, null);
});

test('session body fat without its session is dropped and fat ignore list is sanitized', () => {
  const defaults = createDefaultState(now, MEAL_NAMES);
  const session = { id: 'keep', at: now.getTime() - 1000, protocol: 'jp3', sex: 'male', age: 30, weightKg: 80, heightCm: 180, waistSite: 'navel', skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] }, girths: {} };
  const state = sanitizeState(
    {
      ...defaults,
      body: {
        ...defaults.body,
        fat: [
          { id: 'f1', at: session.at, pct: 12, source: 'manual', sessionId: 'keep' },
          { id: 'f2', at: now.getTime() - 9000000, pct: 13, source: 'manual', sessionId: 'gone' },
          { id: 'f3', at: now.getTime() - 99000000, pct: 14, source: 'manual' },
        ],
        ignoredHealthFat: [{ at: 1, pct: 12 }, { at: 'x', pct: 2 }],
      },
      measurements: { ...defaults.measurements, sessions: [session] },
    },
    defaults,
    now,
  );
  assert.deepEqual(state.body.fat.map((entry) => entry.id).sort(), ['f1', 'f3']);
  assert.deepEqual(state.body.ignoredHealthFat, [{ at: 1, pct: 12 }]);
});

test('pressure peak is kept only when it is a valid reading above the average', () => {
  const defaults = createDefaultState(now, MEAL_NAMES);
  const state = sanitizeState(
    {
      ...defaults,
      measurements: {
        ...defaults.measurements,
        bloodPressure: [
          { id: 'p1', at: now.getTime(), systolic: 160, diastolic: 100, peakSystolic: 200, peakDiastolic: 120, source: 'manual' },
          { id: 'p2', at: now.getTime() - 5000000, systolic: 160, diastolic: 100, peakSystolic: 120, peakDiastolic: 80, source: 'manual' },
          { id: 'p2', at: now.getTime() - 6000000, systolic: 150, diastolic: 90, source: 'manual' },
        ],
      },
    },
    defaults,
    now,
  );
  const byId = Object.fromEntries(state.measurements.bloodPressure.map((entry) => [entry.id, entry]));
  assert.equal(state.measurements.bloodPressure.length, 2);
  assert.equal(byId.p1.peakSystolic, 200);
  assert.equal(byId.p2.peakSystolic, undefined);
});

test('deleted or session fat does not come back from Apple Health', () => {
  const state = makeState({ health: { body: true, activity: false, nutrition: false, heart: false, writeWeight: false, requested: [] }, energy: { days: {} } });
  state.body = { ...state.body, fat: [{ id: 's', at: 5000, pct: 15, source: 'manual', sessionId: 'x' }], ignoredHealthFat: [{ at: 100000, pct: 18 }] };
  const merged = mergeHealthSync(state, {
    body: {
      weights: [],
      heightCm: null,
      fat: [
        { id: 'h1', at: 5000, pct: 16.4, source: 'health' },
        { id: 'h2', at: 100000, pct: 18, source: 'health' },
        { id: 'h3', at: 900000, pct: 20, source: 'health' },
      ],
    },
    days: {},
  });
  assert.deepEqual(merged.body.fat.map((entry) => entry.id), ['s', 'h3']);
});

test('reset and clear remove every backup copy of the state', () => {
  const data = new Map([[STORAGE_KEY, '{}'], [`${BACKUP_KEY_PREFIX}1`, 'x'], [`${BACKUP_KEY_PREFIX}2`, 'y'], ['other', 'z']]);
  const storage = {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  assert.equal(clearBackups(storage), true);
  assert.deepEqual([...data.keys()].sort(), ['canIEatNow.state', 'other']);
  data.set(`${BACKUP_KEY_PREFIX}3`, 'w');
  assert.equal(clearState(storage), true);
  assert.deepEqual([...data.keys()], ['other']);
});

test('CSV neutralizes formulas hidden behind whitespace and fullwidth signs', () => {
  assert.equal(escapeCsvText(' =1+1'), "' =1+1");
  assert.equal(escapeCsvText(' +1'), "' +1");
  assert.equal(escapeCsvText('＝1'), "'＝1");
  assert.equal(escapeCsvText('＠x'), "'＠x");
  assert.equal(escapeCsvText('\n=1'), "\"'\n=1\"");
  assert.equal(escapeCsvText('Cintura'), 'Cintura');
});
