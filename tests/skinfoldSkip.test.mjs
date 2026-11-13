import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inconsistentReadings, navyBlockerFor, navyGirthSites, readingSpread, sessionResults, skippedRequiredSites } from '../www/src/core/bodyComposition.js';
import { buildMeasurementReport } from '../www/src/core/measurementReport.js';
import { createDefaultState, sanitizeState } from '../www/src/core/storage.js';
import { createMeasureActions, editDraftFor, newDraft, sessionFromDraft } from '../www/src/ui/measureActions.js';
import { buildSteps } from '../www/src/ui/views/measureView.js';
import { MEAL_NAMES, localDate } from './helpers.mjs';

function session(extra = {}) {
  return {
    id: 'ms-a',
    at: localDate('2026-11-09', '07:00').getTime(),
    protocol: 'jp3',
    sex: 'male',
    age: 35,
    weightKg: 80,
    heightCm: 178,
    waistSite: 'navel',
    skinfolds: { chest: [10, 10], thigh: [15, 15] },
    girths: { neck: 39, waist: 90 },
    skippedSkinfolds: ['abdomen'],
    ...extra,
  };
}

test('reading spread and the consistency hint need three readings over 4 mm apart', () => {
  assert.equal(readingSpread([20]), null);
  assert.equal(readingSpread([20, 25]), 5);
  assert.equal(readingSpread([20, 25, 30]), 10);
  assert.equal(inconsistentReadings([20, 25]), false);
  assert.equal(inconsistentReadings([20, 25, 30]), true);
  assert.equal(inconsistentReadings([20, 22, 24]), false);
  assert.equal(inconsistentReadings([20, 21.5, 24.1]), true);
  assert.equal(inconsistentReadings([20, 1, 30]), false);
});

test('navy girths add the hip only for women', () => {
  assert.deepEqual(navyGirthSites('male'), ['neck', 'waist']);
  assert.deepEqual(navyGirthSites('female'), ['neck', 'waist', 'hip']);
});

test('a skipped required fold falls back to the navy formula and says why', () => {
  const result = sessionResults(session());
  assert.equal(result.jp3, null);
  assert.equal(result.sumMm, null);
  assert.equal(result.fatSource, 'navy');
  assert.equal(result.fatPct, result.navy);
  assert.ok(Number.isFinite(result.fatPct));
  assert.deepEqual(result.skippedSkinfolds, ['abdomen']);
  assert.deepEqual(result.missingNavyGirths, []);
});

test('a skipped fold without the navy tapes lists what is missing and stays finite', () => {
  const result = sessionResults(session({ girths: { waist: 90 } }));
  assert.equal(result.fatPct, null);
  assert.equal(result.fatSource, null);
  assert.equal(result.fatMassKg, null);
  assert.deepEqual(result.missingNavyGirths, ['neck']);
  const female = sessionResults(session({ sex: 'female', protocol: 'jp3', skinfolds: { triceps: [10, 10], thigh: [15, 15] }, skippedSkinfolds: ['suprailiac'], girths: {} }));
  assert.deepEqual(female.missingNavyGirths, ['neck', 'waist', 'hip']);
});

test('a filled site is never treated as skipped', () => {
  const filled = session({ skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] } });
  assert.deepEqual(skippedRequiredSites(filled), []);
  const result = sessionResults(filled);
  assert.equal(result.fatSource, 'jp3');
  assert.deepEqual(result.skippedSkinfolds, []);
  assert.deepEqual(skippedRequiredSites(session({ skippedSkinfolds: ['calf', 'evil'] })), []);
  assert.deepEqual(skippedRequiredSites(session({ protocol: 'tape' })), []);
});

test('the report and csv values stay finite with a skipped fold', () => {
  const report = buildMeasurementReport({ sessions: [session()], bloodPressure: [], sex: 'male', age: 35 });
  const ids = report.rows.map((row) => row.id);
  assert.equal(ids.includes('fatJp3'), false);
  assert.ok(ids.includes('fatNavy'));
  for (const row of report.rows) for (const cell of row.cells) assert.ok(cell.value === null || Number.isFinite(cell.value));
});

test('the sanitizer keeps only required, unfilled skipped sites', () => {
  const now = localDate('2026-11-09', '10:00');
  const defaults = createDefaultState(now, MEAL_NAMES);
  const state = sanitizeState(
    {
      ...defaults,
      measurements: {
        sessions: [
          session({ id: 'skip', at: now.getTime() - 1000, skippedSkinfolds: ['abdomen', 'chest', 'calf', 'evil', 7] }),
          session({ id: 'plain', at: now.getTime() - 2000, skippedSkinfolds: 'abdomen' }),
          session({ id: 'tape', at: now.getTime() - 3000, protocol: 'tape', skinfolds: {}, skippedSkinfolds: ['abdomen'] }),
        ],
        draft: { protocol: 'jp3', sex: 'male', step: 3, updatedAt: now.getTime(), skinfolds: { chest: [10, 10] }, skippedSkinfolds: ['abdomen', 'chest', 'nope'] },
      },
    },
    defaults,
    now,
  );
  const byId = Object.fromEntries(state.measurements.sessions.map((item) => [item.id, item]));
  assert.deepEqual(byId.skip.skippedSkinfolds, ['abdomen']);
  assert.equal('skippedSkinfolds' in byId.plain, false);
  assert.equal('skippedSkinfolds' in byId.tape, false);
  assert.deepEqual(state.measurements.draft.skippedSkinfolds, ['abdomen']);
});

test('the draft carries skipped sites into the session and the edit draft', () => {
  const now = localDate('2026-11-09', '10:00');
  const state = createDefaultState(now, MEAL_NAMES);
  const draft = { ...newDraft(state, now), protocol: 'jp3', sex: 'male', skinfolds: { chest: [10, 10], thigh: [15, 15] }, girths: { neck: 39, waist: 90 }, skippedSkinfolds: ['abdomen', 'triceps'] };
  const saved = sessionFromDraft(state, draft, now);
  assert.deepEqual(saved.skippedSkinfolds, ['abdomen']);
  const edit = editDraftFor(saved, now);
  assert.deepEqual(edit.skippedSkinfolds, ['abdomen']);
  const refilled = sessionFromDraft(state, { ...edit, skinfolds: { ...edit.skinfolds, abdomen: [20, 20] } }, now);
  assert.equal('skippedSkinfolds' in refilled, false);
  assert.equal(sessionResults(refilled).fatSource, 'jp3');
});

test('steps flag the navy tapes only when a required fold was skipped', () => {
  const now = localDate('2026-11-09', '10:00');
  const state = createDefaultState(now, MEAL_NAMES);
  const base = { ...newDraft(state, now), protocol: 'jp3', sex: 'female' };
  const navy = (draft) => buildSteps(draft).filter((step) => step.navy).map((step) => step.site);
  assert.deepEqual(navy(base), []);
  assert.deepEqual(navy({ ...base, skippedSkinfolds: ['suprailiac'] }), ['neck', 'waist', 'hip']);
  assert.deepEqual(navy({ ...base, sex: 'male', skippedSkinfolds: ['abdomen'] }), ['neck', 'waist']);
  assert.deepEqual(navy({ ...base, skippedSkinfolds: ['suprailiac'], skinfolds: { suprailiac: [12, 12] } }), []);
  assert.deepEqual(navy({ ...base, protocol: 'tape', skippedSkinfolds: ['suprailiac'] }), []);
});

test('saving a session with a skipped fold writes no body fat entry', () => {
  const now = new Date();
  const defaults = createDefaultState(now, MEAL_NAMES);
  let state = sanitizeState({ ...defaults, onboarded: true, profile: { ...defaults.profile, sex: 'male' }, health: { ...defaults.health, writeBodyFat: true } }, defaults, now);
  const store = {
    get state() {
      return state;
    },
    replace(next) {
      state = sanitizeState(next, defaults, new Date());
    },
  };
  const writes = [];
  const actions = createMeasureActions(store, { saveHealthSample: (flag, options) => writes.push(options) || Promise.resolve(true), addWeight: () => {}, updateProfile: () => {} }, { toast: () => {} });
  const outcome = actions.saveSession({ ...newDraft(store.state, now), protocol: 'jp3', sex: 'male', skinfolds: { chest: [10, 10], thigh: [15, 15] }, girths: { neck: 39, waist: 90 }, skippedSkinfolds: ['abdomen'] });
  assert.equal(outcome.ok, true);
  assert.equal(store.state.body.fat.length, 0);
  assert.equal(writes.length, 0);
  assert.deepEqual(store.state.measurements.sessions[0].skippedSkinfolds, ['abdomen']);
  assert.equal(sessionResults(store.state.measurements.sessions[0]).fatSource, 'navy');
});

test('the navy blocker says why the tape fallback failed', () => {
  assert.equal(sessionResults(session()).navyBlocker, null);
  assert.equal(sessionResults(session({ girths: { waist: 90 } })).navyBlocker, 'girths');
  assert.equal(sessionResults(session({ heightCm: null })).navyBlocker, 'height');
  assert.equal(sessionResults(session({ girths: { neck: 45, waist: 44 } })).navyBlocker, 'range');
  assert.equal(sessionResults(session({ skippedSkinfolds: [], girths: {} })).navyBlocker, null);
  assert.equal(navyBlockerFor(170, []), 'range');
});

test('mass deltas are suppressed when the body fat method changes between months', () => {
  const oct = session({ id: 'oct', at: localDate('2026-10-05', '07:00').getTime(), skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] }, skippedSkinfolds: [] });
  const nov = session({ id: 'nov', at: localDate('2026-11-05', '07:00').getTime() });
  const report = buildMeasurementReport({ sessions: [oct, nov], bloodPressure: [], sex: 'male', age: 35 });
  const row = (id) => report.rows.find((item) => item.id === id);
  for (const id of ['fatMass', 'leanMass', 'ffmi']) {
    const last = row(id).cells.at(-1);
    assert.equal(last.delta, null, id);
    assert.equal(last.methodChanged, true, id);
  }
  assert.notEqual(row('waist').cells.at(-1).methodChanged, true);
  assert.deepEqual(report.methods, ['jp3', 'navySkipped']);
});

test('mass deltas stay when both months use the same method', () => {
  const oct = session({ id: 'oct', at: localDate('2026-10-05', '07:00').getTime(), weightKg: 82 });
  const nov = session({ id: 'nov', at: localDate('2026-11-05', '07:00').getTime() });
  const report = buildMeasurementReport({ sessions: [oct, nov], bloodPressure: [], sex: 'male', age: 35 });
  const last = report.rows.find((item) => item.id === 'fatMass').cells.at(-1);
  assert.equal(last.methodChanged, false);
  assert.ok(Number.isFinite(last.delta));
});

test('a skipped jp3 session does not blank the month jp3 when a complete one exists', () => {
  const complete = session({ id: 'full', at: localDate('2026-11-03', '07:00').getTime(), skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] }, skippedSkinfolds: [], girths: {} });
  const skipped = session({ id: 'skip', at: localDate('2026-11-05', '07:00').getTime(), girths: { neck: 39, waist: 90, chest: 100, hip: 100 } });
  const report = buildMeasurementReport({ sessions: [complete, skipped], bloodPressure: [], sex: 'male', age: 35 });
  const jp3 = report.rows.find((item) => item.id === 'fatJp3');
  assert.ok(jp3);
  assert.equal(jp3.cells.at(-1).value, sessionResults(complete).jp3);
});

test('the csv has a body fat method row per month', async () => {
  const { reportCsv } = await import('../www/src/ui/views/reportView.js');
  const oct = session({ id: 'oct', at: localDate('2026-10-05', '07:00').getTime(), skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] }, skippedSkinfolds: [] });
  const nov = session({ id: 'nov', at: localDate('2026-11-05', '07:00').getTime() });
  const csv = reportCsv(buildMeasurementReport({ sessions: [oct, nov], bloodPressure: [], sex: 'male', age: 35 }));
  const line = csv.split('\r\n').find((row) => row.startsWith('Método da gordura'));
  assert.equal(line, 'Método da gordura;;;;JP3;Fita (dobra sem medir)');
  assert.equal(csv.includes('NaN'), false);
});

test('flows with skinfolds get one caliper intro step right before the first fold', () => {
  const now = localDate('2026-11-09', '10:00');
  const base = { ...newDraft(createDefaultState(now, MEAL_NAMES), now), sex: 'male' };
  const types = (draft) => buildSteps(draft).map((step) => step.type);
  assert.deepEqual(types({ ...base, protocol: 'jp3' }).slice(0, 3), ['setup', 'caliperIntro', 'skinfold']);
  assert.equal(types({ ...base, protocol: 'jp7' }).filter((type) => type === 'caliperIntro').length, 1);
  assert.equal(types({ ...base, protocol: 'tape' }).includes('caliperIntro'), false);
});
