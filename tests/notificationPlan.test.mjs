import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODIFIED_MEAL_ID } from '../www/src/core/fasting.js';
import { emptyDayLog } from '../www/src/core/meals.js';
import { DEFAULT_HORIZON_HOURS, MAX_PENDING_NOTIFICATIONS, buildNotificationPlan, isAsleepAt, stableNotificationId } from '../www/src/core/notificationPlan.js';
import { localDate, makeState } from './helpers.mjs';

function enabled({ kinds, profile, meals, ...rest } = {}) {
  const state = makeState(rest);
  state.notifications = { enabled: true, kinds: { water: true, mealAllowed: true, windowOpen: true, windowClosing: true, ...(kinds || {}) } };
  if (profile) state.profile = { ...state.profile, ...profile };
  if (meals) state.meals = meals;
  return state;
}

function ofKind(plan, kind) {
  return plan.filter((item) => item.kind === kind);
}

function times(items) {
  return items.map((item) => `${item.at.getDate()} ${String(item.at.getHours()).padStart(2, '0')}:${String(item.at.getMinutes()).padStart(2, '0')}`);
}

test('disabled notifications produce an empty plan', () => {
  const state = makeState();
  assert.deepEqual(buildNotificationPlan(state, localDate('2026-11-09', '08:00')), []);
});

test('intermittent 16:8 plans window open, meals inside the window and closing reminder', () => {
  const state = enabled({ kinds: { water: false } });
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '08:00'), 24);
  assert.deepEqual(times(ofKind(plan, 'windowOpen')), ['9 12:00']);
  assert.deepEqual(times(ofKind(plan, 'windowClosing')), ['9 19:30']);
  assert.deepEqual(times(ofKind(plan, 'mealAllowed')), ['9 12:30', '9 16:00', '9 19:30']);
  assert.ok(!plan.some((item) => item.params.name === 'Breakfast'));
  const sorted = [...plan].sort((left, right) => left.at - right.at);
  assert.deepEqual(plan, sorted);
});

test('window crossing midnight schedules closing after midnight and meals of the night', () => {
  const state = enabled({
    kinds: { water: false },
    fasting: { intermittent: { preset: '16:8', eatingHours: 8, windowStart: '20:00' } },
    meals: [
      { id: 'dinner', name: 'Dinner', time: '20:30' },
      { id: 'late', name: 'Late', time: '01:00' },
    ],
    profile: { wakeTime: '12:00', sleepTime: '05:00' },
  });
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '13:00'), 24);
  assert.deepEqual(times(ofKind(plan, 'windowOpen')), ['9 20:00']);
  assert.deepEqual(times(ofKind(plan, 'windowClosing')), ['10 03:30']);
  assert.deepEqual(times(ofKind(plan, 'mealAllowed')), ['9 20:30', '10 01:00']);
});

test('weekend fasting merges weekdays and opens on monday at wake time', () => {
  const state = enabled({ kinds: { water: false, mealAllowed: false }, fasting: { mode: 'weekdays' } });
  const plan = buildNotificationPlan(state, localDate('2026-11-13', '10:00'), 72);
  assert.deepEqual(times(ofKind(plan, 'windowClosing')), []);
  assert.deepEqual(times(ofKind(plan, 'windowOpen')), ['16 07:00']);
});

test('weekend closing reminder is kept when awake', () => {
  const state = enabled({ kinds: { water: false, mealAllowed: false }, fasting: { mode: 'weekdays' }, profile: { sleepTime: '23:45' } });
  const plan = buildNotificationPlan(state, localDate('2026-11-13', '10:00'), 24);
  assert.deepEqual(times(ofKind(plan, 'windowClosing')), ['13 23:30']);
});

test('alternate zero day has no meal notifications and modified day has one', () => {
  const zero = enabled({ kinds: { water: false }, fasting: { mode: 'alternate', alternate: { cycleStart: '2026-11-08', fastingDayType: 'zero', modifiedMealTime: '13:00', modifiedMealKcal: 500 } } });
  const zeroPlan = buildNotificationPlan(zero, localDate('2026-11-09', '06:00'), 18);
  assert.equal(ofKind(zeroPlan, 'mealAllowed').length, 0);
  assert.equal(ofKind(zeroPlan, 'windowOpen').length, 0);

  const modified = enabled({ kinds: { water: false }, fasting: { mode: 'alternate', alternate: { cycleStart: '2026-11-08', fastingDayType: 'modified', modifiedMealTime: '13:00', modifiedMealKcal: 450 } } });
  const plan = buildNotificationPlan(modified, localDate('2026-11-09', '06:00'), 12);
  const meals = ofKind(plan, 'mealAllowed');
  assert.equal(meals.length, 1);
  assert.equal(meals[0].bodyKey, 'notificationPlan.mealModifiedBody');
  assert.equal(meals[0].params.kcal, 450);
  assert.deepEqual(times(ofKind(plan, 'windowOpen')), ['9 13:00']);
  assert.deepEqual(times(ofKind(plan, 'windowClosing')), ['9 13:30']);

  modified.days = { '2026-11-09': { ...emptyDayLog(), meals: { [MODIFIED_MEAL_ID]: { eatenAt: localDate('2026-11-09', '12:10').getTime(), minute: 730 } } } };
  const after = buildNotificationPlan(modified, localDate('2026-11-09', '12:20'), 10);
  assert.equal(ofKind(after, 'mealAllowed').length, 0);
  assert.equal(ofKind(after, 'windowClosing').length, 0);
});

test('eaten, skipped and adjusted meals are respected', () => {
  const state = enabled({ kinds: { water: false, windowOpen: false, windowClosing: false } });
  state.days = {
    '2026-11-09': {
      ...emptyDayLog(),
      meals: { lunch: { eatenAt: localDate('2026-11-09', '12:30').getTime(), minute: 750 } },
      skips: { dinner: 'user' },
      adjustments: { snack: 17 * 60 },
    },
  };
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '13:00'), 12);
  assert.deepEqual(times(plan), ['9 17:00']);
  assert.equal(plan[0].params.name, 'Snack');
});

test('window shift of today moves the closing reminder', () => {
  const state = enabled({ kinds: { water: false, mealAllowed: false, windowOpen: false } });
  state.days = { '2026-11-09': { ...emptyDayLog(), windowShift: -60 } };
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '12:00'), 10);
  assert.deepEqual(times(plan), ['9 18:30']);
});

test('water reminders follow sleep after midnight, skip handled ones and stop at goal', () => {
  const state = enabled({ kinds: { mealAllowed: false, windowOpen: false, windowClosing: false }, profile: { wakeTime: '07:00', sleepTime: '02:00' } });
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '23:00'), 4);
  assert.deepEqual(times(plan), ['9 23:30', '10 01:00']);
  state.days = { '2026-11-09': { ...emptyDayLog(), lastReminder: 1410 } };
  assert.deepEqual(times(buildNotificationPlan(state, localDate('2026-11-09', '23:00'), 4)), ['10 01:00']);
  state.days = { '2026-11-09': { ...emptyDayLog(), water: [{ id: 'w', at: 1, ml: 5000 }] } };
  assert.deepEqual(times(buildNotificationPlan(state, localDate('2026-11-09', '23:00'), 4)), []);
});

test('meal and closing notifications are not sent while asleep', () => {
  const state = enabled({ kinds: { water: false }, meals: [{ id: 'night', name: 'Night', time: '23:30' }], profile: { sleepTime: '23:00' } });
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '08:00'), 20);
  assert.ok(!plan.some((item) => item.params.name === 'Night'));
  assert.ok(isAsleepAt({ wakeTime: '07:00', sleepTime: '01:00' }, localDate('2026-11-10', '03:00')));
  assert.ok(!isAsleepAt({ wakeTime: '07:00', sleepTime: '01:00' }, localDate('2026-11-10', '00:30')));
});

test('kind toggles remove only their kind', () => {
  const all = buildNotificationPlan(enabled(), localDate('2026-11-09', '08:00'), 24);
  for (const kind of ['water', 'mealAllowed', 'windowOpen', 'windowClosing']) {
    const plan = buildNotificationPlan(enabled({ kinds: { [kind]: false } }), localDate('2026-11-09', '08:00'), 24);
    assert.equal(ofKind(plan, kind).length, 0, kind);
    assert.equal(plan.length, all.length - ofKind(all, kind).length, kind);
  }
});

test('plan is capped at 60 nearest items', () => {
  const state = enabled({ profile: { wakeTime: '06:00', sleepTime: '23:30', weightKg: 120, glassMl: 100 } });
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '06:00'), 24 * 7);
  assert.equal(plan.length, MAX_PENDING_NOTIFICATIONS);
  const full = buildNotificationPlan(state, localDate('2026-11-09', '06:00'), 24 * 2);
  assert.deepEqual(plan.slice(0, 10).map((item) => item.id), full.slice(0, 10).map((item) => item.id));
});

test('ids are stable, unique and positive 31 bit integers', () => {
  const state = enabled();
  const first = buildNotificationPlan(state, localDate('2026-11-09', '08:00'), 24);
  const later = buildNotificationPlan(state, localDate('2026-11-09', '09:00'), 24);
  const lunchFirst = first.find((item) => item.kind === 'mealAllowed' && item.params.name === 'Lunch');
  const lunchLater = later.find((item) => item.kind === 'mealAllowed' && item.params.name === 'Lunch');
  assert.equal(lunchFirst.id, lunchLater.id);
  assert.equal(new Set(first.map((item) => item.id)).size, first.length);
  assert.ok(first.every((item) => Number.isInteger(item.id) && item.id > 0 && item.id <= 0x7fffffff));
  assert.equal(stableNotificationId('a'), stableNotificationId('a'));
  assert.notEqual(stableNotificationId('a'), stableNotificationId('b'));
});

test('default horizon covers four days', () => {
  assert.equal(DEFAULT_HORIZON_HOURS, 96);
  const state = enabled({ kinds: { water: false, mealAllowed: false, windowClosing: false } });
  const plan = buildNotificationPlan(state, localDate('2026-11-09', '13:00'));
  assert.deepEqual(times(plan), ['10 12:00', '11 12:00', '12 12:00', '13 12:00']);
  assert.equal(buildNotificationPlan(state, localDate('2026-11-09', '13:00'), 48).length, 2);
});

test('default horizon still caps at the 60 nearest items', () => {
  const plan = buildNotificationPlan(enabled(), localDate('2026-11-09', '06:00'));
  const shorter = buildNotificationPlan(enabled(), localDate('2026-11-09', '06:00'), 24);
  assert.equal(plan.length, MAX_PENDING_NOTIFICATIONS);
  assert.deepEqual(plan.slice(0, shorter.length).map((item) => item.id), shorter.map((item) => item.id));
});
