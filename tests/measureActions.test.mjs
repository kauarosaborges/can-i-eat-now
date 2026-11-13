import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, sanitizeState } from '../www/src/core/storage.js';
import { createMeasureActions, newDraft } from '../www/src/ui/measureActions.js';
import { MEAL_NAMES } from './helpers.mjs';

function setup({ health = {} } = {}) {
  const now = new Date();
  const defaults = createDefaultState(now, MEAL_NAMES);
  let state = sanitizeState({ ...defaults, onboarded: true, profile: { ...defaults.profile, sex: 'male' }, health: { ...defaults.health, ...health } }, defaults, now);
  const store = {
    get state() {
      return state;
    },
    replace(next) {
      state = sanitizeState(next, defaults, new Date());
    },
  };
  const toasts = [];
  const writes = [];
  const weights = [];
  let release = null;
  const bodyActions = {
    saveHealthSample: (flag, options) => {
      writes.push(options);
      return new Promise((resolve) => {
        release = () => resolve(true);
      });
    },
    addWeight: (kg, options) => weights.push({ kg, options }),
    updateProfile: () => {},
  };
  const actions = createMeasureActions(store, bodyActions, { toast: (message, options) => toasts.push({ message, options }) });
  return { store, actions, toasts, writes, weights, release: () => release && release() };
}

function jp3Draft(store, extra = {}) {
  return { ...newDraft(store.state, new Date()), protocol: 'jp3', sex: 'male', skinfolds: { chest: [10, 10], abdomen: [20, 20], thigh: [15, 15] }, girths: { waist: 90 }, ...extra };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a stale save undo does not delete a session edited afterwards', () => {
  const { store, actions, toasts } = setup();
  const first = actions.saveSession(jp3Draft(store));
  assert.equal(first.ok, true);
  const undoFirst = toasts[0].options.action.onClick;
  actions.startEdit(first.session.id);
  const editDraft = { ...store.state.measurements.editDraft, girths: { waist: 95 } };
  assert.equal(actions.saveSession(editDraft).ok, true);
  undoFirst();
  assert.equal(store.state.measurements.sessions.length, 1);
  assert.equal(store.state.measurements.sessions[0].girths.waist, 95);
  assert.equal(toasts[toasts.length - 1].message, 'Essa medição já mudou, então não dá para desfazer.');
});

test('the save undo of an edit restores the previous version', () => {
  const { store, actions, toasts } = setup();
  const first = actions.saveSession(jp3Draft(store));
  actions.startEdit(first.session.id);
  actions.saveSession({ ...store.state.measurements.editDraft, girths: { waist: 99 } });
  toasts[toasts.length - 1].options.action.onClick();
  assert.equal(store.state.measurements.sessions.length, 1);
  assert.equal(store.state.measurements.sessions[0].girths.waist, 90);
});

test('a double tap on save creates one session', () => {
  const { store, actions } = setup();
  const draft = jp3Draft(store);
  actions.saveSession(draft);
  const again = actions.saveSession(draft);
  assert.equal(again.duplicate, true);
  assert.equal(store.state.measurements.sessions.length, 1);
});

test('starting an edit keeps the new session draft untouched', () => {
  const { store, actions } = setup();
  const saved = actions.saveSession(jp3Draft(store));
  const inProgress = jp3Draft(store, { step: 4, girths: { neck: 40 } });
  actions.saveDraft(inProgress);
  actions.startEdit(saved.session.id);
  assert.equal(store.state.measurements.draft.step, 4);
  assert.equal(store.state.measurements.draft.editingId, null);
  assert.equal(store.state.measurements.editDraft.editingId, saved.session.id);
  assert.equal(actions.pendingEditFor('other'), true);
  assert.equal(actions.pendingEditFor(saved.session.id), false);
});

test('the weight typed in a session goes to the weight history', () => {
  const { store, actions, weights } = setup();
  actions.saveSession(jp3Draft(store, { weightKg: 82.4 }));
  assert.equal(weights.length, 1);
  assert.equal(weights[0].kg, 82.4);
  assert.equal(weights[0].options.confirmed, true);
});

test('deleting a session written to Health ignores its fat sample, even mid write', async () => {
  const { store, actions, writes, release } = setup({ health: { body: true, writeBodyFat: true } });
  const saved = actions.saveSession(jp3Draft(store));
  assert.equal(writes.length, 1);
  actions.deleteSession(saved.session.id);
  release();
  await flush();
  const ignored = store.state.body.ignoredHealthFat;
  assert.equal(ignored.length >= 1, true);
  assert.equal(store.state.body.fat.length, 0);
});

test('editing a written fat value ignores the old Health sample', async () => {
  const { store, actions, release } = setup({ health: { body: true, writeBodyFat: true } });
  const saved = actions.saveSession(jp3Draft(store));
  release();
  await flush();
  assert.equal(store.state.body.fat[0].healthWritten, true);
  const oldPct = store.state.body.fat[0].pct;
  actions.startEdit(saved.session.id);
  actions.saveSession({ ...store.state.measurements.editDraft, skinfolds: { chest: [14, 14], abdomen: [26, 26], thigh: [19, 19] } });
  assert.deepEqual(store.state.body.ignoredHealthFat.map((item) => item.pct), [oldPct]);
  assert.equal(store.state.body.fat.length, 1);
});

test('pressure deleted while the Health write is in flight is ignored and never comes back', async () => {
  const { store, actions, release } = setup({ health: { heart: true, writeBloodPressure: true } });
  const outcome = actions.addPressure({ readings: [{ systolic: 130, diastolic: 85, pulse: null }], arm: 'left' });
  actions.deletePressure(outcome.entry.id);
  release();
  await flush();
  assert.equal(store.state.measurements.bloodPressure.length, 0);
  assert.equal(store.state.measurements.ignoredHealthPressure.length >= 1, true);
});

test('two equal pressures in a row are both saved with a truthful result', () => {
  const { store, actions } = setup();
  const one = actions.addPressure({ readings: [{ systolic: 118, diastolic: 78, pulse: null }], arm: 'left' });
  const two = actions.addPressure({ readings: [{ systolic: 118, diastolic: 78, pulse: null }], arm: 'left' });
  assert.equal(one.ok && two.ok, true);
  assert.equal(store.state.measurements.bloodPressure.length, 2);
});

test('pressure keeps the highest reading so a single urgent value is not lost', () => {
  const { actions } = setup();
  const outcome = actions.addPressure({ readings: [{ systolic: 200, diastolic: 120, pulse: null }, { systolic: 120, diastolic: 80, pulse: null }], arm: 'right' });
  assert.equal(outcome.entry.systolic, 160);
  assert.equal(outcome.entry.peakSystolic, 200);
  assert.equal(outcome.entry.peakDiastolic, 120);
});
