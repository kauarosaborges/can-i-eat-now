import { createDefaultState } from '../www/src/core/storage.js';

export const MEAL_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };

export function localDate(key, time = '00:00') {
  const [year, month, day] = key.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

export function makeState(overrides = {}) {
  const base = createDefaultState(localDate('2026-11-09', '08:00'), MEAL_NAMES);
  return {
    ...base,
    ...overrides,
    fasting: { ...base.fasting, ...(overrides.fasting || {}) },
    days: overrides.days || {},
  };
}
