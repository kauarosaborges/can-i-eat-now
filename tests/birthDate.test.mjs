import test from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, birthDateRange, isPlausibleBirthDate } from '../www/src/core/body.js';

const now = new Date(2026, 10, 10, 12, 0);

test('birth date range spans ages 10 to 110', () => {
  assert.deepEqual(birthDateRange(now), { min: '1916-11-10', max: '2016-11-10' });
});

test('implausible birth dates are rejected', () => {
  assert.equal(isPlausibleBirthDate('1890-01-01', now), false);
  assert.equal(isPlausibleBirthDate('2024-05-01', now), false);
  assert.equal(isPlausibleBirthDate('2030-01-01', now), false);
  assert.equal(isPlausibleBirthDate('1990-02-30', now), false);
  assert.equal(isPlausibleBirthDate('1990-06-15', now), true);
});

test('age falls back to the profile age when the birth date is implausible', () => {
  assert.equal(ageOn({ birthDate: '1890-01-01', age: 35 }, now), 35);
  assert.equal(ageOn({ birthDate: '1990-11-11', age: 35 }, now), 35);
  assert.equal(ageOn({ birthDate: '1990-11-10', age: 20 }, now), 36);
});
