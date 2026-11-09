import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToKey,
  clampNumber,
  daysBetween,
  isValidDateKey,
  isValidTime,
  minutesToTime,
  timeToMinutes,
  weekdayOfKey,
} from '../www/src/core/time.js';

test('time strings convert to minutes and back', () => {
  assert.equal(timeToMinutes('07:30'), 450);
  assert.equal(minutesToTime(450), '07:30');
  assert.equal(minutesToTime(1440 + 60), '01:00');
  assert.equal(minutesToTime(-30), '23:30');
  assert.ok(Number.isNaN(timeToMinutes('25:00')));
});

test('validates time and date keys', () => {
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('7:30'), false);
  assert.equal(isValidDateKey('2026-02-29'), false);
  assert.equal(isValidDateKey('2028-02-29'), true);
});

test('date key arithmetic crosses months, years and DST dates', () => {
  assert.equal(addDaysToKey('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysToKey('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  assert.equal(weekdayOfKey('2026-11-09'), 1);
});

test('clampNumber rejects garbage and clamps', () => {
  assert.equal(clampNumber('abc', 0, 10, 5), 5);
  assert.equal(clampNumber(99, 0, 10, 5), 10);
  assert.equal(clampNumber('-4', 0, 10, 5), 0);
  assert.equal(clampNumber(Infinity, 0, 10, 5), 5);
});
