import { ACTIVITY_LEVELS } from './hydration.js';
import { FASTING_DAY_TYPES, FASTING_MODES, INTERMITTENT_PRESETS, MODIFIED_MEAL_ID } from './fasting.js';
import { MAX_MEALS, sanitizeMealName } from './meals.js';
import {
  clampInteger,
  clampNumber,
  isValidDateKey,
  sanitizeTime,
  toDateKey,
  daysBetween,
} from './time.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'canIEatNow.state';
export const BACKUP_KEY_PREFIX = 'canIEatNow.backup.';
export const RETENTION_DAYS = 60;
export const MAX_WATER_ENTRIES = 200;
export const SEXES = ['unspecified', 'female', 'male'];
export const SKIP_REASONS = ['noFit', 'user'];

export const LIMITS = {
  weightKg: { min: 30, max: 300 },
  heightCm: { min: 100, max: 250 },
  age: { min: 10, max: 110 },
  exerciseMinutes: { min: 0, max: 600 },
  glassMl: { min: 50, max: 1000 },
  customWaterMl: { min: 50, max: 2000 },
  waterEntryMl: { min: 1, max: 2000 },
  dayMinute: { min: 0, max: 2879 },
  eatingHours: { min: 1, max: 23 },
  toleranceMinutes: { min: 0, max: 180 },
  minGapMinutes: { min: 60, max: 360 },
  modifiedMealKcal: { min: 200, max: 800 },
  windowShift: { min: -180, max: 0 },
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function createMealId(seed) {
  const base = Number.isFinite(seed) ? seed : Date.now();
  return `meal-${base.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createDefaultState(now, mealNames) {
  const names = mealNames || {};
  return {
    version: SCHEMA_VERSION,
    onboarded: false,
    fasting: {
      mode: 'intermittent',
      intermittent: { preset: '16:8', eatingHours: 8, windowStart: '12:00' },
      weekdays: { fastingDays: [0, 6] },
      alternate: {
        cycleStart: toDateKey(now),
        fastingDayType: 'zero',
        modifiedMealTime: '13:00',
        modifiedMealKcal: 500,
      },
      toleranceMinutes: 60,
      minGapMinutes: 150,
    },
    meals: [
      { id: 'breakfast', name: names.breakfast || 'breakfast', time: '07:30' },
      { id: 'lunch', name: names.lunch || 'lunch', time: '12:30' },
      { id: 'snack', name: names.snack || 'snack', time: '16:00' },
      { id: 'dinner', name: names.dinner || 'dinner', time: '19:30' },
    ],
    profile: {
      weightKg: 70,
      heightCm: 170,
      age: 35,
      sex: 'unspecified',
      activity: 'light',
      exerciseMinutes: 30,
      hotClimate: false,
      wakeTime: '07:00',
      sleepTime: '23:00',
      glassMl: 250,
    },
    notifications: { enabled: false, kinds: { water: true, mealAllowed: true, windowOpen: true, windowClosing: true } },
    days: {},
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeFasting(input, defaults) {
  const source = isPlainObject(input) ? input : {};
  const intermittent = isPlainObject(source.intermittent) ? source.intermittent : {};
  const weekdays = isPlainObject(source.weekdays) ? source.weekdays : {};
  const alternate = isPlainObject(source.alternate) ? source.alternate : {};
  const presetIds = INTERMITTENT_PRESETS.map((item) => item.id);
  const fastingDays = Array.isArray(weekdays.fastingDays)
    ? [...new Set(weekdays.fastingDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : defaults.weekdays.fastingDays;
  return {
    mode: pick(source.mode, FASTING_MODES, defaults.mode),
    intermittent: {
      preset: pick(intermittent.preset, presetIds, defaults.intermittent.preset),
      eatingHours: clampInteger(intermittent.eatingHours, LIMITS.eatingHours.min, LIMITS.eatingHours.max, defaults.intermittent.eatingHours),
      windowStart: sanitizeTime(intermittent.windowStart, defaults.intermittent.windowStart),
    },
    weekdays: { fastingDays: fastingDays.length < 7 ? fastingDays : defaults.weekdays.fastingDays },
    alternate: {
      cycleStart: isValidDateKey(alternate.cycleStart) ? alternate.cycleStart : defaults.alternate.cycleStart,
      fastingDayType: pick(alternate.fastingDayType, FASTING_DAY_TYPES, defaults.alternate.fastingDayType),
      modifiedMealTime: sanitizeTime(alternate.modifiedMealTime, defaults.alternate.modifiedMealTime),
      modifiedMealKcal: clampInteger(alternate.modifiedMealKcal, LIMITS.modifiedMealKcal.min, LIMITS.modifiedMealKcal.max, defaults.alternate.modifiedMealKcal),
    },
    toleranceMinutes: clampInteger(source.toleranceMinutes, LIMITS.toleranceMinutes.min, LIMITS.toleranceMinutes.max, defaults.toleranceMinutes),
    minGapMinutes: clampInteger(source.minGapMinutes, LIMITS.minGapMinutes.min, LIMITS.minGapMinutes.max, defaults.minGapMinutes),
  };
}

function sanitizeMeals(input, defaults) {
  if (!Array.isArray(input)) return defaults.map((meal) => ({ ...meal }));
  const seen = new Set();
  const meals = [];
  for (const meal of input) {
    if (!isPlainObject(meal) || typeof meal.id !== 'string' || !ID_PATTERN.test(meal.id)) continue;
    if (meal.id === MODIFIED_MEAL_ID || seen.has(meal.id)) continue;
    seen.add(meal.id);
    const fallback = defaults.find((item) => item.id === meal.id);
    meals.push({
      id: meal.id,
      name: sanitizeMealName(meal.name, fallback ? fallback.name : meal.id),
      time: sanitizeTime(meal.time, fallback ? fallback.time : '12:00'),
    });
    if (meals.length >= MAX_MEALS) break;
  }
  return meals;
}

function sanitizeProfile(input, defaults) {
  const source = isPlainObject(input) ? input : {};
  return {
    weightKg: clampNumber(source.weightKg, LIMITS.weightKg.min, LIMITS.weightKg.max, defaults.weightKg),
    heightCm: clampInteger(source.heightCm, LIMITS.heightCm.min, LIMITS.heightCm.max, defaults.heightCm),
    age: clampInteger(source.age, LIMITS.age.min, LIMITS.age.max, defaults.age),
    sex: pick(source.sex, SEXES, defaults.sex),
    activity: pick(source.activity, ACTIVITY_LEVELS, defaults.activity),
    exerciseMinutes: clampInteger(source.exerciseMinutes, LIMITS.exerciseMinutes.min, LIMITS.exerciseMinutes.max, defaults.exerciseMinutes),
    hotClimate: typeof source.hotClimate === 'boolean' ? source.hotClimate : defaults.hotClimate,
    wakeTime: sanitizeTime(source.wakeTime, defaults.wakeTime),
    sleepTime: sanitizeTime(source.sleepTime, defaults.sleepTime),
    glassMl: clampInteger(source.glassMl, LIMITS.glassMl.min, LIMITS.glassMl.max, defaults.glassMl),
  };
}

function sanitizeDay(input) {
  const source = isPlainObject(input) ? input : {};
  const meals = {};
  if (isPlainObject(source.meals)) {
    for (const [id, value] of Object.entries(source.meals)) {
      if (!ID_PATTERN.test(id) || !isPlainObject(value)) continue;
      if (!Number.isFinite(value.eatenAt) || !Number.isFinite(value.minute)) continue;
      meals[id] = { eatenAt: value.eatenAt, minute: clampInteger(value.minute, LIMITS.dayMinute.min, LIMITS.dayMinute.max, 0) };
    }
  }
  const skips = {};
  if (isPlainObject(source.skips)) {
    for (const [id, reason] of Object.entries(source.skips)) {
      if (ID_PATTERN.test(id) && SKIP_REASONS.includes(reason)) skips[id] = reason;
    }
  }
  const adjustments = {};
  if (isPlainObject(source.adjustments)) {
    for (const [id, minutes] of Object.entries(source.adjustments)) {
      if (ID_PATTERN.test(id) && Number.isFinite(minutes)) adjustments[id] = clampInteger(minutes, LIMITS.dayMinute.min, LIMITS.dayMinute.max, 0);
    }
  }
  const water = Array.isArray(source.water)
    ? source.water
        .filter((entry) => isPlainObject(entry) && Number.isFinite(entry.at) && Number.isFinite(entry.ml))
        .slice(-MAX_WATER_ENTRIES)
        .map((entry, index) => ({
          id: typeof entry.id === 'string' && ID_PATTERN.test(entry.id) ? entry.id : `w-${Math.round(entry.at).toString(36)}-${index}`,
          at: entry.at,
          ml: clampInteger(entry.ml, LIMITS.waterEntryMl.min, LIMITS.waterEntryMl.max, 250),
        }))
    : [];
  return {
    windowShift: clampInteger(source.windowShift, LIMITS.windowShift.min, LIMITS.windowShift.max, 0),
    meals,
    skips,
    adjustments,
    water,
    lastReminder: clampInteger(source.lastReminder, -1, LIMITS.dayMinute.max + 1, -1),
  };
}

function sanitizeDays(input, now) {
  if (!isPlainObject(input)) return {};
  const todayKey = toDateKey(now);
  const days = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isValidDateKey(key)) continue;
    const age = daysBetween(key, todayKey);
    if (age > RETENTION_DAYS || age < -1) continue;
    days[key] = sanitizeDay(value);
  }
  return days;
}

function sanitizeNotifications(input, defaults) {
  const source = isPlainObject(input) ? input : {};
  const kinds = isPlainObject(source.kinds) ? source.kinds : {};
  return {
    enabled: source.enabled === true,
    kinds: Object.fromEntries(Object.keys(defaults.kinds).map((kind) => [kind, typeof kinds[kind] === 'boolean' ? kinds[kind] : defaults.kinds[kind]])),
  };
}

export function sanitizeState(candidate, defaults, now) {
  if (!isPlainObject(candidate)) return defaults;
  return {
    version: SCHEMA_VERSION,
    onboarded: candidate.onboarded === true,
    fasting: sanitizeFasting(candidate.fasting, defaults.fasting),
    meals: sanitizeMeals(candidate.meals, defaults.meals),
    profile: sanitizeProfile(candidate.profile, defaults.profile),
    notifications: sanitizeNotifications(candidate.notifications, defaults.notifications),
    days: sanitizeDays(candidate.days, now),
  };
}

export function migrateState(candidate) {
  if (!isPlainObject(candidate)) return null;
  if (candidate.version === SCHEMA_VERSION) return candidate;
  return null;
}

export function inspectState(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { status: 'empty', parsed: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', parsed: null };
  }
  const migrated = migrateState(parsed);
  if (!migrated) return { status: isPlainObject(parsed) && 'version' in parsed ? 'unknownVersion' : 'corrupt', parsed: null };
  return { status: 'ok', parsed: migrated };
}

export function parseState(raw, defaults, now) {
  const inspected = inspectState(raw);
  if (inspected.status !== 'ok') return defaults;
  return sanitizeState(inspected.parsed, defaults, now);
}

export function loadStateWithReport(storage, defaults, now) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: defaults, backupKey: null, status: 'unavailable' };
  }
  const inspected = inspectState(raw);
  if (inspected.status === 'ok') return { state: sanitizeState(inspected.parsed, defaults, now), backupKey: null, status: 'ok' };
  if (inspected.status === 'empty') return { state: defaults, backupKey: null, status: 'empty' };
  const backupKey = `${BACKUP_KEY_PREFIX}${now.getTime()}`;
  try {
    storage.setItem(backupKey, raw);
    storage.removeItem(STORAGE_KEY);
  } catch {
    return { state: defaults, backupKey: null, status: 'backupFailed' };
  }
  return { state: defaults, backupKey, status: inspected.status };
}

export function loadState(storage, defaults, now) {
  return loadStateWithReport(storage, defaults, now).state;
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  return true;
}

export function resolveNotificationsEnabled(wanted, permission) {
  return wanted === true && permission === 'granted';
}

export function mergeSettings(state, draft) {
  return {
    ...state,
    fasting: draft.fasting,
    meals: draft.meals,
    profile: draft.profile,
    notifications: draft.notifications,
  };
}
