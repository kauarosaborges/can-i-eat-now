import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseMlPerKgForAge,
  buildReminderSchedule,
  computeDailyGoal,
  dueReminder,
  hydrationRatio,
  nextReminderMinute,
  totalWaterMl,
} from '../www/src/core/hydration.js';

const profile = { weightKg: 70, age: 35, activity: 'sedentary', exerciseMinutes: 0, hotClimate: false };

test('base ml per kg depends on age', () => {
  assert.equal(baseMlPerKgForAge(25), 40);
  assert.equal(baseMlPerKgForAge(30), 35);
  assert.equal(baseMlPerKgForAge(55), 35);
  assert.equal(baseMlPerKgForAge(56), 30);
});

test('goal sums base, activity, exercise and climate then rounds to 50', () => {
  assert.equal(computeDailyGoal(profile).goalMl, 2450);
  const active = computeDailyGoal({ ...profile, activity: 'moderate', exerciseMinutes: 45, hotClimate: true });
  assert.equal(active.breakdown.exerciseMl, 375);
  assert.equal(active.breakdown.activityBonusMl, 245);
  assert.equal(active.breakdown.climateMl, 500);
  assert.equal(active.goalMl, 3550);
});

test('goal is clamped between 1500 and 5000', () => {
  assert.equal(computeDailyGoal({ ...profile, weightKg: 30, age: 80 }).goalMl, 1500);
  const huge = computeDailyGoal({ ...profile, weightKg: 200, age: 20, activity: 'intense', exerciseMinutes: 180, hotClimate: true });
  assert.equal(huge.goalMl, 5000);
  assert.equal(huge.breakdown.clamped, true);
});

test('reminder schedule spreads glasses across waking hours within 60 to 90 minutes', () => {
  const schedule = buildReminderSchedule({ goalMl: 2500, glassMl: 250, wakeTime: '07:00', sleepTime: '23:00' });
  assert.equal(schedule.glasses, 10);
  assert.equal(schedule.intervalMinutes, 90);
  assert.equal(schedule.times[0], 510);
  assert.ok(schedule.times.every((at) => at <= 1380));
  assert.equal(schedule.times.length, 10);

  const dense = buildReminderSchedule({ goalMl: 4000, glassMl: 200, wakeTime: '07:00', sleepTime: '23:00' });
  assert.equal(dense.intervalMinutes, 60);
  assert.equal(dense.times.length, 15);
  assert.ok(!dense.times.includes(1380));
  assert.equal(dense.mlPerReminder, 250);
});

test('reminder schedule wraps sleep after midnight', () => {
  const schedule = buildReminderSchedule({ goalMl: 2000, glassMl: 250, wakeTime: '10:00', sleepTime: '02:00' });
  assert.equal(schedule.intervalMinutes, 90);
  assert.ok(schedule.times.includes(1500));
  assert.deepEqual(schedule.times, [...schedule.times].sort((left, right) => left - right));
});

test('next and due reminders', () => {
  const times = [480, 570, 660];
  assert.equal(nextReminderMinute(times, 500), 570);
  assert.equal(nextReminderMinute(times, 700), null);
  assert.equal(dueReminder(times, 575, -1), 570);
  assert.equal(dueReminder(times, 575, 570), null);
  assert.equal(dueReminder(times, 640, -1), null);
});

test('water totals and ratio', () => {
  assert.equal(totalWaterMl([{ ml: 250 }, { ml: 500 }, { ml: Number.NaN }]), 750);
  assert.equal(hydrationRatio(3000, 2000), 1);
  assert.equal(hydrationRatio(500, 2000), 0.25);
});
